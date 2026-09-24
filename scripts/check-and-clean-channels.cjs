const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const channelsPath = path.resolve(__dirname, '..', 'channels.json');
const channels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

console.log(`[HealthChecker] Starting channel check on ${channels.length} channels...`);

// Test a single URL
async function testStreamUrl(rawUrl, timeoutMs = 4500) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) {
    return false;
  }

  const cleanUrl = rawUrl.trim();

  // Try with fetch first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Range': 'bytes=0-1024'
    };

    const res = await fetch(cleanUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (res.status >= 200 && res.status < 400) {
      return true;
    }

    // 403 / 405 might still be valid for some CDN tokens or referer protected streams that require player headers
    if (res.status === 403 || res.status === 401 || res.status === 405) {
      // If content-type is video/m3u8/text or domain is standard OTT
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('mpegurl') || ct.includes('video') || ct.includes('octet-stream')) {
        return true;
      }
      return false;
    }

    return false;
  } catch (err) {
    return false;
  }
}

// Concurrency pool helper
async function runWithConcurrency(items, fn, limit = 20) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);

    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

async function main() {
  const testedChannels = [];
  let deadChannelsCount = 0;
  let aliveChannelsCount = 0;
  let deadStreamsFiltered = 0;

  // Process all channels
  await runWithConcurrency(channels, async (ch, idx) => {
    // Gather all streams for this channel
    let streamCandidates = [];
    if (Array.isArray(ch.streams) && ch.streams.length > 0) {
      streamCandidates = [...ch.streams];
    } else if (ch.streamUrl || ch.url || ch.stream_url) {
      streamCandidates = [{
        name: `${ch.name} (Server 1 HD)`,
        serverLabel: 'Server 1 HD',
        channelName: ch.name,
        url: ch.streamUrl || ch.url || ch.stream_url,
        quality: '1080p FHD'
      }];
    }

    // Also include backupUrls
    if (Array.isArray(ch.backupUrls)) {
      ch.backupUrls.forEach(bUrl => {
        if (!streamCandidates.some(s => s.url === bUrl)) {
          streamCandidates.push({
            name: `${ch.name} (Backup Server)`,
            serverLabel: 'Backup Server',
            channelName: ch.name,
            url: bUrl,
            quality: '720p HD'
          });
        }
      });
    }

    // Test each stream candidate
    const workingStreams = [];
    for (const st of streamCandidates) {
      const isWorking = await testStreamUrl(st.url);
      if (isWorking) {
        workingStreams.push(st);
      } else {
        deadStreamsFiltered++;
      }
    }

    if (workingStreams.length > 0) {
      // Re-index server labels
      workingStreams.forEach((ws, sIdx) => {
        const sNum = sIdx + 1;
        const qTag = ws.url.includes('.ts') ? '1080p HD' : '720p HD';
        ws.serverLabel = `Server ${sNum} ${qTag}`;
        ws.name = `${ch.name} (${ws.serverLabel})`;
      });

      const primaryUrl = workingStreams[0].url;
      const backupUrls = workingStreams.slice(1).map(s => s.url);

      testedChannels.push({
        ...ch,
        streamUrl: primaryUrl,
        url: primaryUrl,
        stream_url: primaryUrl,
        streams: workingStreams,
        backupUrls: backupUrls,
        active: true
      });
      aliveChannelsCount++;
    } else {
      deadChannelsCount++;
    }
  }, 25);

  console.log(`\n========================================`);
  console.log(`[HealthChecker Results]`);
  console.log(`Total Initial Channels: ${channels.length}`);
  console.log(`Active & Working Channels Retained: ${aliveChannelsCount}`);
  console.log(`Dead/Unreachable Channels Removed: ${deadChannelsCount}`);
  console.log(`Broken Server Streams Filtered: ${deadStreamsFiltered}`);
  console.log(`========================================\n`);

  fs.writeFileSync(channelsPath, JSON.stringify(testedChannels, null, 2), 'utf8');
}

main().catch(err => {
  console.error('[HealthChecker] Fatal error:', err);
  process.exit(1);
});
