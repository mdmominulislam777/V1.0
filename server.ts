import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { Readable } from "stream";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// Initialize GoogleGenAI with secure header mapping
const aiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "AIzaSy" + "DummyPlaceholder_ReplaceWithRealSecret_IfRequired",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});

// Universal multi-sport channel resolver loader
let channelResolverModule: any = null;
import("./sportsApi/channelResolver.js")
  .then((m) => {
    channelResolverModule = m?.default || (globalThis as any).HighFyChannelResolver;
  })
  .catch(() => {});

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "2da9bc7707msh95f431d97eae2d9p11dacfjsn8ac155ee8d81";
const DEFAULT_CRICKET_HOST = "cricbuzz-cricket2.p.rapidapi.com";

function sanitizeCricbuzzHost(h?: any): string {
  const str = typeof h === "string" ? h : Array.isArray(h) ? String(h[0] || "") : "";
  if (!str) return DEFAULT_CRICKET_HOST;
  const trimmed = str.trim();
  if (!trimmed.includes(".") || trimmed.length > 40 || trimmed.includes("msh95f4") || trimmed.length === 50 || !trimmed.includes("rapidapi.com")) {
    return DEFAULT_CRICKET_HOST;
  }
  return trimmed;
}

const RAPIDAPI_CRICKET_HOST = sanitizeCricbuzzHost(process.env.CRICBUZZ_RAPIDAPI_HOST);
const RAW_THESPORTSDB_SECRET = (
  process.env.THESPORTSDB_API_KEY ||
  process.env.THESPORTSDB_KEY ||
  process.env.THESPORTSDB_BASE_URL ||
  ""
).trim();
const IS_THESPORTSDB_SECRET_CONFIGURED = Boolean(RAW_THESPORTSDB_SECRET);
const THESPORTSDB_KEY = RAW_THESPORTSDB_SECRET
  ? RAW_THESPORTSDB_SECRET.replace(/^https?:\/\/www\.thesportsdb\.com\/api\/v1\/json\/?/i, "").replace(/\/+$/, "").trim() || "3"
  : "3";
const THESPORTSDB_BASE = `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}`;

function extractAllSportsEnvKey(): string {
  const candidates = [
    process.env.ALLSPORTS_API_KEY,
    process.env.ALLSPORTSAPI_KEY,
    process.env.ALLSPORTSAPI_BASE_URL,
    process.env.ALLSPORTS_BASE_URL,
  ];
  for (const raw of candidates) {
    const val = (raw || "").trim();
    if (!val) continue;
    if (/^https?:\/\//i.test(val)) {
      try {
        const u = new URL(val);
        const k = (u.searchParams.get("APIkey") || u.searchParams.get("apikey") || u.searchParams.get("apiKey") || u.searchParams.get("key") || "").trim();
        if (k) return k;
      } catch {}
      continue;
    }
    return val;
  }
  return "";
}

const ALLSPORTSAPI_KEY = extractAllSportsEnvKey();
const ALLSPORTSAPI_BASE = "https://apiv2.allsportsapi.com";

const CRICKETDATA_API_KEY = (process.env.CRICKETDATA_API_KEY || process.env.CRICAPI_KEY || process.env.CRICKET_API_KEY || "").trim();

// Cricbuzz API toggle: Permanently disabled per user request
const ENABLE_CRICBUZZ_API = false;

// In-memory cache & In-flight request coalescers to preserve API quota
interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

// In-flight promise coalescers (Prevents duplicate parallel requests to upstream APIs)
const inFlightPromises = {
  rapidSchedule: null as Promise<any> | null,
  rapidTeams: null as Promise<any[]> | null,
  rapidCricketMatches: null as Promise<any[]> | null,
  cricketDataMatches: null as Promise<any[]> | null,
  sportsDbEvents: null as Promise<any[]> | null,
  sportsProxy: new Map<string, Promise<any>>(),
};

const rapidCache = {
  schedule: null as CacheEntry<any> | null,
  teams: null as CacheEntry<any> | null,
  players: new Map<string, CacheEntry<any>>(),
  matches: null as CacheEntry<any[]> | null,
  TTL_SCHEDULE_NORMAL: 20 * 60 * 1000, // 20 minutes for general cricket schedule
  TTL_SCHEDULE_LIVE: 3 * 60 * 1000,    // 3 minutes when live matches are active
  TTL_STATIC: 12 * 60 * 60 * 1000,      // 12 hours for static teams and player squads
};

const sportsDbCache = {
  events: null as CacheEntry<any[]> | null,
  leagues: new Map<string, CacheEntry<any>>(),
  details: new Map<string, CacheEntry<any>>(),
  TTL_EVENTS: 20 * 60 * 1000, // 20 minutes for curated events index
  TTL_LEAGUES: 30 * 60 * 1000, // 30 minutes for league fixtures
  TTL_DETAILS: 30 * 60 * 1000, // 30 minutes for event details
};

const CRICKET_CACHE_TTL_SECONDS = 180;
const CRICKET_CACHE_TTL_MS = CRICKET_CACHE_TTL_SECONDS * 1000; // 180 seconds
const CRICKET_BLOCK_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes cooldown when blocked

const cricketDataCache = {
  matches: null as CacheEntry<any[]> | null,
  current: null as CacheEntry<any> | null,
  allMatches: null as CacheEntry<any> | null,
  series: null as CacheEntry<any> | null,
  details: new Map<string, CacheEntry<any>>(),
  source: "CricketData.org" as "CricketData.org" | "ESPN-Fallback",
  lastStatus: 200 as number,
  lastError: "" as string,
  blocked: false as boolean,
  blockedUntil: 0 as number,
  rateLimited: false as boolean,
  TTL_LIVE: CRICKET_CACHE_TTL_MS,     // 180 seconds cache TTL
  TTL_SCHEDULE: CRICKET_CACHE_TTL_MS, // 180 seconds cache TTL
  TTL_STATIC: 30 * 60 * 1000,         // 30 minutes for series list
};

const allSportsApiCache = {
  events: null as CacheEntry<any[]> | null,
  TTL: 3 * 60 * 1000, // 3 minutes for live scores
};

// ============================================================================
// HIGHFY TV ANTI-SNIFF & REQABLE SECURITY SYSTEM
// ============================================================================
const STREAM_SECURITY_KEY = crypto
  .createHash("sha256")
  .update(process.env.STREAM_SECRET || "highfy-anti-sniff-stream-guard-2026-secure-token")
  .digest();

// AES-256-GCM token encryption with timestamp payload to prevent permanent replay attacks
function encryptStreamUrl(url: string): string {
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", STREAM_SECURITY_KEY, iv);
    // Payload: timestamp + delimiter + url (allows dynamic token expiration)
    const payload = `${Date.now()}||${url}`;
    let enc = cipher.update(payload, "utf8", "base64url");
    enc += cipher.final("base64url");
    const tag = cipher.getAuthTag().toString("base64url");
    return `${iv.toString("base64url")}.${tag}.${enc}`;
  } catch (err: any) {
    return Buffer.from(url).toString("base64url");
  }
}

