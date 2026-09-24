const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const channelsPath = path.resolve(__dirname, '..', 'channels.json');
const channels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

console.log(`[Inspector] Loaded ${channels.length} channels from channels.json`);

// Let's inspect sample URLs across different categories
const sampleUrls = [];
channels.forEach(ch => {
  const urls = [];
  if (ch.streamUrl) urls.push(ch.streamUrl);
  if (ch.url && !urls.includes(ch.url)) urls.push(ch.url);
  if (Array.isArray(ch.streams)) {
    ch.streams.forEach(s => {
      if (s.url && !urls.includes(s.url)) urls.push(s.url);
    });
  }
  urls.forEach(u => sampleUrls.push({ channelName: ch.name, url: u, category: ch.category }));
});

console.log(`[Inspector] Total stream URLs to test: ${sampleUrls.length}`);

// Test function
async function testUrl(url, timeoutMs = 6000) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return { ok: false, reason: 'invalid_url' };
  
  const cleanUrl = url.trim();
  
  // Use fetch with timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    
    const res = await fetch(cleanUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Range': 'bytes=0-1024',
        'Connection': 'close'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    
    clearTimeout(timer);
    
    if (res.status >= 200 && res.status < 400) {
      return { ok: true, status: res.status };
    }
    
    // Check for IPTV tokenized CDN responses (403, 401, 405) that might still be valid or header protected
    const ct = res.headers.get('content-type') || '';
    if ((res.status === 403 || res.status === 401 || res.status === 405) && 
        (ct.includes('mpegurl') || ct.includes('video') || ct.includes('octet-stream') || cleanUrl.includes('.m3u8') || cleanUrl.includes('.ts'))) {
      return { ok: true, status: res.status, notice: 'header_protected' };
    }
    
    return { ok: false, status: res.status };
  } catch (err) {
    // If fetch failed due to SSL, try http/https module fallback
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

// Concurrency runner
async function runTest() {
  const results = [];
  let checked = 0;
  const BATCH_SIZE = 30;
  
  for (let i = 0; i < sampleUrls.length; i += BATCH_SIZE) {
    const batch = sampleUrls.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async item => {
      const res = await testUrl(item.url);
      return { ...item, ...res };
    }));
    results.push(...batchResults);
    checked += batch.length;
    if (checked % 90 === 0 || checked >= sampleUrls.length) {
      const working = results.filter(r => r.ok).length;
      console.log(`Checked ${checked}/${sampleUrls.length} URLs... Working: ${working}, Dead: ${checked - working}`);
    }
  }
  
  const workingUrls = results.filter(r => r.ok);
  const deadUrls = results.filter(r => !r.ok);
  
  console.log(`\n=== TEST SUMMARY ===`);
  console.log(`Total URLs: ${results.length}`);
  console.log(`Working URLs: ${workingUrls.length}`);
  console.log(`Dead URLs: ${deadUrls.length}`);
  
  // Show breakdown by dead reason
  const reasons = {};
  deadUrls.forEach(d => {
    const k = d.status ? `HTTP ${d.status}` : (d.error || d.reason || 'unknown');
    reasons[k] = (reasons[k] || 0) + 1;
  });
  console.log(`Dead Breakdown:`, reasons);
  
  // Write detailed log
  fs.writeFileSync(path.resolve(__dirname, 'url-test-results.json'), JSON.stringify({
    total: results.length,
    workingCount: workingUrls.length,
    deadCount: deadUrls.length,
    deadSample: deadUrls.slice(0, 20),
    workingSample: workingUrls.slice(0, 20)
  }, null, 2));
}

runTest();
