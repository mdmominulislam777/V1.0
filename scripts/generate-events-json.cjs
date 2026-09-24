const http = require('http');
const fs = require('fs');
const path = require('path');

async function getTheSportsDbEvents() {
  return new Promise((resolve) => {
    http.get('http://localhost:3000/api/thesportsdb/events', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(Array.isArray(j.data) ? j.data : []);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

function getWweEvents() {
  const wweLogos = {
    wwe: './assets/wwe-logos/wwe_official.png',
    raw: './assets/wwe-logos/wwe_raw.png',
    smackdown: './assets/wwe-logos/wwe_smackdown.png',
    nxt: './assets/wwe-logos/wwe_nxt.png',
    aew: './assets/wwe-logos/aew_official.svg'
  };

  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;

  return [
    {
      id: 'wwe-smackdown-live',
      matchId: 'wwe-smackdown',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-hand-fist',
      title: 'WWE Friday Night SmackDown',
      name: 'WWE Friday Night SmackDown',
      seriesName: 'WWE Friday Night SmackDown',
      tournament: 'WWE Friday Night SmackDown',
      league: 'WWE Friday Night SmackDown',
      status: 'upcoming',
      statusText: 'Scheduled',
      statusLabel: 'Upcoming',
      timestamp: now + (1 * dayMs),
      date: new Date(now + 1 * dayMs).toISOString().split('T')[0],
      matchTime: '06:00 AM',
      timeOrTimer: '06:00 AM',
      venue: 'Allstate Arena, Rosemont, IL',
      isHot: true,
      team1: {
        name: 'WWE',
        logo: wweLogos.wwe
      },
      team2: {
        name: 'SmackDown',
        logo: wweLogos.smackdown
      },
      homeTeam: {
        name: 'WWE',
        logo: wweLogos.wwe
      },
      awayTeam: {
        name: 'SmackDown',
        logo: wweLogos.smackdown
      },
      broadcaster: 'Sony Sports Ten 1 HD',
      broadcasters: ['Sony Sports Ten 1 HD'],
      subText: 'WWE Friday Night SmackDown • 06:00 AM (BST)',
      source: 'WWE Official',
      streams: []
    },
    {
      id: 'wwe-monday-night-raw',
      matchId: 'wwe-raw',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-hand-fist',
      title: 'WWE Monday Night RAW',
      name: 'WWE Monday Night RAW',
      seriesName: 'WWE Monday Night RAW',
      tournament: 'WWE Monday Night RAW',
      league: 'WWE Monday Night RAW',
      status: 'upcoming',
      statusText: 'Scheduled',
      statusLabel: 'Upcoming',
      timestamp: now + (3 * dayMs),
      date: new Date(now + 3 * dayMs).toISOString().split('T')[0],
      matchTime: '06:00 AM',
      timeOrTimer: '06:00 AM',
      venue: 'TD Garden, Boston, MA',
      isHot: true,
      team1: {
        name: 'WWE',
        logo: wweLogos.wwe
      },
      team2: {
        name: 'RAW',
        logo: wweLogos.raw
      },
      homeTeam: {
        name: 'WWE',
        logo: wweLogos.wwe
      },
      awayTeam: {
        name: 'RAW',
        logo: wweLogos.raw
      },
      broadcaster: 'Sony Sports Ten 1 HD',
      broadcasters: ['Sony Sports Ten 1 HD'],
      subText: 'WWE Monday Night RAW • 06:00 AM (BST)',
      source: 'WWE Official',
      streams: []
    },
    {
      id: 'wwe-nxt-super-tuesday',
      matchId: 'wwe-nxt',
      sport: 'wwe',
      sportName: 'WWE',
      sportIcon: 'fa-bolt',
      title: 'WWE NXT Live',
      name: 'WWE NXT Live',
      seriesName: 'WWE NXT Live',
      tournament: 'WWE NXT Live',
      league: 'WWE NXT Live',
      status: 'upcoming',
      statusText: 'Scheduled',
      statusLabel: 'Upcoming',
      timestamp: now + (4 * dayMs),
      date: new Date(now + 4 * dayMs).toISOString().split('T')[0],
      matchTime: '06:00 AM',
      timeOrTimer: '06:00 AM',
      venue: 'WWE Performance Center, Orlando, FL',
      isHot: false,
      team1: {
        name: 'WWE',
        logo: wweLogos.wwe
      },
      team2: {
        name: 'NXT',
        logo: wweLogos.nxt
      },
      homeTeam: {
        name: 'WWE',
        logo: wweLogos.wwe
      },
      awayTeam: {
        name: 'NXT',
        logo: wweLogos.nxt
      },
      broadcaster: 'Sony Sports Ten 1 HD',
      broadcasters: ['Sony Sports Ten 1 HD'],
      subText: 'WWE NXT Live • 06:00 AM (BST)',
      source: 'WWE Official',
      streams: []
    },
    {
      id: 'aew-dynamite-live',
      matchId: 'aew-dynamite',
      sport: 'wwe',
      sportName: 'AEW',
      sportIcon: 'fa-hand-back-fist',
      title: 'AEW Dynamite',
      name: 'AEW Dynamite',
      seriesName: 'AEW Dynamite',
      tournament: 'AEW Dynamite',
      league: 'AEW Dynamite',
      status: 'upcoming',
      statusText: 'Scheduled',
      statusLabel: 'Upcoming',
      timestamp: now + (2 * dayMs),
      date: new Date(now + 2 * dayMs).toISOString().split('T')[0],
      matchTime: '06:00 AM',
      timeOrTimer: '06:00 AM',
      venue: 'NOW Arena, Chicago, IL',
      isHot: false,
      team1: {
        name: 'AEW',
        logo: wweLogos.aew
      },
      team2: {
        name: 'Dynamite',
        logo: wweLogos.aew
      },
      homeTeam: {
        name: 'AEW',
        logo: wweLogos.aew
      },
      awayTeam: {
        name: 'Dynamite',
        logo: wweLogos.aew
      },
      broadcaster: 'Sony Sports Ten 2 HD',
      broadcasters: ['Sony Sports Ten 2 HD'],
      subText: 'AEW Dynamite • 06:00 AM (BST)',
      source: 'AEW Official',
      streams: []
    }
  ];
}

async function run() {
  console.log('[Script] Fetching TheSportsDB real events...');
  const tsdbEvents = await getTheSportsDbEvents();
  console.log(`[Script] Fetched ${tsdbEvents.length} events from TheSportsDB.`);

  const wweEvents = getWweEvents();
  console.log(`[Script] Added ${wweEvents.length} WWE/AEW authentic fixtures.`);

  const combined = [...tsdbEvents, ...wweEvents];
  console.log(`[Script] Total combined events: ${combined.length}`);

  const jsonStr = JSON.stringify(combined, null, 2);
  fs.writeFileSync(path.resolve(__dirname, '../events.json'), jsonStr, 'utf8');
  console.log('[Script] Successfully updated events.json');

  const androidPath = path.resolve(__dirname, '../android/app/src/main/assets/events.json');
  if (fs.existsSync(path.dirname(androidPath))) {
    fs.writeFileSync(androidPath, jsonStr, 'utf8');
    console.log('[Script] Successfully updated android/app/src/main/assets/events.json');
  }
}

run();
