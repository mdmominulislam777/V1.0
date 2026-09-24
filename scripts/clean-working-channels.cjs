const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const channelsPath = path.resolve(__dirname, '..', 'channels.json');
const channels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

console.log(`[HealthChecker] Loaded ${channels.length} channels from channels.json`);

// Fast robust URL tester using http/https request with strict socket timeout
function checkUrl(rawUrl, timeoutMs = 3500) {
  return new Promise((resolve) => {
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) {
      return resolve({ ok: false, reason: 'invalid_url' });
    }

    let urlObj;
    try {
      urlObj = new URL(rawUrl.trim());
    } catch (e) {
      return resolve({ ok: false, reason: 'parse_error' });
    }

    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Range': 'bytes=0-512',
        'Connection': 'close'
      },
      timeout: timeoutMs,
      rejectUnauthorized: false
    };

    let finished = false;
    const finish = (result) => {
      if (!finished) {
        finished = true;
        resolve(result);
      }
    };

    const req = client.request(options, (res) => {
      const status = res.statusCode || 0;
      res.destroy(); // We only need headers/status
      
      // 2xx, 3xx are working streams/redirects
      if (status >= 200 && status < 400) {
        return finish({ ok: true, status });
      }

      // 403, 401, 405 on media streams (m3u8/ts) often indicate live OTT token requirements or referer checks which browser/HLS.js handles
      const ct = (res.headers['content-type'] || '').toLowerCase();
      if ((status === 403 || status === 401 || status === 405) &&
          (ct.includes('mpegurl') || ct.includes('video') || ct.includes('octet-stream') || rawUrl.includes('.m3u8') || rawUrl.includes('.ts'))) {
        return finish({ ok: true, status, note: 'cdn_token_restricted' });
      }

      return finish({ ok: false, status });
    });

    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, reason: 'timeout' });
    });

    req.on('error', (err) => {
      req.destroy();
      finish({ ok: false, reason: err.code || err.message });
    });

    req.end();
  });
}

// Pool runner
async function processAllChannels() {
  const CONCURRENCY = 35;
  const cleanedChannels = [];
  let deadChannelsCount = 0;
  let workingChannelsCount = 0;
  let totalStreamsChecked = 0;
  let deadStreamsCount = 0;

  // Cache test results by URL to avoid re-checking duplicate URLs
  const urlCache = new Map();

  async function checkCachedUrl(url) {
    totalStreamsChecked++;
    if (urlCache.has(url)) {
      return urlCache.get(url);
    }
    const res = await checkUrl(url);
    urlCache.set(url, res);
    return res;
  }

  // Work queue
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < channels.length) {
      const idx = currentIndex++;
      const ch = channels[idx];

      // Extract all candidate streams
      let streamList = [];
      if (Array.isArray(ch.streams) && ch.streams.length > 0) {
        streamList = [...ch.streams];
      } else if (ch.streamUrl || ch.url || ch.stream_url) {
        const u = (ch.streamUrl || ch.url || ch.stream_url).trim();
        streamList = [{
          name: `${ch.name} (Server 1 HD)`,
          serverLabel: 'Server 1 HD',
          channelName: ch.name,
          url: u,
          quality: '1080p FHD'
        }];
      }

      if (Array.isArray(ch.backupUrls)) {
        ch.backupUrls.forEach(bUrl => {
          if (bUrl && !streamList.some(s => s.url === bUrl)) {
            streamList.push({
              name: `${ch.name} (Backup Server)`,
              serverLabel: 'Backup Server',
              channelName: ch.name,
              url: bUrl.trim(),
              quality: '720p HD'
            });
          }
        });
      }

      // Check streams for this channel
      const validStreams = [];
      for (const st of streamList) {
        if (!st.url || !st.url.startsWith('http')) {
          deadStreamsCount++;
          continue;
        }
        const result = await checkCachedUrl(st.url);
        if (result.ok) {
          validStreams.push(st);
        } else {
          deadStreamsCount++;
        }
      }

      if (validStreams.length > 0) {
        // Re-label servers
        validStreams.forEach((s, sIdx) => {
          const sNum = sIdx + 1;
          const qTag = s.url.includes('.ts') ? '1080p HD' : (s.quality || '720p HD');
          s.serverLabel = `Server ${sNum} (${qTag})`;
          s.name = `${ch.name} (${s.serverLabel})`;
          s.channelName = ch.name;
        });

        const primaryStream = validStreams[0].url;
        const backupUrls = validStreams.slice(1).map(s => s.url);

        cleanedChannels.push({
          ...ch,
          streamUrl: primaryStream,
          url: primaryStream,
          stream_url: primaryStream,
          streams: validStreams,
          backupUrls: backupUrls,
          active: true
        });
        workingChannelsCount++;
      } else {
        deadChannelsCount++;
      }

      if ((idx + 1) % 50 === 0 || (idx + 1) === channels.length) {
        console.log(`[HealthChecker] Progress: ${idx + 1}/${channels.length} channels checked. Working: ${workingChannelsCount}, Dead/Removed: ${deadChannelsCount}`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\n========================================`);
  console.log(`[HEALTH CHECK COMPLETE]`);
  console.log(`Initial Channels Count: ${channels.length}`);
  console.log(`Working Channels Retained: ${cleanedChannels.length}`);
  console.log(`Non-working Channels Deleted: ${deadChannelsCount}`);
  console.log(`Total Streams Evaluated: ${totalStreamsChecked}`);
  console.log(`Dead Streams Pruned: ${deadStreamsCount}`);
  console.log(`========================================\n`);

  // Save the cleaned channels
  fs.writeFileSync(channelsPath, JSON.stringify(cleanedChannels, null, 2), 'utf8');
  console.log(`[HealthChecker] Saved ${cleanedChannels.length} clean channels to channels.json`);

  // Also write a report summary
  fs.writeFileSync(path.resolve(__dirname, 'cleanup-report.json'), JSON.stringify({
    initialChannels: channels.length,
    workingChannels: cleanedChannels.length,
    deadChannelsRemoved: deadChannelsCount,
    deadStreamsPruned: deadStreamsCount,
    timestamp: new Date().toISOString()
  }, null, 2), 'utf8');
}

processAllChannels().catch(err => {
  console.error('[HealthChecker] Error:', err);
  process.exit(1);
});
