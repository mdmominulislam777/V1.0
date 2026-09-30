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
import { GoogleGenAI } from "@google/genai";

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
const THESPORTSDB_KEY = process.env.THESPORTSDB_API_KEY || "3";
const THESPORTSDB_BASE = `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}`;
const ALLSPORTSAPI_KEY = (process.env.ALLSPORTSAPI_KEY || "").trim();
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

const cricketDataCache = {
  matches: null as CacheEntry<any[]> | null,
  current: null as CacheEntry<any> | null,
  allMatches: null as CacheEntry<any> | null,
  series: null as CacheEntry<any> | null,
  details: new Map<string, CacheEntry<any>>(),
  lastStatus: 200 as number,
  lastError: "" as string,
  rateLimited: false as boolean,
  TTL_LIVE: 45 * 1000,         // 45 seconds for live matches
  TTL_SCHEDULE: 5 * 60 * 1000, // 5 minutes for general matches
  TTL_STATIC: 30 * 60 * 1000,  // 30 minutes for series list
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
    max: 120, // max 120 requests per IP per minute
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
          const json = await response.json();
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
    "india": "https://flagcdn.com/w320/in.png",
    "ind": "https://flagcdn.com/w320/in.png",
    "bangladesh": "https://flagcdn.com/w320/bd.png",
    "ban": "https://flagcdn.com/w320/bd.png",
    "pakistan": "https://flagcdn.com/w320/pk.png",
    "pak": "https://flagcdn.com/w320/pk.png",
    "england": "https://flagcdn.com/w320/gb-eng.png",
    "eng": "https://flagcdn.com/w320/gb-eng.png",
    "australia": "https://flagcdn.com/w320/au.png",
    "aus": "https://flagcdn.com/w320/au.png",
    "sri lanka": "https://flagcdn.com/w320/lk.png",
    "sl": "https://flagcdn.com/w320/lk.png",
    "south africa": "https://flagcdn.com/w320/za.png",
    "sa": "https://flagcdn.com/w320/za.png",
    "new zealand": "https://flagcdn.com/w320/nz.png",
    "nz": "https://flagcdn.com/w320/nz.png",
    "west indies": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170818/west-indies.jpg",
    "wi": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170818/west-indies.jpg",
    "afghanistan": "https://flagcdn.com/w320/af.png",
    "afg": "https://flagcdn.com/w320/af.png",
    "ireland": "https://flagcdn.com/w320/ie.png",
    "scotland": "https://flagcdn.com/w320/gb-sct.png",
    "netherlands": "https://flagcdn.com/w320/nl.png",
    "zimbabwe": "https://flagcdn.com/w320/zw.png",
    "nepal": "https://flagcdn.com/w320/np.png",
    "usa": "https://flagcdn.com/w320/us.png",
    "canada": "https://flagcdn.com/w320/ca.png",
    "uae": "https://flagcdn.com/w320/ae.png",
    "chennai super kings": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170823/chennai-super-kings.jpg",
    "csk": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170823/chennai-super-kings.jpg",
    "mumbai indians": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170829/mumbai-indians.jpg",
    "mi": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170829/mumbai-indians.jpg",
    "royal challengers bengaluru": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170826/royal-challengers-bangalore.jpg",
    "royal challengers bangalore": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170826/royal-challengers-bangalore.jpg",
    "rcb": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170826/royal-challengers-bangalore.jpg",
    "kolkata knight riders": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170827/kolkata-knight-riders.jpg",
    "kkr": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170827/kolkata-knight-riders.jpg",
    "delhi capitals": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170828/delhi-capitals.jpg",
    "dc": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170828/delhi-capitals.jpg",
    "rajasthan royals": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170831/rajasthan-royals.jpg",
    "rr": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170831/rajasthan-royals.jpg",
    "sunrisers hyderabad": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170830/sunrisers-hyderabad.jpg",
    "srh": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170830/sunrisers-hyderabad.jpg",
    "gujarat titans": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225642/gujarat-titans.jpg",
    "gt": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225642/gujarat-titans.jpg",
    "lucknow super giants": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225645/lucknow-super-giants.jpg",
    "lsg": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c225645/lucknow-super-giants.jpg",
    "punjab kings": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170824/punjab-kings.jpg",
    "pbks": "https://static.cricbuzz.com/a/img/v1/300x300/i1/c170824/punjab-kings.jpg"
  };

  function resolveHDTeamLogo(teamName: string, rawLogo?: string): string {
    // 1. HIGHEST PRIORITY: If authentic original team logo is provided by feed/API, preserve and upgrade it!
    if (rawLogo && typeof rawLogo === "string") {
      let clean = rawLogo.trim();
      if (clean && !clean.includes("un.png") && !clean.includes("placeholder") && !clean.includes("default-team")) {
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

    if (!teamName) return "./assets/team-placeholder.svg";
    const tLower = teamName.toLowerCase().trim();

    // 2. Exact match in curated database
    if (HD_CRICKET_LOGOS_MAP[tLower]) {
      return HD_CRICKET_LOGOS_MAP[tLower];
    }

    // 3. Match abbreviations (<= 3 chars) only as exact whole words, full names with substring
    for (const [k, v] of Object.entries(HD_CRICKET_LOGOS_MAP)) {
      if (k.length <= 3) {
        const regex = new RegExp(`(^|\\b|\\s)${k}(\\b|\\s|$)`, "i");
        if (regex.test(tLower)) {
          return v;
        }
      } else {
        if (tLower === k || tLower.includes(k) || k.includes(tLower)) {
          return v;
        }
      }
    }

    return "./assets/team-placeholder.svg";
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
          const datasets = [liveData, upcomingData, recentData].filter(Boolean);

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

  let lastCricketDataApiTime = 0;
  async function fetchCricketDataApi(
    endpoint: string,
    apiKey: string = CRICKETDATA_API_KEY,
    offset: number = 0
  ): Promise<{ ok: boolean; status: number; data?: any; error?: string; rawText?: string }> {
    const activeKey = apiKey.trim() || CRICKETDATA_API_KEY;
    if (!activeKey) {
      return { ok: false, status: 401, error: "CRICKETDATA_API_KEY is not configured in environment variables." };
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
    const url = `https://api.cricapi.com/v1/${cleanEndpoint}${sep}apikey=${encodeURIComponent(activeKey)}&offset=${offset}`;

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

      if (res.status === 429) {
        cricketDataCache.lastStatus = 429;
        cricketDataCache.rateLimited = true;
        cricketDataCache.lastError = "CricketData.org rate limit reached (HTTP 429)";
        return { ok: false, status: 429, error: "Rate limit reached (HTTP 429)", rawText: text };
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: data?.reason || data?.message || (text ? text.slice(0, 250) : res.statusText),
          rawText: text,
        };
      }

      if (data && data.status === "failure") {
        const reason = data.reason || "CricketData API returned failure status";
        const isRateLimit =
          String(reason).toLowerCase().includes("hit limit") ||
          String(reason).toLowerCase().includes("quota") ||
          String(reason).toLowerCase().includes("rate limit") ||
          String(reason).toLowerCase().includes("reached your limit");
        if (isRateLimit) {
          cricketDataCache.lastStatus = 429;
          cricketDataCache.rateLimited = true;
          cricketDataCache.lastError = reason;
          return { ok: false, status: 429, error: reason, rawText: text };
        }
        return { ok: false, status: 400, error: reason, data, rawText: text };
      }

      cricketDataCache.lastStatus = 200;
      cricketDataCache.rateLimited = false;
      cricketDataCache.lastError = "";
      return { ok: true, status: 200, data, rawText: text };
    } catch (err: any) {
      return { ok: false, status: 500, error: err.message || "Network error reaching CricketData.org API" };
    }
  }

  // Load and cache authentic channels.json for matching broadcast channels
  let cachedChannelsJson: any[] | null = null;
  function getChannelsFromDisk(): any[] {
    if (cachedChannelsJson && cachedChannelsJson.length > 0) return cachedChannelsJson;
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), "channels.json"), "utf8");
      cachedChannelsJson = JSON.parse(raw);
      return cachedChannelsJson || [];
    } catch (e: any) {
      console.warn("[Channels] Error reading channels.json:", e.message);
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

    // STRICT USER MANDATE:
    // If no broadcasting/channel information is provided in the API response, return null/empty.
    // Absolutely NO guessing, NO country/tournament inference, and NO placeholder/fallback channels!
    if (extracted.length === 0) {
      return {
        broadcaster: null,
        broadcasters: [],
        channelId: null,
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
      't sports': ['ch-t-sports-hd', 'ch-t-sports-server-2'],
      't sports hd': ['ch-t-sports-hd', 'ch-t-sports-server-2'],
      'tsports': ['ch-t-sports-hd', 'ch-t-sports-server-2'],
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

    let status = "upcoming";
    if (
      matchEnded ||
      msLower === "result" ||
      statusLower.includes("won by") ||
      statusLower.includes("match drawn") ||
      statusLower.includes("match tied") ||
      statusLower.includes("no result") ||
      statusLower.includes("abandoned") ||
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

    const homeInfo = teamInfo.find((t: any) => t.name === homeName) || teamInfo[0] || {};
    const awayInfo = teamInfo.find((t: any) => t.name === awayName) || teamInfo[1] || {};

    const homeLogo = resolveHDTeamLogo(homeName, homeInfo.img || item.t1img);
    const awayLogo = resolveHDTeamLogo(awayName, awayInfo.img || item.t2img);

    // Parse scores & overs from score array or cricScore t1s/t2s
    const scoreList = Array.isArray(item.score) ? item.score : [];
    let homeScore = item.t1s ? String(item.t1s).trim() : "";
    let homeOvers = "";
    let awayScore = item.t2s ? String(item.t2s).trim() : "";
    let awayOvers = "";

    if (scoreList.length > 0) {
      homeScore = "";
      awayScore = "";
      for (const sc of scoreList) {
        const inng = String(sc.inning || "").toLowerCase();
        const runs = sc.r !== undefined ? sc.r : 0;
        const wkts = sc.w !== undefined ? sc.w : 0;
        const overs = sc.o !== undefined ? sc.o : 0;
        const formatted = `${runs}/${wkts}`;
        const formattedOvers = `(${overs} ov)`;

        if (inng.includes(homeName.toLowerCase()) || inng.includes("inning 1") || (!homeScore && scoreList.indexOf(sc) === 0)) {
          if (!homeScore) {
            homeScore = formatted;
            homeOvers = formattedOvers;
          } else {
            homeScore += ` & ${formatted}`;
          }
        } else {
          if (!awayScore) {
            awayScore = formatted;
            awayOvers = formattedOvers;
          } else {
            awayScore += ` & ${formatted}`;
          }
        }
      }
    }

    const rawStartStr = item.dateTimeGMT || item.date || item.startTime || null;
    const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr.endsWith("Z") ? rawStartStr : rawStartStr + "Z")) : NaN;
    const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
    const timestamp = hasValidStart ? parsedStartMs : null;

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
    const activeKey = apiKey.trim() || CRICKETDATA_API_KEY;
    if (!activeKey) return [];

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
          const date = ev.date || "";
          return `${[t1, t2].sort().join("_vs_")}::${date}`;
        };
        const seenFps = new Map<string, any>();

        const addEvent = (ev: any) => {
          if (!ev || !ev.id) return;
          if (seenIds.has(ev.id)) return;
          const fp = getFingerprint(ev);
          if (fp && seenFps.has(fp)) {
            const existing = seenFps.get(fp);
            if (existing.status !== "live" && ev.status === "live") {
              existing.status = "live";
              existing.statusText = ev.statusText || "LIVE NOW";
              existing.statusLabel = "LIVE";
              existing.timeOrTimer = "LIVE";
            }
            if (ev.team1?.score && !existing.team1?.score) {
              existing.team1.score = ev.team1.score;
              existing.team1.overs = ev.team1.overs;
            }
            if (ev.team2?.score && !existing.team2?.score) {
              existing.team2.score = ev.team2.score;
              existing.team2.overs = ev.team2.overs;
            }
            return;
          }
          seenIds.add(ev.id);
          if (fp) seenFps.set(fp, ev);
          events.push(ev);
        };

        // 1. Fetch current live/ongoing matches (CricketData endpoint: currentMatches)
        const currentRes = await fetchCricketDataApi("currentMatches", activeKey, 0);
        if (currentRes.ok && Array.isArray(currentRes.data?.data)) {
          for (const item of currentRes.data.data) {
            const ev = normalizeCricketDataEvent(item);
            if (ev) addEvent(ev);
          }
        }

        // 2. Fetch matches list if quota permits
        if (currentRes.status !== 429) {
          const matchesRes = await fetchCricketDataApi("matches", activeKey, 0);
          if (matchesRes.ok && Array.isArray(matchesRes.data?.data)) {
            for (const item of matchesRes.data.data) {
              const ev = normalizeCricketDataEvent(item);
              if (ev) addEvent(ev);
            }
          }
        }

        // Sort: LIVE first, then UPCOMING, then FINISHED
        events.sort((a, b) => {
          const order: Record<string, number> = { live: 0, upcoming: 1, finished: 2 };
          const orderA = order[a.status] !== undefined ? order[a.status] : 1;
          const orderB = order[b.status] !== undefined ? order[b.status] : 1;
          if (orderA !== orderB) return orderA - orderB;
          return (a.timestamp || 0) - (b.timestamp || 0);
        });

        if (events.length > 0) {
          cricketDataCache.matches = { timestamp: Date.now(), data: events };
        }
        return events.length > 0 ? events : (cricketDataCache.matches?.data || []);
      } catch (err: any) {
        console.warn("[CricketData] Matches error:", err.message);
        return cricketDataCache.matches?.data || [];
      } finally {
        inFlightPromises.cricketDataMatches = null;
      }
    })();

    return inFlightPromises.cricketDataMatches;
  }

  // Proxy: Cricket Data API (CricketData.org / CricAPI)
  app.get("/api/cricket/matches", async (_req, res) => {
    try {
      const matches = await getNormalizedCricketDataMatches();
      if (matches.length === 0 && cricketDataCache.rateLimited) {
        return res.json({
          status: "rate_limited",
          source: "CricketData.org",
          rateLimited: true,
          upstreamStatus: 429,
          message: cricketDataCache.lastError || "CricketData.org rate limit reached (HTTP 429)",
          total: 0,
          data: [],
        });
      }
      return res.json({
        status: "success",
        source: "CricketData.org",
        rateLimited: false,
        upstreamStatus: cricketDataCache.lastStatus || 200,
        total: matches.length,
        data: matches,
      });
    } catch (err: any) {
      console.warn("[Backend Proxy] CricketData error:", err.message);
      res.json({
        status: "error",
        source: "CricketData.org",
        total: 0,
        data: [],
        error: "Failed to fetch cricket matches from CricketData.org",
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

      const mCenter = mCenterRes.status === "fulfilled" ? mCenterRes.value : null;
      const scard = scardRes.status === "fulfilled" ? scardRes.value : null;
      const leanback = leanbackRes.status === "fulfilled" ? leanbackRes.value : null;

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
  app.get(["/api/cricapi/test", "/api/cricket/cricapi/test"], async (req, res) => {
    try {
      const apiKey = String(
        req.query.key ||
        req.query.api_key ||
        req.query.apikey ||
        req.headers["x-cricapi-key"] ||
        CRICKETDATA_API_KEY ||
        ""
      ).trim();

      if (!apiKey) {
        return res.status(400).json({
          valid: false,
          status: "missing_key",
          message: "CricketData.org (CricAPI) API key is required. Pass ?apikey=YOUR_KEY or set CRICKETDATA_API_KEY in Environment Variables.",
        });
      }

      const startTime = Date.now();
      const testRes = await fetchCricketDataApi("currentMatches", apiKey, 0);
      const elapsed = Date.now() - startTime;

      if (testRes.ok && testRes.data) {
        const matches = Array.isArray(testRes.data.data) ? testRes.data.data : [];
        return res.json({
          valid: true,
          status: "success",
          source: "CricketData.org",
          message: `CricketData.org (CricAPI) key is VALID and operational! (${matches.length} current matches found)`,
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
          valid: false,
          status: "rate_limited",
          source: "CricketData.org",
          statusCode: 429,
          rateLimited: true,
          total: 0,
          data: [],
          message: "CricketData.org rate limit reached (Hits limit exceeded).",
          error: testRes.error,
        });
      }

      return res.status(testRes.status || 500).json({
        valid: false,
        status: "error",
        source: "CricketData.org",
        statusCode: testRes.status,
        message: testRes.error || `CricketData.org API error with HTTP status ${testRes.status}`,
      });
    } catch (err: any) {
      return res.status(500).json({
        valid: false,
        status: "error",
        message: err.message,
      });
    }
  });

  // Dedicated CricketData.org Matches Endpoint
  app.get("/api/cricket/cricapi/matches", async (req, res) => {
    try {
      const apiKey = String(
        req.query.api_key ||
        req.query.key ||
        req.query.apikey ||
        req.headers["x-cricapi-key"] ||
        CRICKETDATA_API_KEY ||
        ""
      ).trim();

      const matches = await getNormalizedCricketDataMatches(apiKey);
      if (matches.length === 0 && cricketDataCache.rateLimited) {
        return res.json({
          status: "rate_limited",
          source: "CricketData.org",
          rateLimited: true,
          upstreamStatus: 429,
          message: cricketDataCache.lastError || "CricketData.org rate limit reached (HTTP 429)",
          total: 0,
          data: [],
        });
      }
      res.json({
        status: "success",
        source: "CricketData.org",
        rateLimited: false,
        upstreamStatus: cricketDataCache.lastStatus || 200,
        total: matches.length,
        data: matches,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Dedicated CricketData.org Current Matches Endpoint
  app.get("/api/cricket/cricapi/current", async (req, res) => {
    try {
      const apiKey = String(
        req.query.api_key ||
        req.query.key ||
        req.query.apikey ||
        req.headers["x-cricapi-key"] ||
        CRICKETDATA_API_KEY ||
        ""
      ).trim();

      const apiRes = await fetchCricketDataApi("currentMatches", apiKey, 0);
      if (!apiRes.ok) {
        return res.status(apiRes.status).json({ status: "error", message: apiRes.error });
      }

      const rawList = Array.isArray(apiRes.data?.data) ? apiRes.data.data : [];
      const normalized = rawList.map((item: any) => normalizeCricketDataEvent(item)).filter(Boolean);

      res.json({
        status: "success",
        source: "CricketData.org Current",
        total: normalized.length,
        data: normalized,
        info: apiRes.data?.info || {},
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: err.message });
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
    // Normal match window (Football 3h covers Extra Time + Penalties; Tennis/Motorsport 5h; other sports 4.5h)
    const formatDurationMs = sportLower.includes("motor") || sportLower.includes("tennis")
      ? 5 * 3600 * 1000
      : sportLower.includes("basket") || sportLower.includes("base") || sportLower.includes("rugby") || sportLower.includes("hockey") || sportLower.includes("combat") || sportLower.includes("wwe")
      ? 4.5 * 3600 * 1000
      : 3 * 3600 * 1000;
    // Stale-LIVE safety ceiling (Football 6h, Tennis/Motorsport 10h, Basketball/Baseball/Rugby/Hockey 8h)
    const maxLiveSafeguardMs = sportLower.includes("motor") || sportLower.includes("tennis")
      ? 10 * 3600 * 1000
      : sportLower.includes("basket") || sportLower.includes("base") || sportLower.includes("rugby") || sportLower.includes("hockey") || sportLower.includes("combat") || sportLower.includes("wwe")
      ? 8 * 3600 * 1000
      : 6 * 3600 * 1000;

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
          sport === "tennis"
            ? 5 * 3600 * 1000
            : sport === "baseball"
            ? 4.5 * 3600 * 1000
            : 4 * 3600 * 1000;
        const maxLiveSafeguardMs =
          sport === "tennis"
            ? 10 * 3600 * 1000
            : sport === "baseball"
            ? 8 * 3600 * 1000
            : 7 * 3600 * 1000;

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

        const dateStr = rawStartStr && String(rawStartStr).includes("T")
          ? String(rawStartStr).split("T")[0]
          : hasValidStart
          ? new Date(parsedStartMs).toISOString().split("T")[0]
          : "";

        const broadcasts = (comp?.broadcasts?.[0]?.names || []).concat(comp?.geoBroadcasts?.map((b: any) => b.media?.shortName).filter(Boolean) || []);
        const broadcaster = broadcasts.length > 0 ? broadcasts[0] : "";
        const league = defaultLeague || comp?.league?.name || sportName;
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

    // 1. Baseball (MLB)
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${todayStr}`);
      if (res.ok) {
        const json = await res.json();
        for (const ev of (json.events || [])) {
          const norm = normalizeEspnEvent(ev, "baseball", "Baseball", "fa-baseball", "MLB");
          if (norm) events.push(norm);
        }
      }
    } catch {}

    // 2. Basketball (WNBA & NBA)
    try {
      const resW = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${todayStr}`);
      if (resW.ok) {
        const jsonW = await resW.json();
        for (const ev of (jsonW.events || [])) {
          const norm = normalizeEspnEvent(ev, "basketball", "Basketball", "fa-basketball", "WNBA");
          if (norm) events.push(norm);
        }
      }
      const resN = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard");
      if (resN.ok) {
        const jsonN = await resN.json();
        for (const ev of (jsonN.events || [])) {
          const norm = normalizeEspnEvent(ev, "basketball", "Basketball", "fa-basketball", "NBA");
          if (norm) events.push(norm);
        }
      }
    } catch {}

    // 3. Rugby
    try {
      const rugbyEndpoints = [
        { url: "https://site.api.espn.com/apis/site/v2/sports/rugby/289234/scoreboard", league: "The Rugby Championship" },
        { url: "https://site.api.espn.com/apis/site/v2/sports/rugby/270559/scoreboard", league: "Top 14 Rugby" },
        { url: "https://site.api.espn.com/apis/site/v2/sports/rugby/269/scoreboard", league: "Premiership Rugby" }
      ];
      for (const rEp of rugbyEndpoints) {
        const resR = await fetch(rEp.url).catch(() => null);
        if (resR && resR.ok) {
          const jsonR = await resR.json();
          for (const ev of (jsonR.events || [])) {
            const norm = normalizeEspnEvent(ev, "rugby", "Rugby", "fa-football", rEp.league);
            if (norm) events.push(norm);
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
          const jsonT = await resT.json();
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

                const rawEndStr = comp.endDate || comp.end_time || ev.endDate || ev.end_time || null;
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
                  5 * 3600 * 1000,
                  10 * 3600 * 1000,
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
                    ? new Date(parsedStartMs + 5 * 3600 * 1000).toISOString()
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
        "4370", // Formula 1
        "4380", // NHL Ice Hockey
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

      // 2. Fetch day schedules
      for (const d of [todayStr, tmwDate, yestDate]) {
        promises.push(
          fetch(`${THESPORTSDB_BASE}/eventsday.php?d=${d}`)
            .then((r) => (r.ok ? r.json() : { events: [] }))
            .catch(() => ({ events: [] }))
        );
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
      const nextData = nextRes.ok ? await nextRes.json() : { events: [] };
      const pastData = pastRes.ok ? await pastRes.json() : { events: [] };

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
      const data = await response.json();
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
        const data = await response.json();
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
      const data = await response.json();
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
            const liveData = await liveRes.json();
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

  // Lookup Fixture Broadcaster by Event / Fixture ID
  app.get("/api/fixture/broadcaster", async (req, res) => {
    try {
      const fixtureId = String(req.query.fixtureId || req.query.id || "").trim();
      if (!fixtureId) {
        return res.status(400).json({ status: "error", error: "fixtureId is required" });
      }

      // Check rapidCache and sportsDbCache first if cached events have broadcaster
      const allCached = [
        ...(rapidCache.matches?.data || []),
        ...(sportsDbCache.events?.data || [])
      ];
      const cachedEv = allCached.find((e: any) =>
        String(e.id) === fixtureId || String(e.rawId) === fixtureId || String(e.idEvent) === fixtureId
      );
      if (cachedEv && (cachedEv.broadcaster || cachedEv.strTVStation)) {
        const rawStation = String(cachedEv.broadcaster || cachedEv.strTVStation).trim();
        if (rawStation) {
          const broadcasters = rawStation
            .split(/[,/|;+&]|\band\b|\bor\b/i)
            .map((s: string) => s.trim())
            .filter(Boolean);
          return res.json({
            status: "success",
            fixtureId,
            broadcaster: rawStation,
            broadcasters,
            source: "Cache"
          });
        }
      }

      // Check TheSportsDB event lookup if fixture is numeric or starts with tsdb-
      const cleanTsdbId = fixtureId.replace(/^tsdb-/, "");
      if (/^\d+$/.test(cleanTsdbId)) {
        const response = await fetch(`${THESPORTSDB_BASE}/lookupevent.php?id=${encodeURIComponent(cleanTsdbId)}`);
        if (response.ok) {
          const data = await response.json();
          const raw = (data.events && data.events[0]) || null;
          if (raw) {
            const rawStation = String(raw.strTVStation || raw.strBroadcaster || raw.strBroadcast || "").trim();
            const broadcasters = rawStation
              ? rawStation.split(/[,/|;+&]|\band\b|\bor\b/i).map((s: string) => s.trim()).filter(Boolean)
              : [];
            if (rawStation) {
              return res.json({
                status: "success",
                fixtureId,
                broadcaster: rawStation,
                broadcasters,
                source: "TheSportsDB"
              });
            }
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
            const mCenter = await mCenterRes.json();
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
                  if (val && typeof val === "string" && val.trim()) {
                    extracted.push(val.trim());
                  }
                }
              }
              if (extracted.length > 0) {
                const uniqueBc = Array.from(new Set(extracted));
                return res.json({
                  status: "success",
                  fixtureId,
                  broadcaster: uniqueBc.join(", "),
                  broadcasters: uniqueBc,
                  source: "Cricbuzz RapidAPI"
                });
              }
            }
          }
        } catch (e: any) {
          console.warn("[Backend Proxy] Cricbuzz broadcaster lookup note:", e.message);
        }
      }

      return res.json({
        status: "not_found",
        fixtureId,
        broadcaster: "",
        broadcasters: []
      });
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

        // Match broadcaster token in channel name or vice versa
        const cleanCh = chName.replace(/\b(hd|fhd|uhd|4k|live|stream|tv|channel|stb)\b/gi, " ").replace(/\s+/g, " ").trim();
        if (cleanCh && (bNorm.includes(cleanCh) || cleanCh.includes(bNorm))) {
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
      // 1. Ingest TheSportsDB events
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

      const fetchHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,bn;q=0.8,hi;q=0.7",
        "Referer": origin + "/",
        "Origin": origin,
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

      // Pass CORS and low-latency streaming headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("X-Accel-Buffering", "no"); // Disables reverse proxy buffering for immediate chunk delivery

      const contentType = targetRes.headers.get("content-type") || "";
      const pathname = targetUrlObj.pathname.toLowerCase();
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
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
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
    res.json({
      status: "ok",
      secure: true,
      rapidApiConfigured: !!RAPIDAPI_KEY,
      cricbuzzConfigured: ENABLE_CRICBUZZ_API && !!RAPIDAPI_KEY,
      cricbuzzPaused: !ENABLE_CRICBUZZ_API,
      cricketDataConfigured: !!CRICKETDATA_API_KEY,
      thesportsdbConfigured: true,
      allSportsApiConfigured: !!ALLSPORTSAPI_KEY,
    });
  });

  // Client configuration status endpoint (Secure, returns flags and public config only)
  app.get("/api/config", (_req, res) => {
    res.json({
      status: "ok",
      rapidApiConfigured: !!RAPIDAPI_KEY,
      cricbuzzConfigured: ENABLE_CRICBUZZ_API && !!RAPIDAPI_KEY,
      cricketDataConfigured: !!CRICKETDATA_API_KEY,
      thesportsdbConfigured: true,
      allSportsApiConfigured: !!ALLSPORTSAPI_KEY,
      thesportsdbKey: THESPORTSDB_KEY === "3" ? "3" : "configured",
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
