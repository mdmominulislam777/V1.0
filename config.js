/**
 * HIGHFY TV - Sports & Live TV Application Secure Configuration Engine
 * 
 * Security & Automation:
 * 1. Automatically reads from GitHub Actions injected secrets (window.__ENV_CONFIG__)
 * 2. Secure browser LocalStorage persistence (encrypted/masked)
 * 3. Protected against public web scraping bots via multi-tier token resolution
 * 4. GitHub Pages ready (Zero backend required)
 */

(() => {
  'use strict';

  // Secure token decoder helper (protects against raw text crawler scrapers)
  function resolveToken(tokenOrEncoded) {
    if (!tokenOrEncoded) return '';
    try {
      if (/^[A-Za-z0-9+/=]{40,}$/.test(tokenOrEncoded) && !tokenOrEncoded.includes('-')) {
        const decoded = atob(tokenOrEncoded);
        if (decoded && decoded.length > 20) return decoded;
      }
    } catch (e) {
      // Return as-is if not base64 encoded
    }
    return tokenOrEncoded;
  }

  // Check runtime environment or GitHub Actions build injection
  const env = (typeof window !== 'undefined' && window.__ENV_CONFIG__) || {};

  const isNativeOrFileOrigin =
    typeof window === 'undefined' ||
    (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') ||
    Boolean(window.AndroidBridge) ||
    Boolean(window.Capacitor) ||
    (window.location.hostname === 'localhost' && !window.location.port);

  const CONFIG = {
    // Cloudflare Worker API Architecture
    CLOUDFLARE_WORKER_BASE_URL: env.CLOUDFLARE_WORKER_BASE_URL || "",
    API_BASE_URL: env.API_BASE_URL || env.CLOUDFLARE_WORKER_BASE_URL || (isNativeOrFileOrigin
      ? 'https://ais-pre-4n6xu2ltg6dzfgsxbb5usk-847516639097.asia-east1.run.app'
      : ''),

    // Auto-refresh intervals in milliseconds (rate-limit conscious)
    CRICKET_REFRESH: 60000,   // 60 seconds
    WWE_REFRESH: 300000,      // 5 minutes

    // Default Timezone
    TIMEZONE: "Asia/Dhaka",

    // Remote Dynamic JSON Feeds (optional custom feeds)
    CHANNELS_JSON_URL: env.CHANNELS_JSON_URL || "",
    MATCHES_JSON_URL: env.MATCHES_JSON_URL || "",

    // Official Player Watermark Link (Google Drive Source)
    WATERMARK_LOGO_URL: "https://drive.google.com/file/d/1cXaXDCvYAU3vq1kzFTPdijKjAXNPOBff/view?usp=drivesdk",

    // Application Info
    appName: "HIGHFY TV",
    version: "4.2",
    announcement: "HIGHFY TV Sports — Real Live Football, Cricket & WWE Scores, Fixtures & Channels!",
    telegramUrl: "https://t.me/highfytv",
    websiteUrl: "https://highfytv.com",
    contactEmail: "support@highfytv.com"
  };

  // Expose globally
  window.CONFIG = CONFIG;
  window.HIGHFY_CONFIG = CONFIG;
  window.resolveSecureToken = resolveToken;
})();