function decryptStreamUrl(token: string): string | null {
  try {
    const trimmed = token.trim();
    const parts = trimmed.split(".");
    if (parts.length === 3) {
      const iv = Buffer.from(parts[0], "base64url");
      const tag = Buffer.from(parts[1], "base64url");
      const enc = parts[2];
      const decipher = crypto.createDecipheriv("aes-256-gcm", STREAM_SECURITY_KEY, iv);
      decipher.setAuthTag(tag);
      let dec = decipher.update(enc, "base64url", "utf8");
      dec += decipher.final("utf8");

      // Check timestamped payload format: timestamp||url
      if (dec.includes("||")) {
        const separatorIdx = dec.indexOf("||");
        const ts = parseInt(dec.slice(0, separatorIdx), 10);
        const url = dec.slice(separatorIdx + 2);
        // Tokens are valid for up to 6 hours (renewable continuously by the active player)
        if (!isNaN(ts) && (Date.now() - ts < 6 * 60 * 60 * 1000) && /^https?:\/\//i.test(url)) {
          return url;
        }
      }

      // Legacy direct URL format inside GCM
      if (/^https?:\/\//i.test(dec)) {
        return dec;
      }
    }

    // Fallback: standard base64url decode
    const buf = Buffer.from(trimmed, "base64url").toString("utf8");
    if (/^https?:\/\//i.test(buf)) return buf;
    return null;
  } catch {
    return null;
  }
}

function isReqableOrSnifferThreat(req: express.Request): { detected: boolean; reason: string } {
  const userAgent = (req.headers["user-agent"] || "").toLowerCase();
  const rawHeaders = JSON.stringify(req.headers).toLowerCase();

  // 1. Packet Sniffers & Reverse Engineering Tools
  if (userAgent.includes("reqable") || rawHeaders.includes("reqable")) {
    return { detected: true, reason: "Reqable network sniffer detected" };
  }
  if (userAgent.includes("charles") || rawHeaders.includes("charlesproxy")) {
    return { detected: true, reason: "Charles proxy detected" };
  }
  if (userAgent.includes("fiddler") || rawHeaders.includes("fiddler")) {
    return { detected: true, reason: "Fiddler sniffer detected" };
  }
  if (userAgent.includes("http toolkit") || rawHeaders.includes("httptoolkit")) {
    return { detected: true, reason: "HTTP Toolkit detected" };
  }
  if (userAgent.includes("burp") || rawHeaders.includes("burpcollaborator") || rawHeaders.includes("x-burp")) {
    return { detected: true, reason: "Burp Suite detected" };
  }
  if (userAgent.includes("wireshark") || rawHeaders.includes("wireshark")) {
    return { detected: true, reason: "Wireshark traffic capture detected" };
  }
  if (userAgent.includes("mitmproxy") || rawHeaders.includes("mitmproxy")) {
    return { detected: true, reason: "mitmproxy interceptor detected" };
  }

  // 2. Command-Line Scraping & Downloading Bots (unless internal, health probe, or authorized)
  const isLoopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  if (
    !isLoopback && (
      userAgent.startsWith("wget/") ||
      userAgent.includes("python-requests") ||
      userAgent.includes("aiohttp") ||
      userAgent.includes("scrapy") ||
      userAgent.includes("postmanruntime")
    )
  ) {
    return { detected: true, reason: "Automated scraper tool detected" };
  }

  // 3. Known Proxy & Sniffer Specific Injected Headers
  if (
    req.headers["x-reqable-proxy"] ||
    req.headers["reqable-client"] ||
    req.headers["reqable-version"] ||
    req.headers["x-mitmproxy"] ||
    req.headers["x-charles-proxy"] ||
    req.headers["x-packet-sniffer"]
  ) {
    return { detected: true, reason: "Proxy sniffer injected headers detected" };
  }

  return { detected: false, reason: "" };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.DEFAULT_APP_PORT || process.env.PORT || 3000);

  // 1. Configure Trust Proxy for Reverse Proxies (Cloud Run / Nginx)
  app.set("trust proxy", 1);

  // 2. Hide sensitive server fingerprint headers
  app.disable("x-powered-by");

  // 3. Helmet Security Headers (Content-Security-Policy tailored for video streaming, iframe players & assets)
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows flexible video stream CDN embeds (HLS/m3u8/iframes)
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: false,
      frameguard: false, // Allows safe AI Studio iframe preview
    })
  );

  // 4. Global API Rate Limiter (Protects against DDoS, Brute Force & Scraping Attacks)
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : (process.env.NODE_ENV !== "production" ? 10000 : 120), // Configurable or relaxed in dev/staging for load testing
    standardHeaders: true,
    legacyHeaders: false,
    validate: {
      trustProxy: false,
      xForwardedForHeader: false,
      forwardedHeader: false,
    },
    message: { error: "Too many requests, please try again later." },
  });
  app.use("/api/", apiLimiter);

  // 5. CORS Protection & JSON Body parsing with strict payload limit
  app.use(cors());
  app.use(express.json({ limit: "100kb" }));

  // 6. Anti-Reqable & Anti-Sniffer Network Firewall Middleware
  app.use((req, res, next) => {
    // Permit threat verification check endpoint to report status to client
    if (req.path === "/api/security/check-threat") {
      return next();
    }

    const threat = isReqableOrSnifferThreat(req);
    if (threat.detected) {
      console.warn(`[HighFy Security] Blocked sniffer threat (${threat.reason}) from IP: ${req.ip}`);
      return res.status(403).json({
        status: "error",
        blocked: true,
        code: "REQABLE_DETECTED",
        threat: threat.reason,
        message: "reqable আনইস্টল করো",
        detail: "নিরাপত্তা সতর্কতা: আপনার ডিভাইসে Reqable বা নেটওয়ার্ক স্নিফিং অ্যাপ সনাক্ত করা হয়েছে। হাইফাই টিভি ব্যবহার করতে এটি আনইন্সটল করুন।"
      });
    }
    next();
  });

  // Client Threat & Reqable Verification Endpoint
  app.get("/api/security/check-threat", (req, res) => {
    const threat = isReqableOrSnifferThreat(req);
    res.json({
      status: "success",
      blocked: threat.detected,
      threat: threat.reason || null,
      message: threat.detected ? "reqable আনইস্টল করো" : "clear",
      timestamp: Date.now()
    });
  });

  // Stream URL Protection / Encryption Endpoint
  app.get("/api/security/protect-stream", (req, res) => {
    try {
      const rawUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
        return res.status(400).json({ status: "error", message: "Invalid stream URL" });
      }
      const token = encryptStreamUrl(rawUrl);
      return res.json({
        status: "success",
        token,
        proxyUrl: `/api/stream-proxy?token=${token}`
      });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Sanitize path parameter helper to prevent path traversal
  const sanitizePath = (p: string): string => {
    return p.replace(/(\.\.[\/\\])+/g, "").replace(/^\/+/, "");
  };

  // Helper: Fetch and cache Cricbuzz Cricket Teams (Single-Flight Promise Coalescer)
  async function fetchRapidTeams(customKey?: string): Promise<any[]> {
    if (!ENABLE_CRICBUZZ_API) return [];
    const activeKey = (customKey && customKey.trim()) ? customKey.trim() : RAPIDAPI_KEY;
    const now = Date.now();
    if (rapidCache.teams && (now - rapidCache.teams.timestamp < rapidCache.TTL_STATIC)) {
      return rapidCache.teams.data;
    }
    if (inFlightPromises.rapidTeams) {
      return inFlightPromises.rapidTeams;
    }

    inFlightPromises.rapidTeams = (async () => {
      try {
        const response = await fetch(`https://${RAPIDAPI_CRICKET_HOST}/teams/v1/international`, {
          headers: {
            "x-rapidapi-host": RAPIDAPI_CRICKET_HOST,
            "x-rapidapi-key": activeKey,
          },
        });
        if (response.ok) {
          const json: any = await response.json();
          const teams = Array.isArray(json.list) ? json.list : (Array.isArray(json.teams) ? json.teams : (Array.isArray(json.response) ? json.response : []));
          rapidCache.teams = { timestamp: Date.now(), data: teams };
          return teams;
        }
      } catch (e: any) {
        console.warn("[Backend Proxy] RapidAPI teams fetch error:", e.message);
      } finally {
        inFlightPromises.rapidTeams = null;
      }
      return rapidCache.teams?.data || [];
    })();

    return inFlightPromises.rapidTeams;
  }

  // Helper: Fetch and cache Cricbuzz Cricket Schedule (Single-Flight Promise Coalescer & Adaptive TTL)
  async function fetchRapidSchedule(customKey?: string): Promise<any> {
    if (!ENABLE_CRICBUZZ_API) return null;
    const activeKey = (customKey && customKey.trim()) ? customKey.trim() : RAPIDAPI_KEY;
    const now = Date.now();
    const currentTtl = rapidCache.TTL_SCHEDULE_NORMAL;
    if (rapidCache.schedule && (now - rapidCache.schedule.timestamp < currentTtl)) {
      return rapidCache.schedule.data;
    }
    if (inFlightPromises.rapidSchedule) {
      return inFlightPromises.rapidSchedule;
    }

    inFlightPromises.rapidSchedule = (async () => {
      try {
        const response = await fetch(`https://${RAPIDAPI_CRICKET_HOST}/matches/v1/upcoming`, {
          headers: {
            "x-rapidapi-host": RAPIDAPI_CRICKET_HOST,
            "x-rapidapi-key": activeKey,
          },
        });
        if (response.ok) {
          const json = await response.json();
          rapidCache.schedule = { timestamp: Date.now(), data: json };
          return json;
        }
      } catch (e: any) {
        console.warn("[Backend Proxy] RapidAPI schedule fetch error:", e.message);
      } finally {
        inFlightPromises.rapidSchedule = null;
      }
      return rapidCache.schedule?.data || null;
    })();

    return inFlightPromises.rapidSchedule;
  }

  // Helper: Transform RapidAPI Schedule into Normalized Match Events (Cached & Coalesced)
  // Universal Bangladesh (Asia/Dhaka BST) Event Date & Time Formatter
  function formatDhakaEventTime(timestamp: number): string {
    try {
      const dateObj = new Date(timestamp);
      const now = new Date();
      const tz = "Asia/Dhaka";
      const timeStr = dateObj.toLocaleTimeString("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      const hourFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
      });
      const dateFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      const dateLocalFmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const evComp = dateLocalFmt.format(dateObj);
      const todayComp = dateLocalFmt.format(now);

      const evHour = parseInt(hourFormatter.format(dateObj), 10);
      const nowHour = parseInt(hourFormatter.format(now), 10);

      const [evY, evM, evD] = evComp.split(/[-/]/).map(Number);
      const [nowY, nowM, nowD] = todayComp.split(/[-/]/).map(Number);
      const evDateOnly = new Date(Date.UTC(evY, evM - 1, evD));
      const nowDateOnly = new Date(Date.UTC(nowY, nowM - 1, nowD));
      const dayDiff = Math.round((evDateOnly.getTime() - nowDateOnly.getTime()) / (24 * 3600 * 1000));

      if (dayDiff === 0) {
        if (evHour < 6 && nowHour >= 6) {
          return `Last Night, ${timeStr} BST`;
        }
        return `Today, ${timeStr} BST`;
      } else if (dayDiff === 1) {
        if (evHour < 6) {
          return `Tonight, ${timeStr} BST`;
        }
        return `Tomorrow, ${timeStr} BST`;
      } else if (dayDiff === -1) {
        return `Yesterday, ${timeStr} BST`;
      } else {
        const dateStr = dateFormatter.format(dateObj);
        return `${dateStr}, ${timeStr} BST`;
      }
    } catch (e) {
      return new Date(timestamp).toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: true }) + " BST";
    }
  }

  const HD_CRICKET_LOGOS_MAP: Record<string, string> = {
    // International & ICC Full/Associate Member Official Cricket Board Crests & Flags
    "india": "https://r2.thesportsdb.com/images/media/team/badge/donl7g1646775159.png",
    "ind": "https://r2.thesportsdb.com/images/media/team/badge/donl7g1646775159.png",
    "bangladesh": "https://r2.thesportsdb.com/images/media/team/badge/j74o4t1646775146.png",
    "ban": "https://r2.thesportsdb.com/images/media/team/badge/j74o4t1646775146.png",
    "pakistan": "https://r2.thesportsdb.com/images/media/team/badge/03o8241646775177.png",
    "pak": "https://r2.thesportsdb.com/images/media/team/badge/03o8241646775177.png",
    "england": "https://r2.thesportsdb.com/images/media/team/badge/y5wcl81646775152.png",
    "eng": "https://r2.thesportsdb.com/images/media/team/badge/y5wcl81646775152.png",
    "australia": "https://r2.thesportsdb.com/images/media/team/badge/zvm8581646775132.png",
    "aus": "https://r2.thesportsdb.com/images/media/team/badge/zvm8581646775132.png",
    "sri lanka": "https://r2.thesportsdb.com/images/media/team/badge/i5fqg01646775193.png",
    "sl": "https://r2.thesportsdb.com/images/media/team/badge/i5fqg01646775193.png",
    "south africa": "https://r2.thesportsdb.com/images/media/team/badge/hn47e51646775185.png",
    "sa": "https://r2.thesportsdb.com/images/media/team/badge/hn47e51646775185.png",
    "rsa": "https://r2.thesportsdb.com/images/media/team/badge/hn47e51646775185.png",
    "new zealand": "https://r2.thesportsdb.com/images/media/team/badge/1yyh9s1646775166.png",
    "nz": "https://r2.thesportsdb.com/images/media/team/badge/1yyh9s1646775166.png",
    "west indies": "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
    "wi": "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
    "win": "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
    "windies": "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
    "afghanistan": "https://r2.thesportsdb.com/images/media/team/badge/bzu3v71646775261.png",
    "afg": "https://r2.thesportsdb.com/images/media/team/badge/bzu3v71646775261.png",
    "ireland": "https://r2.thesportsdb.com/images/media/team/badge/wlryed1646775269.png",
    "ire": "https://r2.thesportsdb.com/images/media/team/badge/wlryed1646775269.png",
    "irl": "https://r2.thesportsdb.com/images/media/team/badge/wlryed1646775269.png",
    "scotland": "https://r2.thesportsdb.com/images/media/team/badge/78woeh1646775360.png",
    "sco": "https://r2.thesportsdb.com/images/media/team/badge/78woeh1646775360.png",
    "netherlands": "https://r2.thesportsdb.com/images/media/team/badge/um67l21779090256.png",
    "ned": "https://r2.thesportsdb.com/images/media/team/badge/um67l21779090256.png",
    "zimbabwe": "https://r2.thesportsdb.com/images/media/team/badge/7ah0831646775278.png",
    "zim": "https://r2.thesportsdb.com/images/media/team/badge/7ah0831646775278.png",
    "nepal": "https://r2.thesportsdb.com/images/media/team/badge/bn5wrv1646775335.png",
    "nep": "https://r2.thesportsdb.com/images/media/team/badge/bn5wrv1646775335.png",
    "usa": "https://r2.thesportsdb.com/images/media/team/badge/abmnzg1583580897.png",
    "united states": "https://r2.thesportsdb.com/images/media/team/badge/abmnzg1583580897.png",
    "canada": "https://r2.thesportsdb.com/images/media/team/badge/o49xhy1645907007.png",
    "can": "https://r2.thesportsdb.com/images/media/team/badge/o49xhy1645907007.png",
    "uae": "https://r2.thesportsdb.com/images/media/team/badge/6poybf1583580847.png",
    "united arab emirates": "https://r2.thesportsdb.com/images/media/team/badge/6poybf1583580847.png",
    "oman": "https://r2.thesportsdb.com/images/media/team/badge/5ybzn71625862595.png",
    "oma": "https://r2.thesportsdb.com/images/media/team/badge/5ybzn71625862595.png",
    "namibia": "https://r2.thesportsdb.com/images/media/team/badge/myxq3q1583580470.png",
    "nam": "https://r2.thesportsdb.com/images/media/team/badge/myxq3q1583580470.png",
    "hong kong": "https://r2.thesportsdb.com/images/media/team/badge/5q02lz1625863342.png",
    "hong kong, china": "https://r2.thesportsdb.com/images/media/team/badge/5q02lz1625863342.png",
    "hkg": "https://r2.thesportsdb.com/images/media/team/badge/5q02lz1625863342.png",
    "papua new guinea": "https://r2.thesportsdb.com/images/media/team/badge/swdkjm1646775345.png",
    "png": "https://r2.thesportsdb.com/images/media/team/badge/swdkjm1646775345.png",
    "uganda": "https://r2.thesportsdb.com/images/media/team/badge/155jix1625862051.png",
    "uga": "https://r2.thesportsdb.com/images/media/team/badge/155jix1625862051.png",
    "kenya": "https://r2.thesportsdb.com/images/media/team/badge/oym2v91646775312.png",
    "ken": "https://r2.thesportsdb.com/images/media/team/badge/oym2v91646775312.png",
    "bahamas": "https://flagcdn.com/w320/bs.png",
    "bah": "https://flagcdn.com/w320/bs.png",
    "bermuda": "https://flagcdn.com/w320/bm.png",
    "ber": "https://flagcdn.com/w320/bm.png",
    "bmu": "https://flagcdn.com/w320/bm.png",
    "cayman islands": "https://flagcdn.com/w320/ky.png",
    "cay": "https://flagcdn.com/w320/ky.png",
    "malaysia": "https://flagcdn.com/w320/my.png",
    "mal": "https://flagcdn.com/w320/my.png",
    "mas": "https://flagcdn.com/w320/my.png",
    "kuwait": "https://flagcdn.com/w320/kw.png",
    "kuw": "https://flagcdn.com/w320/kw.png",
    "bahrain": "https://flagcdn.com/w320/bh.png",
    "bhr": "https://flagcdn.com/w320/bh.png",
    "qatar": "https://flagcdn.com/w320/qa.png",
    "qat": "https://flagcdn.com/w320/qa.png",
    "saudi arabia": "https://flagcdn.com/w320/sa.png",
    "ksa": "https://flagcdn.com/w320/sa.png",
    "singapore": "https://flagcdn.com/w320/sg.png",
    "sin": "https://flagcdn.com/w320/sg.png",
    "sgp": "https://flagcdn.com/w320/sg.png",
    "thailand": "https://flagcdn.com/w320/th.png",
    "tha": "https://flagcdn.com/w320/th.png",
    "japan": "https://flagcdn.com/w320/jp.png",
    "jpn": "https://flagcdn.com/w320/jp.png",
    "tanzania": "https://flagcdn.com/w320/tz.png",
    "tan": "https://flagcdn.com/w320/tz.png",
    "nigeria": "https://flagcdn.com/w320/ng.png",
    "ngr": "https://flagcdn.com/w320/ng.png",
    "rwanda": "https://flagcdn.com/w320/rw.png",
    "rwa": "https://flagcdn.com/w320/rw.png",
    "botswana": "https://flagcdn.com/w320/bw.png",
    "bot": "https://flagcdn.com/w320/bw.png",
    "jersey": "https://flagcdn.com/w320/je.png",
    "jer": "https://flagcdn.com/w320/je.png",
    "guernsey": "https://flagcdn.com/w320/gg.png",
    "gue": "https://flagcdn.com/w320/gg.png",
    "italy": "https://flagcdn.com/w320/it.png",
    "ita": "https://flagcdn.com/w320/it.png",
    "germany": "https://flagcdn.com/w320/de.png",
    "ger": "https://flagcdn.com/w320/de.png",
    "spain": "https://flagcdn.com/w320/es.png",
    "esp": "https://flagcdn.com/w320/es.png",
    "denmark": "https://flagcdn.com/w320/dk.png",
    "den": "https://flagcdn.com/w320/dk.png",
    "vanuatu": "https://flagcdn.com/w320/vu.png",
    "samoa": "https://flagcdn.com/w320/ws.png",
    "fiji": "https://flagcdn.com/w320/fj.png",
    "argentina": "https://flagcdn.com/w320/ar.png",
    "brazil": "https://flagcdn.com/w320/br.png",
    "switzerland": "https://flagcdn.com/w320/ch.png",
    "sui": "https://flagcdn.com/w320/ch.png",
    "belgium": "https://flagcdn.com/w320/be.png",
    "bel": "https://flagcdn.com/w320/be.png",
    "luxembourg": "https://flagcdn.com/w320/lu.png",
    "lux": "https://flagcdn.com/w320/lu.png",
    "china": "https://flagcdn.com/w320/cn.png",
    "chn": "https://flagcdn.com/w320/cn.png",
    "austria": "https://flagcdn.com/w320/at.png",
    "aut": "https://flagcdn.com/w320/at.png",
    "france": "https://flagcdn.com/w320/fr.png",
    "fra": "https://flagcdn.com/w320/fr.png",
    "norway": "https://flagcdn.com/w320/no.png",
    "nor": "https://flagcdn.com/w320/no.png",
    "sweden": "https://flagcdn.com/w320/se.png",
    "swe": "https://flagcdn.com/w320/se.png",
    "finland": "https://flagcdn.com/w320/fi.png",
    "fin": "https://flagcdn.com/w320/fi.png",
    "portugal": "https://flagcdn.com/w320/pt.png",
    "por": "https://flagcdn.com/w320/pt.png",
    "malta": "https://flagcdn.com/w320/mt.png",
    "mlt": "https://flagcdn.com/w320/mt.png",
    "romania": "https://flagcdn.com/w320/ro.png",
    "rou": "https://flagcdn.com/w320/ro.png",
    "greece": "https://flagcdn.com/w320/gr.png",
    "gre": "https://flagcdn.com/w320/gr.png",
    "cyprus": "https://flagcdn.com/w320/cy.png",
    "cyp": "https://flagcdn.com/w320/cy.png",
    "estonia": "https://flagcdn.com/w320/ee.png",
    "est": "https://flagcdn.com/w320/ee.png",
    "czech republic": "https://flagcdn.com/w320/cz.png",
    "czechia": "https://flagcdn.com/w320/cz.png",
    "cze": "https://flagcdn.com/w320/cz.png",
    "hungary": "https://flagcdn.com/w320/hu.png",
    "hun": "https://flagcdn.com/w320/hu.png",
    "serbia": "https://flagcdn.com/w320/rs.png",
    "srb": "https://flagcdn.com/w320/rs.png",
    "bulgaria": "https://flagcdn.com/w320/bg.png",
    "bul": "https://flagcdn.com/w320/bg.png",
    "croatia": "https://flagcdn.com/w320/hr.png",
    "cro": "https://flagcdn.com/w320/hr.png",
    "slovenia": "https://flagcdn.com/w320/si.png",
    "svn": "https://flagcdn.com/w320/si.png",
    "turkey": "https://flagcdn.com/w320/tr.png",
    "tur": "https://flagcdn.com/w320/tr.png",
    "israel": "https://flagcdn.com/w320/il.png",
    "isr": "https://flagcdn.com/w320/il.png",
    "philippines": "https://flagcdn.com/w320/ph.png",
    "phi": "https://flagcdn.com/w320/ph.png",
    "indonesia": "https://flagcdn.com/w320/id.png",
    "ina": "https://flagcdn.com/w320/id.png",
    "idn": "https://flagcdn.com/w320/id.png",
    "myanmar": "https://flagcdn.com/w320/mm.png",
    "mya": "https://flagcdn.com/w320/mm.png",
    "cambodia": "https://flagcdn.com/w320/kh.png",
    "cam": "https://flagcdn.com/w320/kh.png",
    "bhutan": "https://flagcdn.com/w320/bt.png",
    "bhu": "https://flagcdn.com/w320/bt.png",
    "maldives": "https://flagcdn.com/w320/mv.png",
    "mdv": "https://flagcdn.com/w320/mv.png",
    "mongolia": "https://flagcdn.com/w320/mn.png",
    "mgl": "https://flagcdn.com/w320/mn.png",
    "south korea": "https://flagcdn.com/w320/kr.png",
    "korea": "https://flagcdn.com/w320/kr.png",
    "kor": "https://flagcdn.com/w320/kr.png",
    "mexico": "https://flagcdn.com/w320/mx.png",
    "mex": "https://flagcdn.com/w320/mx.png",
    "chile": "https://flagcdn.com/w320/cl.png",
    "chi": "https://flagcdn.com/w320/cl.png",
    "peru": "https://flagcdn.com/w320/pe.png",
    "per": "https://flagcdn.com/w320/pe.png",
    "panama": "https://flagcdn.com/w320/pa.png",
    "pan": "https://flagcdn.com/w320/pa.png",
    "costa rica": "https://flagcdn.com/w320/cr.png",
    "crc": "https://flagcdn.com/w320/cr.png",
    "belize": "https://flagcdn.com/w320/bz.png",
    "blz": "https://flagcdn.com/w320/bz.png",
    "suriname": "https://flagcdn.com/w320/sr.png",
    "sur": "https://flagcdn.com/w320/sr.png",
    "sierra leone": "https://flagcdn.com/w320/sl.png",
    "sle": "https://flagcdn.com/w320/sl.png",
    "ghana": "https://flagcdn.com/w320/gh.png",
    "gha": "https://flagcdn.com/w320/gh.png",
    "cameroon": "https://flagcdn.com/w320/cm.png",
    "cmr": "https://flagcdn.com/w320/cm.png",
    "malawi": "https://flagcdn.com/w320/mw.png",
    "mwi": "https://flagcdn.com/w320/mw.png",
    "mozambique": "https://flagcdn.com/w320/mz.png",
    "moz": "https://flagcdn.com/w320/mz.png",
    "lesotho": "https://flagcdn.com/w320/ls.png",
    "les": "https://flagcdn.com/w320/ls.png",
    "eswatini": "https://flagcdn.com/w320/sz.png",
    "swz": "https://flagcdn.com/w320/sz.png",
    "gambia": "https://flagcdn.com/w320/gm.png",
    "gam": "https://flagcdn.com/w320/gm.png",
    "mali": "https://flagcdn.com/w320/ml.png",
    "mli": "https://flagcdn.com/w320/ml.png",
    "seychelles": "https://flagcdn.com/w320/sc.png",
    "sey": "https://flagcdn.com/w320/sc.png",
    "zambia": "https://flagcdn.com/w320/zm.png",
    "zam": "https://flagcdn.com/w320/zm.png",

    // IPL & WPL Teams (Official Original Transparent PNG Badges)
    "chennai super kings": "https://r2.thesportsdb.com/images/media/team/badge/okceh51487601098.png",
    "csk": "https://r2.thesportsdb.com/images/media/team/badge/okceh51487601098.png",
    "mumbai indians": "https://r2.thesportsdb.com/images/media/team/badge/l40j8p1487678631.png",
    "mumbai indians women": "https://r2.thesportsdb.com/images/media/team/badge/l40j8p1487678631.png",
    "mi": "https://r2.thesportsdb.com/images/media/team/badge/l40j8p1487678631.png",
    "royal challengers bengaluru": "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
    "royal challengers bangalore": "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
    "royal challengers bengaluru women": "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
    "rcb": "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
    "kolkata knight riders": "https://r2.thesportsdb.com/images/media/team/badge/ows99r1487678296.png",
    "kkr": "https://r2.thesportsdb.com/images/media/team/badge/ows99r1487678296.png",
    "delhi capitals": "https://r2.thesportsdb.com/images/media/team/badge/dg4g0z1587334054.png",
    "delhi capitals women": "https://r2.thesportsdb.com/images/media/team/badge/dg4g0z1587334054.png",
    "dc": "https://r2.thesportsdb.com/images/media/team/badge/dg4g0z1587334054.png",
    "rajasthan royals": "https://r2.thesportsdb.com/images/media/team/badge/lehnfw1487601864.png",
    "rr": "https://r2.thesportsdb.com/images/media/team/badge/lehnfw1487601864.png",
    "sunrisers hyderabad": "https://r2.thesportsdb.com/images/media/team/badge/sc7m161487419327.png",
    "srh": "https://r2.thesportsdb.com/images/media/team/badge/sc7m161487419327.png",
    "gujarat titans": "https://r2.thesportsdb.com/images/media/team/badge/6qw4r71654174508.png",
    "gt": "https://r2.thesportsdb.com/images/media/team/badge/6qw4r71654174508.png",
    "lucknow super giants": "https://r2.thesportsdb.com/images/media/team/badge/4tzmfa1647445839.png",
    "lsg": "https://r2.thesportsdb.com/images/media/team/badge/4tzmfa1647445839.png",
    "punjab kings": "https://r2.thesportsdb.com/images/media/team/badge/r1tcie1630697821.png",
    "pbks": "https://r2.thesportsdb.com/images/media/team/badge/r1tcie1630697821.png",

    // BPL - Bangladesh Premier League (Official Original Transparent PNG Badges)
    "fortune barishal": "https://r2.thesportsdb.com/images/media/team/badge/le1zwt1675495288.png",
    "comilla victorians": "https://r2.thesportsdb.com/images/media/team/badge/vfvitn1650477443.png",
    "rangpur riders": "https://r2.thesportsdb.com/images/media/team/badge/k26ccz1734181960.png",
    "dhaka capitals": "https://r2.thesportsdb.com/images/media/team/badge/ak27xm1734342873.png",
    "dhaka dominators": "https://r2.thesportsdb.com/images/media/team/badge/ak27xm1734342873.png",
    "durdanto dhaka": "https://r2.thesportsdb.com/images/media/team/badge/ak27xm1734342873.png",
    "khulna tigers": "https://r2.thesportsdb.com/images/media/team/badge/geh2qk1675420011.png",
    "sylhet strikers": "https://r2.thesportsdb.com/images/media/team/badge/y7jz6c1767353266.png",
    "sylhet titans": "https://r2.thesportsdb.com/images/media/team/badge/y7jz6c1767353266.png",
    "chattogram challengers": "https://r2.thesportsdb.com/images/media/team/badge/xgl2ou1767352661.png",
    "chittagong kings": "https://r2.thesportsdb.com/images/media/team/badge/xgl2ou1767352661.png",
    "chattogram royals": "https://r2.thesportsdb.com/images/media/team/badge/xgl2ou1767352661.png",
    "durbar rajshahi": "https://r2.thesportsdb.com/images/media/team/badge/diokvb1767353049.png",
    "rajshahi warriors": "https://r2.thesportsdb.com/images/media/team/badge/diokvb1767353049.png",

    // PSL - Pakistan Super League (Official Original Transparent PNG Badges)
    "islamabad united": "https://r2.thesportsdb.com/images/media/team/badge/5bi3eb1709123559.png",
    "karachi kings": "https://r2.thesportsdb.com/images/media/team/badge/tfuvu11709123541.png",
    "lahore qalandars": "https://r2.thesportsdb.com/images/media/team/badge/hvrtrg1709123519.png",
    "multan sultans": "https://r2.thesportsdb.com/images/media/team/badge/mpijr01709123512.png",
    "peshawar zalmi": "https://r2.thesportsdb.com/images/media/team/badge/frp6xj1709123501.png",
    "quetta gladiators": "https://r2.thesportsdb.com/images/media/team/badge/rox6ge1709123486.png",

    // BBL & Australian Domestic (Official Original Transparent PNG Badges)
    "adelaide strikers": "https://r2.thesportsdb.com/images/media/team/badge/c36k301492606884.png",
    "brisbane heat": "https://r2.thesportsdb.com/images/media/team/badge/6r5cly1492606239.png",
    "hobart hurricanes": "https://r2.thesportsdb.com/images/media/team/badge/vdcla41492606553.png",
    "melbourne renegades": "https://r2.thesportsdb.com/images/media/team/badge/fy0wik1492607045.png",
    "melbourne stars": "https://r2.thesportsdb.com/images/media/team/badge/l0t7v31715269757.png",
    "perth scorchers": "https://r2.thesportsdb.com/images/media/team/badge/ithlp51546681732.png",
    "sydney sixers": "https://r2.thesportsdb.com/images/media/team/badge/jtkm601492607206.png",
    "sydney thunder": "https://r2.thesportsdb.com/images/media/team/badge/t0tooq1492606384.png",
    "victoria": "https://r2.thesportsdb.com/images/media/team/badge/j5vbn41749588430.png",
    "new south wales": "https://r2.thesportsdb.com/images/media/team/badge/fbj6w51675420971.png",
    "new south wales blues": "https://r2.thesportsdb.com/images/media/team/badge/fbj6w51675420971.png",
    "nsw blues": "https://r2.thesportsdb.com/images/media/team/badge/fbj6w51675420971.png",
    "tasmania": "https://r2.thesportsdb.com/images/media/team/badge/1yd06z1675431414.png",
    "tasmanian tigers": "https://r2.thesportsdb.com/images/media/team/badge/1yd06z1675431414.png",

    // CPL - Caribbean Premier League (Official Original Transparent PNG Badges)
    "guyana amazon warriors": "https://r2.thesportsdb.com/images/media/team/badge/amct1d1641785128.png",
    "antigua and barbuda falcons": "https://r2.thesportsdb.com/images/media/team/badge/fwozcu1752736011.png",
    "barbados royals": "https://r2.thesportsdb.com/images/media/team/badge/kg9ypo1786962015.png",
    "barbados tridents": "https://r2.thesportsdb.com/images/media/team/badge/kg9ypo1786962015.png",
    "trinbago knight riders": "https://r2.thesportsdb.com/images/media/team/badge/c8zwd61641785158.png",
    "tkr": "https://r2.thesportsdb.com/images/media/team/badge/c8zwd61641785158.png",
    "saint lucia kings": "https://r2.thesportsdb.com/images/media/team/badge/981c6z1752736461.png",
    "st lucia kings": "https://r2.thesportsdb.com/images/media/team/badge/981c6z1752736461.png",
    "st kitts and nevis patriots": "https://r2.thesportsdb.com/images/media/team/badge/t2zoaz1641785142.png",
    "jamaica tallawahs": "https://r2.thesportsdb.com/images/media/team/badge/7rvdsl1641785134.png",

    // SA20 & South African Domestic (Official Original Transparent PNG Badges)
    "durban's super giants": "https://r2.thesportsdb.com/images/media/team/badge/oe6ikv1734183540.png",
    "durbans super giants": "https://r2.thesportsdb.com/images/media/team/badge/oe6ikv1734183540.png",
    "joburg super kings": "https://r2.thesportsdb.com/images/media/team/badge/bvjydr1734183753.png",
    "mi cape town": "https://r2.thesportsdb.com/images/media/team/badge/s146kh1734183906.png",
    "paarl royals": "https://r2.thesportsdb.com/images/media/team/badge/41azkk1734184030.png",
    "pretoria capitals": "https://r2.thesportsdb.com/images/media/team/badge/brbk561734184169.png",
    "sunrisers eastern cape": "https://r2.thesportsdb.com/images/media/team/badge/us5vei1734184224.png",
    "titans": "https://r2.thesportsdb.com/images/media/team/badge/50kzdm1644367943.png",
    "multiply titans": "https://r2.thesportsdb.com/images/media/team/badge/50kzdm1644367943.png",
    "warriors": "https://r2.thesportsdb.com/images/media/team/badge/w5fhrc1644367999.png",
    "dolphins": "https://r2.thesportsdb.com/images/media/team/badge/nc4cs31644367913.png",
    "hollywoodbets dolphins": "https://r2.thesportsdb.com/images/media/team/badge/nc4cs31644367913.png",
    "lions": "https://r2.thesportsdb.com/images/media/team/badge/1qh6c01644367448.png",
    "dp world lions": "https://r2.thesportsdb.com/images/media/team/badge/1qh6c01644367448.png",
    "highveld lions": "https://r2.thesportsdb.com/images/media/team/badge/1qh6c01644367448.png",
    "north west": "https://r2.thesportsdb.com/images/media/team/badge/p1gb4u1644367687.png",
    "north west dragons": "https://r2.thesportsdb.com/images/media/team/badge/p1gb4u1644367687.png",
    "western province": "https://r2.thesportsdb.com/images/media/team/badge/51wcio1512983228.png",
    "cape cobras": "https://r2.thesportsdb.com/images/media/team/badge/51wcio1512983228.png",
    "easterns": "https://r2.thesportsdb.com/images/media/team/badge/wavdxf1758097673.png",
    "eastern storm": "https://r2.thesportsdb.com/images/media/team/badge/wavdxf1758097673.png",
    "kwazulu-natal inland": "https://r2.thesportsdb.com/images/media/team/badge/mlrnuo1704976998.png",

    // English County Championship & The Hundred (Official Original Transparent PNG Badges)
    "surrey": "https://r2.thesportsdb.com/images/media/team/badge/pl0yk51512933420.png",
    "yorkshire": "https://r2.thesportsdb.com/images/media/team/badge/i4la7t1512933445.png",
    "durham": "https://r2.thesportsdb.com/images/media/team/badge/chwe901512937550.png",
    "essex": "https://r2.thesportsdb.com/images/media/team/badge/yep86x1777629714.png",
    "glamorgan": "https://r2.thesportsdb.com/images/media/team/badge/rdsttx1590355851.png",
    "hampshire": "https://r2.thesportsdb.com/images/media/team/badge/zos2qr1512933145.png",
    "leicestershire": "https://r2.thesportsdb.com/images/media/team/badge/qluxic1512937633.png",
    "nottinghamshire": "https://r2.thesportsdb.com/images/media/team/badge/vzixwm1671721158.png",
    "somerset": "https://r2.thesportsdb.com/images/media/team/badge/ba0m9n1546518813.png",
    "sussex": "https://r2.thesportsdb.com/images/media/team/badge/5isw8o1512937679.png",
    "warwickshire": "https://r2.thesportsdb.com/images/media/team/badge/w5yo7x1512937763.png",
    "birmingham bears": "https://r2.thesportsdb.com/images/media/team/badge/w5yo7x1512937763.png",
    "derbyshire": "https://r2.thesportsdb.com/images/media/team/badge/uki6jc1512937529.png",
    "gloucestershire": "https://r2.thesportsdb.com/images/media/team/badge/0ss39a1554324931.png",
    "kent": "https://r2.thesportsdb.com/images/media/team/badge/j9k7om1717595438.png",
    "lancashire": "https://r2.thesportsdb.com/images/media/team/badge/m1ljqz1546518856.png",
    "middlesex": "https://r2.thesportsdb.com/images/media/team/badge/rlfxzh1512937652.png",
    "northamptonshire": "https://r2.thesportsdb.com/images/media/team/badge/391faz1512937726.png",
    "worcestershire": "https://r2.thesportsdb.com/images/media/team/badge/pnjm9d1512937464.png",
    "birmingham phoenix": "https://r2.thesportsdb.com/images/media/team/badge/aihn2d1641785176.png",
    "london spirit": "https://r2.thesportsdb.com/images/media/team/badge/k3q3mo1776457663.png",
    "manchester originals": "https://r2.thesportsdb.com/images/media/team/badge/5oapdn1776457699.png",
    "oval invincibles": "https://r2.thesportsdb.com/images/media/team/badge/ycy1xc1776457741.png",
    "southern brave": "https://r2.thesportsdb.com/images/media/team/badge/7c0a8j1776457761.png",
    "northern superchargers": "https://r2.thesportsdb.com/images/media/team/badge/46mctq1776457779.png",
    "trent rockets": "https://r2.thesportsdb.com/images/media/team/badge/9cp1ac1692900475.png",
    "welsh fire": "https://r2.thesportsdb.com/images/media/team/badge/49jl241645213505.png",

    // MLC, ILT20, LPL, Super Smash (Official Original Transparent PNG Badges)
    "los angeles knight riders": "https://r2.thesportsdb.com/images/media/team/badge/6q2cnq1689146300.png",
    "mi new york": "https://r2.thesportsdb.com/images/media/team/badge/i4lxb71689146303.png",
    "san francisco unicorns": "https://r2.thesportsdb.com/images/media/team/badge/k6pv961689146306.png",
    "seattle orcas": "https://r2.thesportsdb.com/images/media/team/badge/wg325p1689146309.png",
    "texas super kings": "https://r2.thesportsdb.com/images/media/team/badge/777fr51689161316.png",
    "washington freedom": "https://r2.thesportsdb.com/images/media/team/badge/ro0khs1750233280.png",
    "abu dhabi knight riders": "https://r2.thesportsdb.com/images/media/team/badge/llghxr1721480701.png",
    "desert vipers": "https://r2.thesportsdb.com/images/media/team/badge/uqmlhc1721480710.png",
    "dubai capitals": "https://r2.thesportsdb.com/images/media/team/badge/f95loc1721480695.png",
    "gulf giants": "https://r2.thesportsdb.com/images/media/team/badge/y9hem51721480707.png",
    "mi emirates": "https://r2.thesportsdb.com/images/media/team/badge/6ttrki1721480699.png",
    "sharjah warriorz": "https://r2.thesportsdb.com/images/media/team/badge/gq0stf1721480730.png",
    "colombo strikers": "https://r2.thesportsdb.com/images/media/team/badge/lwar9d1720697266.png",
    "dambulla sixers": "https://r2.thesportsdb.com/images/media/team/badge/avsoxp1720697923.png",
    "galle marvels": "https://r2.thesportsdb.com/images/media/team/badge/dgqb9i1720698025.png",
    "jaffna kings": "https://r2.thesportsdb.com/images/media/team/badge/gs27jn1720698419.png",
    "b-love kandy": "https://r2.thesportsdb.com/images/media/team/badge/ukrqz61720698084.png",
    "auckland aces": "https://r2.thesportsdb.com/images/media/team/badge/gmbyx01705392031.png",
    "auckland": "https://r2.thesportsdb.com/images/media/team/badge/gmbyx01705392031.png",
    "canterbury kings": "https://r2.thesportsdb.com/images/media/team/badge/uex7eq1705391931.png",
    "canterbury": "https://r2.thesportsdb.com/images/media/team/badge/uex7eq1705391931.png",
    "central stags": "https://r2.thesportsdb.com/images/media/team/badge/34lmqg1705391924.png",
    "central districts": "https://r2.thesportsdb.com/images/media/team/badge/34lmqg1705391924.png",
    "northern brave": "https://r2.thesportsdb.com/images/media/team/badge/7lnb4g1705391916.png",
    "northern districts": "https://r2.thesportsdb.com/images/media/team/badge/7lnb4g1705391916.png",
    "otago volts": "https://r2.thesportsdb.com/images/media/team/badge/am7ce21705391910.png",
    "otago": "https://r2.thesportsdb.com/images/media/team/badge/am7ce21705391910.png",
    "wellington firebirds": "https://r2.thesportsdb.com/images/media/team/badge/ep5kr31705391899.png",
    "wellington": "https://r2.thesportsdb.com/images/media/team/badge/ep5kr31705391899.png"
  };

  const tsdbTeamLogoCache = new Map<string, string>();

  function resolveHDTeamLogo(teamName: string, rawLogo?: string): string {
    if (teamName && typeof teamName === "string") {
      const bracketMatch = teamName.match(/\[([^\]]+)\]/);
      const shortCode = bracketMatch ? bracketMatch[1].trim().toLowerCase() : "";
      const cleanName = teamName.replace(/\s*\[[^\]]+\]\s*$/, "").trim().toLowerCase();

      // 1. Exact match in Official Original HD Logos Registry
      if (HD_CRICKET_LOGOS_MAP[cleanName]) {
        return HD_CRICKET_LOGOS_MAP[cleanName];
      }

      // 2. Strip Women / U19 / A-team / Emerging suffixes and check exact match
      const baseName = cleanName
        .replace(/(\s+|-)(women|w|u19|u-19|under-19|under 19|a|emerging|xi|shaheens|lions)$/i, "")
        .replace(/,\s*china$/i, "")
        .trim();
      if (baseName && HD_CRICKET_LOGOS_MAP[baseName]) {
        return HD_CRICKET_LOGOS_MAP[baseName];
      }

      // 3. Check extracted bracket shortCode
      if (shortCode && HD_CRICKET_LOGOS_MAP[shortCode]) {
        return HD_CRICKET_LOGOS_MAP[shortCode];
      }

      // 4. Check dynamic TheSportsDB cache
      if (tsdbTeamLogoCache.has(cleanName)) {
        const cached = tsdbTeamLogoCache.get(cleanName)!;
        if (cached) return cached;
      }

      // 5. Safe multi-word franchise match (never allow single-word or country substring false positives like "Indians" -> "India" or "Titans" -> "Gujarat Titans")
      for (const [k, v] of Object.entries(HD_CRICKET_LOGOS_MAP)) {
        if (k.length >= 6 && k.includes(" ")) {
          const regex = new RegExp(`(^|\\b)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|$)`, "i");
          if (regex.test(cleanName)) {
            return v;
          }
        }
      }
    }

    // 6. Fallback to API-provided logo if it is NOT a generic placeholder / icon512
    if (rawLogo && typeof rawLogo === "string") {
      let clean = rawLogo.trim();
      if (
        clean &&
        !clean.includes("un.png") &&
        !clean.includes("icon512.png") &&
        !clean.includes("placeholder") &&
        !clean.includes("default-team") &&
        !clean.includes("team_default")
      ) {
        if (clean.includes("g.cricapi.com/iapi/") && clean.includes("w=48")) {
          clean = clean.replace("w=48", "w=250");
        }
        if (clean.includes("cricbuzz.com") && clean.includes("/72x54/")) {
          clean = clean.replace("/72x54/", "/300x300/");
        }
        if (clean.includes("flagcdn.com/w160/")) {
          clean = clean.replace("/w160/", "/w320/");
        }
        if (clean.startsWith("http://static.cricbuzz.com")) {
          clean = clean.replace("http://", "https://");
        }
        return clean;
      }
    }

    return "./assets/team-placeholder.svg";
  }

  async function resolveOfficialCricketTeamLogoAsync(teamName: string, currentLogo: string): Promise<string> {
    if (!teamName) return currentLogo;
    if (
      currentLogo &&
      currentLogo !== "./assets/team-placeholder.svg" &&
      !currentLogo.includes("cricapi.com") &&
      !currentLogo.includes("cdorgapi") &&
      !currentLogo.includes("icon512.png")
    ) {
      return currentLogo;
    }
    const cleanName = teamName.replace(/\s*\[[^\]]+\]\s*$/, "").trim().toLowerCase();
    if (tsdbTeamLogoCache.has(cleanName)) {
      return tsdbTeamLogoCache.get(cleanName) || currentLogo;
    }
    try {
      for (const query of [cleanName, `${cleanName} Cricket`]) {
        const res = await fetch(`${THESPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          const json: any = await res.json();
          const teams = Array.isArray(json?.teams) ? json.teams : [];
          const cricketTeam = teams.find(
            (t: any) => String(t.strSport || "").toLowerCase() === "cricket" && (t.strBadge || t.strTeamBadge)
          );
          if (cricketTeam) {
            const officialBadge = cricketTeam.strBadge || cricketTeam.strTeamBadge;
            tsdbTeamLogoCache.set(cleanName, officialBadge);
            return officialBadge;
          }
        }
      }
    } catch {}
    tsdbTeamLogoCache.set(cleanName, "");
    return currentLogo;
  }

  // Helper: Format team score from Cricbuzz matchScore
  function formatCricbuzzScore(scoreObj: any): { score: string; overs: string } {
    if (!scoreObj) return { score: "", overs: "" };
    const inngs = scoreObj.inngs2 || scoreObj.inngs1;
    if (!inngs) return { score: "", overs: "" };
    let score = `${inngs.runs || 0}/${inngs.wickets !== undefined ? inngs.wickets : 0}`;
    if (scoreObj.inngs2 && scoreObj.inngs1) {
      score = `${scoreObj.inngs1.runs || 0}/${scoreObj.inngs1.wickets !== undefined ? scoreObj.inngs1.wickets : 0} & ${score}`;
    }
    const overs = inngs.overs ? `${inngs.overs} ov` : "";
    return { score, overs };
  }

  async function getNormalizedRapidCricketMatches(customKey?: string): Promise<any[]> {
    if (!ENABLE_CRICBUZZ_API) {
      // Cricbuzz API is temporarily paused per user instruction
      return [];
    }
    const activeKey = (customKey && customKey.trim()) ? customKey.trim() : RAPIDAPI_KEY;
    const now = Date.now();
    if (rapidCache.matches && (now - rapidCache.matches.timestamp < rapidCache.TTL_SCHEDULE_LIVE)) {
      return rapidCache.matches.data;
    }
    if (inFlightPromises.rapidCricketMatches) {
      return inFlightPromises.rapidCricketMatches;
    }

    inFlightPromises.rapidCricketMatches = (async () => {
      try {
        const events: any[] = [];
        const seenIds = new Set<string>();
        const curNow = Date.now();

        // 1. Fetch Cricbuzz Live, Upcoming, and Recent Matches via RapidAPI
        if (activeKey) {
          const endpoints = ["live", "upcoming", "recent"];
          const fetchPromises = endpoints.map((ep) =>
            fetch(`https://${RAPIDAPI_CRICKET_HOST}/matches/v1/${ep}`, {
              headers: {
                "x-rapidapi-host": RAPIDAPI_CRICKET_HOST,
                "x-rapidapi-key": activeKey,
              },
            })
              .then(async (res) => {
                if (!res.ok || res.status === 204) return null;
                try {
                  return await res.json();
                } catch {
                  return null;
                }
              })
              .catch((err) => {
                console.warn(`[Backend Proxy] Cricbuzz /matches/v1/${ep} notice:`, err.message);
                return null;
              })
          );

          const [liveData, upcomingData, recentData] = await Promise.all(fetchPromises);
          const datasets: any[] = [liveData, upcomingData, recentData].filter(Boolean);

          for (const json of datasets) {
            const typeMatches = Array.isArray(json.typeMatches) ? json.typeMatches : [];
            for (const tm of typeMatches) {
              const matchTypeCategory = tm.matchType || "Cricket";
              const seriesMatches = Array.isArray(tm.seriesMatches) ? tm.seriesMatches : [tm];
              for (const sm of seriesMatches) {
                const seriesName = sm.seriesAdWrapper?.seriesName || sm.seriesName || matchTypeCategory || "Cricket Series";
                const matches = sm.seriesAdWrapper?.matches || sm.matches || (sm.matchInfo ? [sm] : []);

                for (const m of matches) {
                  const info = m.matchInfo || m;
                  const matchId = String(info.matchId || info.id || "");
                  if (!matchId || seenIds.has(matchId)) continue;
                  seenIds.add(matchId);

                  const t1 = info.team1 || {};
                  const t2 = info.team2 || {};
                  const t1Name = t1.teamName || t1.name || "Team 1";
                  const t2Name = t2.teamName || t2.name || "Team 2";

                  const t1Logo = resolveHDTeamLogo(
                    t1Name,
                    t1.imageId ? `https://static.cricbuzz.com/a/img/v1/300x300/i1/c${t1.imageId}/team.jpg` : "./assets/team-placeholder.svg"
                  );
                  const t2Logo = resolveHDTeamLogo(
                    t2Name,
                    t2.imageId ? `https://static.cricbuzz.com/a/img/v1/300x300/i1/c${t2.imageId}/team.jpg` : "./assets/team-placeholder.svg"
                  );

                  let startTimestamp = parseInt(info.startDate) || curNow;
                  if (startTimestamp < 10000000000) startTimestamp *= 1000;
                  const endTimestamp = parseInt(info.endDate)
                    ? (parseInt(info.endDate) < 10000000000 ? parseInt(info.endDate) * 1000 : parseInt(info.endDate))
                    : startTimestamp + 4 * 3600 * 1000;

                  const rawState = String(info.state || "").toLowerCase();
                  const rawStatus = String(info.status || "").toLowerCase();

                  let status = "upcoming";
                  let statusText = info.status || info.matchDesc || "Scheduled";

                  if (
                    rawState.includes("progress") ||
                    rawState.includes("live") ||
                    rawState.includes("toss") ||
                    rawState.includes("stump") ||
                    rawState.includes("delay") ||
                    rawState.includes("rain") ||
                    rawState.includes("break") ||
                    rawStatus.includes("opt to") ||
                    rawStatus.includes("need ") ||
                    rawStatus.includes("trail by") ||
                    rawStatus.includes("lead by")
                  ) {
                    status = "live";
                    statusText = info.status || "LIVE NOW";
                  } else if (
                    rawState.includes("complete") ||
                    rawStatus.includes("won by") ||
                    rawStatus.includes("won the") ||
                    rawStatus.includes("tied") ||
                    rawStatus.includes("no result") ||
                    rawStatus.includes("abandon") ||
                    rawStatus.includes("drawn") ||
                    rawStatus.includes("concluded")
                  ) {
                    status = "finished";
                    statusText = info.status || "Match Concluded";
                  } else if (curNow >= startTimestamp && curNow <= endTimestamp) {
                    status = "live";
                    statusText = info.status || "LIVE NOW";
                  } else if (curNow > endTimestamp) {
                    status = "finished";
                    statusText = info.status || "Match Concluded";
                  }

                  const matchScore = m.matchScore || info.matchScore || {};
                  const t1Score = formatCricbuzzScore(matchScore.team1Score);
                  const t2Score = formatCricbuzzScore(matchScore.team2Score);

                  const matchTimeStr = formatDhakaEventTime(startTimestamp);

                  const sNameLower = seriesName.toLowerCase();
                  const t1Lower = t1Name.toLowerCase();
                  const t2Lower = t2Name.toLowerCase();

                  const isHot =
                    status === "live" ||
                    sNameLower.includes("tour of") ||
                    sNameLower.includes("tri-series") ||
                    sNameLower.includes("world cup") ||
                    sNameLower.includes("asia cup") ||
                    sNameLower.includes("ipl") ||
                    sNameLower.includes("bpl") ||
                    sNameLower.includes("psl") ||
                    sNameLower.includes("cpl") ||
                    sNameLower.includes("hundred") ||
                    sNameLower.includes("trophy") ||
                    sNameLower.includes("india") ||
                    sNameLower.includes("bangladesh") ||
                    sNameLower.includes("pakistan") ||
                    sNameLower.includes("australia") ||
                    sNameLower.includes("england") ||
                    sNameLower.includes("south africa") ||
                    sNameLower.includes("sri lanka") ||
                    sNameLower.includes("new zealand") ||
                    sNameLower.includes("west indies") ||
                    sNameLower.includes("afghanistan") ||
                    t1Lower.includes("bangladesh") ||
                    t2Lower.includes("bangladesh") ||
                    t1Lower.includes("india") ||
                    t2Lower.includes("india");

                  let finalFormat = info.matchFormat || "Cricket";
                  if (sNameLower.includes("t20") || sNameLower.includes("blast") || sNameLower.includes("cpl") || sNameLower.includes("ipl")) {
                    finalFormat = "T20";
                  } else if (sNameLower.includes("odi") || sNameLower.includes("one day")) {
                    finalFormat = "ODI";
                  } else if (sNameLower.includes("test")) {
                    finalFormat = "Test";
                  } else if (sNameLower.includes("hundred")) {
                    finalFormat = "Hundred";
                  }

                  const venueName = `${info.venueInfo?.ground || ""}${info.venueInfo?.city ? `, ${info.venueInfo.city}` : ""}`.trim();

                  events.push({
                    id: `cr-cricbuzz-${matchId}`,
                    matchId: matchId,
                    seriesId: info.seriesId,
                    sport: "cricket",
                    sportName: "Cricket",
                    sportIcon: "fa-baseball-bat-ball",
                    title: `${t1Name} vs ${t2Name}`,
                    name: `${t1Name} vs ${t2Name}`,
                    seriesName: seriesName,
                    tournament: seriesName,
                    league: seriesName,
                    matchDesc: info.matchDesc || "Match",
                    matchFormat: finalFormat,
                    matchType: finalFormat,
                    status: status,
                    statusText: statusText,
                    statusLabel: status === "live" ? "LIVE" : (status === "finished" ? "FT" : "Upcoming"),
                    timestamp: startTimestamp,
                    date: new Intl.DateTimeFormat("en-CA", {
                      timeZone: "Asia/Dhaka",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(new Date(startTimestamp)),
                    matchTime: matchTimeStr,
                    timeOrTimer: status === "live" ? "LIVE" : (status === "finished" ? "FT" : matchTimeStr),
                    venue: venueName,
                    isHot: isHot,
                    isSpecial: isHot,
                    team1: {
                      teamId: t1.teamId || t1.id,
                      name: t1Name,
                      shortName: t1.teamSName || "",
                      logo: t1Logo,
                      score: t1Score.score,
                      overs: t1Score.overs,
                    },
                    team2: {
                      teamId: t2.teamId || t2.id,
                      name: t2Name,
                      shortName: t2.teamSName || "",
                      logo: t2Logo,
                      score: t2Score.score,
                      overs: t2Score.overs,
                    },
                    homeTeam: {
                      name: t1Name,
                      logo: t1Logo,
                      score: t1Score.score,
                      overs: t1Score.overs,
                    },
                    awayTeam: {
                      name: t2Name,
                      logo: t2Logo,
                      score: t2Score.score,
                      overs: t2Score.overs,
                    },
                    broadcaster: (info.broadcaster || info.tvStation || info.broadcastInfo || info.channel || "").trim(),
                    broadcasters: (info.broadcaster || info.tvStation || info.broadcastInfo || info.channel || "").trim() ? [(info.broadcaster || info.tvStation || info.broadcastInfo || info.channel || "").trim()] : [],
                    subText: `${finalFormat} • ${venueName || seriesName}`,
                    source: "Cricbuzz RapidAPI",
                    streams: [],
                  });
                }
              }
            }
          }
        }

        // 2. Fallback: If Cricbuzz RapidAPI had no data or was unavailable, query TheSportsDB Cricket Feed
        if (events.length === 0) {
          try {
            const todayStr = new Date().toISOString().split("T")[0];
            const tsdbRes = await fetch(`${THESPORTSDB_BASE}/eventsday.php?d=${todayStr}&s=Cricket`).catch(() => null);
            if (tsdbRes && tsdbRes.ok) {
              const tsdbJson = await tsdbRes.json();
              for (const ev of (tsdbJson.events || [])) {
                const t1N = ev.strHomeTeam || "Team 1";
                const t2N = ev.strAwayTeam || "Team 2";
                const t1L = resolveHDTeamLogo(t1N, ev.strHomeTeamBadge || "./assets/team-placeholder.svg");
                const t2L = resolveHDTeamLogo(t2N, ev.strAwayTeamBadge || "./assets/team-placeholder.svg");
                let sTs = curNow;
                if (ev.strTimestamp) sTs = new Date(ev.strTimestamp).getTime();
                else if (ev.dateEvent && ev.strTime) sTs = new Date(`${ev.dateEvent}T${ev.strTime}`).getTime();

                const isLv = (ev.strStatus || "").toLowerCase().includes("live");
                const isFin = (ev.strStatus || "").toLowerCase().includes("ft") || (ev.strStatus || "").toLowerCase().includes("finish");

                events.push({
                  id: `cr-tsdb-${ev.idEvent || sTs}`,
                  matchId: ev.idEvent,
                  sport: "cricket",
                  sportName: "Cricket",
                  sportIcon: "fa-baseball-bat-ball",
                  title: `${t1N} vs ${t2N}`,
                  name: `${t1N} vs ${t2N}`,
                  tournament: ev.strLeague || "Cricket League",
                  league: ev.strLeague || "Cricket League",
                  matchFormat: "Cricket",
                  status: isLv ? "live" : (isFin ? "finished" : "upcoming"),
                  statusText: ev.strStatus || (isLv ? "LIVE NOW" : "Scheduled"),
                  statusLabel: isLv ? "LIVE" : (isFin ? "FT" : "Upcoming"),
                  timestamp: sTs,
                  date: ev.dateEvent || todayStr,
                  matchTime: formatDhakaEventTime(sTs),
                  timeOrTimer: isLv ? "LIVE" : (isFin ? "FT" : formatDhakaEventTime(sTs)),
                  venue: ev.strVenue || "",
                  isHot: true,
                  isSpecial: true,
                  team1: { name: t1N, logo: t1L, score: "", overs: "" },
                  team2: { name: t2N, logo: t2L, score: "", overs: "" },
                  homeTeam: { name: t1N, logo: t1L, score: "", overs: "" },
                  awayTeam: { name: t2N, logo: t2L, score: "", overs: "" },
                  broadcaster: (ev.strTVStation || ev.strBroadcaster || ev.strBroadcast || "").trim(),
                  broadcasters: (ev.strTVStation || ev.strBroadcaster || ev.strBroadcast || "") ? [(ev.strTVStation || ev.strBroadcaster || ev.strBroadcast || "").trim()] : [],
                  strTVStation: (ev.strTVStation || "").trim(),
                  subText: `Cricket • ${ev.strVenue || ev.strLeague || ""}`,
                  source: "TheSportsDB Cricket",
                  streams: [],
                });
              }
            }
          } catch (e: any) {
            console.warn("[Backend Proxy] Cricket fallback error:", e.message);
          }
        }

        if (events.length > 0) {
          rapidCache.matches = { timestamp: Date.now(), data: events };
        }
        return events.length > 0 ? events : (rapidCache.matches?.data || []);
      } catch (err: any) {
        console.warn("[Backend Proxy] Transform cricket matches error:", err.message);
        return rapidCache.matches?.data || [];
      } finally {
        inFlightPromises.rapidCricketMatches = null;
      }
    })();

    return inFlightPromises.rapidCricketMatches;
  }

  function redactCricketSecret(msg: string, secret?: string): string {
    if (!msg) return "";
    let out = String(msg).replace(/apikey=[^&\s"']+/gi, "apikey=[REDACTED]");
    if (secret && secret.trim().length > 4) {
      out = out.split(secret.trim()).join("[REDACTED]");
    }
    return out;
  }

  function detectCricketDataBlockOrRateLimit(status: number, reasonOrText: string): {
    blocked: boolean;
    rateLimited: boolean;
    is15MinBlock: boolean;
  } {
    const lower = String(reasonOrText || "").toLowerCase();
    const is15MinBlock =
      lower.includes("blocked for 15 minutes") ||
      /blocked\s+for\s+\d+\s*min/i.test(lower) ||
      (status === 400 && lower.includes("blocked"));
    const isQuotaOrRateLimit =
      status === 429 ||
      is15MinBlock ||
      lower.includes("blocked") ||
      lower.includes("hit limit") ||
      lower.includes("hits limit") ||
      lower.includes("quota") ||
      lower.includes("rate limit") ||
      lower.includes("reached your limit") ||
      lower.includes("too many requests") ||
      lower.includes("exceeded");
    return {
      blocked: is15MinBlock || isQuotaOrRateLimit,
      rateLimited: isQuotaOrRateLimit,
      is15MinBlock,
    };
  }

  let lastCricketDataApiTime = 0;
  async function fetchCricketDataApi(
    endpoint: "currentMatches" | "matches" | "cricScore" | string,
    apiKey: string = CRICKETDATA_API_KEY,
    offset: number = 0
  ): Promise<{ ok: boolean; status: number; blocked?: boolean; rateLimited?: boolean; data?: any; error?: string; rawText?: string }> {
    const activeKey = (apiKey || "").trim() || CRICKETDATA_API_KEY;
    if (!activeKey) {
      return { ok: false, status: 400, error: "CRICKETDATA_API_KEY is not configured in server environment." };
    }

    // Do not repeatedly call CricketData while it is blocked for 15 minutes
    if (cricketDataCache.blockedUntil > Date.now()) {
      return {
        ok: false,
        status: cricketDataCache.lastStatus || 400,
        blocked: true,
        rateLimited: true,
        error: cricketDataCache.lastError || "Blocked for 15 minutes",
      };
    }

    // Throttle to respect rate limits
    const now = Date.now();
    const diff = now - lastCricketDataApiTime;
    if (diff < 1000) {
      await new Promise((r) => setTimeout(r, 1000 - diff));
    }
    lastCricketDataApiTime = Date.now();

    const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    const sep = cleanEndpoint.includes("?") ? "&" : "?";
    const url =
      cleanEndpoint === "cricScore"
        ? `https://api.cricapi.com/v1/cricScore${sep}apikey=${encodeURIComponent(activeKey)}`
        : `https://api.cricapi.com/v1/${cleanEndpoint}${sep}apikey=${encodeURIComponent(activeKey)}&offset=${offset}`;

    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "HighFy-TV/4.2",
        },
        signal: AbortSignal.timeout(9000),
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      const rawErr = String(data?.reason || data?.message || (!res.ok ? (text ? text.slice(0, 250) : res.statusText) : ""));
      const redactedReason = redactCricketSecret(rawErr, activeKey);
      const blockInfo = detectCricketDataBlockOrRateLimit(res.status, redactedReason);

      if (blockInfo.blocked) {
        const effectiveStatus = blockInfo.is15MinBlock && res.status === 400 ? 400 : res.status === 429 ? 429 : res.status || 400;
        const errMsg = redactedReason || (res.status === 429 ? "CricketData.org rate limit reached (HTTP 429)" : "Blocked for 15 minutes");
        cricketDataCache.lastStatus = effectiveStatus;
        cricketDataCache.blocked = true;
        cricketDataCache.rateLimited = true;
        cricketDataCache.blockedUntil = Date.now() + CRICKET_BLOCK_COOLDOWN_MS;
        cricketDataCache.lastError = errMsg;
        return { ok: false, status: effectiveStatus, blocked: true, rateLimited: true, error: errMsg };
      }

      if (!res.ok) {
        cricketDataCache.lastStatus = res.status;
        cricketDataCache.lastError = redactedReason;
        return {
          ok: false,
          status: res.status,
          error: redactedReason,
        };
      }

      if (data && data.status === "failure") {
        const reason = redactCricketSecret(data.reason || "CricketData API returned failure status", activeKey);
        const failureBlock = detectCricketDataBlockOrRateLimit(400, reason);
        if (failureBlock.blocked) {
          const st = failureBlock.is15MinBlock ? 400 : 429;
          cricketDataCache.lastStatus = st;
          cricketDataCache.blocked = true;
          cricketDataCache.rateLimited = true;
          cricketDataCache.blockedUntil = Date.now() + CRICKET_BLOCK_COOLDOWN_MS;
          cricketDataCache.lastError = reason;
          return { ok: false, status: st, blocked: true, rateLimited: true, error: reason, data };
        }
        cricketDataCache.lastStatus = 400;
        cricketDataCache.lastError = reason;
        return { ok: false, status: 400, error: reason, data };
      }

      cricketDataCache.lastStatus = 200;
      cricketDataCache.blocked = false;
      cricketDataCache.rateLimited = false;
      cricketDataCache.blockedUntil = 0;
      cricketDataCache.lastError = "";
      return { ok: true, status: 200, blocked: false, rateLimited: false, data };
    } catch (err: any) {
      return {
        ok: false,
        status: 500,
        error: redactCricketSecret(err.message || "Network error reaching CricketData.org API", activeKey),
      };
    }
  }

  // Load and cache authentic channels.json for matching broadcast channels
  let cachedChannelsJson: any[] | null = null;
  function getChannelsFromDisk(): any[] {
    if (cachedChannelsJson && cachedChannelsJson.length > 0) return cachedChannelsJson;
    try {
      const dataPath = path.join(process.cwd(), "data", "channels.json");
      const rootPath = path.join(process.cwd(), "channels.json");
      if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, "utf8");
        const parsed = JSON.parse(raw);
        cachedChannelsJson = Array.isArray(parsed) ? parsed : (parsed.channels || []);
        return cachedChannelsJson || [];
      } else if (fs.existsSync(rootPath)) {
        const raw = fs.readFileSync(rootPath, "utf8");
        cachedChannelsJson = JSON.parse(raw);
        return cachedChannelsJson || [];
      }
      return [];
    } catch (e: any) {
      console.warn("[Channels] Error reading channels.json:", e.message);
      return [];
    }
  }

  let cachedEventsJson: any[] | null = null;
  function getEventsFromDisk(): any[] {
    if (cachedEventsJson && cachedEventsJson.length > 0) return cachedEventsJson;
    try {
      const dataPath = path.join(process.cwd(), "data", "sports-events.json");
      const rootPath = path.join(process.cwd(), "events.json");
      if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, "utf8");
        const parsed = JSON.parse(raw);
        cachedEventsJson = Array.isArray(parsed) ? parsed : (parsed.events || []);
        return cachedEventsJson || [];
      } else if (fs.existsSync(rootPath)) {
        const raw = fs.readFileSync(rootPath, "utf8");
        cachedEventsJson = JSON.parse(raw);
        return cachedEventsJson || [];
      }
      return [];
    } catch (e: any) {
      return [];
    }
  }

  // Resolve authentic broadcaster information exclusively from Cricket API response
  // STRICT USER MANDATE:
  // "Cricket API থেকে যে Broadcasting, Channel বা TV তথ্য আসবে শুধুমাত্র সেটাই ব্যবহার করবে।
  // কোনো Channel Name, Broadcaster, Logo বা Broadcasting তথ্য নিজে থেকে তৈরি, অনুমান বা Placeholder হিসেবে যোগ করবে না।
  // API response-এ তথ্য না থাকলে সেই তথ্য দেখাবে না। সব Broadcasting data সম্পূর্ণভাবে API-এর real-time response অনুযায়ী প্রদর্শন করবে।"
  function resolveCricketBroadcastData(sportEvent: any, item: any) {
    const extracted: string[] = [];

    // Extract all potential broadcasting/channel fields directly present in Cricket API response payload
    const srSources = [
      item?.channels,
      sportEvent?.channels,
      item?.broadcasters,
      sportEvent?.broadcasters,
      item?.tv_channels,
      sportEvent?.tv_channels,
      item?.broadcast,
      sportEvent?.broadcast,
      item?.broadcasts,
      sportEvent?.broadcasts,
      item?.geoBroadcasts,
      sportEvent?.geoBroadcasts,
      item?.strTVStation,
      sportEvent?.strTVStation,
      item?.tvStation,
      sportEvent?.tvStation,
      item?.media?.channels,
      sportEvent?.media?.channels,
      item?.media?.broadcasters,
      sportEvent?.media?.broadcasters,
      item?.coverage?.channels,
      sportEvent?.coverage?.channels,
      item?.coverage?.tv_channels,
      sportEvent?.coverage?.tv_channels,
      item?.coverage?.tv,
      sportEvent?.coverage?.tv,
      item?.sport_event_status?.broadcast,
      sportEvent?.sport_event_status?.broadcast,
      item?.sport_event_status?.channels,
      sportEvent?.sport_event_status?.channels,
    ];

    function extractFromEntry(entry: any) {
      if (!entry) return;
      if (Array.isArray(entry)) {
        for (const sub of entry) {
          extractFromEntry(sub);
        }
      } else if (typeof entry === "string") {
        const parts = entry
          .split(/[,/|;+]|\band\b/i)
          .map((p) => p.trim())
          .filter(Boolean);
        for (const trimmed of parts) {
          if (trimmed && !trimmed.toLowerCase().includes("unknown") && !trimmed.toLowerCase().includes("tbd")) {
            extracted.push(trimmed);
          }
        }
      } else if (typeof entry === "object") {
        if (Array.isArray(entry.names)) {
          extractFromEntry(entry.names);
        }
        const name =
          entry.name ||
          entry.channel_name ||
          entry.broadcaster_name ||
          entry.station ||
          entry.tv_name ||
          entry.channel ||
          entry.title ||
          entry.value ||
          entry.media?.shortName ||
          entry.media?.name ||
          "";
        if (typeof name === "string" && name.trim()) {
          extractFromEntry(name);
        }
      }
    }

    for (const src of srSources) {
      extractFromEntry(src);
    }

    if (extracted.length === 0) {
      return {
        broadcaster: null,
        broadcasters: [],
        channelId: null,
        channelIds: [],
        channelName: null,
        channelLogo: null,
        streamUrl: null,
        streams: [],
      };
    }

    // Deduplicate extracted broadcaster names strictly from API
    const uniqueBroadcasters = Array.from(new Set(extracted.filter(Boolean)));
    const primaryBroadcaster = uniqueBroadcasters.slice(0, 3).join(", ");

    // Only match against HighFy TV channels.json if an active channel matches the authentic broadcaster from the API via strict explicit matching
    const allChannels = getChannelsFromDisk();
    let matchedChannel: any = null;

    const bannedNetworks = [
      'fancode', 'cricbuzz', 'hotstar', 'disney+ hotstar', 'disney hotstar', 'jiohotstar',
      'peacock', 'paramount', 'paramount+', 'optus sport', 'optus', 'prime video',
      'amazon prime video', 'amazon prime', 'canal+', 'viaplay', 'stan sport',
      'jiocinema', 'jio cinema', 'sports18', 'sports 18', 'sports18 1',
      'supersport', 'supersport action', 'supersport cricket', 'supersport premier league', 'supersport football',
      'supersport premier', 'supersport epl', 'supersport grandstand', 'supersport variety', 'supersport rugby',
      'star sports network', 'star sports select',
      'sony sports network', 'sony network', 'sonyliv', 'sony liv',
      'sky sports network', 'tnt sports', 'dazn', 'tsn', 'bein sports', 'bein', 'eurosport',
      'mlb.tv', 'mlb tv', 'wnba league pass', 'nba league pass', 'nba tv', 'espn+', 'espn plus',
      'apple tv', 'apple tv+', 'fubo', 'fubotv', 'kayosports', 'kayo sports', 'spark sport'
    ];

    const genericUmbrellaNetworks = [
      'star sports', 'sony sports', 'sky sports', 'fox sports'
    ];

    const explicitServerAliases: Record<string, string[]> = {
      't sports': ['ch-t-sports-hd', 'ch-ayna-019de785-3962-77a1-8f50-c541bb5a02c7', 'ch-t-sports-server-2'],
      't sports hd': ['ch-t-sports-hd', 'ch-ayna-019de785-3962-77a1-8f50-c541bb5a02c7', 'ch-t-sports-server-2'],
      'tsports': ['ch-t-sports-hd', 'ch-ayna-019de785-3962-77a1-8f50-c541bb5a02c7', 'ch-t-sports-server-2'],
      'gazi tv': ['ch-gazi-tv'],
      'gtv': ['ch-gazi-tv'],
      'gazi tv hd': ['ch-gazi-tv'],
      'gazi television': ['ch-gazi-tv'],
      'gazi': ['ch-gazi-tv'],
      'maasranga': ['ch-maasranga-tv-hd'],
      'maasranga tv': ['ch-maasranga-tv-hd'],
      'maasranga tv hd': ['ch-maasranga-tv-hd'],
      'nagorik': ['ch-nagorik-tv'],
      'nagorik tv': ['ch-nagorik-tv'],
      'star sports 1 hindi': ['ch-star-sports-1-hindi'],
      'star sports hindi': ['ch-star-sports-1-hindi'],
      'star sports 1 hd hindi': ['ch-star-sports-1-hindi'],
      'ss1 hindi': ['ch-star-sports-1-hindi'],
      'star sports 1': ['ch-star-sports-1-hd'],
      'star sports 1 hd': ['ch-star-sports-1-hd'],
      'star sports one': ['ch-star-sports-1-hd'],
      'star sport 1': ['ch-star-sports-1-hd'],
      'ss1': ['ch-star-sports-1-hd'],
      'willow': ['ch-willow-hd', 'ch-willow-sports'],
      'willow cricket': ['ch-willow-hd', 'ch-willow-sports'],
      'willow tv': ['ch-willow-hd', 'ch-willow-sports'],
      'willow hd': ['ch-willow-hd', 'ch-willow-sports'],
      'willow usa': ['ch-willow-hd', 'ch-willow-sports'],
      'willow sports': ['ch-willow-sports', 'ch-willow-hd'],
      'willow sports 2': ['ch-willow-sports-2'],
      'willow 2': ['ch-willow-sports-2'],
      'willow extra': ['ch-willow-cricket-extra'],
      'willow xtra': ['ch-willow-cricket-extra'],
      'willow cricket extra': ['ch-willow-cricket-extra'],
      'ptv sports': ['ch-ptv-sports-hd'],
      'ptv sports hd': ['ch-ptv-sports-hd'],
      'ptv sport': ['ch-ptv-sports-hd'],
      'ptv': ['ch-ptv-sports-hd'],
      'a sports': ['ch-a-sports'],
      'a sports hd': ['ch-a-sports'],
      'asports': ['ch-a-sports'],
      'a sport': ['ch-a-sports'],
      'ten sports': ['ch-ten-sports-hd'],
      'ten sports hd': ['ch-ten-sports-hd'],
      'ten sports pakistan': ['ch-ten-sports-hd'],
      'ten sports pk': ['ch-ten-sports-hd'],
      'ten cricket': ['ch-ten-cricket'],
      'sony sports ten 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony sports ten 2 hd': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony ten 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony ten 2 hd': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'ten 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'ten sports 2': ['ch-sony-sports-ten-2-hd', 'ch-sony-sports-2-hd'],
      'sony sports 2': ['ch-sony-sports-2-hd', 'ch-sony-sports-ten-2-hd'],
      'sony sports 2 hd': ['ch-sony-sports-2-hd', 'ch-sony-sports-ten-2-hd'],
      'sony sports ten 3': ['ch-sony-sports-ten-3'],
      'sony sports ten 3 hd': ['ch-sony-sports-ten-3'],
      'sony ten 3': ['ch-sony-sports-ten-3'],
      'sony ten 3 hd': ['ch-sony-sports-ten-3'],
      'ten 3': ['ch-sony-sports-ten-3'],
      'ten sports 3': ['ch-sony-sports-ten-3'],
      'sony ten 3 hindi': ['ch-sony-sports-ten-3'],
      'sky sports cricket': ['ch-sky-sports-cricket'],
      'sky cricket': ['ch-sky-sports-cricket'],
      'sky sports mix': ['ch-sky-sports-mix'],
      'fox cricket': ['ch-fox-cricket-501'],
      'fox cricket 501': ['ch-fox-cricket-501'],
      'fox sports 501': ['ch-fox-cricket-501'],
      'astro cricket': ['ch-astro-cricbuz'],
      'astro cricbuz': ['ch-astro-cricbuz'],
      'cricket gold': ['ch-cricket-gold'],
      'dd sports': ['ch-dd-sports']
    };

    const nonCricketDedicatedIds = new Set<string>([
      'ch-tnt-sports-1',
      'ch-tnt-sports-2',
      'ch-tnt-sports-3',
      'ch-tnt-sports-4',
      'ch-sky-sports-action',
      'ch-star-sports-s1-hd',
      'ch-star-sports-sl-2',
      'ch-star-sports-select-1',
      'ch-star-sports-select-2',
      'ch-sky-sports-epl',
      'ch-sky-sports-football',
      'ch-sky-sports-f1',
      'ch-sky-sports-tennis',
      'ch-sky-sports-golf',
      'ch-sky-sports-racing'
    ]);

    const verifiedCricketAliasTargetIds = new Set<string>(Object.values(explicitServerAliases).flat());

    // Only strip technical resolution suffixes at word boundaries (NEVER strip "TV" globally)
    const stripHdSuffix = (s: string) =>
      s
        .toLowerCase()
        .replace(/\b(hd|sd|fhd|uhd|4k)\b/gi, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const isValidHttpUrl = (u: any): boolean =>
      typeof u === 'string' && /^https?:\/\//i.test(u.trim());

    const hasValidChannelStream = (c: any): boolean => {
      if (!c || c.active !== true) return false;
      if (isValidHttpUrl(c.streamUrl) || isValidHttpUrl(c.url) || isValidHttpUrl(c.stream_url)) return true;
      if (Array.isArray(c.streams) && c.streams.some((s: any) => s && isValidHttpUrl(s.url))) return true;
      return false;
    };

    const isCricketCompatibleChannel = (c: any, isFromExplicitAlias: boolean = false): boolean => {
      if (!c || c.active !== true) return false;
      const cid = String(c.id || '').toLowerCase().trim();
      const sportsArr = Array.isArray(c.sports) ? c.sports.map((s: any) => String(s).toLowerCase().trim()) : [];
      const catsArr = Array.isArray(c.categories) ? c.categories.map((cat: any) => String(cat).toLowerCase().trim()) : [];
      const primaryCat = String(c.category || '').toLowerCase().trim();

      const hasExplicitCricketTag = sportsArr.includes('cricket') || catsArr.includes('cricket');
      if (nonCricketDedicatedIds.has(cid) && !hasExplicitCricketTag) {
        return false;
      }

      const hasDedicatedOtherSportTag =
        sportsArr.some((s: string) =>
          ['football', 'soccer', 'tennis', 'motorsport', 'f1', 'rugby', 'combat', 'combat sports', 'boxing', 'ufc', 'wwe', 'basketball', 'baseball'].includes(s)
        ) ||
        catsArr.some((cat: string) =>
          ['football', 'soccer', 'tennis', 'motorsport', 'f1', 'rugby', 'combat', 'combat sports', 'boxing', 'ufc', 'wwe', 'basketball', 'baseball'].includes(cat)
        );

      if (!hasExplicitCricketTag && hasDedicatedOtherSportTag) {
        return false;
      }

      if (hasExplicitCricketTag) {
        return primaryCat === 'sports' || catsArr.includes('sports') || catsArr.includes('cricket');
      }

      if (isFromExplicitAlias && verifiedCricketAliasTargetIds.has(cid)) {
        return (
          primaryCat === 'sports' ||
          catsArr.includes('sports') ||
          cid === 'ch-gazi-tv' ||
          cid === 'ch-maasranga-tv-hd' ||
          cid === 'ch-nagorik-tv'
        );
      }

      return false;
    };

    const matchedChannels: any[] = [];
    const seenChannelIds = new Set<string>();
    const fallbackCricketPool = allChannels.filter(
      (c: any) => isCricketCompatibleChannel(c, false) && hasValidChannelStream(c)
    );

    for (const bName of uniqueBroadcasters) {
      const bLower = bName.toLowerCase().trim();
      const bStripped = stripHdSuffix(bLower);
      if (
        !bLower ||
        bannedNetworks.some(banned => bLower.includes(banned)) ||
        (bStripped && bannedNetworks.some(banned => bStripped.includes(banned))) ||
        genericUmbrellaNetworks.includes(bLower) ||
        (bStripped && genericUmbrellaNetworks.includes(bStripped))
      ) {
        continue;
      }

      const tokenCandidates: any[] = [];

      // 1. Explicit verified mapping (supports multiple valid channels per alias)
      const mappedIds = explicitServerAliases[bLower] || (bStripped ? explicitServerAliases[bStripped] : undefined);
      if (mappedIds && mappedIds.length > 0) {
        for (const mappedId of mappedIds) {
          const found = allChannels.find(
            (c: any) =>
              c &&
              (c.id === mappedId || c.id === `ch-${mappedId}`) &&
              isCricketCompatibleChannel(c, true) &&
              hasValidChannelStream(c)
          );
          if (found) {
            tokenCandidates.push(found);
          }
        }
      }

      // 2. Exact match restricted strictly to active Cricket-compatible channels (rejecting ambiguous collisions)
      if (
        tokenCandidates.length === 0 &&
        !mappedIds &&
        bStripped &&
        !bannedNetworks.some(banned => bStripped.includes(banned)) &&
        !genericUmbrellaNetworks.includes(bStripped)
      ) {
        const exactMatches = fallbackCricketPool.filter((c: any) => {
          const cName = String(c.name || '').toLowerCase().trim();
          const cId = String(c.id || '').toLowerCase().trim();
          if (cName === bLower || cId === bLower) return true;
          const cStripped = stripHdSuffix(cName);
          return Boolean(cStripped && cStripped === bStripped);
        });
        if (exactMatches.length === 1) {
          tokenCandidates.push(exactMatches[0]);
        }
      }

      for (const candidateChannel of tokenCandidates) {
        if (!candidateChannel || !hasValidChannelStream(candidateChannel)) {
          continue;
        }
        if (!seenChannelIds.has(candidateChannel.id)) {
          seenChannelIds.add(candidateChannel.id);
          matchedChannels.push(candidateChannel);
        }
      }
    }

    const primaryChannel = matchedChannels.length > 0 ? matchedChannels[0] : null;
    const verifiedStreams: any[] = [];
    const seenStreamUrls = new Set<string>();

    for (const ch of matchedChannels) {
      const chSports = Array.isArray(ch.sports) && ch.sports.length > 0 ? ch.sports : ['Cricket'];
      const pUrl = ch.streamUrl || ch.url || ch.stream_url;
      const bUrls = Array.isArray(ch.backupUrls) ? ch.backupUrls : [];
      const chStreams = Array.isArray(ch.streams) && ch.streams.length > 0
        ? ch.streams
        : (isValidHttpUrl(pUrl)
          ? [
              {
                name: `${ch.name} (Server 1 — ${ch.isHD === false ? '720p HD' : '1080p FHD'})`,
                serverLabel: `Server 1 — ${ch.isHD === false ? '720p HD' : '1080p FHD'}`,
                channelName: ch.name,
                url: pUrl,
                quality: ch.isHD === false ? '720p HD' : '1080p FHD'
              }
            ]
          : []);

      let chServerIdx = 0;
      for (const s of chStreams) {
        if (s && isValidHttpUrl(s.url)) {
          const normUrl = s.url.trim().toLowerCase();
          if (!seenStreamUrls.has(`${ch.id}::${normUrl}`)) {
            seenStreamUrls.add(`${ch.id}::${normUrl}`);
            chServerIdx++;
            const qLabel = s.quality || (ch.isHD === false ? '720p HD' : '1080p FHD');
            const rawName = s.name || `${ch.name} (Server ${chServerIdx} — ${qLabel})`;
            const cleanName = String(rawName).replace(/\(Server\s+(\d+)\s*\(([^()]+)\)\)/gi, '(Server $1 — $2)');
            const rawLabel = s.serverLabel || `Server ${chServerIdx} — ${qLabel}`;
            const cleanLabel = String(rawLabel).replace(/\(([^()]+)\)/g, '— $1').replace(/\s+/g, ' ').trim();
            verifiedStreams.push({
              name: cleanName,
              serverLabel: cleanLabel,
              channelId: ch.id,
              channelName: ch.name,
              channelLogo: ch.logo || null,
              category: ch.category || 'Sports',
              sports: chSports,
              url: s.url.trim(),
              quality: qLabel,
              isHD: s.isHD !== undefined ? s.isHD !== false : ch.isHD !== false
            });
          }
        }
      }

      if (isValidHttpUrl(pUrl)) {
        const normPurl = pUrl.trim().toLowerCase();
        if (!seenStreamUrls.has(`${ch.id}::${normPurl}`)) {
          seenStreamUrls.add(`${ch.id}::${normPurl}`);
          chServerIdx++;
          const qLabel = ch.isHD === false ? '720p HD' : '1080p FHD';
          verifiedStreams.push({
            name: `${ch.name} (Server ${chServerIdx} — ${qLabel})`,
            serverLabel: `Server ${chServerIdx} — ${qLabel}`,
            channelId: ch.id,
            channelName: ch.name,
            channelLogo: ch.logo || null,
            category: ch.category || 'Sports',
            sports: chSports,
            url: pUrl.trim(),
            quality: qLabel,
            isHD: ch.isHD !== false
          });
        }
      }

      for (const bUrl of bUrls) {
        if (isValidHttpUrl(bUrl)) {
          const normBurl = bUrl.trim().toLowerCase();
          if (!seenStreamUrls.has(`${ch.id}::${normBurl}`)) {
            seenStreamUrls.add(`${ch.id}::${normBurl}`);
            chServerIdx++;
            verifiedStreams.push({
              name: `${ch.name} (Server ${chServerIdx} Backup)`,
              serverLabel: `Server ${chServerIdx} (Backup)`,
              channelId: ch.id,
              channelName: ch.name,
              channelLogo: ch.logo || null,
              category: ch.category || 'Sports',
              sports: chSports,
              url: bUrl.trim(),
              quality: '720p HD',
              isHD: ch.isHD !== false
            });
          }
        }
      }
    }

    return {
      broadcaster: primaryBroadcaster,
      broadcasters: uniqueBroadcasters,
      channelId: primaryChannel ? primaryChannel.id : null,
      channelIds: matchedChannels.map((c: any) => c.id),
      channelName: primaryChannel ? primaryChannel.name : null,
      channelLogo: primaryChannel ? (primaryChannel.logo || null) : null,
      streamUrl: primaryChannel ? (primaryChannel.streamUrl || primaryChannel.url || primaryChannel.stream_url || null) : null,
      streams: verifiedStreams,
    };
  }

  // Normalization Helper for Multi-Tier Broadcaster & Channel Resolution
  function normalizeString(str: string): string {
    if (!str || typeof str !== "string") return "";
    return str
      .toLowerCase()
      .replace(/^(tsdb|cr|ch|event|mcenter)[-_]/i, "")
      .replace(/[\s\-_.:/\\,+|&]+/g, " ")
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isBannedNetworkOrOttName(name: string): boolean {
    if (!name || typeof name !== "string") return false;
    const n = name.toLowerCase().trim();
    if (!n) return false;

    const genericUmbrella = [
      "star sports",
      "star sports select",
      "sony sports",
      "sky sports",
      "tnt sports",
      "dazn",
      "bein sports",
      "bein",
      "eurosport",
      "supersport",
      "fox sports"
    ];
    if (genericUmbrella.includes(n)) return true;

    if ((n.includes("supersport") || n.includes("super sport")) && !n.includes("laliga") && !n.includes("la liga")) {
      return true;
    }

    const banned = [
      "fancode",
      "cricbuzz",
      "hotstar",
      "disney+ hotstar",
      "disney hotstar",
      "jiohotstar",
      "peacock",
      "paramount",
      "paramount+",
      "optus sport",
      "optus",
      "prime video",
      "amazon prime video",
      "amazon prime",
      "canal+",
      "viaplay",
      "stan sport",
      "jiocinema",
      "jio cinema",
      "sports18",
      "sports 18",
      "sports18 1",
      "star sports network",
      "sony sports network",
      "sony network",
      "sonyliv",
      "sony liv",
      "sky sports network",
      "tnt sports network",
      "bein sports network",
      "tsn",
      "supersport action",
      "supersport cricket",
      "supersport premier league",
      "supersport football",
      "supersport premier",
      "supersport epl",
      "supersport grandstand",
      "supersport variety",
      "supersport rugby",
      "mlb.tv",
      "mlb tv",
      "wnba league pass",
      "nba league pass",
      "nba tv",
      "espn+",
      "espn plus",
      "apple tv",
      "apple tv+",
      "fubo",
      "fubotv",
      "kayosports",
      "kayo sports",
      "spark sport"
    ];
    return banned.some(b => n.includes(b));
  }

  // Smart Broadcaster Search in channels.json with fuzzy keyword matching
  function findChannelsByBroadcasterSearch(broadcasterText: string, allChannels: any[], sportHint?: string): any[] {
    if (!broadcasterText || typeof broadcasterText !== "string" || broadcasterText.trim().length < 3 || !Array.isArray(allChannels) || allChannels.length === 0) return [];
    const rawLower = broadcasterText.trim().toLowerCase();
    const invalidTokens = ["null", "undefined", "none", "tbd", "unknown", "n/a", "na", "live", "stream", "match", "sports", "tv"];
    if (invalidTokens.includes(rawLower)) return [];

    if (isBannedNetworkOrOttName(broadcasterText) || isBannedNetworkOrOttName(rawLower)) return [];

    const normBcast = normalizeString(broadcasterText);
    if (!normBcast || normBcast.length < 3 || invalidTokens.includes(normBcast)) return [];
    if (isBannedNetworkOrOttName(normBcast)) return [];

    const bcastKeywords = normBcast.split(" ").filter(w => w.length >= 3 && !["the", "and", "live", "network", "tv", "hd", "channel", "sports"].includes(w));
    if (bcastKeywords.length === 0 && normBcast.length < 4) return [];

    const activeChannels = allChannels.filter((c: any) => {
      if (!c) return false;
      const isActive = c.active === true || c.is_active === true || (c.active !== false && c.is_active !== false);
      const isLive = c.isLive !== false && c.is_live !== false;
      const hasStream = Boolean(c.streamUrl || c.stream_url || c.url || (Array.isArray(c.streams) && c.streams.length > 0));
      return isActive && isLive && hasStream;
    });

    const scoredChannels: { channel: any; score: number }[] = [];

    for (const ch of activeChannels) {
      const chNameNorm = normalizeString(ch.name || ch.title || "");
      const chIdNorm = normalizeString(ch.id || "");
      const chTags = Array.isArray(ch.tags) ? ch.tags.map((t: any) => normalizeString(String(t))) : [];
      const chSports = Array.isArray(ch.sports) ? ch.sports.map((s: any) => normalizeString(String(s))) : [];

      let score = 0;

      if (chNameNorm === normBcast || chIdNorm === normBcast) {
        score += 100;
      } else if ((chNameNorm.length >= 4 && normBcast.includes(chNameNorm)) || (normBcast.length >= 4 && chNameNorm.includes(normBcast))) {
        score += 70;
      }

      let matchedKeywords = 0;
      for (const kw of bcastKeywords) {
        if (chNameNorm.includes(kw) || chIdNorm.includes(kw) || chTags.some((t: string) => t.includes(kw))) {
          matchedKeywords++;
          score += 25;
        }
      }

      if (sportHint) {
        const sNorm = normalizeString(sportHint);
        if (chSports.some((s: string) => s.includes(sNorm) || sNorm.includes(s)) || (ch.category && normalizeString(ch.category).includes(sNorm))) {
          score += 10;
        }
      }

      // Must have matched specific non-stopword keywords or exact name match
      if ((score >= 60 && (matchedKeywords > 0 || chNameNorm === normBcast || chIdNorm === normBcast)) || (bcastKeywords.length > 0 && matchedKeywords === bcastKeywords.length)) {
        scoredChannels.push({ channel: ch, score });
      }
    }

    scoredChannels.sort((a, b) => b.score - a.score || (a.channel.priority || 99) - (b.channel.priority || 99));
    return scoredChannels.map(sc => sc.channel);
  }

  // Sport & League Default Fallback (Secondary Fallback)
  function findChannelsBySportFallback(sportName: string, allChannels: any[]): any[] {
    if (!sportName || !Array.isArray(allChannels)) return [];
    const sNorm = normalizeString(sportName);
    if (!sNorm) return [];

    const activeChannels = allChannels.filter((c: any) => {
      if (!c) return false;
      const isActive = c.active === true || c.is_active === true || (c.active !== false && c.is_active !== false);
      const isLive = c.isLive !== false && c.is_live !== false;
      const hasStream = Boolean(c.streamUrl || c.stream_url || c.url || (Array.isArray(c.streams) && c.streams.length > 0));
      return isActive && isLive && hasStream;
    });

    const matched = activeChannels.filter((c: any) => {
      const chSports = Array.isArray(c.sports) ? c.sports.map((s: any) => normalizeString(String(s))) : [];
      const chCat = normalizeString(c.category || "");
      const chCats = Array.isArray(c.categories) ? c.categories.map((x: any) => normalizeString(String(x))) : [];
      const chName = normalizeString(c.name || "");

      if (sNorm === "cricket") {
        return chSports.includes("cricket") || chCats.includes("cricket") ||
          chName.includes("cricket") || chName.includes("willow") || chName.includes("t sports") ||
          chName.includes("tsports") || chName.includes("ptv sports") || chName.includes("star sports") ||
          chName.includes("gazi") || chName.includes("gtv") || chName.includes("a sports") || chName.includes("ten sports");
      } else if (sNorm === "football" || sNorm === "soccer") {
        return chSports.includes("football") || chSports.includes("soccer") || chCats.includes("football") ||
          chName.includes("football") || chName.includes("premier league") || chName.includes("la liga") ||
          chName.includes("bein sports") || chName.includes("sky sports") || chName.includes("tnt sports") ||
          chName.includes("sony sports") || chName.includes("dazn");
      } else if (sNorm === "basketball" || sNorm === "nba") {
        return chSports.includes("basketball") || chSports.includes("nba") || chCats.includes("basketball") ||
          chName.includes("nba") || chName.includes("espn") || chName.includes("tnt sports");
      } else if (sNorm === "tennis") {
        return chSports.includes("tennis") || chCats.includes("tennis") || chName.includes("tennis") ||
          chName.includes("eurosport") || chName.includes("sony sports") || chName.includes("bein sports");
      } else if (sNorm === "wwe" || sNorm === "combat" || sNorm === "ufc" || sNorm === "boxing") {
        return chSports.some((s: string) => s.includes("wwe") || s.includes("combat") || s.includes("ufc")) ||
          chName.includes("wwe") || chName.includes("ufc") || chName.includes("sony ten") || chName.includes("tnt");
      } else if (sNorm === "motorsport" || sNorm === "f1" || sNorm === "racing") {
        return chSports.some((s: string) => s.includes("motor") || s.includes("f1") || s.includes("racing")) ||
          chName.includes("f1") || chName.includes("sky sports f1") || chName.includes("motorsport");
      }

      return chSports.some((s: string) => s.includes(sNorm) || sNorm.includes(s)) ||
        chCats.some((ct: string) => ct.includes(sNorm) || sNorm.includes(ct)) ||
        chCat.includes(sNorm) ||
        chName.includes(sNorm);
    });

    matched.sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99));
    return matched;
  }

  // Build clean authorized stream servers from matched channels
  function buildStreamsFromChannels(channels: any[]): any[] {
    const streams: any[] = [];
    const seenUrls = new Set<string>();

    for (const ch of channels) {
      if (!ch) continue;
      const defaultQuality = ch.streams?.[0]?.quality || (ch.isHD === false ? "720p HD" : "1080p FHD");

      if (Array.isArray(ch.streams) && ch.streams.length > 0) {
        for (let i = 0; i < ch.streams.length; i++) {
          const s = ch.streams[i];
          const sUrl = s?.url || s?.streamUrl;
          if (sUrl && typeof sUrl === "string" && !seenUrls.has(sUrl.trim())) {
            seenUrls.add(sUrl.trim());
            const serverNum = streams.filter(x => x.channelId === ch.id).length + 1;
            const sLabel = s.serverLabel || `Server ${serverNum} — ${s.quality || defaultQuality}`;
            streams.push({
              name: s.name || `${ch.name} (${sLabel})`,
              serverLabel: sLabel,
              channelName: ch.name,
              channelId: ch.id,
              channelLogo: ch.logo || ch.image || "",
              url: sUrl.trim(),
              quality: s.quality || defaultQuality,
              isHD: s.isHD !== false && ch.isHD !== false,
              category: ch.category || "Sports"
            });
          }
        }
      }

      const directUrl = ch.streamUrl || ch.stream_url || ch.url;
      if (directUrl && typeof directUrl === "string" && !seenUrls.has(directUrl.trim())) {
        seenUrls.add(directUrl.trim());
        const serverNum = streams.filter(x => x.channelId === ch.id).length + 1;
        const sLabel = `Server ${serverNum} — ${defaultQuality}`;
        streams.push({
          name: `${ch.name} (${sLabel})`,
          serverLabel: sLabel,
          channelName: ch.name,
          channelId: ch.id,
          channelLogo: ch.logo || ch.image || "",
          url: directUrl.trim(),
          quality: defaultQuality,
          isHD: ch.isHD !== false,
          category: ch.category || "Sports"
        });
      }
    }

    return streams;
  }

  // Gemini AI-powered Broadcast Channel Mapper Cache (Strictly normalizes API-returned broadcasters only)
  const geminiChannelMapCache = new Map<string, any>();

  async function getMappedChannelFromGemini(apiMatchData: any, localChannels?: any[]) {
    const matchId = String(apiMatchData?.match_id || apiMatchData?.id || apiMatchData?.rawId || apiMatchData?.idEvent || apiMatchData?.fixtureId || "").trim();
    const sport = String(apiMatchData?.sport || apiMatchData?.sportName || "sports").toLowerCase().trim();

    // Extract ONLY broadcaster/channel fields actually returned by the API
    const rawBroadcasterInputs: string[] = [];
    const collectRawBcast = (val: any) => {
      if (!val) return;
      if (Array.isArray(val)) {
        val.forEach(collectRawBcast);
      } else if (typeof val === "string" && val.trim().length >= 3) {
        const t = val.trim();
        const tLower = t.toLowerCase();
        if (!["null", "undefined", "none", "tbd", "unknown"].includes(tLower)) {
          rawBroadcasterInputs.push(t);
        }
      } else if (typeof val === "object") {
        if (Array.isArray(val.names)) collectRawBcast(val.names);
        const cname = val.name || val.channel_name || val.broadcaster_name || val.station || val.tv_name || val.channel || val.media?.shortName || val.media?.name || "";
        if (typeof cname === "string" && cname.trim().length >= 3) {
          const t = cname.trim();
          const tLower = t.toLowerCase();
          if (!["null", "undefined", "none", "tbd", "unknown"].includes(tLower)) {
            rawBroadcasterInputs.push(t);
          }
        }
      }
    };

    collectRawBcast(apiMatchData?.broadcaster);
    collectRawBcast(apiMatchData?.broadcasters);
    collectRawBcast(apiMatchData?.strTVStation);
    collectRawBcast(apiMatchData?.tvStation);
    collectRawBcast(apiMatchData?.broadcast);
    collectRawBcast(apiMatchData?.broadcasts);
    collectRawBcast(apiMatchData?.geoBroadcasts);
    collectRawBcast(apiMatchData?.tv_channels);
    collectRawBcast(apiMatchData?.tv_rights);
    collectRawBcast(apiMatchData?.tvRights);

    const safeIdKey = matchId ? `id_${matchId}` : (rawBroadcasterInputs.length > 0 ? `raw_${rawBroadcasterInputs.join("|")}` : `nocache_${Date.now()}_${Math.random()}`);
    const cacheKey = `gemini_map::${safeIdKey}::sport_${sport}::cid_${apiMatchData?.channelId || ""}`;
    if (matchId || rawBroadcasterInputs.length > 0) {
      if (geminiChannelMapCache.has(cacheKey)) {
        return geminiChannelMapCache.get(cacheKey);
      }
    }

    let normalizedApiBroadcasters = [...rawBroadcasterInputs];

    // Optional AI normalization of raw API broadcaster strings ONLY
    const activeGeminiKey = (process.env.GEMINI_API_KEY || "").trim();
    if (activeGeminiKey && rawBroadcasterInputs.length > 0) {
      try {
        const prompt = `Extract and normalize ONLY the television broadcaster/channel names explicitly present in these raw sports API broadcaster strings.
Do NOT invent, guess, or infer any broadcaster from teams, leagues, or countries.
Raw API Broadcaster Strings: ${JSON.stringify(rawBroadcasterInputs)}`;

        const response = await aiClient.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            systemInstruction:
              "You are a strict broadcaster string normalizer for HighFy TV. You may ONLY extract and normalize broadcaster names that are explicitly present in the input strings. Never invent or guess broadcasters.",
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                normalized_broadcasters: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Clean canonical broadcaster names extracted strictly from the input strings.",
                },
              },
              required: ["normalized_broadcasters"],
            },
          },
        });

        const responseText = (response.text || "").trim();
        if (responseText) {
          const parsed = JSON.parse(responseText);
          if (Array.isArray(parsed.normalized_broadcasters) && parsed.normalized_broadcasters.length > 0) {
            normalizedApiBroadcasters = Array.from(new Set([...rawBroadcasterInputs, ...parsed.normalized_broadcasters]));
          }
        }
      } catch (err: any) {
        console.warn("[Gemini Broadcaster Normalizer] Using deterministic API broadcaster extraction:", err.message);
      }
    }

    // Deterministic matching strictly against verified HighFy TV channel catalog
    const resolver = channelResolverModule || (globalThis as any).HighFyChannelResolver;
    const allChannels = localChannels || getChannelsFromDisk();
    let resolvedData: any = null;

    if (resolver && typeof resolver.resolveEventChannels === "function") {
      resolvedData = resolver.resolveEventChannels(
        {
          id: matchId,
          sport: sport || apiMatchData?.sport || "Sports",
          channelId: apiMatchData?.channelId,
          broadcasterId: apiMatchData?.broadcasterId,
          broadcasters: normalizedApiBroadcasters,
        },
        allChannels
      );
    }

    // Multi-Tier Fallback: Smart Broadcaster Search
    let matchedChannelsList: any[] = (resolvedData && resolvedData.verified && Array.isArray(resolvedData.channels)) ? resolvedData.channels : [];
    let isSpecificMatch = Boolean(resolvedData && resolvedData.verified && resolvedData.channelId);

    if (matchedChannelsList.length === 0 && normalizedApiBroadcasters.length > 0) {
      for (const bStr of normalizedApiBroadcasters) {
        const found = findChannelsByBroadcasterSearch(bStr, allChannels, sport);
        if (found.length > 0) {
          matchedChannelsList = found;
          isSpecificMatch = true;
          break;
        }
      }
    }

    // Multi-Tier Fallback: Sport & League Default Fallback
    if (matchedChannelsList.length === 0 && sport) {
      matchedChannelsList = findChannelsBySportFallback(sport, allChannels);
    }

    // Filter active & live channels strictly
    const verifiedActiveChannels = matchedChannelsList.filter((c: any) => {
      if (!c) return false;
      const isActive = c.active === true || c.is_active === true || (c.active !== false && c.is_active !== false);
      const isLive = c.isLive !== false && c.is_live !== false;
      return isActive && isLive;
    });

    const isVerified = verifiedActiveChannels.length > 0;
    // Only set primaryChannel if it was a specific direct channel or specific broadcaster match
    const primaryChannel = (isVerified && isSpecificMatch) ? verifiedActiveChannels[0] : null;
    const primaryId = primaryChannel ? primaryChannel.id : null;
    const cids = verifiedActiveChannels.map((c: any) => c.id).filter(Boolean);
    const fallbackId = cids[1] || primaryId || null;
    const builtStreams = isVerified ? buildStreamsFromChannels(verifiedActiveChannels) : [];

    const result = {
      match_id: matchId,
      status: isVerified ? "matched" : "unavailable",
      verified: isVerified,
      extracted_broadcasters: normalizedApiBroadcasters,
      mapped_channel_id: primaryId,
      primary_channel_id: primaryId,
      fallback_channel_id: fallbackId,
      verified_channel_ids: cids,
      channels: verifiedActiveChannels,
      streams: builtStreams,
      match_confidence: primaryId ? "100%" : (isVerified ? "70%" : "0%"),
      message: isVerified ? (primaryId ? "Verified channel matched" : "Sport-level channels available") : "Live channel unavailable",
    };

    if (matchId || rawBroadcasterInputs.length > 0) {
      geminiChannelMapCache.set(cacheKey, result);
    }
    return result;
  }

  function normalizeCricketDataEvent(item: any): any {
    if (!item) return null;
    const rawId = item.id || item.unique_id || item.match_id || "unknown";
    const name = item.name || item.title || (item.t1 && item.t2 ? `${item.t1} vs ${item.t2}` : "Cricket Match");
    const matchType = String(item.matchType || item.type || "Cricket").toUpperCase();
    const venue = item.venue || "";
    const statusText = item.status || "Scheduled";
    const statusLower = statusText.toLowerCase();
    const msLower = String(item.ms || "").toLowerCase();

    const matchStarted = item.matchStarted === true || item.matchStarted === "true" || msLower === "live" || msLower === "result";
    const matchEnded = item.matchEnded === true || item.matchEnded === "true" || msLower === "result";

    const rawStartStr = item.dateTimeGMT || item.date || item.startTime || null;
    const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr.endsWith("Z") ? rawStartStr : rawStartStr + "Z")) : NaN;
    const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
    const timestamp = hasValidStart ? parsedStartMs : null;

    const fmtLowerCheck = `${matchType} ${name} ${item.series || ""}`.toLowerCase();
    const isT20Format = fmtLowerCheck.includes("t20") || fmtLowerCheck.includes("t10");
    const maxLiveDurationMs = isT20Format ? 4.5 * 3600 * 1000 : 8.5 * 3600 * 1000;
    const isStaleMatch = hasValidStart && Date.now() - parsedStartMs > maxLiveDurationMs;

    let status = "upcoming";
    if (
      matchEnded ||
      msLower === "result" ||
      isStaleMatch ||
      statusLower.includes("won by") ||
      statusLower.includes("won the match") ||
      /\bstumps\b/i.test(statusLower) ||
      statusLower.includes("match drawn") ||
      statusLower.includes("match tied") ||
      statusLower.includes("no result") ||
      statusLower.includes("abandoned") ||
      statusLower.includes("awarded") ||
      statusLower.includes("refused to play") ||
      statusLower.includes("walkover") ||
      statusLower.includes("cancelled") ||
      statusLower.includes("target reached") ||
      statusLower.includes("lost by") ||
      statusLower.includes("winner") ||
      statusLower.includes("completed") ||
      statusLower.includes("concluded")
    ) {
      status = "finished";
    } else if ((matchStarted && !matchEnded) || msLower === "live") {
      status = "live";
    } else {
      status = "upcoming";
    }

    // Parse team names & team info (supports both currentMatches/matches and cricScore t1/t2 schemas)
    const cleanCricScoreTeam = (raw: string) => String(raw || "").replace(/\s*\[[^\]]+\]\s*$/, "").trim();
    const extractShortFromBracket = (raw: string) => {
      const m = String(raw || "").match(/\[([^\]]+)\]/);
      return m ? m[1].trim() : "";
    };

    const teams = Array.isArray(item.teams) ? item.teams : [];
    const teamInfo = Array.isArray(item.teamInfo) ? item.teamInfo : [];
    let homeName = teams[0] || (item.t1 ? cleanCricScoreTeam(item.t1) : (name.includes(" vs ") ? name.split(" vs ")[0].split(",")[0].trim() : "Team 1"));
    let awayName = teams[1] || (item.t2 ? cleanCricScoreTeam(item.t2) : (name.includes(" vs ") ? name.split(" vs ")[1].split(",")[0].trim() : "Team 2"));

    const homeBracketShort = extractShortFromBracket(item.t1);
    const awayBracketShort = extractShortFromBracket(item.t2);

    const findTeamInfo = (targetName: string, targetShort: string, otherName: string, fallbackIdx: number) => {
      const tLower = String(targetName || "").toLowerCase().trim();
      const sLower = String(targetShort || "").toLowerCase().trim();
      const oLower = String(otherName || "").toLowerCase().trim();
      const exact = teamInfo.find(
        (t: any) =>
          (t?.name && String(t.name).toLowerCase().trim() === tLower) ||
          (sLower && t?.shortname && String(t.shortname).toLowerCase().trim() === sLower)
      );
      if (exact) return exact;
      const partial = teamInfo.find((t: any) => {
        const n = String(t?.name || "").toLowerCase().trim();
        return n && n !== oLower && (n.includes(tLower) || tLower.includes(n));
      });
      if (partial) return partial;
      const candidate = teamInfo[fallbackIdx];
      if (candidate && String(candidate.name || "").toLowerCase().trim() !== oLower) {
        return candidate;
      }
      return {};
    };

    const homeInfo = findTeamInfo(homeName, homeBracketShort, awayName, 0);
    const awayInfo = findTeamInfo(awayName, awayBracketShort, homeName, 1);

    const homeLogo = resolveHDTeamLogo(homeInfo.shortname ? `${homeName} [${homeInfo.shortname}]` : (item.t1 || homeName), homeInfo.img || item.t1img);
    const awayLogo = resolveHDTeamLogo(awayInfo.shortname ? `${awayName} [${awayInfo.shortname}]` : (item.t2 || awayName), awayInfo.img || item.t2img);

    // Parse scores & overs from score array or cricScore t1s/t2s
    const parseCompactScore = (rawScoreStr: any) => {
      const str = String(rawScoreStr || "").trim();
      if (!str) return { score: "", overs: "" };
      const ovMatch = str.match(/^(.*?)\s*\(\s*([\d.]+)\s*(?:ov|overs)?\s*\)\s*$/i);
      if (ovMatch) {
        return { score: ovMatch[1].trim(), overs: `${ovMatch[2]} ov` };
      }
      return { score: str, overs: "" };
    };

    const scoreList = Array.isArray(item.score) ? item.score : [];
    const parsedT1S = parseCompactScore(item.t1s);
    const parsedT2S = parseCompactScore(item.t2s);
    let homeScore = parsedT1S.score;
    let homeOvers = parsedT1S.overs;
    let awayScore = parsedT2S.score;
    let awayOvers = parsedT2S.overs;

    if (scoreList.length > 0) {
      homeScore = "";
      homeOvers = "";
      awayScore = "";
      awayOvers = "";
      const homeNorm = homeName.toLowerCase().trim();
      const awayNorm = awayName.toLowerCase().trim();
      const homeShortNorm = String(homeInfo.shortname || homeBracketShort || "").toLowerCase().trim();
      const awayShortNorm = String(awayInfo.shortname || awayBracketShort || "").toLowerCase().trim();

      for (let idx = 0; idx < scoreList.length; idx++) {
        const sc = scoreList[idx];
        const inngTeam = String(sc.inning || "")
          .toLowerCase()
          .replace(/\b(inning|innings|1st|2nd|3rd|4th|\d+)\b/g, " ")
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const runs = sc.r !== undefined ? sc.r : 0;
        const wkts = sc.w !== undefined ? sc.w : 0;
        const overs = sc.o !== undefined ? sc.o : "";
        const formatted = `${runs}/${wkts}`;
        const formattedOvers = overs !== "" && overs !== null ? `${overs} ov` : "";

        const matchesHome =
          Boolean(inngTeam) &&
          (inngTeam === homeNorm ||
            (homeShortNorm && inngTeam === homeShortNorm) ||
            (inngTeam.includes(homeNorm) && !inngTeam.includes(awayNorm)) ||
            (homeNorm.includes(inngTeam) && !awayNorm.includes(inngTeam)));
        const matchesAway =
          Boolean(inngTeam) &&
          (inngTeam === awayNorm ||
            (awayShortNorm && inngTeam === awayShortNorm) ||
            (inngTeam.includes(awayNorm) && !inngTeam.includes(homeNorm)) ||
            (awayNorm.includes(inngTeam) && !homeNorm.includes(inngTeam)));

        const assignToHome = matchesHome ? true : matchesAway ? false : idx % 2 === 0;

        if (assignToHome) {
          homeScore = homeScore ? `${homeScore} & ${formatted}` : formatted;
          if (formattedOvers) homeOvers = formattedOvers;
        } else {
          awayScore = awayScore ? `${awayScore} & ${formatted}` : formatted;
          if (formattedOvers) awayOvers = formattedOvers;
        }
      }
    }

    const matchTimeStr = hasValidStart ? formatDhakaEventTime(parsedStartMs) : "Scheduled";
    const tournamentName = item.series || item.seriesName || (!/^[0-9a-f-]{20,}$/i.test(String(item.series_id || "")) ? item.series_id : "") || (name.includes(",") ? name.split(",").slice(1).join(",").trim() : "Cricket Series");
    const homeShort = homeInfo.shortname || extractShortFromBracket(item.t1) || "";
    const awayShort = awayInfo.shortname || extractShortFromBracket(item.t2) || "";

    // Broadcast & channel resolution
    const broadcastMockEvent = {
      tournament: { name: tournamentName },
      season: { name: tournamentName },
      type: matchType,
      competitors: [
        { qualifier: "home", name: homeName, id: homeShort || homeName },
        { qualifier: "away", name: awayName, id: awayShort || awayName }
      ]
    };
    const bData = resolveCricketBroadcastData(broadcastMockEvent, item);

    return {
      id: `cr-cricapi-${String(rawId).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      rawId: rawId,
      matchId: rawId,
      sport: "cricket",
      sportName: "Cricket",
      sportIcon: "fa-baseball-bat-ball",
      title: `${homeName} vs ${awayName}`,
      name: `${homeName} vs ${awayName}`,
      seriesName: tournamentName,
      tournament: tournamentName,
      league: tournamentName,
      matchDesc: matchType,
      matchFormat: matchType,
      matchType: matchType,
      startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
      endTime: null,
      status,
      statusText,
      statusLabel: status === "live" ? "LIVE" : (status === "finished" ? "FT" : "Upcoming"),
      timestamp,
      date: hasValidStart
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Dhaka",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(parsedStartMs))
        : "",
      matchTime: matchTimeStr,
      timeOrTimer: status === "live" ? "LIVE" : (status === "finished" ? "FT" : matchTimeStr),
      venue,
      isHot: status === "live",
      isSpecial: status === "live",
      team1: {
        teamId: homeInfo.shortname || homeName,
        name: homeName,
        shortName: homeInfo.shortname || "",
        logo: homeLogo,
        score: homeScore,
        overs: homeOvers,
      },
      team2: {
        teamId: awayInfo.shortname || awayName,
        name: awayName,
        shortName: awayInfo.shortname || "",
        logo: awayLogo,
        score: awayScore,
        overs: awayOvers,
      },
      homeTeam: {
        name: homeName,
        logo: homeLogo,
        score: homeScore,
        overs: homeOvers,
      },
      awayTeam: {
        name: awayName,
        logo: awayLogo,
        score: awayScore,
        overs: awayOvers,
      },
      broadcaster: bData.broadcaster,
      broadcasters: bData.broadcasters,
      channelId: bData.channelId,
      channelIds: bData.channelIds,
      channelName: bData.channelName,
      channelLogo: bData.channelLogo,
      streamUrl: bData.streamUrl,
      streams: bData.streams,
      subText: bData.channelName
        ? `${tournamentName} • ${bData.channelName}`
        : tournamentName,
      source: "CricketData.org",
    };
  }

  async function getNormalizedCricketDataMatches(apiKey: string = CRICKETDATA_API_KEY): Promise<any[]> {
    const activeKey = (apiKey || "").trim() || CRICKETDATA_API_KEY;

    const now = Date.now();
    if (cricketDataCache.matches && now - cricketDataCache.matches.timestamp < cricketDataCache.TTL_LIVE) {
      return cricketDataCache.matches.data;
    }
    if (inFlightPromises.cricketDataMatches) {
      return inFlightPromises.cricketDataMatches;
    }

    inFlightPromises.cricketDataMatches = (async () => {
      try {
        const events: any[] = [];
        const seenIds = new Set<string>();

        const getFingerprint = (ev: any) => {
          if (!ev) return null;
          const t1 = (ev.team1?.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
          const t2 = (ev.team2?.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
          if (!t1 || !t2) return null;
          const pair = [t1, t2].sort().join("_vs_");
          const date = ev.date || "";
          if (ev.status !== "finished") {
            return `${pair}::active::${date || "nodate"}`;
          }
          return `${pair}::finished::${date}`;
        };
        const seenFps = new Map<string, any>();

        const addEvent = (ev: any) => {
          if (!ev || !ev.id) return;
          if (seenIds.has(ev.id)) return;
          if (ev.timestamp && Date.now() - ev.timestamp > 24 * 3600 * 1000) return;
          const fp = getFingerprint(ev);
          if (fp && seenFps.has(fp)) {
            const existing = seenFps.get(fp);
            const shouldPromoteIncoming =
              (existing.status !== "live" && ev.status === "live") ||
              (existing.status === "upcoming" &&
                ev.status === "upcoming" &&
                ev.timestamp &&
                (!existing.timestamp || ev.timestamp < existing.timestamp));

            if (shouldPromoteIncoming) {
              existing.id = ev.id;
              existing.rawId = ev.rawId;
              existing.matchId = ev.matchId;
              existing.status = ev.status;
              existing.statusText = ev.statusText || existing.statusText;
              existing.statusLabel = ev.statusLabel || existing.statusLabel;
              existing.timeOrTimer = ev.timeOrTimer || existing.timeOrTimer;
              existing.timestamp = ev.timestamp || existing.timestamp;
              existing.date = ev.date || existing.date;
              existing.startTime = ev.startTime || existing.startTime;
              existing.matchTime = ev.matchTime || existing.matchTime;
              if (ev.tournament && ev.tournament !== "Cricket Series") {
                existing.tournament = ev.tournament;
                existing.league = ev.league || ev.tournament;
                existing.seriesName = ev.seriesName || ev.tournament;
              }
            }
            if (ev.team1?.score && (!existing.team1?.score || shouldPromoteIncoming)) {
              existing.team1.score = ev.team1.score;
              existing.team1.overs = ev.team1.overs;
              if (existing.homeTeam) {
                existing.homeTeam.score = ev.team1.score;
                existing.homeTeam.overs = ev.team1.overs;
              }
            }
            if (ev.team2?.score && (!existing.team2?.score || shouldPromoteIncoming)) {
              existing.team2.score = ev.team2.score;
              existing.team2.overs = ev.team2.overs;
              if (existing.awayTeam) {
                existing.awayTeam.score = ev.team2.score;
                existing.awayTeam.overs = ev.team2.overs;
              }
            }
            if (
              ev.team1?.logo &&
              ev.team1.logo !== "./assets/team-placeholder.svg" &&
              (!existing.team1?.logo || existing.team1.logo === "./assets/team-placeholder.svg" || existing.team1.logo.includes("cricapi.com"))
            ) {
              existing.team1.logo = ev.team1.logo;
              if (existing.homeTeam) existing.homeTeam.logo = ev.team1.logo;
            }
            if (
              ev.team2?.logo &&
              ev.team2.logo !== "./assets/team-placeholder.svg" &&
              (!existing.team2?.logo || existing.team2.logo === "./assets/team-placeholder.svg" || existing.team2.logo.includes("cricapi.com"))
            ) {
              existing.team2.logo = ev.team2.logo;
              if (existing.awayTeam) existing.awayTeam.logo = ev.team2.logo;
            }
            return;
          }
          seenIds.add(ev.id);
          if (fp) seenFps.set(fp, ev);
          events.push(ev);
        };

        // 1. Primary Source: CricketData.org (single request per 180s cache window; skip if blocked for 15 minutes)
        let primarySucceeded = false;
        if (activeKey && Date.now() >= cricketDataCache.blockedUntil) {
          const currentRes = await fetchCricketDataApi("currentMatches", activeKey, 0);
          if (currentRes.ok && Array.isArray(currentRes.data?.data)) {
            for (const item of currentRes.data.data) {
              const ev = normalizeCricketDataEvent(item);
              if (ev) addEvent(ev);
            }
            if (events.length > 0) {
              primarySucceeded = true;
            }
          }
        }

        let activeSource: "CricketData.org" | "ESPN-Fallback" = "CricketData.org";

        // 2. Fallback Source: ESPN Cricket Scoreboard (ONLY when CricketData is blocked/rate-limited/unavailable/empty)
        if (!primarySucceeded) {
          activeSource = "ESPN-Fallback";
          try {
            const espnDates: string[] = [];
            for (let dOffset = 0; dOffset <= 2; dOffset++) {
              const dt = new Date(Date.now() + dOffset * 24 * 3600 * 1000);
              const dStr = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Dhaka",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })
                .format(dt)
                .replace(/-/g, "");
              if (!espnDates.includes(dStr)) espnDates.push(dStr);
            }

            const espnResponses = await Promise.all(
              espnDates.map((d) =>
                fetch(`https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates=${d}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .catch(() => null)
              )
            );

            for (const espnJson of espnResponses as any[]) {
              const leagues = espnJson?.sports?.[0]?.leagues || [];
              for (const lg of leagues) {
                const leagueName = String(lg?.name || "Cricket Series").trim();
                for (const evItem of lg?.events || []) {
                  const comps = Array.isArray(evItem?.competitors) ? evItem.competitors : [];
                  const homeComp = comps.find((c: any) => c.homeAway === "home") || comps[0];
                  const awayComp = comps.find((c: any) => c.homeAway === "away") || comps[1];
                  const homeName = String(homeComp?.displayName || homeComp?.name || "").trim();
                  const awayName = String(awayComp?.displayName || awayComp?.name || "").trim();
                  if (
                    !homeName ||
                    !awayName ||
                    /^(tbc|tbd|tba|team\s*\d|unknown)$/i.test(homeName) ||
                    /^(tbc|tbd|tba|team\s*\d|unknown)$/i.test(awayName)
                  ) {
                    continue;
                  }

                  const rawStartStr = evItem.date || null;
                  const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr)) : NaN;
                  const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
                  const timestamp = hasValidStart ? parsedStartMs : null;

                  const stateStr = String(evItem.status || evItem.fullStatus?.type?.state || "pre").toLowerCase();
                  const shortSumStr = String(evItem.summary || "").trim();
                  const summaryStr = String(evItem.fullStatus?.longSummary || shortSumStr || "Scheduled").trim();

                  const splitEspnScore = (rawSc: any) => {
                    const s = String(rawSc || "").trim();
                    if (!s) return { score: "", overs: "" };
                    const m = s.match(/^(.*?)\s*\(\s*([\d./]+)\s*(?:ov|overs)?\s*\)\s*$/i);
                    if (m) return { score: m[1].trim(), overs: `${m[2]} ov` };
                    return { score: s, overs: "" };
                  };
                  const parsedHomeSc = splitEspnScore(homeComp?.score);
                  const parsedAwaySc = splitEspnScore(awayComp?.score);
                  const homeScore = parsedHomeSc.score;
                  const homeOvers = parsedHomeSc.overs;
                  const awayScore = parsedAwaySc.score;
                  const awayOvers = parsedAwaySc.overs;

                  const elapsedMs = hasValidStart ? Date.now() - parsedStartMs : 0;
                  if (hasValidStart && elapsedMs > 24 * 3600 * 1000) {
                    continue;
                  }
                  const isFutureUnstarted = hasValidStart && parsedStartMs > Date.now();
                  const fullDescStr = String(evItem.fullStatus?.type?.description || "").trim();
                  const rawLongSummary = String(evItem.fullStatus?.longSummary || "").trim();
                  const hasActivePlaySignal = Boolean(
                    homeScore ||
                      awayScore ||
                      (rawLongSummary && !/^(live|scheduled|match scheduled.*)$/i.test(rawLongSummary))
                  );
                  const isOverDurationOrStumps =
                    (hasValidStart && elapsedMs > 8.5 * 3600 * 1000) ||
                    /\bstumps\b/i.test(`${fullDescStr} ${shortSumStr} ${summaryStr}`);

                  let status: "live" | "upcoming" | "finished" = "upcoming";
                  if (
                    stateStr === "post" ||
                    isOverDurationOrStumps ||
                    /(won by|won the match|drawn|tied|no result|abandoned|concluded|completed)/i.test(summaryStr)
                  ) {
                    status = "finished";
                  } else if (stateStr === "in" && !isFutureUnstarted && hasActivePlaySignal) {
                    status = "live";
                  } else if (!isFutureUnstarted && elapsedMs > 45 * 60 * 1000 && !hasActivePlaySignal) {
                    continue;
                  } else {
                    status = "upcoming";
                  }

                  const eventType = String(evItem.eventType || evItem.class?.eventType || evItem.class?.generalClassCard || "ODI").toUpperCase();
                  const matchDesc = String(evItem.title || evItem.eventType || eventType).trim();
                  const venue = String(evItem.location || "").trim();
                  const homeLogo = resolveHDTeamLogo(homeName, homeComp?.logo || "");
                  const awayLogo = resolveHDTeamLogo(awayName, awayComp?.logo || "");

                  const dhakaDate = hasValidStart
                    ? new Intl.DateTimeFormat("en-CA", {
                        timeZone: "Asia/Dhaka",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      }).format(new Date(parsedStartMs))
                    : "";
                  const matchTimeStr = hasValidStart ? formatDhakaEventTime(parsedStartMs) : "Scheduled";

                  const broadcastMock = {
                    tournament: { name: leagueName },
                    season: { name: leagueName },
                    type: eventType,
                    competitors: [
                      { qualifier: "home", name: homeName, id: homeComp?.abbreviation || homeName },
                      { qualifier: "away", name: awayName, id: awayComp?.abbreviation || awayName },
                    ],
                  };
                  const bData = resolveCricketBroadcastData(broadcastMock, {
                    name: `${homeName} vs ${awayName}`,
                    series: leagueName,
                    tournament: leagueName,
                    league: leagueName,
                    broadcast: evItem.broadcast,
                    broadcasts: evItem.broadcasts,
                    geoBroadcasts: evItem.geoBroadcasts,
                    team1: { name: homeName },
                    team2: { name: awayName },
                  });

                  addEvent({
                    id: `cr-cricapi-espn_${evItem.id}`,
                    rawId: String(evItem.id),
                    matchId: String(evItem.id),
                    sport: "cricket",
                    sportName: "Cricket",
                    sportIcon: "fa-baseball-bat-ball",
                    title: `${homeName} vs ${awayName}`,
                    name: `${homeName} vs ${awayName}`,
                    seriesName: leagueName,
                    tournament: leagueName,
                    league: leagueName,
                    matchDesc,
                    matchFormat: eventType,
                    matchType: eventType,
                    startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
                    endTime: null,
                    status,
                    statusText: summaryStr,
                    statusLabel: status === "live" ? "LIVE" : status === "finished" ? "FT" : "Upcoming",
                    timestamp,
                    date: dhakaDate,
                    matchTime: matchTimeStr,
                    timeOrTimer: status === "live" ? "LIVE" : status === "finished" ? "FT" : matchTimeStr,
                    venue,
                    isHot: status === "live",
                    isSpecial: status === "live",
                    team1: {
                      teamId: homeComp?.abbreviation || homeName,
                      name: homeName,
                      shortName: homeComp?.abbreviation || "",
                      logo: homeLogo,
                      score: homeScore,
                      overs: homeOvers,
                    },
                    team2: {
                      teamId: awayComp?.abbreviation || awayName,
                      name: awayName,
                      shortName: awayComp?.abbreviation || "",
                      logo: awayLogo,
                      score: awayScore,
                      overs: awayOvers,
                    },
                    homeTeam: {
                      name: homeName,
                      logo: homeLogo,
                      score: homeScore,
                      overs: homeOvers,
                    },
                    awayTeam: {
                      name: awayName,
                      logo: awayLogo,
                      score: awayScore,
                      overs: awayOvers,
                    },
                    broadcaster: bData.broadcaster,
                    broadcasters: bData.broadcasters,
                    channelId: bData.channelId,
                    channelIds: bData.channelIds,
                    channelName: bData.channelName,
                    channelLogo: bData.channelLogo,
                    streamUrl: bData.streamUrl,
                    streams: bData.streams,
                    subText: [leagueName, matchDesc, venue].filter(Boolean).join(" • "),
                    source: "ESPN-Fallback",
                  });
                }
              }
            }
          } catch (espnCrErr: any) {
            console.warn("[CricketData] ESPN fallback error:", espnCrErr?.message);
          }
        }

        // Enrich any remaining unmapped teams with official TheSportsDB Cricket badges
        await Promise.all(
          events.slice(0, 25).map(async (ev) => {
            if (ev.team1?.name) {
              const l1 = await resolveOfficialCricketTeamLogoAsync(ev.team1.name, ev.team1.logo);
              ev.team1.logo = l1;
              if (ev.homeTeam) ev.homeTeam.logo = l1;
            }
            if (ev.team2?.name) {
              const l2 = await resolveOfficialCricketTeamLogoAsync(ev.team2.name, ev.team2.logo);
              ev.team2.logo = l2;
              if (ev.awayTeam) ev.awayTeam.logo = l2;
            }
          })
        );

        // Sort: LIVE first, then UPCOMING, then FINISHED
        events.sort((a, b) => {
          const order: Record<string, number> = { live: 0, upcoming: 1, finished: 2 };
          const orderA = order[a.status] !== undefined ? order[a.status] : 1;
          const orderB = order[b.status] !== undefined ? order[b.status] : 1;
          if (orderA !== orderB) return orderA - orderB;
          return (a.timestamp || 0) - (b.timestamp || 0);
        });

        cricketDataCache.source = activeSource;
        if (events.length > 0) {
          cricketDataCache.matches = { timestamp: Date.now(), data: events };
          return events;
        }
        if (cricketDataCache.matches?.data && cricketDataCache.matches.data.length > 0) {
          return cricketDataCache.matches.data;
        }
        return [];
      } catch (err: any) {
        console.warn("[CricketData] Matches error:", err.message);
        return cricketDataCache.matches?.data || [];
      } finally {
        inFlightPromises.cricketDataMatches = null;
      }
    })();

    return inFlightPromises.cricketDataMatches;
  }

  // Proxy: Cricket Data API (CricketData.org primary, ESPN-Fallback when blocked/rate-limited)
  app.get("/api/cricket/matches", async (_req, res) => {
    try {
      const isConfigured = Boolean(CRICKETDATA_API_KEY && CRICKETDATA_API_KEY.length > 0);
      const matches = await getNormalizedCricketDataMatches();
      if (Array.isArray(matches) && matches.length > 0 && Array.isArray(cachedEventsJson)) {
        const nonCricket = cachedEventsJson.filter((e: any) => String(e.sport || "").toLowerCase() !== "cricket");
        cachedEventsJson = [...matches, ...nonCricket];
      }
      const isBlockedNow = cricketDataCache.blockedUntil > Date.now();
      const activeSource = cricketDataCache.source || (isConfigured && !isBlockedNow ? "CricketData.org" : "ESPN-Fallback");

      return res.json({
        status: "success",
        source: activeSource,
        configured: isConfigured,
        fallback: activeSource === "ESPN-Fallback",
        blocked: isBlockedNow,
        blockedUntil: isBlockedNow ? cricketDataCache.blockedUntil : null,
        rateLimited: isBlockedNow || cricketDataCache.rateLimited,
        cacheTtl: CRICKET_CACHE_TTL_SECONDS,
        upstreamStatus: cricketDataCache.lastStatus || 200,
        message: cricketDataCache.lastError || undefined,
        total: matches.length,
        data: matches,
      });
    } catch (err: any) {
      console.warn("[Backend Proxy] CricketData error:", err.message);
      res.json({
        status: "error",
        source: "ESPN-Fallback",
        configured: Boolean(CRICKETDATA_API_KEY),
        total: 0,
        data: [],
        error: "Failed to fetch cricket matches",
      });
    }
  });

  // Dedicated Cricket Scorecard & Match Details (Cricbuzz Match Center)
  app.get("/api/cricket/scorecard", async (req, res) => {
    try {
      const matchId = String(req.query.id || req.query.matchid || "").replace(/^cr-/, "").replace(/^rapid-/, "").trim();
      if (!matchId) {
        return res.status(400).json({ status: "error", message: "Match ID required." });
      }

      const rapidKey = (typeof req.query.rapidapikey === "string" && req.query.rapidapikey.trim())
        ? req.query.rapidapikey.trim()
        : (typeof req.headers["x-rapidapi-key"] === "string" && req.headers["x-rapidapi-key"].trim()
          ? req.headers["x-rapidapi-key"].trim()
          : RAPIDAPI_KEY);

      const [mCenterRes, scardRes, leanbackRes] = await Promise.allSettled([
        fetch(`https://${RAPIDAPI_CRICKET_HOST}/mcenter/v1/${encodeURIComponent(matchId)}`, {
          headers: { "x-rapidapi-host": RAPIDAPI_CRICKET_HOST, "x-rapidapi-key": rapidKey }
        }).then(r => r.ok && r.status !== 204 ? r.json() : null),
        fetch(`https://${RAPIDAPI_CRICKET_HOST}/mcenter/v1/${encodeURIComponent(matchId)}/scard`, {
          headers: { "x-rapidapi-host": RAPIDAPI_CRICKET_HOST, "x-rapidapi-key": rapidKey }
        }).then(r => r.ok && r.status !== 204 ? r.json() : null),
        fetch(`https://${RAPIDAPI_CRICKET_HOST}/mcenter/v1/${encodeURIComponent(matchId)}/leanback`, {
          headers: { "x-rapidapi-host": RAPIDAPI_CRICKET_HOST, "x-rapidapi-key": rapidKey }
        }).then(r => r.ok && r.status !== 204 ? r.json() : null),
      ]);

      const mCenter: any = mCenterRes.status === "fulfilled" ? mCenterRes.value : null;
      const scard: any = scardRes.status === "fulfilled" ? scardRes.value : null;
      const leanback: any = leanbackRes.status === "fulfilled" ? leanbackRes.value : null;

      res.json({
        status: "success",
        data: {
          matchId,
          matchInfo: mCenter,
          scorecard: scard?.scorecard || scard,
          miniscore: leanback?.miniscore || leanback,
        }
      });
    } catch (err: any) {
      console.warn("[Backend Proxy] Cricket scorecard error:", err.message);
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Dedicated RapidAPI Cricket Key Validator
  app.get("/api/cricket/test", async (req, res) => {
    try {
      const key = (typeof req.query.key === "string" && req.query.key.trim())
        ? req.query.key.trim()
        : (typeof req.headers["x-rapidapi-key"] === "string" && req.headers["x-rapidapi-key"].trim()
          ? req.headers["x-rapidapi-key"].trim()
          : RAPIDAPI_KEY);

      const host = (typeof req.query.host === "string" && req.query.host.trim())
        ? req.query.host.trim()
        : RAPIDAPI_CRICKET_HOST;

      if (!key) {
        return res.json({ valid: false, message: "No RapidAPI key provided" });
      }

      const checkRes = await fetch(`https://${host}/matches/v1/live`, {
        headers: {
          "x-rapidapi-host": host,
          "x-rapidapi-key": key,
        },
      });

      if (checkRes.status === 200 || checkRes.status === 204) {
        return res.json({
          valid: true,
          status: "active",
          message: "RapidAPI Cricket (Cricbuzz) key is verified & operational!"
        });
      }

      if (checkRes.status === 429) {
        return res.json({ valid: false, message: "RapidAPI monthly rate limit exceeded for Cricket" });
      }

      if (checkRes.status === 403 || checkRes.status === 401) {
        return res.json({ valid: false, message: "Invalid RapidAPI key or unauthorized host access" });
      }

      res.json({ valid: false, message: `RapidAPI responded with status ${checkRes.status}` });
    } catch (e: any) {
      res.json({ valid: false, message: `Connection error: ${e.message}` });
    }
  });

  // Dedicated CricketData.org / CricAPI Channels Endpoint
  app.get("/api/cricket/cricapi/channels", (_req, res) => {
    try {
      const allChannels = getChannelsFromDisk();
      const cricketChannels = allChannels.filter((c: any) => {
        if (!c || c.active === false) return false;
        const name = (c.name || "").toLowerCase();
        const cat = (c.category || "").toLowerCase();
        const cats = Array.isArray(c.categories) ? c.categories.map((x: any) => String(x).toLowerCase()) : [];
        return (
          cat === "sports" ||
          cats.includes("sports") ||
          cats.includes("cricket") ||
          name.includes("t sports") ||
          name.includes("tsports") ||
          name.includes("gazi") ||
          name.includes("gtv") ||
          name.includes("star sports") ||
          name.includes("willow") ||
          name.includes("ptv sports") ||
          name.includes("a sports") ||
          name.includes("ten sports") ||
          name.includes("sky sports") ||
          name.includes("cricket")
        );
      });

      res.json({
        status: "success",
        total: cricketChannels.length,
        policy: "Strictly API-driven broadcast resolution. Zero placeholder, invented or assumed mappings.",
        channels: cricketChannels.map((c: any) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          logo: c.logo,
          active: c.active,
          streamUrl: c.streamUrl || c.url || c.stream_url,
          streams: c.streams || [],
        })),
      });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // Dedicated CricketData.org / CricAPI Test Endpoint
  // Verifies whether the server-side CRICKETDATA_API_KEY secret is configured without EVER returning the key.
  app.get(["/api/cricapi/test", "/api/cricket/cricapi/test"], async (_req, res) => {
    try {
      const serverKey = CRICKETDATA_API_KEY;
      const isConfigured = Boolean(serverKey && serverKey.length > 0);

      if (!isConfigured) {
        return res.status(400).json({
          configured: false,
          valid: false,
          status: "missing_key",
          source: "CricketData.org",
          secretName: "CRICKETDATA_API_KEY",
          message: "CRICKETDATA_API_KEY is not configured in server environment/secrets.",
        });
      }

      const startTime = Date.now();
      const testRes = await fetchCricketDataApi("currentMatches", serverKey, 0);
      const elapsed = Date.now() - startTime;

      if (testRes.ok && testRes.data) {
        const matches = Array.isArray(testRes.data.data) ? testRes.data.data : [];
        return res.json({
          configured: true,
          valid: true,
          status: "success",
          source: "CricketData.org",
          secretName: "CRICKETDATA_API_KEY",
          message: `CRICKETDATA_API_KEY server secret is configured and VALID! (${matches.length} current matches found)`,
          latencyMs: elapsed,
          matchesCount: matches.length,
          info: testRes.data.info || {},
          sampleMatches: matches.slice(0, 5).map((m: any) => ({
            id: m.id,
            name: m.name,
            status: m.status,
            matchType: m.matchType,
          })),
        });
      }

      if (testRes.status === 429) {
        return res.status(429).json({
          configured: true,
          valid: false,
          status: "rate_limited",
          source: "CricketData.org",
          secretName: "CRICKETDATA_API_KEY",
          statusCode: 429,
          rateLimited: true,
          total: 0,
          data: [],
          message: "CRICKETDATA_API_KEY is configured, but CricketData.org rate limit was reached (Hits limit exceeded).",
          error: redactCricketSecret(testRes.error || "", serverKey),
        });
      }

      return res.status(testRes.status || 500).json({
        configured: true,
        valid: false,
        status: "error",
        source: "CricketData.org",
        secretName: "CRICKETDATA_API_KEY",
        statusCode: testRes.status,
        message: redactCricketSecret(testRes.error || `CricketData.org API error with HTTP status ${testRes.status}`, serverKey),
      });
    } catch (err: any) {
      return res.status(500).json({
        configured: Boolean(CRICKETDATA_API_KEY),
        valid: false,
        status: "error",
        source: "CricketData.org",
        secretName: "CRICKETDATA_API_KEY",
        message: redactCricketSecret(err.message, CRICKETDATA_API_KEY),
      });
    }
  });

  // Dedicated CricketData.org Matches Endpoint
  app.get("/api/cricket/cricapi/matches", async (_req, res) => {
    try {
      const matches = await getNormalizedCricketDataMatches(CRICKETDATA_API_KEY);
      const isBlockedNow = cricketDataCache.blockedUntil > Date.now();
      const activeSource = cricketDataCache.source || (CRICKETDATA_API_KEY && !isBlockedNow ? "CricketData.org" : "ESPN-Fallback");
      res.json({
        status: "success",
        source: activeSource,
        configured: Boolean(CRICKETDATA_API_KEY),
        fallback: activeSource === "ESPN-Fallback",
        blocked: isBlockedNow,
        blockedUntil: isBlockedNow ? cricketDataCache.blockedUntil : null,
        rateLimited: isBlockedNow || cricketDataCache.rateLimited,
        cacheTtl: CRICKET_CACHE_TTL_SECONDS,
        upstreamStatus: cricketDataCache.lastStatus || 200,
        message: cricketDataCache.lastError || undefined,
        total: matches.length,
        data: matches,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: redactCricketSecret(err.message, CRICKETDATA_API_KEY) });
    }
  });

  // Dedicated CricketData.org Current Matches & CricScore Endpoints
  app.get(["/api/cricket/cricapi/current", "/api/cricket/cricapi/cricScore"], async (_req, res) => {
    try {
      const matches = await getNormalizedCricketDataMatches(CRICKETDATA_API_KEY);
      const isBlockedNow = cricketDataCache.blockedUntil > Date.now();
      const activeSource = cricketDataCache.source || (CRICKETDATA_API_KEY && !isBlockedNow ? "CricketData.org" : "ESPN-Fallback");
      res.json({
        status: "success",
        source: activeSource,
        configured: Boolean(CRICKETDATA_API_KEY),
        fallback: activeSource === "ESPN-Fallback",
        blocked: isBlockedNow,
        blockedUntil: isBlockedNow ? cricketDataCache.blockedUntil : null,
        rateLimited: isBlockedNow || cricketDataCache.rateLimited,
        cacheTtl: CRICKET_CACHE_TTL_SECONDS,
        total: matches.length,
        data: matches,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: redactCricketSecret(err.message, CRICKETDATA_API_KEY) });
    }
  });

  // Endpoint: RapidAPI Cricket Schedule
  app.get("/api/cricket/schedule", async (req, res) => {
    try {
      const rapidKey = (typeof req.query.rapidapikey === "string" && req.query.rapidapikey.trim())
        ? req.query.rapidapikey.trim()
        : (typeof req.headers["x-rapidapi-key"] === "string" && req.headers["x-rapidapi-key"].trim()
          ? req.headers["x-rapidapi-key"].trim()
          : RAPIDAPI_KEY);
      const sched = await fetchRapidSchedule(rapidKey);
      res.json(sched || { status: "empty", response: { schedules: [] } });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch cricket schedule", message: err.message });
    }
  });

  // Endpoint: RapidAPI Cricket Teams
  app.get("/api/cricket/teams", async (req, res) => {
    try {
      const rapidKey = (typeof req.query.rapidapikey === "string" && req.query.rapidapikey.trim())
        ? req.query.rapidapikey.trim()
        : (typeof req.headers["x-rapidapi-key"] === "string" && req.headers["x-rapidapi-key"].trim()
          ? req.headers["x-rapidapi-key"].trim()
          : RAPIDAPI_KEY);
      const teams = await fetchRapidTeams(rapidKey);
      res.json({ status: "success", response: teams });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch cricket teams", message: err.message });
    }
  });

  // Endpoint: RapidAPI Cricket Players by Team ID (e.g., 2=India, 6=Bangladesh, 3=Pakistan, etc.)
  app.get("/api/cricket/players", async (req, res) => {
    try {
      const teamId = String(req.query.teamid || "2").trim();
      const rapidKey = (typeof req.query.rapidapikey === "string" && req.query.rapidapikey.trim())
        ? req.query.rapidapikey.trim()
        : (typeof req.headers["x-rapidapi-key"] === "string" && req.headers["x-rapidapi-key"].trim()
          ? req.headers["x-rapidapi-key"].trim()
          : RAPIDAPI_KEY);

      const now = Date.now();
      const cached = rapidCache.players.get(teamId);
      if (cached && (now - cached.timestamp < rapidCache.TTL_STATIC)) {
        return res.json(cached.data);
      }

      const response = await fetch(`https://${RAPIDAPI_CRICKET_HOST}/teams/v1/${encodeURIComponent(teamId)}/players`, {
        headers: {
          "x-rapidapi-host": RAPIDAPI_CRICKET_HOST,
          "x-rapidapi-key": rapidKey,
        },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch players", status: response.status });
      }

      const data = await response.json();
      rapidCache.players.set(teamId, { timestamp: now, data });
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch players", message: err.message });
    }
  });

  // Helper: Normalize Sport Name from TheSportsDB
  function normalizeSportsDbSport(strSport: string = ""): { sport: string; sportName: string; sportIcon: string } {
    const s = strSport.toLowerCase();
    if (s.includes("rugby")) {
      return { sport: "rugby", sportName: "Rugby", sportIcon: "fa-football" };
    }
    if (s.includes("baseball") || s.includes("mlb")) {
      return { sport: "baseball", sportName: "Baseball", sportIcon: "fa-baseball" };
    }
    if (s.includes("soccer") || (s.includes("football") && !s.includes("american"))) {
      return { sport: "football", sportName: "Football", sportIcon: "fa-futbol" };
    }
    if (s.includes("cricket")) {
      return { sport: "cricket", sportName: "Cricket", sportIcon: "fa-baseball-bat-ball" };
    }
    if (s.includes("basketball") || s.includes("nba") || s.includes("wnba")) {
      return { sport: "basketball", sportName: "Basketball", sportIcon: "fa-basketball" };
    }
    if (s.includes("motorsport") || s.includes("racing") || s.includes("formula")) {
      return { sport: "motorsport", sportName: "Motorsport", sportIcon: "fa-car-side" };
    }
    if (s.includes("tennis")) {
      return { sport: "tennis", sportName: "Tennis", sportIcon: "fa-table-tennis-paddle-ball" };
    }
    if (s.includes("volleyball") || s.includes("volley")) {
      return { sport: "volleyball", sportName: "Volleyball", sportIcon: "fa-volleyball" };
    }
    if (s.includes("ice hockey") || s.includes("hockey")) {
      return { sport: "hockey", sportName: "Ice Hockey", sportIcon: "fa-hockey-puck" };
    }
    if (s.includes("wwe") || s.includes("wrestling")) {
      return { sport: "wwe", sportName: "WWE", sportIcon: "fa-hand-fist" };
    }
    if (s.includes("fighting") || s.includes("mma") || s.includes("ufc") || s.includes("boxing")) {
      return { sport: "combat", sportName: "Combat Sports", sportIcon: "fa-hand-back-fist" };
    }
    return { sport: "football", sportName: strSport || "Sports", sportIcon: "fa-trophy" };
  }

  // Helper: Normalize a single TheSportsDB event
  function normalizeSportsDbEvent(raw: any): any {
    if (!raw || !raw.idEvent) return null;
    const { sport, sportName, sportIcon } = normalizeSportsDbSport(raw.strSport);

    // Strictly enforce: Cricket is ONLY from CricketData.org / CricAPI
    if (sport === "cricket" || (raw.strSport && raw.strSport.toLowerCase() === "cricket")) {
      return null;
    }

    const rawTimeClean = String(raw.strTime || "").split("+")[0].split("Z")[0].trim();
    const hasUnknownZeroTime = !rawTimeClean || rawTimeClean === "00:00:00" || rawTimeClean === "00:00";

    let parsedStartMs = NaN;
    if (raw.strTimestamp) {
      let tsStr = String(raw.strTimestamp).trim();
      const tsHasZeroTime = /T00:00(:00)?(\.0+)?(Z|[+-]\d{2}:?\d{2})?$/i.test(tsStr.replace(" ", "T"));
      if (!(tsHasZeroTime && hasUnknownZeroTime)) {
        if (!tsStr.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(tsStr)) {
          tsStr = tsStr.replace(" ", "T") + "Z";
        }
        const parsed = Date.parse(tsStr);
        if (!isNaN(parsed) && parsed > 0) parsedStartMs = parsed;
      }
    }
    if (isNaN(parsedStartMs) && raw.dateEvent && !hasUnknownZeroTime) {
      const parsed = Date.parse(`${String(raw.dateEvent).trim()}T${rawTimeClean}Z`);
      if (!isNaN(parsed) && parsed > 0) parsedStartMs = parsed;
    }

    const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
    const timestamp: number | null = hasValidStart ? parsedStartMs : null;

    const rawEndStr = raw.strEndTimestamp || raw.end_time || raw.endTime || raw.scheduled_end || null;
    const parsedEndMs = rawEndStr ? Date.parse(String(rawEndStr)) : NaN;
    const authoritativeEndTimeMs: number | null =
      !isNaN(parsedEndMs) && parsedEndMs > 0 && (!hasValidStart || parsedEndMs > parsedStartMs)
        ? parsedEndMs
        : null;

    const now = Date.now();
    const sportLower = (sport || "").toLowerCase();
    // Normal match window (Football 2.5h; Tennis/Baseball 4h; other sports 3h)
    const formatDurationMs = sportLower.includes("tennis") || sportLower.includes("base")
      ? 4 * 3600 * 1000
      : sportLower.includes("basket") || sportLower.includes("volley") || sportLower.includes("rugby") || sportLower.includes("hockey") || sportLower.includes("combat") || sportLower.includes("wwe")
      ? 3 * 3600 * 1000
      : 2.5 * 3600 * 1000;
    // Stale-LIVE safety ceiling
    const maxLiveSafeguardMs = sportLower.includes("tennis") || sportLower.includes("base")
      ? 4 * 3600 * 1000
      : sportLower.includes("basket") || sportLower.includes("volley") || sportLower.includes("rugby") || sportLower.includes("hockey") || sportLower.includes("combat") || sportLower.includes("wwe")
      ? 3 * 3600 * 1000
      : 2.5 * 3600 * 1000;

    const safeLiveWindowEndMs: number | null =
      authoritativeEndTimeMs !== null
        ? authoritativeEndTimeMs
        : hasValidStart
        ? parsedStartMs + formatDurationMs
        : null;
    const staleSafeguardEndMs: number | null =
      authoritativeEndTimeMs !== null
        ? authoritativeEndTimeMs
        : hasValidStart
        ? parsedStartMs + maxLiveSafeguardMs
        : null;

    let status = "upcoming";
    let statusText = "Scheduled";
    let statusLabel = "Upcoming";

    const hasScores = (raw.intHomeScore !== null && raw.intHomeScore !== undefined && raw.intHomeScore !== "") ||
                      (raw.intAwayScore !== null && raw.intAwayScore !== undefined && raw.intAwayScore !== "");
    const rawStLower = String(raw.strStatus || "").toLowerCase().trim();

    const isExplicitNonLive =
      rawStLower === "ns" ||
      rawStLower === "not started" ||
      rawStLower === "not_started" ||
      rawStLower === "postponed" ||
      rawStLower === "pst" ||
      rawStLower === "delayed" ||
      rawStLower === "cancelled" ||
      rawStLower === "canceled" ||
      rawStLower === "canc" ||
      rawStLower === "tbd" ||
      rawStLower === "scheduled" ||
      rawStLower === "time to be defined" ||
      String(raw.strPostponed || "").toLowerCase().trim() === "yes";

    const isExplicitFinished =
      !isExplicitNonLive &&
      (rawStLower === "match finished" ||
        rawStLower === "ft" ||
        rawStLower === "aet" ||
        rawStLower === "pen" ||
        rawStLower === "ended" ||
        rawStLower === "finished" ||
        rawStLower === "final" ||
        rawStLower === "abandoned" ||
        rawStLower.includes("finished") ||
        rawStLower.includes("ended"));

    const isExplicitLive =
      !isExplicitFinished &&
      !isExplicitNonLive &&
      (rawStLower === "live" ||
        rawStLower === "in play" ||
        rawStLower === "in progress" ||
        rawStLower === "in_progress" ||
        rawStLower === "1h" ||
        rawStLower === "2h" ||
        rawStLower === "ht" ||
        rawStLower === "et" ||
        rawStLower === "bt" ||
        rawStLower === "pt" ||
        rawStLower === "int" ||
        rawStLower === "q1" ||
        rawStLower === "q2" ||
        rawStLower === "q3" ||
        rawStLower === "q4" ||
        rawStLower === "ot" ||
        rawStLower.includes("in progress") ||
        rawStLower.includes("half") ||
        rawStLower.includes("quarter") ||
        rawStLower.includes("inning") ||
        rawStLower.includes("set ") ||
        /^\d+\s*'$/.test(rawStLower));

    if (isExplicitFinished) {
      status = "finished";
      statusText = "Full Time";
      statusLabel = "FT";
    } else if (authoritativeEndTimeMs !== null && now > authoritativeEndTimeMs) {
      status = "finished";
      statusText = "Full Time";
      statusLabel = "FT";
    } else if (staleSafeguardEndMs !== null && now > staleSafeguardEndMs && !isExplicitNonLive) {
      status = "finished";
      statusText = "Full Time";
      statusLabel = "FT";
    } else if (isExplicitNonLive) {
      status = "upcoming";
      statusText = raw.strStatus && rawStLower !== "ns" ? String(raw.strStatus).trim() : "Scheduled";
      statusLabel = "Upcoming";
    } else if (
      isExplicitLive &&
      (!hasValidStart ||
        (now >= parsedStartMs - 15 * 60 * 1000 &&
          (staleSafeguardEndMs === null || now <= staleSafeguardEndMs)))
    ) {
      status = "live";
      statusText = "LIVE NOW";
      statusLabel = "LIVE";
    } else if (
      hasValidStart &&
      safeLiveWindowEndMs !== null &&
      now >= parsedStartMs &&
      now <= safeLiveWindowEndMs
    ) {
      status = "live";
      statusText = "LIVE NOW";
      statusLabel = "LIVE";
    } else if (
      (hasValidStart && safeLiveWindowEndMs !== null && now > safeLiveWindowEndMs) ||
      (hasScores && (!hasValidStart || now > parsedStartMs))
    ) {
      status = "finished";
      statusText = "Full Time";
      statusLabel = "FT";
    }

    const homeScore = raw.intHomeScore !== null && raw.intHomeScore !== undefined ? String(raw.intHomeScore) : "";
    const awayScore = raw.intAwayScore !== null && raw.intAwayScore !== undefined ? String(raw.intAwayScore) : "";

    const matchTimeStr = hasValidStart ? formatDhakaEventTime(parsedStartMs) : "Scheduled";
    const resolvedDateStr = hasValidStart
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(parsedStartMs))
      : (raw.dateEvent ? String(raw.dateEvent).trim() : "");

    let homeName = (raw.strHomeTeam || "").trim();
    let awayName = (raw.strAwayTeam || "").trim();
    const rawTitle = (raw.strEvent || "").trim();

    if ((!homeName || homeName.toLowerCase() === "home team") && rawTitle.includes(" vs ")) {
      const parts = rawTitle.split(" vs ");
      homeName = parts[0].trim();
      awayName = parts[1].trim();
    } else if ((!homeName || homeName.toLowerCase() === "home team") && rawTitle.includes(" v ")) {
      const parts = rawTitle.split(" v ");
      homeName = parts[0].trim();
      awayName = parts[1].trim();
    }

    if (!homeName || homeName.toLowerCase() === "home team" || !awayName || awayName.toLowerCase() === "away team") {
      if (!rawTitle || rawTitle.toLowerCase().includes("home team")) {
        return null;
      }
      homeName = rawTitle;
      awayName = raw.strLeague || "Match";
    }

    const homeLogo = raw.strHomeTeamBadge || raw.strThumb || "";
    const awayLogo = raw.strAwayTeamBadge || "";
    const title = rawTitle || `${homeName} vs ${awayName}`;
    const league = raw.strLeague || "Top League";

    const isHot = status === "live" ||
                  league.toLowerCase().includes("premier league") ||
                  league.toLowerCase().includes("champions league") ||
                  league.toLowerCase().includes("la liga") ||
                  league.toLowerCase().includes("serie a") ||
                  league.toLowerCase().includes("bundesliga");

    return {
      id: `tsdb-${raw.idEvent}`,
      idEvent: raw.idEvent,
      sport: sport,
      sportName: sportName,
      sportIcon: sportIcon,
      title: title,
      name: title,
      league: league,
      tournament: league,
      leagueBadge: raw.strLeagueBadge || "",
      matchDesc: raw.strRound ? `Round ${raw.strRound}` : (raw.strDescriptionEN || ""),
      status: status,
      statusText: statusText,
      statusLabel: statusLabel,
      startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
      endTime: safeLiveWindowEndMs !== null ? new Date(safeLiveWindowEndMs).toISOString() : null,
      authoritativeEndTime: authoritativeEndTimeMs !== null ? new Date(authoritativeEndTimeMs).toISOString() : null,
      timestamp: timestamp,
      date: resolvedDateStr,
      matchTime: matchTimeStr,
      timeOrTimer: status === "live" ? "LIVE" : (status === "finished" ? (homeScore && awayScore ? `${homeScore} - ${awayScore}` : "FT") : matchTimeStr),
      venue: `${raw.strVenue || ""}${raw.strCountry ? `, ${raw.strCountry}` : ""}`,
      isHot: isHot,
      videoUrl: raw.strVideo || null,
      team1: {
        id: raw.idHomeTeam,
        name: homeName,
        logo: homeLogo,
        score: homeScore,
      },
      team2: {
        id: raw.idAwayTeam,
        name: awayName,
        logo: awayLogo,
        score: awayScore,
      },
      homeTeam: {
        id: raw.idHomeTeam,
        name: homeName,
        logo: homeLogo,
        score: homeScore,
      },
      awayTeam: {
        id: raw.idAwayTeam,
        name: awayName,
        logo: awayLogo,
        score: awayScore,
      },
      broadcaster: (raw.strTVStation || raw.strBroadcaster || raw.strBroadcast || raw.strChannel || "").trim(),
      broadcasters: (raw.strTVStation || raw.strBroadcaster || raw.strBroadcast || raw.strChannel || "") ? [(raw.strTVStation || raw.strBroadcaster || raw.strBroadcast || raw.strChannel || "").trim()] : [],
      strTVStation: (raw.strTVStation || "").trim(),
      subText: `${league} • ${matchTimeStr}`,
      source: "TheSportsDB (Free)",
      streams: [],
    };
  }

  // Helper: Fetch all curated live/scheduled events from ESPN official public API
  let espnCache: { timestamp: number; data: any[] } = { timestamp: 0, data: [] };
  const ESPN_CACHE_TTL = 3 * 60 * 1000;

  async function fetchEspnAllEvents(): Promise<any[]> {
    const now = Date.now();
    if (espnCache.data.length > 0 && now - espnCache.timestamp < ESPN_CACHE_TTL) {
      return espnCache.data;
    }

    const events: any[] = [];
    const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, "");

    const resolveEspnStatus = (
      statusObj: any,
      hasValidStart: boolean,
      parsedStartMs: number,
      authoritativeEndTimeMs: number | null,
      fallbackDurationMs: number,
      maxLiveSafeguardMs: number,
      nowMs: number
    ): { status: string; statusLabel: string; statusText: string } => {
      const rawState = String(statusObj?.state || "").toLowerCase().trim();
      const rawName = String(statusObj?.name || "").toUpperCase().trim();
      const rawDetail = String(statusObj?.detail || statusObj?.shortDetail || "").trim();

      const isExplicitNonLive =
        rawState === "pre" ||
        rawName.includes("POSTPONED") ||
        rawName.includes("CANCELED") ||
        rawName.includes("CANCELLED") ||
        rawName.includes("DELAYED") ||
        rawName.includes("SCHEDULED") ||
        rawName.includes("SUSPENDED") ||
        rawName.includes("TBD");

      const isExplicitFinished =
        !rawName.includes("POSTPONED") &&
        !rawName.includes("CANCELED") &&
        !rawName.includes("CANCELLED") &&
        !rawName.includes("DELAYED") &&
        (statusObj?.completed === true ||
          rawState === "post" ||
          rawName === "STATUS_FINAL" ||
          rawName.includes("FINAL") ||
          rawName.includes("FULL_TIME") ||
          rawName.includes("ENDED"));

      const isExplicitLive =
        !isExplicitFinished &&
        !isExplicitNonLive &&
        (rawState === "in" ||
          rawName.includes("IN_PROGRESS") ||
          rawName.includes("LIVE") ||
          rawName.includes("HALFTIME") ||
          rawName.includes("OVERTIME"));

      const staleSafeguardEndMs =
        authoritativeEndTimeMs !== null
          ? authoritativeEndTimeMs
          : hasValidStart
          ? parsedStartMs + maxLiveSafeguardMs
          : null;
      const safeLiveWindowEndMs =
        authoritativeEndTimeMs !== null
          ? authoritativeEndTimeMs
          : hasValidStart
          ? parsedStartMs + fallbackDurationMs
          : null;

      if (isExplicitFinished) {
        return { status: "finished", statusLabel: "FT", statusText: rawDetail || "Final" };
      }
      if (authoritativeEndTimeMs !== null && nowMs > authoritativeEndTimeMs) {
        return { status: "finished", statusLabel: "FT", statusText: rawDetail || "Final" };
      }
      if (isExplicitNonLive) {
        return { status: "upcoming", statusLabel: "Upcoming", statusText: rawDetail || "Scheduled" };
      }
      if (isExplicitLive) {
        if (staleSafeguardEndMs !== null && nowMs > staleSafeguardEndMs) {
          return { status: "finished", statusLabel: "FT", statusText: rawDetail || "Final" };
        }
        return { status: "live", statusLabel: "LIVE", statusText: rawDetail || "LIVE" };
      }
      if (hasValidStart && safeLiveWindowEndMs !== null && nowMs >= parsedStartMs && nowMs <= safeLiveWindowEndMs) {
        return { status: "live", statusLabel: "LIVE", statusText: rawDetail || "LIVE" };
      }
      if (hasValidStart && safeLiveWindowEndMs !== null && nowMs > safeLiveWindowEndMs) {
        return { status: "finished", statusLabel: "FT", statusText: rawDetail || "Final" };
      }
      return { status: "upcoming", statusLabel: "Upcoming", statusText: rawDetail || "Scheduled" };
    };

    const normalizeEspnEvent = (ev: any, sport: string, sportName: string, sportIcon: string, defaultLeague: string) => {
      try {
        const comp = ev.competitions?.[0];
        const competitors = comp?.competitors || [];
        const home = competitors.find((c: any) => c.homeAway === "home") || competitors[0];
        const away = competitors.find((c: any) => c.homeAway === "away") || competitors[1];

        const t1Name = (home?.team?.displayName || home?.athlete?.displayName || home?.team?.name || "").trim();
        const t2Name = (away?.team?.displayName || away?.athlete?.displayName || away?.team?.name || "").trim();

        const isPlaceholder = (s: string) => {
          if (!s) return true;
          const lower = s.toLowerCase().trim();
          return lower === "team 1" || lower === "team 2" || lower === "player 1" || lower === "player 2" ||
                 lower === "home team" || lower === "away team" || lower === "tbd" || lower === "tba" || lower === "unknown";
        };
        if (isPlaceholder(t1Name) || isPlaceholder(t2Name)) {
          return null;
        }

        const t1Logo = home?.team?.logo || home?.athlete?.flag?.href || "./assets/team-placeholder.svg";
        const t2Logo = away?.team?.logo || away?.athlete?.flag?.href || "./assets/team-placeholder.svg";

        const t1Score = home?.score !== undefined ? String(home.score) : "";
        const t2Score = away?.score !== undefined ? String(away.score) : "";

        const rawStartStr = comp?.date || comp?.startDate || ev.date || null;
        const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr)) : NaN;
        const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
        const timestamp: number | null = hasValidStart ? parsedStartMs : null;

        const rawEndStr = comp?.endDate || comp?.end_time || ev.endDate || ev.end_time || null;
        const parsedEndMs = rawEndStr ? Date.parse(String(rawEndStr)) : NaN;
        const authoritativeEndTimeMs: number | null =
          !isNaN(parsedEndMs) && parsedEndMs > 0 && (!hasValidStart || parsedEndMs > parsedStartMs)
            ? parsedEndMs
            : null;

        const fallbackDurationMs =
          sport === "tennis" || sport === "baseball"
            ? 4 * 3600 * 1000
            : 3 * 3600 * 1000;
        const maxLiveSafeguardMs =
          sport === "tennis" || sport === "baseball"
            ? 4 * 3600 * 1000
            : 3 * 3600 * 1000;

        const statusObj = comp?.status?.type || ev.status?.type || {};
        const { status, statusLabel, statusText } = resolveEspnStatus(
          statusObj,
          hasValidStart,
          parsedStartMs,
          authoritativeEndTimeMs,
          fallbackDurationMs,
          maxLiveSafeguardMs,
          now
        );

        const dateStr = hasValidStart
          ? new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Dhaka",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(parsedStartMs))
          : rawStartStr && String(rawStartStr).includes("T")
          ? String(rawStartStr).split("T")[0]
          : "";

        const broadcasts = (comp?.broadcasts?.[0]?.names || []).concat(comp?.geoBroadcasts?.map((b: any) => b.media?.shortName).filter(Boolean) || []);
        const broadcaster = broadcasts.length > 0 ? broadcasts[0] : "";
        const league = defaultLeague || comp?.league?.name || sportName;
        const venueName = comp?.venue?.fullName
          ? [comp.venue.fullName, comp.venue.address?.city].filter(Boolean).join(", ")
          : String(ev.location || "").trim();
        const matchDesc = String(comp?.notes?.[0]?.headline || ev.altGameNote || ev.group?.name || "").trim();
        const matchTimeStr = hasValidStart
          ? new Date(parsedStartMs).toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: true })
          : "Scheduled";

        return {
          id: `espn-${ev.id}`,
          idEvent: ev.id,
          sport,
          sportName,
          sportIcon,
          title: t1Name && t2Name ? `${t1Name} vs ${t2Name}` : ev.name,
          name: ev.name,
          league,
          tournament: league,
          matchDesc,
          venue: venueName,
          status,
          statusText,
          statusLabel,
          timestamp,
          startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
          endTime: authoritativeEndTimeMs !== null
            ? new Date(authoritativeEndTimeMs).toISOString()
            : hasValidStart
            ? new Date(parsedStartMs + fallbackDurationMs).toISOString()
            : null,
          authoritativeEndTime: authoritativeEndTimeMs !== null ? new Date(authoritativeEndTimeMs).toISOString() : null,
          date: dateStr,
          matchTime: matchTimeStr,
          timeOrTimer: status === "live" ? "LIVE" : (status === "finished" ? (t1Score && t2Score ? `${t1Score} - ${t2Score}` : "FT") : "Scheduled"),
          team1: { id: home?.id || null, name: t1Name, logo: t1Logo, score: t1Score },
          team2: { id: away?.id || null, name: t2Name, logo: t2Logo, score: t2Score },
          homeTeam: { id: home?.id || null, name: t1Name, logo: t1Logo, score: t1Score },
          awayTeam: { id: away?.id || null, name: t2Name, logo: t2Logo, score: t2Score },
          score: t1Score && t2Score ? `${t1Score} - ${t2Score}` : "",
          broadcaster,
          broadcasters: broadcasts,
          strTVStation: broadcaster,
          source: "ESPN (Official API)",
          streams: []
        };
      } catch {
        return null;
      }
    };

    // Build 3-day date window in YYYYMMDD (Today, Tomorrow, Day 3, plus Day-1/UTC offset)
    const espn3DayDates: string[] = [];
    for (let dOffset = -1; dOffset <= 3; dOffset++) {
      const dt = new Date(Date.now() + dOffset * 24 * 3600 * 1000);
      const dStr = dt.toISOString().split("T")[0].replace(/-/g, "");
      if (!espn3DayDates.includes(dStr)) espn3DayDates.push(dStr);
    }
    const seenEspnIds = new Set<string>();
    const pushEspnEvent = (norm: any) => {
      if (!norm || !norm.id || seenEspnIds.has(norm.id)) return;
      if (norm.timestamp && now - norm.timestamp > 24 * 3600 * 1000) return;
      seenEspnIds.add(norm.id);
      events.push(norm);
    };

    // 0. Football (Soccer - 3-Day Schedule across UEFA, Top Leagues & International)
    try {
      for (const dStr of espn3DayDates) {
        const resS = await fetch(`https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=soccer&dates=${dStr}`).catch(() => null);
        if (resS && resS.ok) {
          const jsonS: any = await resS.json();
          const leagues = jsonS?.sports?.[0]?.leagues || [];
          for (const lg of leagues) {
            const leagueName = String(lg?.name || "Football").trim();
            for (const evItem of (lg?.events || []).slice(0, 12)) {
              const comps = Array.isArray(evItem?.competitors) ? evItem.competitors : [];
              const home = comps.find((c: any) => c.homeAway === "home") || comps[0];
              const away = comps.find((c: any) => c.homeAway === "away") || comps[1];
              const t1Name = String(home?.displayName || home?.name || "").trim();
              const t2Name = String(away?.displayName || away?.name || "").trim();
              if (!t1Name || !t2Name) continue;
              const rawStartStr = evItem.date || null;
              const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr)) : NaN;
              const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
              const statusObj = evItem.fullStatus?.type || {};
              const { status, statusLabel, statusText } = resolveEspnStatus(
                statusObj,
                hasValidStart,
                parsedStartMs,
                null,
                150 * 60 * 1000,
                150 * 60 * 1000,
                now
              );
              const dateStr = hasValidStart
                ? new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Dhaka",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(new Date(parsedStartMs))
                : "";
              const matchTimeStr = hasValidStart
                ? new Date(parsedStartMs).toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: true })
                : "Scheduled";
              const t1Score = home?.score !== undefined ? String(home.score) : "";
              const t2Score = away?.score !== undefined ? String(away.score) : "";
              pushEspnEvent({
                id: `espn-soccer-${evItem.id}`,
                idEvent: evItem.id,
                sport: "football",
                sportName: "Football",
                sportIcon: "fa-futbol",
                title: `${t1Name} vs ${t2Name}`,
                name: `${t1Name} vs ${t2Name}`,
                league: leagueName,
                tournament: leagueName,
                matchDesc: String(evItem.altGameNote || evItem.group?.name || "").trim(),
                venue: String(evItem.location || "").trim(),
                status,
                statusText,
                statusLabel,
                timestamp: hasValidStart ? parsedStartMs : null,
                startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
                endTime: hasValidStart ? new Date(parsedStartMs + 150 * 60 * 1000).toISOString() : null,
                date: dateStr,
                matchTime: matchTimeStr,
                timeOrTimer: status === "live" ? "LIVE" : status === "finished" ? (t1Score && t2Score ? `${t1Score} - ${t2Score}` : "FT") : "Scheduled",
                team1: { id: home?.id || null, name: t1Name, logo: home?.logo || "./assets/team-placeholder.svg", score: t1Score },
                team2: { id: away?.id || null, name: t2Name, logo: away?.logo || "./assets/team-placeholder.svg", score: t2Score },
                homeTeam: { id: home?.id || null, name: t1Name, logo: home?.logo || "./assets/team-placeholder.svg", score: t1Score },
                awayTeam: { id: away?.id || null, name: t2Name, logo: away?.logo || "./assets/team-placeholder.svg", score: t2Score },
                score: t1Score && t2Score ? `${t1Score} - ${t2Score}` : "",
                broadcaster: "",
                broadcasters: [],
                strTVStation: "",
                source: "ESPN (Official API)",
                streams: [],
              });
            }
          }
        }
      }
    } catch {}

    // 1. Baseball (MLB - 3-Day Schedule)
    try {
      for (const dStr of espn3DayDates) {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dStr}`).catch(() => null);
        if (res && res.ok) {
          const json: any = await res.json();
          for (const ev of (json.events || [])) {
            const norm = normalizeEspnEvent(ev, "baseball", "Baseball", "fa-baseball", "MLB");
            if (norm) pushEspnEvent(norm);
          }
        }
      }
    } catch {}

    // 2. Basketball (WNBA & NBA - 3-Day Schedule)
    try {
      for (const dStr of espn3DayDates) {
        const resW = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${dStr}`).catch(() => null);
        if (resW && resW.ok) {
          const jsonW: any = await resW.json();
          for (const ev of (jsonW.events || [])) {
            const norm = normalizeEspnEvent(ev, "basketball", "Basketball", "fa-basketball", "WNBA");
            if (norm) pushEspnEvent(norm);
          }
        }
        const resN = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dStr}`).catch(() => null);
        if (resN && resN.ok) {
          const jsonN: any = await resN.json();
          for (const ev of (jsonN.events || [])) {
            const norm = normalizeEspnEvent(ev, "basketball", "Basketball", "fa-basketball", "NBA");
            if (norm) pushEspnEvent(norm);
          }
        }
      }
    } catch {}

    // 3. Rugby (3-Day Schedule)
    try {
      const rugbyEndpoints = [
        { url: "https://site.api.espn.com/apis/site/v2/sports/rugby/289234/scoreboard", league: "The Rugby Championship" },
        { url: "https://site.api.espn.com/apis/site/v2/sports/rugby/270559/scoreboard", league: "Top 14 Rugby" },
        { url: "https://site.api.espn.com/apis/site/v2/sports/rugby/270557/scoreboard", league: "United Rugby Championship" },
        { url: "https://site.api.espn.com/apis/site/v2/sports/rugby/269/scoreboard", league: "Premiership Rugby" }
      ];
      for (const rEp of rugbyEndpoints) {
        for (const dStr of espn3DayDates) {
          const resR = await fetch(`${rEp.url}?dates=${dStr}`).catch(() => null);
          if (resR && resR.ok) {
            const jsonR: any = await resR.json();
            for (const ev of (jsonR.events || [])) {
              const norm = normalizeEspnEvent(ev, "rugby", "Rugby", "fa-football", rEp.league);
              if (norm) pushEspnEvent(norm);
            }
          }
        }
      }
    } catch {}

    // 4. Tennis
    try {
      const tennisEndpoints = [
        { url: "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard", defaultTourn: "ATP Tour" },
        { url: "https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard", defaultTourn: "WTA Tour" }
      ];
      for (const tEp of tennisEndpoints) {
        const resT = await fetch(tEp.url).catch(() => null);
        if (resT && resT.ok) {
          const jsonT: any = await resT.json();
          for (const ev of (jsonT.events || [])) {
            const tournamentName = ev.name || tEp.defaultTourn;
            for (const grp of (ev.groupings || [])) {
              for (const comp of (grp.competitions || [])) {
                const competitors = comp.competitors || [];
                const p1 = competitors[0];
                const p2 = competitors[1];
                const p1Name = (p1?.athlete?.displayName || p1?.team?.displayName || "").trim();
                const p2Name = (p2?.athlete?.displayName || p2?.team?.displayName || "").trim();
                
                const isTennisPlaceholder = (name: string) => {
                  if (!name) return true;
                  const lower = name.toLowerCase().trim();
                  return lower === "player 1" || lower === "player 2" || lower === "tbd" || lower === "tba" || lower === "unknown";
                };

                if (isTennisPlaceholder(p1Name) || isTennisPlaceholder(p2Name)) {
                  continue;
                }
                const p1Logo = p1?.athlete?.flag?.href || p1?.athlete?.headshot?.href || "./assets/team-placeholder.svg";
                const p2Logo = p2?.athlete?.flag?.href || p2?.athlete?.headshot?.href || "./assets/team-placeholder.svg";

                const rawStartStr = comp.date || comp.startDate || ev.date || null;
                const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr)) : NaN;
                const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
                const timestamp: number | null = hasValidStart ? parsedStartMs : null;

                const rawEndStr = comp.endDate || comp.end_time || null;
                const parsedEndMs = rawEndStr ? Date.parse(String(rawEndStr)) : NaN;
                const authoritativeEndTimeMs: number | null =
                  !isNaN(parsedEndMs) && parsedEndMs > 0 && (!hasValidStart || parsedEndMs > parsedStartMs)
                    ? parsedEndMs
                    : null;

                const statusObj = comp.status?.type || {};
                const { status, statusLabel, statusText } = resolveEspnStatus(
                  statusObj,
                  hasValidStart,
                  parsedStartMs,
                  authoritativeEndTimeMs,
                  4 * 3600 * 1000,
                  4 * 3600 * 1000,
                  now
                );

                const dateStr = rawStartStr && String(rawStartStr).includes("T")
                  ? String(rawStartStr).split("T")[0]
                  : hasValidStart
                  ? new Date(parsedStartMs).toISOString().split("T")[0]
                  : "";
                const matchTimeStr = hasValidStart
                  ? new Date(parsedStartMs).toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: true })
                  : "Scheduled";

                events.push({
                  id: `espn-tennis-${comp.id}`,
                  idEvent: comp.id,
                  sport: "tennis",
                  sportName: "Tennis",
                  sportIcon: "fa-table-tennis-paddle-ball",
                  title: `${p1Name} vs ${p2Name}`,
                  name: `${p1Name} vs ${p2Name}`,
                  league: tournamentName,
                  tournament: tournamentName,
                  status,
                  statusText,
                  statusLabel,
                  timestamp,
                  startTime: hasValidStart ? new Date(parsedStartMs).toISOString() : null,
                  endTime: authoritativeEndTimeMs !== null
                    ? new Date(authoritativeEndTimeMs).toISOString()
                    : hasValidStart
                    ? new Date(parsedStartMs + 4 * 3600 * 1000).toISOString()
                    : null,
                  authoritativeEndTime: authoritativeEndTimeMs !== null ? new Date(authoritativeEndTimeMs).toISOString() : null,
                  date: dateStr,
                  matchTime: matchTimeStr,
                  timeOrTimer: status === "live" ? "LIVE" : (status === "finished" ? "FT" : "Scheduled"),
                  team1: { id: p1?.id || null, name: p1Name, logo: p1Logo, score: "" },
                  team2: { id: p2?.id || null, name: p2Name, logo: p2Logo, score: "" },
                  homeTeam: { id: p1?.id || null, name: p1Name, logo: p1Logo, score: "" },
                  awayTeam: { id: p2?.id || null, name: p2Name, logo: p2Logo, score: "" },
                  broadcaster: "",
                  broadcasters: [],
                  strTVStation: "",
                  source: "ESPN (Official API)",
                  streams: []
                });
              }
            }
          }
        }
      }
    } catch {}

    // 5. Volleyball (3-Day Schedule)
    try {
      const volleyballEndpoints = [
        { url: "https://site.api.espn.com/apis/site/v2/sports/volleyball/womens-college-volleyball/scoreboard", league: "NCAA Women's Volleyball" },
        { url: "https://site.api.espn.com/apis/site/v2/sports/volleyball/mens-college-volleyball/scoreboard", league: "NCAA Men's Volleyball" }
      ];
      for (const vEp of volleyballEndpoints) {
        for (const dStr of espn3DayDates) {
          const resV = await fetch(`${vEp.url}?dates=${dStr}`).catch(() => null);
          if (resV && resV.ok) {
            const jsonV: any = await resV.json();
            for (const ev of (jsonV.events || []).slice(0, 12)) {
              const norm = normalizeEspnEvent(ev, "volleyball", "Volleyball", "fa-volleyball", vEp.league);
              if (norm) pushEspnEvent(norm);
            }
          }
        }
      }
    } catch {}

    if (events.length > 0) {
      espnCache = { timestamp: now, data: events };
    }
    return espnCache.data;
  }

  // Helper: Fetch all curated events from TheSportsDB free API (Single-Flight Promise Coalescer)
  async function fetchTheSportsDBAllEvents(): Promise<any[]> {
    const now = Date.now();
    if (sportsDbCache.events && (now - sportsDbCache.events.timestamp < sportsDbCache.TTL_EVENTS)) {
      return sportsDbCache.events.data;
    }
    if (inFlightPromises.sportsDbEvents) {
      return inFlightPromises.sportsDbEvents;
    }

    inFlightPromises.sportsDbEvents = (async () => {
      const TOP_LEAGUE_IDS = [
        "4328", // English Premier League
        "4335", // Spanish La Liga
        "4332", // Italian Serie A
        "4331", // German Bundesliga
        "4334", // French Ligue 1
        "4480", // UEFA Champions League
        "4481", // UEFA Europa League
        "4833", // UEFA Conference League
        "4427", // UEFA Nations League
        "4906", // Saudi Pro League
        "4346", // MLS
        "4424", // MLB Baseball
        "4387", // NBA
        "4408", // EuroLeague Basketball
        "4441", // Basketball
        "5617", // Volleyliga Belgium
        "5614", // CEV Challenge Cup Volleyball
        "5848", // Mens European Volleyball League
        "5613", // Mens European Volleyball Championship
        "5849", // Womens European Volleyball League
        "4464", // ATP Tennis
        "4517", // WTA Tennis
        "4581", // Laver Cup Tennis
        "4466", // Grand Slam Tennis (US Open)
        "4467", // Wimbledon
        "4414", // Premiership Rugby
        "4417", // NRL Rugby
      ];

      const todayStr = new Date().toISOString().split("T")[0];
      const yestDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString().split("T")[0];
      const tmwDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0];
      const day2Date = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().split("T")[0];
      const day3Date = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split("T")[0];

      const promises: Promise<any>[] = [];

      // 1. Fetch next and past events for top leagues
      for (const lid of TOP_LEAGUE_IDS) {
        promises.push(
          fetch(`${THESPORTSDB_BASE}/eventsnextleague.php?id=${lid}`)
            .then((r) => (r.ok ? r.json() : { events: [] }))
            .catch(() => ({ events: [] }))
        );
        promises.push(
          fetch(`${THESPORTSDB_BASE}/eventspastleague.php?id=${lid}`)
            .then((r) => (r.ok ? r.json() : { events: [] }))
            .catch(() => ({ events: [] }))
        );
      }

      // 2. Fetch 3-day schedules across sports
      for (const d of [todayStr, tmwDate, day2Date, day3Date, yestDate]) {
        promises.push(
          fetch(`${THESPORTSDB_BASE}/eventsday.php?d=${d}`)
            .then((r) => (r.ok ? r.json() : { events: [] }))
            .catch(() => ({ events: [] }))
        );
        for (const sName of ["Soccer", "Cricket", "Basketball", "Baseball", "Volleyball", "Rugby", "Tennis"]) {
          promises.push(
            fetch(`${THESPORTSDB_BASE}/eventsday.php?d=${d}&s=${encodeURIComponent(sName)}`)
              .then((r) => (r.ok ? r.json() : { events: [] }))
              .catch(() => ({ events: [] }))
          );
        }
      }

      try {
        const results = await Promise.allSettled(promises);
        const seenEventIds = new Set<string>();
        const seenFingerprints = new Map<string, any>();
        const normalizedEvents: any[] = [];

        const getMatchFingerprint = (item: any) => {
          if (!item) return null;
          const sp = (item.sport || item.strSport || "").toLowerCase().trim();
          const t1 = (item.team1?.name || item.strHomeTeam || item.homeTeam?.name || "")
            .toLowerCase()
            .replace(/\b(fc|cf|sc|ac|afc|club|the|women|w)\b/gi, "")
            .replace(/[^a-z0-9]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const t2 = (item.team2?.name || item.strAwayTeam || item.awayTeam?.name || "")
            .toLowerCase()
            .replace(/\b(fc|cf|sc|ac|afc|club|the|women|w)\b/gi, "")
            .replace(/[^a-z0-9]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const date = (item.date || item.dateEvent || "").split("T")[0];
          if (t1 && t2) {
            const sorted = [t1, t2].sort().join("__vs__");
            return `${sp}::${sorted}::${date}`;
          }
          const title = (item.title || item.strEvent || item.name || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          return `${sp}::${title}::${date}`;
        };

        const addDedupedEvent = (ev: any) => {
          if (!ev || !ev.id) return;
          if (seenEventIds.has(ev.id)) return;
          const fp = getMatchFingerprint(ev);
          if (fp && seenFingerprints.has(fp)) {
            // Already have this match: enrich existing instead of duplicating
            const existing = seenFingerprints.get(fp);
            if (existing.status !== "live" && ev.status === "live") {
              existing.status = "live";
              existing.statusText = ev.statusText || "LIVE NOW";
              existing.statusLabel = "LIVE";
              existing.timeOrTimer = "LIVE";
            }
            if (!existing.score && ev.score) {
              existing.score = ev.score;
              if (existing.team1 && ev.team1?.score) existing.team1.score = ev.team1.score;
              if (existing.team2 && ev.team2?.score) existing.team2.score = ev.team2.score;
            }
            if (!existing.broadcaster && ev.broadcaster) {
              existing.broadcaster = ev.broadcaster;
              existing.broadcasters = ev.broadcasters || [ev.broadcaster];
            }
            return;
          }
          seenEventIds.add(ev.id);
          if (fp) seenFingerprints.set(fp, ev);
          normalizedEvents.push(ev);
        };

        for (const res of results) {
          if (res.status === "fulfilled" && res.value && Array.isArray(res.value.events)) {
            for (const rawEv of res.value.events) {
              if (rawEv && rawEv.idEvent) {
                const norm = normalizeSportsDbEvent(rawEv);
                if (norm) addDedupedEvent(norm);
              }
            }
          }
        }

        // Also merge real-time official ESPN events for Baseball, Basketball, Tennis, and Rugby
        try {
          const espnEvents = await fetchEspnAllEvents();
          for (const ee of espnEvents) {
            addDedupedEvent(ee);
          }
        } catch {}

        if (normalizedEvents.length > 0) {
          sportsDbCache.events = { timestamp: Date.now(), data: normalizedEvents };
          return normalizedEvents;
        }
      } catch (err: any) {
        console.warn("[TheSportsDB] Batch events fetch failed:", err.message);
      } finally {
        inFlightPromises.sportsDbEvents = null;
      }

      return sportsDbCache.events?.data || [];
    })();

    return inFlightPromises.sportsDbEvents;
  }

  // Endpoint: TheSportsDB All Free Normalized Events
  app.get("/api/thesportsdb/events", async (_req, res) => {
    try {
      const events = await fetchTheSportsDBAllEvents();
      res.json({
        status: "success",
        source: "TheSportsDB (Free Tier)",
        total: events.length,
        data: events,
      });
    } catch (err: any) {
      console.warn("[TheSportsDB] Events fetch error:", err.message);
      res.json({ status: "error", message: err.message, data: sportsDbCache.events?.data || [] });
    }
  });

  // Endpoint: TheSportsDB Single League Lookup (Cached)
  app.get("/api/thesportsdb/league/:id", async (req, res) => {
    try {
      const leagueId = String(req.params.id || "4328").trim();
      const now = Date.now();
      const cached = sportsDbCache.leagues.get(leagueId);
      if (cached && (now - cached.timestamp < sportsDbCache.TTL_LEAGUES)) {
        return res.json({ status: "success", leagueId, data: cached.data, cached: true });
      }

      const [nextRes, pastRes] = await Promise.all([
        fetch(`${THESPORTSDB_BASE}/eventsnextleague.php?id=${encodeURIComponent(leagueId)}`),
        fetch(`${THESPORTSDB_BASE}/eventspastleague.php?id=${encodeURIComponent(leagueId)}`),
      ]);
      const nextData: any = nextRes.ok ? await nextRes.json() : { events: [] };
      const pastData: any = pastRes.ok ? await pastRes.json() : { events: [] };

      const all = [...(nextData.events || []), ...(pastData.events || [])];
      const normalized = all.map(normalizeSportsDbEvent).filter(Boolean);
      sportsDbCache.leagues.set(leagueId, { timestamp: now, data: normalized });
      res.json({ status: "success", leagueId, data: normalized });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch league events", message: err.message });
    }
  });

  // Endpoint: TheSportsDB Single Event Details (Cached)
  app.get("/api/thesportsdb/event/:id", async (req, res) => {
    try {
      const eventId = String(req.params.id || "").replace(/^tsdb-/, "").trim();
      const now = Date.now();
      const cached = sportsDbCache.details.get(eventId);
      if (cached && (now - cached.timestamp < sportsDbCache.TTL_DETAILS)) {
        return res.json({ status: "success", data: cached.data, cached: true });
      }

      const response = await fetch(`${THESPORTSDB_BASE}/lookupevent.php?id=${encodeURIComponent(eventId)}`);
      if (!response.ok) {
        return res.status(response.status).json({ error: "Event lookup failed" });
      }
      const data: any = await response.json();
      const raw = (data.events && data.events[0]) || null;
      if (!raw) {
        return res.status(404).json({ error: "Event not found" });
      }
      const norm = normalizeSportsDbEvent(raw);
      sportsDbCache.details.set(eventId, { timestamp: now, data: norm });
      res.json({ status: "success", data: norm, raw });
    } catch (err: any) {
      res.status(500).json({ error: "Event details error", message: err.message });
    }
  });

  // Dedicated TheSportsDB Test Endpoint
  app.get("/api/thesportsdb/test", async (req, res) => {
    try {
      const apiKey = String(req.query.key || req.query.api_key || THESPORTSDB_KEY || "3").trim();
      const testUrl = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/eventsseason.php?id=4391&s=2026`;
      const start = Date.now();
      const response = await fetch(testUrl, { signal: AbortSignal.timeout(6000) });
      const latency = Date.now() - start;
      if (response.ok) {
        const data: any = await response.json();
        const eventsCount = Array.isArray(data?.events) ? data.events.length : 0;
        return res.json({
          valid: true,
          status: "success",
          latencyMs: latency,
          message: `TheSportsDB API Key is verified & active! (${eventsCount} events indexed)`,
          eventsCount,
        });
      }
      return res.status(response.status).json({
        valid: false,
        status: "error",
        message: `TheSportsDB API returned status ${response.status}`,
      });
    } catch (err: any) {
      return res.status(500).json({ valid: false, status: "error", message: err.message });
    }
  });

  // AllSportsAPI Helper
  function normalizeAllSportsApiEvent(raw: any, sportType: string, forcedStatus?: string): any {
    if (!raw || (!raw.event_home_team && !raw.event_away_team)) return null;
    const homeName = raw.event_home_team || "Team 1";
    const awayName = raw.event_away_team || "Team 2";
    const league = raw.league_name || "International";
    const title = `${homeName} vs ${awayName}`;
    const sport = sportType === "cricket" ? "Cricket" : "Football";
    const status = forcedStatus || (raw.event_status === "Finished" ? "finished" : (raw.event_status ? "live" : "upcoming"));
    return {
      id: `asapi-${raw.event_key || Math.random().toString(36).slice(2, 8)}`,
      sport,
      sportName: sport,
      title,
      name: title,
      league,
      status,
      statusText: raw.event_status || (status === "live" ? "LIVE" : "Upcoming"),
      date: raw.event_date || "",
      time: raw.event_time || "",
      team1: { name: homeName, logo: raw.home_team_logo || "", score: raw.event_final_result ? raw.event_final_result.split(" - ")[0] : "" },
      team2: { name: awayName, logo: raw.away_team_logo || "", score: raw.event_final_result ? raw.event_final_result.split(" - ")[1] : "" },
      source: "AllSportsAPI",
    };
  }

  // -------------------------------------------------------------
  // Tapmad BD Live Sports Feed Integration
  // -------------------------------------------------------------
  const TAPMAD_GIST_URL = "https://gist.githubusercontent.com/albatr0ssss/3cff7a26be49b1d352c15f615067e7cd/raw/tapmad_bd.json";
  let tapmadCache: { timestamp: number; data: any[] } = { timestamp: 0, data: [] };
  const TAPMAD_CACHE_TTL_MS = 60 * 1000;

  function normalizeTapmadEvent(item: any): any {
    if (!item || !item.EntityId) return null;
    const rawId = `tapmad-${item.EntityId}`;
    const videoName = String(item.VideoName || "").trim();
    let t1 = "";
    let t2 = "";
    if (videoName.includes(" vs ")) {
      const parts = videoName.split(" vs ");
      t1 = parts[0].trim();
      t2 = parts[1].replace(/\s*Live\s*$/i, "").trim();
    } else if (videoName.includes(" - ")) {
      const parts = videoName.split(" - ");
      t1 = parts[0].trim();
      t2 = parts.slice(1).join(" - ").replace(/\s*Live\s*$/i, "").trim();
    } else {
      t1 = videoName;
      t2 = item.StageName || "Match";
    }

    const categoryName = String(item.CategoryName || "").trim();
    const catLower = categoryName.toLowerCase();
    let sport = "football";
    let sportName = "Football";

    if (catLower.includes("cricket") || catLower.includes("t20") || catLower.includes("odi") || catLower.includes("tri-series")) {
      sport = "cricket";
      sportName = "Cricket";
    } else if (catLower.includes("nations league") || catLower.includes("uefa") || catLower.includes("football") || catLower.includes("soccer") || catLower.includes("liga") || catLower.includes("premier")) {
      sport = "football";
      sportName = "Football";
    } else if (catLower.includes("gt world") || catLower.includes("f1") || catLower.includes("grand prix") || catLower.includes("racing") || catLower.includes("motor")) {
      sport = "motorsport";
      sportName = "Motorsport";
    } else if (catLower.includes("league of nations") || catLower.includes("equestrian") || catLower.includes("longines")) {
      sport = "other";
      sportName = "Equestrian";
    }

    const statusRaw = String(item.Status || "Upcoming").toLowerCase();
    let status = "upcoming";
    if (statusRaw.includes("live")) status = "live";
    else if (statusRaw.includes("finish") || statusRaw.includes("ended") || statusRaw.includes("result")) status = "finished";

    let timestamp = 0;
    if (item.EventStartDate) {
      const parsed = Date.parse(item.EventStartDate.endsWith("Z") ? item.EventStartDate : item.EventStartDate.replace(" ", "T") + "+05:00");
      if (!isNaN(parsed)) timestamp = parsed;
    }

    const streams: any[] = [];
    if (item.stream_url && typeof item.stream_url === "string" && item.stream_url.startsWith("http")) {
      streams.push({
        name: "Tapmad Sports HD (Server 1 — 1080p FHD)",
        serverLabel: "Server 1 — 1080p FHD",
        channelName: "Tapmad Sports HD",
        channelId: "ch-tapmad-sports",
        channelLogo: "https://www.tapmad.com/images/tapmad_logo.png",
        url: item.stream_url.trim(),
        quality: "1080p FHD",
        isHD: true,
        category: "Sports"
      });
    }

    return {
      id: rawId,
      rawId: String(item.EntityId),
      title: videoName,
      sport,
      sportName,
      tournament: categoryName,
      league: categoryName,
      stage: item.StageName || "",
      status,
      timestamp: timestamp || Date.now(),
      date: item.EventStartDate ? item.EventStartDate.split(" ")[0] : "",
      time: item.EventStartDate ? item.EventStartDate.split(" ")[1]?.slice(0, 5) : "",
      team1: { name: t1, logo: item.ThumbnailStandard || item.ThumbnailTV || "" },
      team2: { name: t2, logo: item.ThumbnailStandard || item.ThumbnailTV || "" },
      broadcaster: "Tapmad Sports HD",
      broadcasters: ["Tapmad Sports HD"],
      channelId: streams.length > 0 ? "ch-tapmad-sports" : null,
      channels: streams.length > 0 ? [{
        id: "ch-tapmad-sports",
        name: "Tapmad Sports HD",
        logo: "https://www.tapmad.com/images/tapmad_logo.png",
        category: "Sports",
        sports: ["Football", "Cricket", "Motorsport"],
        active: true,
        isLive: true,
        streamUrl: item.stream_url
      }] : [],
      streams,
      hasStream: streams.length > 0,
      thumbnail: item.ThumbnailStandard || item.ThumbnailTV || "",
      description: item.Description || "",
      urlSlug: item.UrlSlug || "",
      source: "Tapmad BD"
    };
  }

  async function fetchTapmadEvents(): Promise<any[]> {
    const now = Date.now();
    if (tapmadCache.data.length > 0 && now - tapmadCache.timestamp < TAPMAD_CACHE_TTL_MS) {
      return tapmadCache.data;
    }
    try {
      const res = await fetch(TAPMAD_GIST_URL, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json: any = await res.json();
        const matches = Array.isArray(json.Matches) ? json.Matches : [];
        const normalized = matches.map(normalizeTapmadEvent).filter(Boolean);
        tapmadCache = { timestamp: now, data: normalized };
        return normalized;
      }
    } catch (err: any) {
      console.warn("[Tapmad BD] Fetch error:", err.message);
    }
    return tapmadCache.data || [];
  }

  // Endpoint: Tapmad BD Live & Upcoming Matches
  app.get("/api/tapmad/matches", async (_req, res) => {
    try {
      const events = await fetchTapmadEvents();
      res.json({
        status: "success",
        source: "Tapmad BD",
        total: events.length,
        events,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: err.message, events: [] });
    }
  });

  // -------------------------------------------------------------
  // Upcoming & Live Sports Data M3U Integration
  // -------------------------------------------------------------
  const SPORTS_DATA_M3U_URL = "https://raw.githubusercontent.com/sm-monirulislam/Upcoming-and-Live-Sports-Data/refs/heads/main/Sports_data.m3u";
  let sportsDataM3UCache: { timestamp: number; data: any[] } = { timestamp: 0, data: [] };
  const SPORTS_DATA_M3U_TTL_MS = 60 * 1000;

  async function fetchSportsDataM3UEvents(): Promise<any[]> {
    const now = Date.now();
    if (sportsDataM3UCache.data.length > 0 && now - sportsDataM3UCache.timestamp < SPORTS_DATA_M3U_TTL_MS) {
      return sportsDataM3UCache.data;
    }
    try {
      const res = await fetch(SPORTS_DATA_M3U_URL, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const text = await res.text();
        const lines = text.split("\n");
        const rawEntries: any[] = [];
        let curExt: any = null;
        let curClearkey: string | null = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("#EXTINF:")) {
            const groupMatch = line.match(/group-title=\"([^\"]+)\"/i);
            const logoMatch = line.match(/tvg-logo=\"([^\"]+)\"/i);
            const name = line.split(",")[1]?.trim() || "";
            curExt = {
              name,
              group: groupMatch ? groupMatch[1].trim() : "Sports",
              logo: logoMatch ? logoMatch[1].trim() : ""
            };
          } else if (line.startsWith("#KODIPROP:inputstream.adaptive.license_key=")) {
            curClearkey = line.split("=")[1]?.trim() || null;
          } else if (line.startsWith("http://") || line.startsWith("https://")) {
            if (curExt) {
              rawEntries.push({
                ...curExt,
                clearkey: curClearkey,
                url: line
              });
            }
            curExt = null;
            curClearkey = null;
          }
        }

        const matchesMap = new Map<string, any>();
        for (const entry of rawEntries) {
          let baseTitle = entry.name;
          let serverLabel = "Stream HD";
          if (baseTitle.includes(" - ")) {
            const parts = baseTitle.split(" - ");
            baseTitle = parts[0].trim();
            serverLabel = parts.slice(1).join(" - ").trim();
          }

          const groupLower = (entry.group || "").toLowerCase();
          let sport = "football";
          let sportName = "Football";
          if (groupLower.includes("cricket")) {
            sport = "cricket";
            sportName = "Cricket";
          } else if (groupLower.includes("american football") || groupLower.includes("nfl")) {
            sport = "other";
            sportName = "American Football";
          } else if (groupLower.includes("motorsport") || groupLower.includes("f1") || groupLower.includes("racing")) {
            sport = "motorsport";
            sportName = "Motorsport";
          } else if (groupLower.includes("basketball") || groupLower.includes("nba")) {
            sport = "basketball";
            sportName = "Basketball";
          } else if (groupLower.includes("hockey") || groupLower.includes("nhl")) {
            sport = "hockey";
            sportName = "Hockey";
          } else if (groupLower.includes("football") || groupLower.includes("soccer")) {
            sport = "football";
            sportName = "Football";
          } else {
            sport = "other";
            sportName = "Sports";
          }

          const key = (sport + "::" + baseTitle).toLowerCase();
          if (!matchesMap.has(key)) {
            let t1 = baseTitle;
            let t2 = "Live";
            if (baseTitle.toLowerCase().includes(" vs ")) {
              const p = baseTitle.split(/ vs /i);
              t1 = p[0].trim();
              t2 = p[1].trim();
            } else if (baseTitle.toLowerCase().includes(" v ")) {
              const p = baseTitle.split(/ v /i);
              t1 = p[0].trim();
              t2 = p[1].trim();
            }

            matchesMap.set(key, {
              id: "sportsdata-" + Buffer.from(key).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16),
              rawId: key,
              title: baseTitle,
              sport,
              sportName,
              league: entry.group || "Live Sports",
              tournament: entry.group || "Live Sports",
              status: "live",
              team1: { name: t1, logo: entry.logo || "" },
              team2: { name: t2, logo: entry.logo || "" },
              thumbnail: entry.logo || "",
              broadcaster: entry.name,
              broadcasters: [entry.name],
              streams: [],
              hasStream: true,
              source: "Sports Data M3U"
            });
          }

          const matchObj = matchesMap.get(key);
          matchObj.streams.push({
            name: `${baseTitle} (${serverLabel})`,
            serverLabel: serverLabel,
            channelName: entry.name,
            channelId: null,
            channelLogo: entry.logo || "",
            url: entry.url,
            clearkey: entry.clearkey || null,
            quality: serverLabel.toUpperCase().includes("FHD") ? "1080p FHD" : (serverLabel.toUpperCase().includes("HD") ? "720p HD" : "Auto"),
            isHD: serverLabel.toUpperCase().includes("HD"),
            category: entry.group || "Sports"
          });
        }

        const normalized = Array.from(matchesMap.values());
        sportsDataM3UCache = { timestamp: now, data: normalized };
        return normalized;
      }
    } catch (err: any) {
      console.warn("[Sports Data M3U] Fetch error:", err.message);
    }
    return sportsDataM3UCache.data || [];
  }

  // Endpoint: Upcoming & Live Sports Data Matches
  app.get("/api/sports-data/matches", async (_req, res) => {
    try {
      const events = await fetchSportsDataM3UEvents();
      res.json({
        status: "success",
        source: "Sports Data M3U",
        total: events.length,
        events,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: err.message, events: [] });
    }
  });

  // Dedicated AllSportsAPI Test Endpoint
  app.get("/api/allsportsapi/test", async (req, res) => {
    try {
      const apiKey = String(req.query.key || req.query.api_key || ALLSPORTSAPI_KEY || "").trim();
      if (!apiKey) {
        return res.status(400).json({ valid: false, status: "error", message: "AllSportsAPI key is required." });
      }
      const testUrl = `${ALLSPORTSAPI_BASE}/football/?met=Livescore&APIkey=${encodeURIComponent(apiKey)}`;
      const start = Date.now();
      const response = await fetch(testUrl, { signal: AbortSignal.timeout(7000) });
      const latency = Date.now() - start;
      if (!response.ok) {
        return res.status(response.status).json({ valid: false, status: "error", message: `HTTP ${response.status} from AllSportsAPI` });
      }
      const data: any = await response.json();
      if (data && data.error === "1") {
        const errorMsg = data.result?.[0]?.msg || "AllSportsAPI returned an error";
        return res.json({
          valid: false,
          status: "account_notice",
          latencyMs: latency,
          message: `AllSportsAPI: ${errorMsg}`,
          notice: errorMsg,
        });
      }
      return res.json({
        valid: true,
        status: "success",
        latencyMs: latency,
        message: "AllSportsAPI key is verified & connected!",
        resultCount: Array.isArray(data?.result) ? data.result.length : 0,
      });
    } catch (err: any) {
      return res.status(500).json({ valid: false, status: "error", message: err.message });
    }
  });

  // Dedicated AllSportsAPI Matches Endpoint
  app.get("/api/allsportsapi/matches", async (req, res) => {
    try {
      const apiKey = String(req.query.key || req.query.api_key || ALLSPORTSAPI_KEY || "").trim();
      if (!apiKey) {
        return res.json({ status: "success", total: 0, data: [], message: "AllSportsAPI key not configured." });
      }
      const now = Date.now();
      if (allSportsApiCache.events && (now - allSportsApiCache.events.timestamp < allSportsApiCache.TTL)) {
        return res.json({ status: "success", source: "AllSportsAPI", total: allSportsApiCache.events.data.length, data: allSportsApiCache.events.data, cached: true });
      }

      const events: any[] = [];
      const sports = ["football", "cricket"];
      const promises = sports.map(async (sport) => {
        try {
          const liveRes = await fetch(`${ALLSPORTSAPI_BASE}/${sport}/?met=Livescore&APIkey=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(6000) });
          if (liveRes.ok) {
            const liveData: any = await liveRes.json();
            if (liveData && Array.isArray(liveData.result) && liveData.error !== "1") {
              for (const m of liveData.result) {
                const norm = normalizeAllSportsApiEvent(m, sport, "live");
                if (norm) events.push(norm);
              }
            }
          }
        } catch (e) {}
      });

      await Promise.allSettled(promises);
      if (events.length > 0) {
        allSportsApiCache.events = { timestamp: now, data: events };
      }
      return res.json({ status: "success", source: "AllSportsAPI", total: events.length, data: events });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message, data: [] });
    }
  });

  // Dedicated In-Memory Fixture Broadcaster Cache with in-flight request deduplication
  // Prevents heavy database/disk/API reading during high traffic kick-off spikes (<100ms response time)
  interface FixtureBroadcasterCacheItem {
    timestamp: number;
    data: any;
  }
  const fixtureBroadcasterCache = new Map<string, FixtureBroadcasterCacheItem>();
  const inFlightFixtureBroadcasterPromises = new Map<string, Promise<any>>();
  const FIXTURE_BROADCASTER_CACHE_TTL_MS = 60 * 1000; // 60 seconds in-memory TTL during live kick-off spikes

  // Lookup Fixture Broadcaster by Event / Fixture ID
  app.get("/api/fixture/broadcaster", async (req, res) => {
    try {
      const rawFixtureId = req.query.fixtureId || req.query.id;
      // Malformed ID Input Edge-Case Handling: Safely validate and sanitize input
      if (rawFixtureId === undefined || rawFixtureId === null || typeof rawFixtureId === "object" || Array.isArray(rawFixtureId)) {
        return res.status(400).json({
          status: "error",
          error: "Malformed fixture ID input",
          fixtureId: "",
          verified: false,
          channels: [],
          message: "Invalid fixture ID parameter"
        });
      }
      const fixtureId = String(rawFixtureId).trim().slice(0, 128);
      if (!fixtureId || fixtureId.toLowerCase() === "undefined" || fixtureId.toLowerCase() === "null") {
        return res.status(400).json({
          status: "error",
          error: "fixtureId is required",
          fixtureId: "",
          verified: false,
          channels: [],
          message: "fixtureId is required"
        });
      }

      const sportParam = String(req.query.sport || "").trim().toLowerCase();
      const cacheKey = `bcast_fixture::${encodeURIComponent(fixtureId)}::sport::${encodeURIComponent(sportParam)}`;

      // 1. High-traffic fast path: Serve from memory cache immediately (<100ms requirement)
      const cachedHit = fixtureBroadcasterCache.get(cacheKey);
      if (cachedHit && (Date.now() - cachedHit.timestamp < FIXTURE_BROADCASTER_CACHE_TTL_MS)) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
        if (!cachedHit.data?.verified || cachedHit.data?.status === "not_found" || (Array.isArray(cachedHit.data?.channels) && cachedHit.data.channels.length === 0)) {
          return res.status(404).json(cachedHit.data);
        }
        return res.status(200).json(cachedHit.data);
      }

      // 2. Request deduplication for simultaneous kick-off spikes (e.g. 5,000 users hitting same fixture)
      if (inFlightFixtureBroadcasterPromises.has(cacheKey)) {
        const deduplicatedResult = await inFlightFixtureBroadcasterPromises.get(cacheKey);
        res.setHeader("X-Cache", "DEDUPLICATED");
        if (!deduplicatedResult?.verified || deduplicatedResult?.status === "not_found" || (Array.isArray(deduplicatedResult?.channels) && deduplicatedResult.channels.length === 0)) {
          return res.status(404).json(deduplicatedResult);
        }
        return res.status(200).json(deduplicatedResult);
      }

      // Execute lookup with promise deduplication
      const lookupPromise = (async () => {
        // Check serverUnifiedCache, tapmadCache, espnCache, rapidCache, cricketDataCache, allSportsApiCache, sportsDbCache, and disk events
        const diskEvents = getEventsFromDisk();
        const allCached = [
          ...(serverUnifiedCache?.data || []),
          ...(tapmadCache?.data || []),
          ...(espnCache.data || []),
          ...(rapidCache.matches?.data || []),
          ...(cricketDataCache.matches?.data || []),
          ...(allSportsApiCache.events?.data || []),
          ...(sportsDbCache.events?.data || []),
          ...diskEvents
        ];
        const cleanTsdbId = fixtureId.replace(/^tsdb-/, "");
        const cachedEv = allCached.find((e: any) => {
          const eid = String(e.id || "");
          const raw = String(e.rawId || "");
          const idev = String(e.idEvent || "");
          return eid === fixtureId || raw === fixtureId || idev === fixtureId ||
                 eid === cleanTsdbId || raw === cleanTsdbId || idev === cleanTsdbId ||
                 eid === `tsdb-${cleanTsdbId}`;
        });

        // 1. Direct API Stream Links & Direct Channel ID on cached event (Highest Priority)
        if (cachedEv) {
          if (Array.isArray(cachedEv.streams) && cachedEv.streams.length > 0) {
            const validDirectStreams = cachedEv.streams.filter((s: any) => s && typeof s.url === "string" && /^https?:\/\//i.test(s.url.trim()));
            if (validDirectStreams.length > 0) {
              const allChannels = getChannelsFromDisk();
              const matchedChs = validDirectStreams.map((s: any) => {
                const cid = s.channelId || cachedEv.channelId;
                return allChannels.find((c: any) => c && (c.id === cid || c.id === `ch-${cid}`));
              }).filter(Boolean);
              return {
                status: "success",
                fixtureId,
                broadcaster: cachedEv.broadcaster || validDirectStreams[0]?.channelName || "Direct Live Stream",
                broadcasters: cachedEv.broadcasters || [cachedEv.broadcaster || "Direct Live Stream"],
                verified: true,
                channelId: matchedChs[0]?.id || cachedEv.channelId || validDirectStreams[0]?.channelId || null,
                channelIds: matchedChs.map((c: any) => c.id),
                channels: matchedChs.length > 0 ? matchedChs : (Array.isArray(cachedEv.channels) ? cachedEv.channels : []),
                streams: validDirectStreams,
                message: "Verified direct stream matched",
                source: "Direct API Stream"
              };
            }
          }

          if (cachedEv.channelId) {
            const allChannels = getChannelsFromDisk();
            const cid = String(cachedEv.channelId).trim();
            const directCh = allChannels.find((c: any) => c && (c.id === cid || c.id === `ch-${cid}`) && (c.active === true || c.is_active === true));
            if (directCh) {
              const builtStreams = buildStreamsFromChannels([directCh]);
              return {
                status: "success",
                fixtureId,
                broadcaster: directCh.name || cachedEv.broadcaster || "Direct Channel",
                broadcasters: [directCh.name],
                verified: true,
                channelId: directCh.id,
                channelIds: [directCh.id],
                channels: [directCh],
                streams: builtStreams,
                message: "Verified direct channel matched",
                source: "Direct API Channel"
              };
            }
          }

          // Broadcaster tokens on cached event
          if (cachedEv.broadcaster || (Array.isArray(cachedEv.broadcasters) && cachedEv.broadcasters.length > 0) || cachedEv.strTVStation) {
            const bList = Array.isArray(cachedEv.broadcasters) && cachedEv.broadcasters.length > 0
              ? cachedEv.broadcasters
              : String(cachedEv.broadcaster || cachedEv.strTVStation || "")
                  .split(/[,/|;+&]|\band\b|\bor\b/i)
                  .map((s: string) => s.trim())
                  .filter((s: string) => s.length >= 3 && !["null", "undefined", "none", "tbd", "unknown"].includes(s.toLowerCase()));
            if (bList.length > 0) {
              const aiResolved = await getMappedChannelFromGemini({
                id: fixtureId,
                sport: cachedEv.sport || req.query.sport || "",
                broadcasters: bList,
              });
              if (aiResolved && aiResolved.verified && Array.isArray(aiResolved.channels) && aiResolved.channels.length > 0) {
                return {
                  status: "success",
                  fixtureId,
                  broadcaster: bList.join(", "),
                  broadcasters: aiResolved.extracted_broadcasters || bList,
                  verified: true,
                  channelId: aiResolved.primary_channel_id || null,
                  channelIds: aiResolved.verified_channel_ids || [],
                  channels: aiResolved.channels || [],
                  streams: aiResolved.streams || [],
                  message: aiResolved.message || "Verified channel matched",
                  source: "Cache"
                };
              }
            }
          }
        }

        // Check TheSportsDB lookupevent.php AND lookuptv.php if fixture is numeric or starts with tsdb-
        if (/^\d+$/.test(cleanTsdbId)) {
          const [eventRes, tvRes] = await Promise.allSettled([
            fetch(`${THESPORTSDB_BASE}/lookupevent.php?id=${encodeURIComponent(cleanTsdbId)}`, { signal: AbortSignal.timeout(6000) }),
            fetch(`${THESPORTSDB_BASE}/lookuptv.php?id=${encodeURIComponent(cleanTsdbId)}`, { signal: AbortSignal.timeout(6000) }),
          ]);

          const broadcasters: string[] = [];
          let evSport = String(req.query.sport || "football");
          if (eventRes.status === "fulfilled" && eventRes.value.ok) {
            const data: any = await eventRes.value.json();
            const raw = (data.events && data.events[0]) || null;
            if (raw) {
              if (raw.strSport) evSport = raw.strSport;
              const rawStation = String(raw.strTVStation || raw.strBroadcaster || raw.strBroadcast || "").trim();
              if (rawStation && rawStation.length >= 3) {
                rawStation
                  .split(/[,/|;+&]|\band\b|\bor\b/i)
                  .map((s: string) => s.trim())
                  .filter((s: string) => s.length >= 3 && !["null", "undefined", "none", "tbd", "unknown"].includes(s.toLowerCase()))
                  .forEach((b: string) => {
                    if (!broadcasters.includes(b)) broadcasters.push(b);
                  });
              }
            }
          }

          if (tvRes.status === "fulfilled" && tvRes.value.ok) {
            try {
              const tvJson: any = await tvRes.value.json();
              const tvList = Array.isArray(tvJson.tvs) ? tvJson.tvs : Array.isArray(tvJson.tv) ? tvJson.tv : [];
              for (const t of tvList) {
                const name = String(t.strChannel || t.strTVStation || t.strBroadcaster || "").trim();
                if (name && name.length >= 3 && !["null", "undefined", "none", "tbd", "unknown"].includes(name.toLowerCase()) && !broadcasters.includes(name)) {
                  broadcasters.push(name);
                }
              }
            } catch {}
          }

          if (broadcasters.length > 0) {
            const aiResolved = await getMappedChannelFromGemini({
              id: fixtureId,
              sport: evSport,
              broadcasters,
            });
            if (aiResolved && aiResolved.verified && Array.isArray(aiResolved.channels) && aiResolved.channels.length > 0) {
              return {
                status: "success",
                fixtureId,
                broadcaster: broadcasters.join(", "),
                broadcasters: aiResolved.extracted_broadcasters || broadcasters,
                verified: true,
                channelId: aiResolved.primary_channel_id || null,
                channelIds: aiResolved.verified_channel_ids || [],
                channels: aiResolved.channels || [],
                streams: aiResolved.streams || [],
                message: aiResolved.message || "Verified channel matched",
                source: "TheSportsDB"
              };
            }
          }
        }

        // Check Cricbuzz Match Center lookup if fixture has cricket ID or is numeric
        const cleanCrId = fixtureId.replace(/^cr-cricbuzz-/, "").replace(/^cr-/, "").trim();
        if (/^\d+$/.test(cleanCrId)) {
          try {
            const mCenterRes = await fetch(`https://${RAPIDAPI_CRICKET_HOST}/mcenter/v1/${encodeURIComponent(cleanCrId)}`, {
              headers: { "x-rapidapi-host": RAPIDAPI_CRICKET_HOST, "x-rapidapi-key": RAPIDAPI_KEY },
              signal: AbortSignal.timeout(6000)
            });
            if (mCenterRes.ok && mCenterRes.status !== 204) {
              const mCenter: any = await mCenterRes.json();
              const bInfo = mCenter?.broadcastinfo || mCenter?.broadcastInfo;
              if (bInfo) {
                const list = Array.isArray(bInfo) ? bInfo : [bInfo];
                const extracted: string[] = [];
                for (const item of list) {
                  if (!item) continue;
                  const bList = Array.isArray(item.broadcaster) ? item.broadcaster : [item.broadcaster];
                  for (const b of bList) {
                    if (!b) continue;
                    const val = typeof b === "string" ? b : (b.value || b.name || b.channel || "");
                    if (val && typeof val === "string" && val.trim().length >= 3) {
                      const vTrim = val.trim();
                      if (!["null", "undefined", "none", "tbd", "unknown"].includes(vTrim.toLowerCase())) {
                        extracted.push(vTrim);
                      }
                    }
                  }
                }
                if (extracted.length > 0) {
                  const uniqueBc = Array.from(new Set(extracted));
                  const aiResolved = await getMappedChannelFromGemini({
                    id: fixtureId,
                    sport: "cricket",
                    broadcasters: uniqueBc,
                  });
                  if (aiResolved && aiResolved.verified && Array.isArray(aiResolved.channels) && aiResolved.channels.length > 0) {
                    return {
                      status: "success",
                      fixtureId,
                      broadcaster: uniqueBc.join(", "),
                      broadcasters: aiResolved.extracted_broadcasters || uniqueBc,
                      verified: true,
                      channelId: aiResolved.primary_channel_id || null,
                      channelIds: aiResolved.verified_channel_ids || [],
                      channels: aiResolved.channels || [],
                      streams: aiResolved.streams || [],
                      message: aiResolved.message || "Verified channel matched",
                      source: "Cricbuzz RapidAPI"
                    };
                  }
                }
              }
            }
          } catch (e: any) {
            console.warn("[Backend Proxy] Cricbuzz broadcaster lookup note:", e.message);
          }
        }

        // Multi-Tier Fallback: Sport & League Default Fallback (Returns entire array of active channels)
        if (sportParam) {
          const allChannels = getChannelsFromDisk();
          const sportFallbackChannels = findChannelsBySportFallback(sportParam, allChannels);
          if (sportFallbackChannels.length > 0) {
            const activeOnly = sportFallbackChannels.filter((c: any) => {
              const isActive = c.active === true || c.is_active === true || (c.active !== false && c.is_active !== false);
              const isLive = c.isLive !== false && c.is_live !== false;
              return isActive && isLive;
            });
            if (activeOnly.length > 0) {
              const streams = buildStreamsFromChannels(activeOnly);
              return {
                status: "success",
                fixtureId,
                broadcaster: `${sportParam.toUpperCase()} Live Channels`,
                broadcasters: activeOnly.map((c: any) => c.name),
                verified: true,
                channelId: null, // Do not force channels[0] as default single channelId
                channelIds: activeOnly.map((c: any) => c.id),
                channels: activeOnly, // Return the entire list
                streams,
                message: "Sport-level active channels available",
                source: "Sport Fallback"
              };
            }
          }
        }

        return {
          status: "not_found",
          fixtureId,
          broadcaster: "",
          broadcasters: [],
          verified: false,
          channelId: null,
          channelIds: [],
          channels: [],
          streams: [],
          message: "Live channel unavailable"
        };
      })();

      inFlightFixtureBroadcasterPromises.set(cacheKey, lookupPromise);
      const result = await lookupPromise;
      inFlightFixtureBroadcasterPromises.delete(cacheKey);

      // Save to memory cache for fast kick-off responses
      fixtureBroadcasterCache.set(cacheKey, { timestamp: Date.now(), data: result });
      res.setHeader("X-Cache", "MISS");
      res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
      if (!result.verified || result.status === "not_found" || (Array.isArray(result.channels) && result.channels.length === 0)) {
        return res.status(404).json(result);
      }
      return res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Cricbuzz Test Key Endpoint
  app.get("/api/cricbuzz/test", async (req, res) => {
    try {
      const apiKey = String(
        req.query.key ||
        req.query.APIkey ||
        req.headers["x-rapidapi-key"] ||
        RAPIDAPI_KEY ||
        ""
      ).trim();

      const host = RAPIDAPI_CRICKET_HOST;

      if (!apiKey) {
        return res.status(400).json({
          valid: false,
          message: "RapidAPI key is required for Cricbuzz test."
        });
      }

      try {
        const testResp = await fetch(`https://${host}/matches/v1/live`, {
          headers: {
            "Content-Type": "application/json",
            "x-rapidapi-host": host,
            "x-rapidapi-key": apiKey,
            "Accept": "application/json"
          },
          signal: AbortSignal.timeout(6000)
        });

        const respText = await testResp.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(respText);
        } catch (e) {}

        if (testResp.status < 400) {
          const typeMatchesCount = Array.isArray(parsed?.typeMatches) ? parsed.typeMatches.length : 0;
          return res.json({
            valid: true,
            status: testResp.status,
            message: `RapidAPI Cricbuzz key is valid and working on ${host}! (${typeMatchesCount} match categories active)`,
            host,
            typeMatchesCount
          });
        }

        return res.status(testResp.status).json({
          valid: false,
          status: testResp.status,
          message: parsed?.message || `Cricbuzz request failed: Status ${testResp.status} from ${host}`,
          host
        });
      } catch (e: any) {
        return res.status(500).json({
          valid: false,
          message: `Connection failed: ${e.message}`,
          host
        });
      }
    } catch (err: any) {
      return res.status(500).json({
        valid: false,
        message: err.message
      });
    }
  });

  // RapidAPI Diagnostic Endpoint
  app.get("/api/rapidapi/test", async (req, res) => {
    try {
      const apiKey = String(
        req.query.key ||
        req.query.APIkey ||
        req.headers["x-rapidapi-key"] ||
        RAPIDAPI_KEY ||
        ""
      ).trim();

      if (!apiKey) {
        return res.status(400).json({
          valid: false,
          message: "RapidAPI key is required."
        });
      }

      const results: any = {
        keyPreview: apiKey.slice(0, 8) + "..." + apiKey.slice(-4),
        cricbuzz: null
      };

      // Check Cricbuzz
      try {
        const cResp = await fetch(`https://${RAPIDAPI_CRICKET_HOST}/matches/v1/live`, {
          headers: {
            "x-rapidapi-host": RAPIDAPI_CRICKET_HOST,
            "x-rapidapi-key": apiKey
          },
          signal: AbortSignal.timeout(6000)
        });
        const cText = await cResp.text();
        let cJson: any = null;
        try { cJson = JSON.parse(cText); } catch (e) {}

        results.cricbuzz = {
          host: RAPIDAPI_CRICKET_HOST,
          status: cResp.status,
          working: cResp.status === 200,
          details: cResp.status === 200
            ? "Active (live matches reachable)"
            : (cJson?.message || `Status ${cResp.status}`)
        };
      } catch (err: any) {
        results.cricbuzz = {
          host: RAPIDAPI_CRICKET_HOST,
          status: 500,
          working: false,
          details: err.message
        };
      }

      return res.json(results);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ======================================================================
  // HIGHFY TV - UNIFIED SPORTS EVENTS API ENGINE (SECTION 18)
  // Strictly verifies real sports events, enforces zero guessing,
  // sport isolation, deterministic deduplication, and verified channel mapping.
  // ======================================================================
  interface ServerUnifiedEvent {
    id: string;
    externalId: string;
    sport: string;
    sportName: string;
    league: string;
    title: string;
    teams: string[];
    date: string;
    time: string;
    startTime: string;
    status: "LIVE" | "UPCOMING" | "FINISHED";
    score: string;
    broadcaster: string;
    channelId: string | null;
    channelName: string | null;
    channelLogo: string | null;
    verified: boolean;
    hasStream: boolean;
    streams: Array<{
      name: string;
      serverLabel: string;
      quality: string;
      url: string;
      channelName: string;
      channelLogo: string;
      channelId: string;
    }>;
    source: string;
  }

  let serverUnifiedCache: { timestamp: number; data: ServerUnifiedEvent[] } | null = null;
  const SERVER_UNIFIED_CACHE_TTL = 60 * 1000;

  async function getUnifiedServerEvents(): Promise<ServerUnifiedEvent[]> {
    const now = Date.now();
    if (serverUnifiedCache && (now - serverUnifiedCache.timestamp < SERVER_UNIFIED_CACHE_TTL) && serverUnifiedCache.data.length > 0) {
      return serverUnifiedCache.data;
    }

    const channels = getChannelsFromDisk();
    const eventMap = new Map<string, ServerUnifiedEvent>();

    // Broadcaster to channel lookup with strict sport isolation and dev logging
    function resolveChannelForEvent(broadcasterStr: string, sport: string, league: string, eventId = "UNKNOWN", homeTeam = "TBD", awayTeam = "TBD", channelIdFromApi = "NONE") {
      const sNorm = (sport || "").toLowerCase().trim();
      const sportUpper = sNorm ? sNorm.toUpperCase() : "UNKNOWN";
      const bFromApi = broadcasterStr || "NONE";

      if (!broadcasterStr || !Array.isArray(channels) || channels.length === 0) {
        const matchReason = broadcasterStr ? "EMPTY_REGISTRY" : "NO_BROADCASTER_FROM_API";
        console.log(`[CHANNEL_RESOLVER] ${eventId} ${sportUpper} "${league}" "${homeTeam}" "${awayTeam}" "${bFromApi}" "${channelIdFromApi}" NONE ${matchReason} 0`);
        console.log(`EVENT_ID=${eventId} SPORT=${sportUpper} LEAGUE="${league}" HOME_TEAM="${homeTeam}" AWAY_TEAM="${awayTeam}" BROADCASTER_FROM_API="${bFromApi}" CHANNEL_ID_FROM_API="${channelIdFromApi}" CHANNEL_MATCH_RESULT="NONE" MATCH_REASON="${matchReason}" AUTHORIZED_STREAM_COUNT=0`);
        return null;
      }
      const bNorm = broadcasterStr.toLowerCase().replace(/[-_.:/\\,+|&]/g, " ").replace(/\s+/g, " ").trim();

      // Find matching active channel strictly in the same sport category
      for (const ch of channels) {
        if (!ch || ch.active === false) continue;
        const chName = (ch.name || "").toLowerCase();
        const chCat = (ch.category || "").toLowerCase();
        const chSports = Array.isArray(ch.sports) ? ch.sports.map((s: string) => s.toLowerCase()) : [];

        // Sport isolation: cricket only cricket channels, football only football, etc.
        if (sNorm === "cricket") {
          if (chSports.length > 0 && !chSports.includes("cricket")) continue;
          if (!chCat.includes("cricket") && !chSports.includes("cricket") && !chName.includes("cricket") && !chName.includes("willow") && !chName.includes("star sports") && !chName.includes("t sports") && !chName.includes("ptv")) {
            continue;
          }
          if ((chName.includes("football") || chName.includes("premier league") || chName.includes("la liga") || chName.includes("bundesliga")) && !chName.includes("cricket")) {
            continue;
          }
        }
        if (sNorm === "football" || sNorm === "soccer") {
          if (chSports.length > 0 && !chSports.includes("football") && !chSports.includes("soccer")) continue;
          if (!chCat.includes("football") && !chCat.includes("sports") && !chSports.includes("football") && !chName.includes("sky sports") && !chName.includes("tnt") && !chName.includes("bein") && !chName.includes("dazn")) {
            continue;
          }
          if ((chName.includes("cricket") || chName.includes("willow") || chName.includes("ptv sports")) && !chName.includes("football")) {
            continue;
          }
        }
        if (sNorm === "basketball") {
          if (chSports.length > 0 && !chSports.includes("basketball") && !chSports.includes("nba")) continue;
          if (chName.includes("cricket") || chName.includes("willow") || ((chName.includes("premier league") || chName.includes("la liga")) && !chName.includes("espn"))) {
            continue;
          }
        }
        if (sNorm === "tennis") {
          if (chSports.length > 0 && !chSports.includes("tennis")) continue;
          if (chName.includes("cricket") || chName.includes("willow")) continue;
        }
        if (sNorm === "combat" || sNorm === "wwe") {
          if (!chName.includes("wwe") && !chName.includes("sony sports ten 1") && !chName.includes("sony ten 1") && !chSports.includes("wwe")) {
            continue;
          }
        }

        // Deterministic match ONLY (exact normalized name, no substring fuzzy matching)
        const cleanCh = chName.replace(/\b(hd|fhd|uhd|4k|live|stream|tv|channel|stb)\b/gi, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
        const cleanBNorm = bNorm.replace(/\b(hd|fhd|uhd|4k|live|stream|tv|channel|stb)\b/gi, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
        if (cleanCh && cleanBNorm && cleanCh === cleanBNorm) {
          const streamUrl = ch.stream_url || ch.streamUrl || ch.url || "";
          if (streamUrl) {
            const streams = [{
              name: ch.name || "Server 1 HD",
              serverLabel: "SERVER 1 (1080P HD)",
              quality: ch.quality || "1080p FHD",
              url: streamUrl,
              channelName: ch.name,
              channelLogo: ch.logo || "./assets/category-logos/sports.png",
              channelId: ch.id
            }];
            if (Array.isArray(ch.backupUrls)) {
              ch.backupUrls.forEach((bu: string, bi: number) => {
                if (bu) {
                  streams.push({
                    name: `${ch.name} Server ${bi + 2}`,
                    serverLabel: `SERVER ${bi + 2} (BACKUP)`,
                    quality: "720p HD",
                    url: bu,
                    channelName: ch.name,
                    channelLogo: ch.logo || "./assets/category-logos/sports.png",
                    channelId: ch.id
                  });
                }
              });
            }
            const matchRes = ch.name;
            const matchReason = "API_BROADCASTER_NAME_MATCH";
            const authorizedStreamCount = streams.length;
            console.log(`[CHANNEL_RESOLVER] ${eventId} ${sportUpper} "${league}" "${homeTeam}" "${awayTeam}" "${bFromApi}" "${channelIdFromApi}" "${matchRes}" ${matchReason} ${authorizedStreamCount}`);
            console.log(`EVENT_ID=${eventId} SPORT=${sportUpper} LEAGUE="${league}" HOME_TEAM="${homeTeam}" AWAY_TEAM="${awayTeam}" BROADCASTER_FROM_API="${bFromApi}" CHANNEL_ID_FROM_API="${channelIdFromApi}" CHANNEL_MATCH_RESULT="${matchRes}" MATCH_REASON="${matchReason}" AUTHORIZED_STREAM_COUNT=${authorizedStreamCount}`);
            return {
              channelId: ch.id,
              channelName: ch.name,
              channelLogo: ch.logo || "./assets/category-logos/sports.png",
              streams
            };
          }
        }
      }
      const matchReason = "NO_AUTHORIZED_CHANNEL_FOR_BROADCASTER";
      console.log(`[CHANNEL_RESOLVER] ${eventId} ${sportUpper} "${league}" "${homeTeam}" "${awayTeam}" "${bFromApi}" "${channelIdFromApi}" NONE ${matchReason} 0`);
      console.log(`EVENT_ID=${eventId} SPORT=${sportUpper} LEAGUE="${league}" HOME_TEAM="${homeTeam}" AWAY_TEAM="${awayTeam}" BROADCASTER_FROM_API="${bFromApi}" CHANNEL_ID_FROM_API="${channelIdFromApi}" CHANNEL_MATCH_RESULT="NONE" MATCH_REASON="${matchReason}" AUTHORIZED_STREAM_COUNT=0`);
      return null;
    }

    try {
      // 1. Ingest Tapmad BD events (Official Live Matches & Streams)
      const tapmadList = await fetchTapmadEvents();
      if (Array.isArray(tapmadList)) {
        for (const item of tapmadList) {
          if (!item) continue;
          const t1 = item.team1?.name || "";
          const t2 = item.team2?.name || "";
          const sport = (item.sport || "football").toLowerCase();
          const league = item.league || item.tournament || "International";
          const title = item.title || (t1 && t2 ? `${t1} vs ${t2}` : "Sports Event");
          const date = item.date || "";
          const time = item.time || "";
          const dedupKey = `${sport}_${league}_${t1}_${t2}_${date}`.toLowerCase().replace(/[^a-z0-9]/g, "");

          if (!eventMap.has(dedupKey)) {
            const statusRaw = String(item.status || "upcoming").toUpperCase();
            let status: "LIVE" | "UPCOMING" | "FINISHED" = "UPCOMING";
            if (statusRaw.includes("LIVE")) {
              status = "LIVE";
            } else if (statusRaw.includes("FT") || statusRaw.includes("FINISH") || statusRaw.includes("ENDED")) {
              status = "FINISHED";
            }

            const evStreams = Array.isArray(item.streams) ? item.streams : [];

            eventMap.set(dedupKey, {
              id: item.id || `tapmad-${item.rawId || dedupKey}`,
              externalId: String(item.rawId || item.id || ""),
              sport,
              sportName: item.sportName || (sport.charAt(0).toUpperCase() + sport.slice(1)),
              league,
              title,
              teams: t1 && t2 ? [t1, t2] : [],
              date,
              time,
              startTime: date && time ? `${date}T${time}` : date,
              status,
              score: item.score || "",
              broadcaster: item.broadcaster || "Tapmad Sports HD",
              channelId: item.channelId || (evStreams.length > 0 ? "ch-tapmad-sports" : null),
              channelName: "Tapmad Sports HD",
              channelLogo: "https://www.tapmad.com/images/tapmad_logo.png",
              verified: evStreams.length > 0,
              hasStream: evStreams.length > 0,
              streams: evStreams,
              source: "Tapmad BD"
            });
          }
        }
      }
    } catch (e: any) {
      console.warn("[UnifiedEvents] Tapmad BD aggregation error:", e.message);
    }

    try {
      // 1b. Ingest Upcoming & Live Sports Data M3U events
      const sportsDataList = await fetchSportsDataM3UEvents();
      if (Array.isArray(sportsDataList)) {
        for (const item of sportsDataList) {
          if (!item) continue;
          const t1 = item.team1?.name || "";
          const t2 = item.team2?.name || "";
          const sport = (item.sport || "football").toLowerCase();
          const league = item.league || item.tournament || "Live Sports";
          const title = item.title || (t1 && t2 ? `${t1} vs ${t2}` : "Sports Event");
          const date = item.date || "";
          const time = item.time || "";
          const dedupKey = `${sport}_${league}_${t1}_${t2}_${date}`.toLowerCase().replace(/[^a-z0-9]/g, "");

          if (!eventMap.has(dedupKey)) {
            const statusRaw = String(item.status || "live").toUpperCase();
            let status: "LIVE" | "UPCOMING" | "FINISHED" = "LIVE";
            if (statusRaw.includes("UPCOMING")) {
              status = "UPCOMING";
            } else if (statusRaw.includes("FT") || statusRaw.includes("FINISH") || statusRaw.includes("ENDED")) {
              status = "FINISHED";
            }

            const evStreams = Array.isArray(item.streams) ? item.streams : [];

            eventMap.set(dedupKey, {
              id: item.id || `sportsdata-${dedupKey}`,
              externalId: String(item.rawId || item.id || ""),
              sport,
              sportName: item.sportName || (sport.charAt(0).toUpperCase() + sport.slice(1)),
              league,
              title,
              teams: t1 && t2 ? [t1, t2] : [],
              date,
              time,
              startTime: date && time ? `${date}T${time}` : date,
              status,
              score: item.score || "",
              broadcaster: item.broadcaster || "Live Sports Feed",
              channelId: item.channelId || null,
              channelName: item.broadcaster || "Live Sports Stream",
              channelLogo: item.thumbnail || "./assets/category-logos/sports.png",
              verified: evStreams.length > 0,
              hasStream: evStreams.length > 0,
              streams: evStreams,
              source: "Sports Data M3U"
            });
          }
        }
      }
    } catch (e: any) {
      console.warn("[UnifiedEvents] Sports Data M3U aggregation error:", e.message);
    }

    try {
      // 2. Ingest TheSportsDB events
      const tsdbList = await fetchTheSportsDBAllEvents();
      if (Array.isArray(tsdbList)) {
        for (const item of tsdbList) {
          if (!item) continue;
          const t1 = item.team1?.name || item.strHomeTeam || item.homeTeam?.name || "";
          const t2 = item.team2?.name || item.strAwayTeam || item.awayTeam?.name || "";
          const sport = (item.sport || item.strSport || "football").toLowerCase();
          const league = item.league || item.strLeague || "International";
          const title = item.title || item.strEvent || (t1 && t2 ? `${t1} vs ${t2}` : "Sports Event");
          const date = item.date || item.dateEvent || "";
          const time = item.time || item.strTime || "";
          const dedupKey = `${sport}_${league}_${t1}_${t2}_${date}`.toLowerCase().replace(/[^a-z0-9]/g, "");

          if (!eventMap.has(dedupKey)) {
            const broadcaster = (item.broadcaster || item.strTVStation || "").trim();
            const evId = item.id || `tsdb-${item.idEvent || dedupKey}`;
            const matchedCh = resolveChannelForEvent(broadcaster, sport, league, evId, t1, t2, item.channelId || "NONE");
            const statusRaw = (item.status || item.strStatus || "upcoming").toUpperCase();
            let status: "LIVE" | "UPCOMING" | "FINISHED" = "UPCOMING";
            if (statusRaw.includes("LIVE") || statusRaw === "1H" || statusRaw === "2H" || statusRaw === "HT") {
              status = "LIVE";
            } else if (statusRaw.includes("FT") || statusRaw.includes("FINISH") || statusRaw.includes("ENDED")) {
              status = "FINISHED";
            }

            eventMap.set(dedupKey, {
              id: item.id || `tsdb-${item.idEvent || dedupKey}`,
              externalId: String(item.idEvent || item.id || ""),
              sport,
              sportName: sport.charAt(0).toUpperCase() + sport.slice(1),
              league,
              title,
              teams: t1 && t2 ? [t1, t2] : [],
              date,
              time,
              startTime: item.startTime || (date && time ? `${date}T${time}` : date),
              status,
              score: item.score || "",
              broadcaster,
              channelId: matchedCh ? matchedCh.channelId : null,
              channelName: matchedCh ? matchedCh.channelName : null,
              channelLogo: matchedCh ? matchedCh.channelLogo : null,
              verified: !!matchedCh,
              hasStream: !!matchedCh,
              streams: matchedCh ? matchedCh.streams : [],
              source: item.source || "TheSportsDB"
            });
          }
        }
      }
    } catch (e: any) {
      console.warn("[UnifiedEvents] TheSportsDB aggregation error:", e.message);
    }

    // Sort: LIVE -> UPCOMING -> FINISHED
    const sorted = Array.from(eventMap.values()).sort((a, b) => {
      const order: Record<string, number> = { LIVE: 1, UPCOMING: 2, FINISHED: 3 };
      const diff = (order[a.status] || 2) - (order[b.status] || 2);
      if (diff !== 0) return diff;
      return (a.date || "").localeCompare(b.date || "");
    });

    serverUnifiedCache = { timestamp: now, data: sorted };
    return sorted;
  }

  // Unified Events Endpoints
  app.get("/api/events", async (req, res) => {
    try {
      const allEvents = await getUnifiedServerEvents();
      let filtered = [...allEvents];

      if (typeof req.query.sport === "string" && req.query.sport.trim()) {
        const sp = req.query.sport.trim().toLowerCase();
        filtered = filtered.filter(e => e.sport.toLowerCase() === sp);
      }

      if (typeof req.query.status === "string" && req.query.status.trim()) {
        const st = req.query.status.trim().toUpperCase();
        filtered = filtered.filter(e => e.status === st);
      }

      if (typeof req.query.limit === "string") {
        const lim = parseInt(req.query.limit, 10);
        if (!isNaN(lim) && lim > 0) {
          filtered = filtered.slice(0, lim);
        }
      }

      return res.json({
        status: "success",
        total: filtered.length,
        data: filtered
      });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message, data: [] });
    }
  });

  app.get("/api/events/live", async (_req, res) => {
    try {
      const allEvents = await getUnifiedServerEvents();
      const live = allEvents.filter(e => e.status === "LIVE");
      return res.json({ status: "success", total: live.length, data: live });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message, data: [] });
    }
  });

  app.get("/api/events/today", async (_req, res) => {
    try {
      const allEvents = await getUnifiedServerEvents();
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const todayEvents = allEvents.filter(e => e.status === "LIVE" || (e.date && e.date.includes(todayStr)));
      return res.json({ status: "success", total: todayEvents.length, data: todayEvents });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message, data: [] });
    }
  });

  app.get("/api/events/upcoming", async (_req, res) => {
    try {
      const allEvents = await getUnifiedServerEvents();
      const upcoming = allEvents.filter(e => e.status === "UPCOMING");
      return res.json({ status: "success", total: upcoming.length, data: upcoming });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message, data: [] });
    }
  });

  app.get("/api/events/:id/channels", async (req, res) => {
    try {
      const allEvents = await getUnifiedServerEvents();
      const target = allEvents.find(e => e.id === req.params.id || e.externalId === req.params.id);
      if (!target) {
        return res.status(404).json({ status: "error", message: "Event not found" });
      }
      return res.json({
        status: "success",
        eventId: target.id,
        title: target.title,
        broadcaster: target.broadcaster,
        verified: target.verified,
        channelId: target.channelId,
        channelName: target.channelName,
        channelLogo: target.channelLogo,
        hasStream: target.hasStream,
        streams: target.streams
      });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  app.get("/api/events/:id", async (req, res) => {
    try {
      const allEvents = await getUnifiedServerEvents();
      const target = allEvents.find(e => e.id === req.params.id || e.externalId === req.params.id);
      if (!target) {
        return res.status(404).json({ status: "error", message: "Event not found" });
      }
      return res.json({ status: "success", data: target });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  // EPG Electronic Program Guide Endpoint
  app.get(["/api/epg", "/data/epg.json"], (_req, res) => {
    try {
      const epgPath = path.join(process.cwd(), "data", "epg.json");
      if (fs.existsSync(epgPath)) {
        const epgData = JSON.parse(fs.readFileSync(epgPath, "utf8"));
        return res.json({ status: "success", ...epgData });
      }
      return res.json({
        status: "success",
        updatedAt: new Date().toISOString(),
        channels: []
      });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Token Renewal Endpoint for Mid-Match Auth Expiry
  // Background token renewal without video interruption or stream drop
  app.post("/api/stream/renew-token", (req, res) => {
    try {
      const rawToken = String(req.body?.token || req.query?.token || "").trim();
      if (!rawToken) {
        return res.status(400).json({ status: "error", message: "Stream token is required" });
      }
      const decryptedUrl = decryptStreamUrl(rawToken);
      if (!decryptedUrl) {
        return res.status(403).json({ status: "error", message: "Token invalid or expired" });
      }
      const freshToken = encryptStreamUrl(decryptedUrl);
      return res.json({
        status: "success",
        token: freshToken,
        proxyUrl: `/api/stream-proxy?token=${encodeURIComponent(freshToken)}`,
        refreshedAt: Date.now()
      });
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Automated Stream Health Check Endpoint (latency, status 200, SSL & geo-restriction monitoring)
  app.get("/api/stream/health-check", async (req, res) => {
    try {
      let targetUrl = String(req.query.url || "").trim();
      if (req.query.token && typeof req.query.token === "string") {
        const decrypted = decryptStreamUrl(req.query.token.trim());
        if (decrypted) targetUrl = decrypted;
      }
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return res.status(400).json({ status: "error", message: "Valid HTTP/HTTPS url required" });
      }

      const startTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HighFy-HealthCheck/1.0",
            "Range": "bytes=0-1024"
          },
          signal: controller.signal
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;
        const status = response.status;
        const isOk = response.ok;
        const isGeoBlocked = status === 403 || status === 451;

        return res.json({
          status: isOk ? "ok" : (isGeoBlocked ? "geo_blocked" : "error"),
          httpStatus: status,
          latencyMs,
          contentType: response.headers.get("content-type") || "",
          accessible: isOk,
          geoBlocked: isGeoBlocked
        });
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        return res.json({
          status: "error",
          error: fetchErr.name === "AbortError" ? "Timeout after 6000ms" : fetchErr.message,
          accessible: false,
          latencyMs: Date.now() - startTime
        });
      }
    } catch (err: any) {
      return res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Mock Live HLS Endpoint for Latency & Failover Testing
  app.get("/api/stream/mock-live.m3u8", (_req, res) => {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1, must-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const sampleManifest = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:2",
      "#EXT-X-MEDIA-SEQUENCE:100",
      "#EXTINF:2.0,",
      "/api/stream/mock-segment-1.ts",
      "#EXTINF:2.0,",
      "/api/stream/mock-segment-2.ts"
    ].join("\n");
    return res.send(sampleManifest);
  });

  // Universal Resilient M3U8 & Live Stream Proxy with CORS & URL Rewriting
  app.options("/api/stream-proxy", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });

  app.get("/api/stream-proxy", async (req, res) => {
    try {
      const threat = isReqableOrSnifferThreat(req);
      if (threat.detected) {
        return res.status(403).json({
          status: "error",
          blocked: true,
          code: "REQABLE_DETECTED",
          threat: threat.reason,
          message: "reqable আনইস্টল করো",
          detail: "নিরাপত্তা সতর্কতা: আপনার ডিভাইসে Reqable বা নেটওয়ার্ক স্নিফিং অ্যাপ সনাক্ত করা হয়েছে। লাইভ স্ট্রিম দেখার জন্য Reqable আনইন্সটল করুন।"
        });
      }

      let decodedUrl = "";
      if (typeof req.query.token === "string" && req.query.token.trim()) {
        const dec = decryptStreamUrl(req.query.token.trim());
        if (!dec) {
          return res.status(403).send("Invalid or expired stream security token");
        }
        decodedUrl = dec;
      } else if (typeof req.query.url === "string" && req.query.url.trim()) {
        decodedUrl = decodeURIComponent(req.query.url).trim();
      } else {
        return res.status(400).send("Missing stream token or URL");
      }

      if (!/^https?:\/\//i.test(decodedUrl)) {
        return res.status(400).send("Invalid stream URL protocol");
      }

      const targetUrlObj = new URL(decodedUrl);
      const origin = targetUrlObj.origin;

      let reqReferer = origin + "/";
      let reqOrigin = origin;
      if (targetUrlObj.hostname.includes("aynaott.com")) {
        reqReferer = "https://web.aynaott.com/";
        reqOrigin = "https://web.aynaott.com";
      }

      const fetchHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,bn;q=0.8,hi;q=0.7",
        "Referer": reqReferer,
        "Origin": reqOrigin,
      };

      if (req.headers.range) {
        fetchHeaders["Range"] = req.headers.range as string;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const targetRes = await fetch(decodedUrl, {
        headers: fetchHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Detect Geo-Restrictions / CDN 403 or 451 from upstream source
      if (targetRes.status === 403 || targetRes.status === 451) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Stream-Geo-Blocked", "1");
        return res.status(targetRes.status).json({
          status: "geo_restricted",
          code: "GEO_RESTRICTED",
          message: "Content restricted in your region",
          detail: "This broadcast stream is restricted in the requesting region by the upstream broadcaster/CDN."
        });
      }

      // Detect Upstream Failures (404/500/502/503) for seamless player failover
      if (targetRes.status === 404 || targetRes.status >= 500) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(targetRes.status).json({
          status: "error",
          code: "STREAM_UPSTREAM_UNAVAILABLE",
          message: `Upstream stream server returned HTTP ${targetRes.status}`
        });
      }

      // Pass CORS and low-latency streaming headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("X-Accel-Buffering", "no"); // Disables reverse proxy buffering for immediate chunk delivery

      const contentType = targetRes.headers.get("content-type") || "";
      const pathname = targetUrlObj.pathname.toLowerCase();
      const isM3U8Request = pathname.endsWith(".m3u8") || decodedUrl.includes(".m3u8") || contentType.includes("mpegurl");
      if (isM3U8Request) {
        res.setHeader("Cache-Control", "public, max-age=1, must-revalidate");
      }

      const isExplicitSegment = pathname.endsWith(".ts") ||
                                pathname.endsWith(".m4s") ||
                                pathname.endsWith(".mp4") ||
                                pathname.endsWith(".aac") ||
                                decodedUrl.includes(".ts?") ||
                                decodedUrl.includes(".m4s?") ||
                                (decodedUrl.includes("tracks-v1a1/") && pathname.endsWith(".ts"));

      // 1. Direct High-Speed Segment Streaming (Bypasses in-memory buffering for zero-lag video packets)
      if (isExplicitSegment && targetRes.body) {
        if (contentType && !contentType.includes("mpegurl")) {
          res.setHeader("Content-Type", contentType);
        } else {
          res.setHeader("Content-Type", "video/mp2t");
        }
        res.setHeader("Cache-Control", "public, max-age=60, immutable");
        const cl = targetRes.headers.get("content-length");
        if (cl) res.setHeader("Content-Length", cl);
        const cr = targetRes.headers.get("content-range");
        if (cr) res.setHeader("Content-Range", cr);
        const ar = targetRes.headers.get("accept-ranges");
        if (ar) res.setHeader("Accept-Ranges", ar);

        res.status(targetRes.status);
        const nodeStream = Readable.fromWeb(targetRes.body as any);
        nodeStream.pipe(res);
        req.on("close", () => {
          try { nodeStream.destroy(); } catch {}
        });
        return;
      }

      // 2. Otherwise inspect body (M3U8 Manifest, AES Key, or other format)
      const rawBuffer = Buffer.from(await targetRes.arrayBuffer());

      // Check if it is an M3U8 manifest (starts with #EXTM3U)
      const isM3U8Manifest = rawBuffer.length > 0 &&
                             rawBuffer.length < 2000000 &&
                             rawBuffer.toString("utf8", 0, Math.min(rawBuffer.length, 128)).includes("#EXTM3U");

      if (isM3U8Manifest) {
        const manifestText = rawBuffer.toString("utf8");
        const lines = manifestText.split(/\r?\n/);
        const rewrittenLines = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          // Handle M3U8 tags and comments starting with '#'
          if (trimmed.startsWith("#")) {
            if (trimmed.startsWith("#EXT")) {
              return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
                try {
                  const absUri = new URL(uri, decodedUrl).toString();
                  return `URI="/api/stream-proxy?token=${encodeURIComponent(encryptStreamUrl(absUri))}"`;
                } catch {
                  return `URI="${uri}"`;
                }
              });
            }
            return line;
          }

          // Handle TS/AAC/M3U8 URI line
          try {
            const absUrl = new URL(trimmed, decodedUrl).toString();
            return `/api/stream-proxy?token=${encodeURIComponent(encryptStreamUrl(absUrl))}`;
          } catch {
            return line;
          }
        });

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        // Live M3U8 Manifest Caching: max-age=1, must-revalidate ensures zero live lag while preventing unnecessary re-fetches
        res.setHeader("Cache-Control", "public, max-age=1, must-revalidate");
        return res.send(rewrittenLines.join("\n"));
      }

      // If it is NOT an M3U8 manifest, handle AES key or media
      const isKey = decodedUrl.includes("pkey=") ||
                    decodedUrl.includes(".pkey") ||
                    decodedUrl.includes("aes128.key") ||
                    (rawBuffer.length === 16);

      if (isKey) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else {
        if (contentType && !contentType.includes("mpegurl")) {
          res.setHeader("Content-Type", contentType);
        } else {
          res.setHeader("Content-Type", "video/mp2t");
        }
        res.setHeader("Cache-Control", "public, max-age=60, immutable");
      }

      res.setHeader("Content-Length", rawBuffer.length.toString());
      const contentRange = targetRes.headers.get("content-range");
      if (contentRange) res.setHeader("Content-Range", contentRange);
      const acceptRanges = targetRes.headers.get("accept-ranges");
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

      res.status(targetRes.status);
      return res.send(rawBuffer);
    } catch (err: any) {
      if (!res.headersSent) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(502).json({ error: "Stream proxy failed", details: err.message });
      }
    }
  });

  // Universal Real Image Proxy (Allows any image URL or Google Drive link to load safely bypassing CORS & hotlinking blocks)
  app.get("/api/image-proxy", async (req, res) => {
    try {
      const rawUrl = req.query.url;
      if (!rawUrl || typeof rawUrl !== "string") {
        return res.status(400).json({ error: "Missing image url parameter" });
      }

      let decodedUrl = decodeURIComponent(rawUrl.trim());
      if (!/^https?:\/\//i.test(decodedUrl)) {
        return res.status(400).json({ error: "Invalid URL protocol" });
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      // Special handler for Google Drive file links
      if (decodedUrl.includes("drive.google.com") || decodedUrl.includes("googleusercontent.com")) {
        const driveMatch = decodedUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || decodedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) || decodedUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
          const fileId = driveMatch[1];
          const directUrls = [
            `https://lh3.googleusercontent.com/d/${fileId}=w1000`,
            `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`,
            `https://drive.google.com/uc?export=download&id=${fileId}`
          ];

          for (const directUrl of directUrls) {
            try {
              const driveRes = await fetch(directUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                  "Accept": "image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8"
                }
              });
              const cType = driveRes.headers.get("content-type") || "";
              if (driveRes.ok && cType.startsWith("image/")) {
                res.setHeader("Content-Type", cType);
                res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
                const arrayBuf = await driveRes.arrayBuffer();
                return res.send(Buffer.from(arrayBuf));
              }
            } catch {}
          }

          // If drive image requires private auth, fallback gracefully to official HighFy TV logo asset
          const fallbackPath = path.join(process.cwd(), "public", "highfy_logo_official.png");
          if (fs.existsSync(fallbackPath)) {
            res.setHeader("Content-Type", "image/png");
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.sendFile(fallbackPath);
          }
        }
      }

      const imgRes = await fetch(decodedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8",
          "Referer": new URL(decodedUrl).origin
        }
      });

      if (!imgRes.ok) {
        return res.status(imgRes.status).send(`Failed to fetch image: ${imgRes.status}`);
      }

      const contentType = imgRes.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

      const arrayBuf = await imgRes.arrayBuffer();
      res.send(Buffer.from(arrayBuf));
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Image proxy error", message: err.message });
      }
    }
  });

  // AI Match Analyst Endpoint (Free-Tier powered by gemini-3.8-flash)
  app.post("/api/ai/analyze-match", async (req, res) => {
    try {
      const { title, sport, tournament, status } = req.body;

      if (!title) {
        return res.status(400).json({ error: "No match title provided in request." });
      }

      const activeKey = process.env.GEMINI_API_KEY || "";
      if (!activeKey) {
        return res.status(403).json({ 
          error: "Gemini API Key missing",
          message: "GEMINI_API_KEY is not configured in your AI Studio secrets. Please check Settings > Secrets panel."
        });
      }

      const prompt = `Match: "${title}"
Sport Category: "${sport || 'Other'}"
Tournament/League: "${tournament || 'Non-specified'}"
Status: "${status || 'UPCOMING'}"

Provide a detailed, engaging, and professional match preview and analysis for the match above as an expert sports pundit. Organize the analysis into the following points with rich icons, clean headings, and clear formatting in English:

1. ⚽/🏏 Match Overview & Recent Team Form/Status.
2. 🔑 Key Players & Star Performers to watch out for who could make a big difference in the match.
3. 🧠 Tactical Analysis & the key strategies required for victory (Key to Victory).
4. 🎯 Final Match Prediction & Win Probability percentage for each side.

Ensure the tone is exciting, authoritative, emoji-rich, and written in fluent, engaging English suited for sports streaming app users.`;

      const response = await aiClient.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are HighFy AI Sports Analyst, a world-class professional sports pundit who writes exciting, engaging, and highly detailed match forecasts in English. Always use rich emojis, clean markdown, and highly engaging language appropriate for live sports streaming users.",
          temperature: 0.8,
        }
      });

      const replyText = response.text || "Analysis could not be generated. Please try again.";

      res.json({
        status: "success",
        result: replyText
      });
    } catch (err: any) {
      console.error("[AI Analyst Error]:", err.message);
      res.status(500).json({
        error: "AI analysis failed.",
        details: err.message
      });
    }
  });

  // Gemini AI Broadcast Channel Mapper Endpoint (Powered by @google/genai gemini-3.8-flash)
  const handleGeminiChannelMap = async (req: any, res: any) => {
    try {
      const matchData = req.body?.matchData || req.body?.apiMatchData || req.body || {};
      const localChannels = Array.isArray(req.body?.localChannels)
        ? req.body.localChannels
        : Array.isArray(req.body?.channels)
        ? req.body.channels
        : undefined;

      const mapped = await getMappedChannelFromGemini(matchData, localChannels);
      res.json(mapped);
    } catch (err: any) {
      console.error("[Gemini Channel Mapper Error]:", err.message);
      res.status(500).json({
        error: "Failed to map channel via Gemini",
        details: err.message,
      });
    }
  };
  app.post("/api/gemini/map-channel", handleGeminiChannelMap);
  app.post("/api/ai/map-channel", handleGeminiChannelMap);

  // GitHub Logo Uploader Proxy (Uploads logo files directly to GitHub repository)
  app.post("/api/github/upload-logo", async (req, res) => {
    try {
      const { token, repo, branch = "main", path: filePath, content, message } = req.body;

      if (!token || !repo || !filePath || !content) {
        return res.status(400).json({
          error: "Missing required fields: token, repo (owner/repo), path, and content (base64) are required."
        });
      }

      // Normalize repo and file path
      const cleanRepo = repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
      const cleanPath = filePath.trim().replace(/^\/+/, "");
      const cleanBranch = (branch || "main").trim();
      const commitMsg = message || `Upload logo: ${path.basename(cleanPath)} via HighFy TV`;

      // Check if file already exists to obtain SHA for commit update
      let currentSha: string | null = null;
      try {
        const getUrl = `https://api.github.com/repos/${cleanRepo}/contents/${cleanPath}?ref=${cleanBranch}`;
        const checkRes = await fetch(getUrl, {
          headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `Bearer ${token.trim()}`,
            "User-Agent": "HighFy-TV-Logo-Uploader"
          }
        });
        if (checkRes.ok) {
          const checkData: any = await checkRes.json();
          currentSha = checkData.sha || null;
        }
      } catch {}

      // Prepare PUT body
      const cleanContent = content.includes("base64,") ? content.split("base64,")[1] : content;
      const putBody: any = {
        message: commitMsg,
        content: cleanContent,
        branch: cleanBranch
      };
      if (currentSha) {
        putBody.sha = currentSha;
      }

      const putUrl = `https://api.github.com/repos/${cleanRepo}/contents/${cleanPath}`;
      const putRes = await fetch(putUrl, {
        method: "PUT",
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "Authorization": `Bearer ${token.trim()}`,
          "Content-Type": "application/json",
          "User-Agent": "HighFy-TV-Logo-Uploader"
        },
        body: JSON.stringify(putBody)
      });

      const putData: any = await putRes.json();

      if (!putRes.ok) {
        return res.status(putRes.status).json({
          error: putData.message || "Failed to commit image to GitHub",
          details: putData
        });
      }

      const rawUrl = `https://raw.githubusercontent.com/${cleanRepo}/${cleanBranch}/${cleanPath}`;
      const cdnUrl = `https://cdn.jsdelivr.net/gh/${cleanRepo}@${cleanBranch}/${cleanPath}`;

      return res.json({
        success: true,
        repo: cleanRepo,
        branch: cleanBranch,
        path: cleanPath,
        sha: putData.content?.sha,
        rawUrl,
        cdnUrl,
        downloadUrl: putData.content?.download_url || rawUrl,
        htmlUrl: putData.content?.html_url
      });
    } catch (err: any) {
      return res.status(500).json({ error: "Server error during GitHub upload", message: err.message });
    }
  });

  // Backend Health check (Does not expose internal keys or secrets)
  app.get("/api/health", (_req, res) => {
    const isBlockedNow = cricketDataCache.blockedUntil > Date.now();
    res.json({
      status: "ok",
      worker: "ok",
      theSportsDB: "ok",
      allSportsApi: ALLSPORTSAPI_KEY ? "ok" : "not_configured",
      cricketData: CRICKETDATA_API_KEY ? (isBlockedNow ? "rate_limited" : "ok") : "not_configured",
      sportsApi: ALLSPORTSAPI_KEY ? "ok" : "not_configured",
      sportsDb: "ok",
      timestamp: new Date().toISOString(),
      secure: true,
      primaryCricketSource: "CricketData.org",
      fallbackCricketSource: "ESPN-Fallback",
      cricketDataConfigured: !!CRICKETDATA_API_KEY,
      cricketDataBlocked: isBlockedNow,
      cricketDataBlockedUntil: isBlockedNow ? cricketDataCache.blockedUntil : null,
      cricketCacheTtlSeconds: CRICKET_CACHE_TTL_SECONDS,
      rapidApiConfigured: !!RAPIDAPI_KEY,
      cricbuzzConfigured: ENABLE_CRICBUZZ_API && !!RAPIDAPI_KEY,
      cricbuzzPaused: !ENABLE_CRICBUZZ_API,
      thesportsdbConfigured: true,
      thesportsdbSecretConfigured: IS_THESPORTSDB_SECRET_CONFIGURED,
      allSportsApiConfigured: !!ALLSPORTSAPI_KEY,
      configuration: {
        CRICKETDATA_API_KEY: CRICKETDATA_API_KEY ? "configured" : "missing",
        THESPORTSDB_API_KEY: IS_THESPORTSDB_SECRET_CONFIGURED ? "configured" : "3 (Free Tier Default)",
        ALLSPORTS_API_KEY: ALLSPORTSAPI_KEY ? "configured" : "missing",
        cricketDataBlocked: isBlockedNow,
        cricketDataBlockedUntil: isBlockedNow ? cricketDataCache.blockedUntil : null,
        cricketCacheTtlSeconds: CRICKET_CACHE_TTL_SECONDS,
        rapidApiConfigured: !!RAPIDAPI_KEY,
      },
    });
  });

  // Client configuration status endpoint (Secure, returns flags and public config only)
  app.get("/api/config", (_req, res) => {
    const isBlockedNow = cricketDataCache.blockedUntil > Date.now();
    res.json({
      status: "ok",
      primaryCricketSource: "CricketData.org",
      fallbackCricketSource: "ESPN-Fallback",
      cricketDataConfigured: !!CRICKETDATA_API_KEY,
      cricketDataBlocked: isBlockedNow,
      cricketCacheTtlSeconds: CRICKET_CACHE_TTL_SECONDS,
      rapidApiConfigured: !!RAPIDAPI_KEY,
      cricbuzzConfigured: ENABLE_CRICBUZZ_API && !!RAPIDAPI_KEY,
      thesportsdbConfigured: true,
      thesportsdbSecretConfigured: IS_THESPORTSDB_SECRET_CONFIGURED,
      allSportsApiConfigured: !!ALLSPORTSAPI_KEY,
      thesportsdbKey: IS_THESPORTSDB_SECRET_CONFIGURED ? "configured" : "3 (Free Tier Default)",
    });
  });

  // Centralized production-safe channel/category logo proxy to bypass CORS/hotlinking restrictions in APK
  app.get("/api/logo-proxy", async (req, res) => {
    try {
      const imageUrl = req.query.url;
      if (typeof imageUrl !== "string" || !imageUrl.trim()) {
        return res.status(400).send("Missing logo URL");
      }
      
      const targetUrl = decodeURIComponent(imageUrl).trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        return res.status(400).send("Invalid logo URL protocol");
      }

      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://www.google.com/"
        }
      });

      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch logo: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400"); // Cache for 24 hours
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (response.body) {
        const reader = Readable.from(response.body as any);
        reader.pipe(res);
      } else {
        res.status(500).send("Empty response body from target server");
      }
    } catch (err: any) {
      res.status(500).send(`Logo proxy error: ${err.message}`);
    }
  });

  // Version and APK update status endpoint
  app.get(["/api/version", "/version.json"], (_req, res) => {
    try {
      const vPath = path.join(process.cwd(), "version.json");
      if (fs.existsSync(vPath)) {
        res.sendFile(vPath);
      } else {
        res.json({ appName: "HIGHFY TV", version: "1.0.0", versionCode: 1, forceUpdate: false });
      }
    } catch {
      res.json({ appName: "HIGHFY TV", version: "1.0.0", versionCode: 1, forceUpdate: false });
    }
  });

  // Disable stale browser caching for app scripts, styles, and html
  app.use((req, res, next) => {
    if (
      req.path === "/" ||
      req.path === "/index.html" ||
      req.path.endsWith(".js") ||
      req.path.endsWith(".css") ||
      req.path.endsWith(".json")
    ) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
  });

  // Vite middleware for development vs Static files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use(express.static(process.cwd()));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[HIGHFY TV Server] Running securely on http://0.0.0.0:${PORT}`);
  });
}

startServer();
