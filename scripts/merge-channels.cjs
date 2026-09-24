const fs = require('fs');
const path = require('path');

const importedList = require('./imported-channels.cjs');
const channelsPath = path.resolve(__dirname, '..', 'channels.json');
let existingChannels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

// Helper to sanitize name
function cleanChannelName(rawName) {
  let name = rawName || '';
  name = name.replace(/[🍿🔥⚽🎶🌍🎎🤸🥊]/g, '').trim();
  name = name.replace(/\.\.\.\.\.\.\.\.?\d+/g, '').trim(); // e.g. .......82
  name = name.replace(/\(\.\.\.\.\d+/g, '').trim();
  name = name.replace(/\(\d+\)/g, '').trim(); // e.g. (19), (26)
  name = name.replace(/#EXTVLCOPT:.*$/i, '').trim();
  name = name.replace(/^BD\s*\|\s*/i, '').trim();
  name = name.replace(/^IN\s*\|\s*/i, '').trim();
  name = name.replace(/^IN\s*-\s*/i, '').trim();
  name = name.replace(/^US\s*-\s*/i, '').trim();
  name = name.replace(/^EN\s*\|\s*/i, '').trim();
  name = name.replace(/^HINDI\s*-\s*/i, '').trim();
  name = name.replace(/\s+/g, ' ').trim();
  return name;
}

function normalizeKey(str) {
  return str.toLowerCase()
    .replace(/[^\w\d]/g, '')
    .replace(/hd|fhd|sd|4k|tv|live|bangla|hindi|uk|channel/g, '');
}

function getSlug(name) {
  return 'ch-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Helper to determine category & categories array
function mapCategory(rawCat, name) {
  const cat = (rawCat || '').trim();
  const n = name.toLowerCase();

  if (cat.toUpperCase() === 'ISLAM' || cat.toLowerCase() === 'islamic' || n.includes('quran') || n.includes('islam') || n.includes('peace tv') || n.includes('madani') || n.includes('waz') || n.includes('iqra') || n.includes('makkah')) {
    return {
      primary: 'Islamic',
      categories: ['Islamic', 'Bangla', 'LiveTV']
    };
  }

  if (cat.toUpperCase() === 'SPORTS' || n.includes('sports') || n.includes('cricket') || n.includes('football') || n.includes('espn') || n.includes('bein') || n.includes('willow') || n.includes('laliga') || n.includes('dazn')) {
    let sportsArr = [];
    if (n.includes('cricket') || n.includes('cricbuz') || n.includes('willow') || n.includes('fox cricket')) sportsArr.push('Cricket');
    if (n.includes('football') || n.includes('laliga') || n.includes('goal')) sportsArr.push('Football');
    return {
      primary: 'Sports',
      categories: ['Sports', 'LiveTV', ...sportsArr],
      sports: sportsArr
    };
  }

  if (cat.toUpperCase() === 'WWE' || n.includes('ufc') || n.includes('wwe')) {
    return {
      primary: 'Sports',
      categories: ['Sports', 'WWE', 'Combat Sports', 'LiveTV'],
      sports: ['WWE', 'Combat Sports']
    };
  }

  if (cat.toUpperCase() === 'CARTOON' || cat.toLowerCase() === 'kids' || n.includes('cartoon') || n.includes('pogo') || n.includes('nick') || n.includes('disney') || n.includes('hungama') || n.includes('doraemon') || n.includes('motu patlu') || n.includes('tom & jerry') || n.includes('yay')) {
    return {
      primary: 'Kids',
      categories: ['Kids', 'Cartoon', 'LiveTV']
    };
  }

  if (cat.toUpperCase() === 'DISCOVERY' || n.includes('discovery') || n.includes('nat geo') || n.includes('animal planet') || n.includes('travelxp') || n.includes('bbc earth') || n.includes('history tv18') || n.includes('wipeout') || n.includes('fishing')) {
    return {
      primary: 'Discovery',
      categories: ['Discovery', 'Infotainment', 'LiveTV']
    };
  }

  if (cat.includes('Music') || cat.includes('𝐌𝐮𝐬𝐢𝐜') || n.includes('music') || n.includes('9xm') || n.includes('jalwa') || n.includes('tashan') || n.includes('sangeet') || n.includes('zoom') || n.includes('vevo') || n.includes('ary music') || n.includes('beats')) {
    return {
      primary: 'Music',
      categories: ['Music', 'LiveTV', 'Entertainment']
    };
  }

  if (cat.toUpperCase() === 'MOVIE' || n.includes('movies') || n.includes('cinema') || n.includes('goldmines') || n.includes('hbo') || n.includes('star gold') || n.includes('sony max') || n.includes('sony pix') || n.includes('cineplex') || n.includes('miniplex') || n.includes('pictures') || n.includes('pal') || n.includes('wah') || n.includes('b4u') || n.includes('lionsgate') || n.includes('rongeen') || n.includes('rakuten')) {
    return {
      primary: 'Movie',
      categories: ['Movie', 'Entertainment', 'LiveTV']
    };
  }

  // Default Bangladesh / Bangla
  return {
    primary: 'Bangla',
    categories: ['Bangla', 'LiveTV', 'Entertainment', 'News']
  };
}

let addedCount = 0;
let mergedCount = 0;

// Process each imported item
importedList.forEach(item => {
  const cleanName = cleanChannelName(item.name);
  const streamUrl = (item.streamUrl || '').replace(/[🍿🔥⚽🎶🌍🎎🤸🥊]/g, '').trim();
  const logo = (item.logo || '').replace(/[🍿🔥⚽🎶🌍🎎🤸🥊]/g, '').trim();
  if (!streamUrl) return;

  const catInfo = mapCategory(item.category, cleanName);
  const normKey = normalizeKey(cleanName);

  // Find if matching channel exists
  let match = existingChannels.find(ch => {
    if (normalizeKey(ch.name) === normKey && normKey.length > 2) return true;
    if (cleanName.toLowerCase() === ch.name.toLowerCase()) return true;
    return false;
  });

  if (match) {
    // Channel exists! Merge new stream into it as Server X
    if (!Array.isArray(match.streams)) {
      match.streams = [
        {
          name: `${match.name} (Server 1 HD)`,
          serverLabel: 'Server 1 HD',
          channelName: match.name,
          url: match.streamUrl || match.url,
          quality: '1080p FHD'
        }
      ];
    }

    // Check if this stream URL already exists in streams
    const alreadyHasUrl = match.streams.some(s => s.url === streamUrl) || match.streamUrl === streamUrl;
    if (!alreadyHasUrl) {
      const sNum = match.streams.length + 1;
      const label = `Server ${sNum} ${streamUrl.includes('.ts') ? 'HD' : streamUrl.includes('720') ? '720p' : 'FHD'}`;
      match.streams.push({
        name: `${match.name} (${label})`,
        serverLabel: label,
        channelName: match.name,
        url: streamUrl,
        quality: streamUrl.includes('.ts') ? '1080p FHD' : '720p HD'
      });

      if (!Array.isArray(match.backupUrls)) match.backupUrls = [];
      if (!match.backupUrls.includes(streamUrl)) {
        match.backupUrls.push(streamUrl);
      }
      mergedCount++;
    }

    // Merge categories
    if (!Array.isArray(match.categories)) match.categories = [match.category || 'Bangla'];
    catInfo.categories.forEach(c => {
      if (!match.categories.includes(c)) match.categories.push(c);
    });
    if (catInfo.sports && Array.isArray(catInfo.sports)) {
      if (!Array.isArray(match.sports)) match.sports = [];
      catInfo.sports.forEach(s => {
        if (!match.sports.includes(s)) match.sports.push(s);
      });
    }
    match.active = true;
    if (!match.logo && logo) match.logo = logo;
  } else {
    // Create new channel
    let newId = getSlug(cleanName);
    let counter = 1;
    while (existingChannels.some(ch => ch.id === newId)) {
      newId = `${getSlug(cleanName)}-${counter++}`;
    }

    const newChannel = {
      id: newId,
      name: cleanName,
      category: catInfo.primary,
      categories: catInfo.categories,
      sports: catInfo.sports || [],
      priority: 5,
      active: true,
      provider: 'Standard',
      isAkashGo: false,
      logo: logo || './assets/channel-logos/default.png',
      url: streamUrl,
      streamUrl: streamUrl,
      stream_url: streamUrl,
      streams: [
        {
          name: `${cleanName} (Server 1 HD)`,
          serverLabel: 'Server 1 HD',
          channelName: cleanName,
          url: streamUrl,
          quality: '1080p FHD'
        }
      ],
      backupUrls: [],
      isLive: true,
      isHD: true
    };

    existingChannels.push(newChannel);
    addedCount++;
  }
});

fs.writeFileSync(channelsPath, JSON.stringify(existingChannels, null, 2), 'utf8');
console.log(`[Import Success] Added ${addedCount} new channels, merged ${mergedCount} streams into existing channels. Total channels now: ${existingChannels.length}`);
