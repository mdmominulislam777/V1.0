const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// Load sources
const rawChannels = JSON.parse(fs.readFileSync(path.join(rootDir, 'channels.json'), 'utf8'));
const sportsWorking = JSON.parse(fs.readFileSync(path.join(__dirname, 'sports_working.json'), 'utf8'));
const ayanaWorking = JSON.parse(fs.readFileSync(path.join(__dirname, 'ayana_working_channels.json'), 'utf8'));
const nonAyanaWorking = JSON.parse(fs.readFileSync(path.join(__dirname, 'non_ayana_final_live.json'), 'utf8'));
const jioWorking = fs.existsSync(path.join(__dirname, 'jio_verified_live.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'jio_verified_live.json'), 'utf8')) : [];

console.log(`Sources: rawChannels=${rawChannels.length}, sports=${sportsWorking.length}, ayana=${ayanaWorking.length}, nonAyana=${nonAyanaWorking.length}, jio=${jioWorking.length}`);

// Canonical list of popular channels to build
const channelCatalog = [
  // --- SPORTS CHANNELS (ALL PRESERVED) ---
  {
    id: 'ch-tapmad-sports',
    name: 'Tapmad Sports HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Cricket', 'Football', 'WWE', 'Tennis', 'Motorsport'],
    logo: 'https://www.tapmad.com/images/tapmad_logo.png',
    priority: 1,
    lookup: ['tapmad sports']
  },
  {
    id: 'ch-t-sports-hd',
    name: 'T Sports HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Bangla'],
    sports: ['Cricket', 'Football', 'Badminton'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-13/images_8b38d691dfaf072e6c964dea814a44ba_playmist_t_sports_hd400x400.jpg',
    priority: 1,
    lookup: ['t sports', 't sports hd']
  },
  {
    id: 'ch-star-sports-1-hd',
    name: 'Star Sports 1 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Star Sports'],
    sports: ['Cricket', 'Football', 'Tennis', 'Kabaddi'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-1-in.png',
    priority: 1,
    lookup: ['star sports 1 hd', 'star sports 1']
  },
  {
    id: 'ch-star-sports-1-hindi',
    name: 'Star Sports 1 Hindi HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Star Sports'],
    sports: ['Cricket', 'Kabaddi'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-1-hindi-in.png',
    priority: 1,
    lookup: ['star sports 1 hindi', 'star sports 1 hindi hd']
  },
  {
    id: 'ch-star-sports-2',
    name: 'Star Sports 2 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Star Sports'],
    sports: ['Cricket', 'Football', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-2-in.png',
    priority: 2,
    lookup: ['star sports 2']
  },
  {
    id: 'ch-star-sports-3',
    name: 'Star Sports 3 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Star Sports'],
    sports: ['Cricket', 'Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-3-in.png',
    priority: 2,
    lookup: ['star sports 3']
  },
  {
    id: 'ch-sony-sports-ten-1-hd',
    name: 'Sony Sports Ten 1 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sony Sports', 'WWE'],
    sports: ['WWE', 'Football', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-1-in.png',
    priority: 1,
    lookup: ['sony ten 1', 'sony sports ten 1', 'ten 1']
  },
  {
    id: 'ch-sony-sports-ten-2-hd',
    name: 'Sony Sports Ten 2 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sony Sports', 'WWE'],
    sports: ['Football', 'WWE'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-2-in.png',
    priority: 1,
    lookup: ['sony ten 2', 'sony sports ten 2', 'ten 2', 'sony sports 2']
  },
  {
    id: 'ch-sony-sports-ten-3',
    name: 'Sony Sports Ten 3 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sony Sports', 'WWE'],
    sports: ['Cricket', 'WWE', 'Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-3-in.png',
    priority: 1,
    lookup: ['sony ten 3', 'sony sports ten 3', 'ten 3']
  },
  {
    id: 'ch-sony-sports-ten-4',
    name: 'Sony Sports Ten 4 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sony Sports', 'WWE'],
    sports: ['Cricket', 'WWE'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-4-in.png',
    priority: 2,
    lookup: ['sony ten 4', 'sony sports ten 4']
  },
  {
    id: 'ch-sony-sports-ten-5-hd',
    name: 'Sony Sports Ten 5 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sony Sports', 'WWE'],
    sports: ['Football', 'Tennis', 'WWE'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-5-in.png',
    priority: 1,
    lookup: ['sony ten 5', 'sony sports ten 5', 'sony six']
  },
  {
    id: 'ch-ten-sports-hd',
    name: 'Ten Sports HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Pakistan'],
    sports: ['Cricket', 'Football'],
    logo: 'https://jiotv.catchup.cdn.jio.com/dare_images/images/Ten_HD.png',
    priority: 1,
    lookup: ['ten sports', 'ten sports hd', 'ten sports pk']
  },
  {
    id: 'ch-ptv-sports-hd',
    name: 'PTV Sports HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Pakistan'],
    sports: ['Cricket', 'Football', 'Hockey'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/PTV_Sports_Logo.svg/250px-PTV_Sports_Logo.svg.png',
    priority: 1,
    lookup: ['ptv sports', 'ptv sports hd']
  },
  {
    id: 'ch-willow-hd',
    name: 'Willow HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Cricket'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/1/10/Willow_Cricket_logo.png',
    priority: 1,
    lookup: ['willow', 'willow hd', 'willow cricket']
  },
  {
    id: 'ch-willow-xtra',
    name: 'Willow Xtra',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Cricket'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/1/10/Willow_Cricket_logo.png',
    priority: 2,
    lookup: ['willow xtra']
  },
  {
    id: 'ch-bein-sports-1-hd',
    name: 'beIN Sports 1 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'beIN Sports'],
    sports: ['Football', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-1-mea.png',
    priority: 1,
    lookup: ['bein sports 1', 'bein sports 1 hd']
  },
  {
    id: 'ch-bein-sports-2',
    name: 'beIN Sports 2 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'beIN Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-2-mea.png',
    priority: 1,
    lookup: ['bein sports 2', 'bein sports 2 hd']
  },
  {
    id: 'ch-bein-sports-3-hd',
    name: 'beIN Sports 3 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'beIN Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-3-mea.png',
    priority: 2,
    lookup: ['bein sports 3', 'bein sports 3 hd']
  },
  {
    id: 'ch-bein-sports-4-hd',
    name: 'beIN Sports 4 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'beIN Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-4-mea.png',
    priority: 2,
    lookup: ['bein sports 4', 'bein sports 4 hd']
  },
  {
    id: 'ch-bein-sports-5-hd',
    name: 'beIN Sports 5 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'beIN Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-5-mea.png',
    priority: 2,
    lookup: ['bein sports 5', 'bein sports 5 hd']
  },
  {
    id: 'ch-bein-sports-xtra',
    name: 'beIN Sports XTRA',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'beIN Sports'],
    sports: ['Football', 'Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/bein-sports-xtra-us.png',
    priority: 2,
    lookup: ['bein sports xtra', 'bein xtra']
  },
  {
    id: 'ch-sky-sports-epl',
    name: 'Sky Sports Premier League HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-premier-league-uk.png',
    priority: 1,
    lookup: ['sky sports premier league', 'sky sports premier league hd']
  },
  {
    id: 'ch-sky-sports-football',
    name: 'Sky Sports Football HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-football-uk.png',
    priority: 1,
    lookup: ['sky sports football', 'sky sports football hd']
  },
  {
    id: 'ch-sky-sports-cricket',
    name: 'Sky Sports Cricket HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Cricket'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-cricket-uk.png',
    priority: 1,
    lookup: ['sky sports cricket', 'sky sports cricket hd']
  },
  {
    id: 'ch-sky-sports-f1-hd',
    name: 'Sky Sports F1 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Motorsport', 'Formula 1'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-f1-uk.png',
    priority: 1,
    lookup: ['sky sports f1', 'sky sports f1 hd']
  },
  {
    id: 'ch-sky-sports-racing',
    name: 'Sky Sports Racing HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Motorsport', 'Racing'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-racing-uk.png',
    priority: 2,
    lookup: ['sky sports racing', 'sky sports racing hd']
  },
  {
    id: 'ch-sky-sport-top-event',
    name: 'Sky Sport Top Event',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Football', 'Motorsport', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/sky-sport-top-event-de.png',
    priority: 2,
    lookup: ['sky sport top event']
  },
  {
    id: 'ch-sky-sport-bundesliga',
    name: 'Sky Sport Bundesliga',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/sky-sport-bundesliga-1-de.png',
    priority: 2,
    lookup: ['sky sport bundesliga']
  },
  {
    id: 'ch-sky-sport-uno',
    name: 'Sky Sport Uno',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Sky Sports'],
    sports: ['Football', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/italy/sky-sport-uno-it.png',
    priority: 2,
    lookup: ['sky sport uno']
  },
  {
    id: 'ch-tnt-sports-1',
    name: 'TNT Sports 1',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'TNT Sports'],
    sports: ['Football', 'Rugby', 'Combat'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-1-uk.png',
    priority: 1,
    lookup: ['tnt sports 1', 'tnt 1']
  },
  {
    id: 'ch-tnt-sports-2',
    name: 'TNT Sports 2',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'TNT Sports'],
    sports: ['Football', 'Rugby'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-2-uk.png',
    priority: 1,
    lookup: ['tnt sports 2', 'tnt 2']
  },
  {
    id: 'ch-tnt-sports-3',
    name: 'TNT Sports 3',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'TNT Sports'],
    sports: ['Football', 'Basketball'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-3-uk.png',
    priority: 2,
    lookup: ['tnt sports 3', 'tnt 3']
  },
  {
    id: 'ch-tnt-sports-4',
    name: 'TNT Sports 4',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'TNT Sports'],
    sports: ['Football', 'Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-4-uk.png',
    priority: 2,
    lookup: ['tnt sports 4', 'tnt 4']
  },
  {
    id: 'ch-eurosport-1',
    name: 'Eurosport 1 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Tennis', 'Cycling', 'Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/eurosport-1-uk.png',
    priority: 1,
    lookup: ['eurosport 1', 'eurosport 1 hd', 'eurosport hd']
  },
  {
    id: 'ch-eurosport-2',
    name: 'Eurosport 2 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Tennis', 'Motorsport', 'Winter Sports'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/eurosport-2-uk.png',
    priority: 1,
    lookup: ['eurosport 2', 'eurosport 2 hd']
  },
  {
    id: 'ch-dazn-1',
    name: 'DAZN 1 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'DAZN'],
    sports: ['Football', 'Boxing'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/dazn1-uk.png',
    priority: 1,
    lookup: ['dazn 1', 'dazn 1 hd']
  },
  {
    id: 'ch-dazn-2',
    name: 'DAZN 2 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'DAZN'],
    sports: ['Football', 'Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-2-es.png',
    priority: 1,
    lookup: ['dazn 2', 'dazn 2 hd']
  },
  {
    id: 'ch-dazn-3',
    name: 'DAZN 3 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'DAZN'],
    sports: ['Football', 'Basketball'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-3-es.png',
    priority: 2,
    lookup: ['dazn 3']
  },
  {
    id: 'ch-dazn-4',
    name: 'DAZN 4 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'DAZN'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-4-es.png',
    priority: 2,
    lookup: ['dazn 4']
  },
  {
    id: 'ch-dazn-5',
    name: 'DAZN 5 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'DAZN'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-es.png',
    priority: 2,
    lookup: ['dazn 5']
  },
  {
    id: 'ch-dazn-laliga',
    name: 'DAZN LaLiga HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'DAZN'],
    sports: ['Football', 'La Liga'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-laliga-es.png',
    priority: 1,
    lookup: ['dazn laliga']
  },
  {
    id: 'ch-supersport-grandstand',
    name: 'SuperSport Grandstand',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Cricket', 'Football', 'Rugby'],
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/7/70/SuperSport_logo.svg/250px-SuperSport_logo.svg.png',
    priority: 1,
    lookup: ['supersport grandstand']
  },
  {
    id: 'ch-supersport-tennis',
    name: 'SuperSport Tennis',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Tennis'],
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/7/70/SuperSport_logo.svg/250px-SuperSport_logo.svg.png',
    priority: 2,
    lookup: ['supersport tennis']
  },
  {
    id: 'ch-dd-sports',
    name: 'DD Sports',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'India'],
    sports: ['Cricket', 'Hockey', 'Olympic Sports'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/dd-sports-in.png',
    priority: 2,
    lookup: ['dd sports']
  },
  {
    id: 'ch-ziggo-sport-1',
    name: 'Ziggo Sport 1',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/netherlands/ziggo-sport-nl.png',
    priority: 2,
    lookup: ['ziggo sport 1', 'ziggo sport']
  },
  {
    id: 'ch-ziggo-sport-2',
    name: 'Ziggo Sport Select HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/netherlands/ziggo-sport-select-nl.png',
    priority: 2,
    lookup: ['ziggo sport 2', 'ziggo sport select']
  },
  {
    id: 'ch-ziggo-sport-3',
    name: 'Ziggo Sport Voetbal HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/netherlands/ziggo-sport-voetbal-nl.png',
    priority: 2,
    lookup: ['ziggo sport 3', 'ziggo sport voetbal']
  },
  {
    id: 'ch-go3-sport-1-hd',
    name: 'Go3 Sport 1 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Basketball'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/lithuania/go3-sport-1-lt.png',
    priority: 2,
    lookup: ['go3 sport 1']
  },
  {
    id: 'ch-go3-sport-2-hd',
    name: 'Go3 Sport 2 HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/lithuania/go3-sport-2-lt.png',
    priority: 2,
    lookup: ['go3 sport 2']
  },
  {
    id: 'ch-ufc-tv',
    name: 'UFC TV',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Combat'],
    sports: ['MMA', 'Combat'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/ufc-us.png',
    priority: 1,
    lookup: ['ufc tv', 'ufc']
  },
  {
    id: 'ch-astro-cricbuz',
    name: 'Astro Cricket HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Cricket'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/malaysia/astro-cricket-my.png',
    priority: 1,
    lookup: ['astro cricket', 'astro cricbuz']
  },
  {
    id: 'ch-motor-vision',
    name: 'Motor Vision',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/motorvision-plus-de.png',
    priority: 2,
    lookup: ['motor vision']
  },
  {
    id: 'ch-pk-sports-hd',
    name: 'Sports HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Cricket', 'Football'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/pakistan/a-sports-pk.png',
    priority: 2,
    lookup: ['pk sports', 'sports hd']
  },
  {
    id: 'ch-stan-sport',
    name: 'Stan Sport',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Rugby', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/stan-sport-au.png',
    priority: 2,
    lookup: ['stan sport']
  },
  {
    id: 'ch-tsn',
    name: 'TSN',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Hockey', 'Basketball'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/canada/tsn1-ca.png',
    priority: 2,
    lookup: ['tsn']
  },
  {
    id: 'ch-fs1',
    name: 'FS1',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Baseball', 'Football', 'Motorsport'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/fox-sports-1-us.png',
    priority: 2,
    lookup: ['fs1']
  },
  {
    id: 'ch-espn2',
    name: 'ESPN2',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Basketball', 'Football', 'Tennis'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/espn-2-us.png',
    priority: 2,
    lookup: ['espn2']
  },
  {
    id: 'ch-sportsnet-one',
    name: 'Sportsnet ONE',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Hockey', 'Baseball'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/canada/sportsnet-one-ca.png',
    priority: 2,
    lookup: ['sportsnet one']
  },
  {
    id: 'ch-mlb-network',
    name: 'MLB Network',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Baseball'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/mlb-network-us.png',
    priority: 2,
    lookup: ['mlb network']
  },
  {
    id: 'ch-nhl-network',
    name: 'NHL Network',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Hockey'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/nhl-network-us.png',
    priority: 2,
    lookup: ['nhl network']
  },
  {
    id: 'ch-gtv',
    name: 'GTV HD',
    category: 'Sports',
    categories: ['LiveTV', 'Sports', 'Bangla'],
    sports: ['Cricket', 'Football'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/GTV_Bangladesh_Logo.svg/250px-GTV_Bangladesh_Logo.svg.png',
    priority: 1,
    lookup: ['gtv', 'gazi tv']
  },
  {
    id: 'ch-bahrain-sports-1',
    name: 'Bahrain Sports 1',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Motorsport'],
    logo: 'https://s3.aynaott.com/storage/0ec8d8b83b191cf915316a1751c8787e',
    priority: 2,
    lookup: ['bahrain sports 1']
  },
  {
    id: 'ch-fifa-plus',
    name: 'FIFA+',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-06-24/bcc9699c8a3c8faf509c92e9280e576f.jpg',
    priority: 2,
    lookup: ['fifa+']
  },
  {
    id: 'ch-ktv-sport-plus',
    name: 'KTV Sport Plus',
    category: 'Sports',
    categories: ['LiveTV', 'Sports'],
    sports: ['Football', 'Basketball'],
    logo: 'https://s3.aynaott.com/storage/44c0d062e5dda8b8a4f2e9933165cd91',
    priority: 2,
    lookup: ['ktv sport plus']
  },

  // --- BANGLA & KOLKATA CHANNELS (POPULAR) ---
  {
    id: 'ch-btv',
    name: 'BTV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4f/BTV_NEWS_Logo_-_Bangladesh_Television.png',
    priority: 1,
    lookup: ['btv', 'bangladesh television']
  },
  {
    id: 'ch-ntv',
    name: 'NTV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_3a9e612cb34891b7da7adab631627f7a_playmist_ntv400x400.jpg',
    priority: 1,
    lookup: ['ntv', 'ntv (720p)', 'ntv bangladesh']
  },
  {
    id: 'ch-rtv',
    name: 'RTV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_4df93b0dfb2210852084c7d0d0f77ea6_playmist_rtv400x400.jpg',
    priority: 1,
    lookup: ['rtv', 'rtv bangladesh']
  },
  {
    id: 'ch-channel-i',
    name: 'Channel i',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_8d06b539958742b87eeb4a5e3aa4a54d_playmist_channel_i400x400.jpg',
    priority: 1,
    lookup: ['channel i']
  },
  {
    id: 'ch-maasranga-tv-hd',
    name: 'Maasranga TV HD',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://static.wikia.nocookie.net/etv-gspn-bangla/images/a/a3/Maasranga_TV_HD_logo.png',
    priority: 1,
    lookup: ['maasranga tv', 'maasranga tv hd', 'maasranga']
  },
  {
    id: 'ch-deepto-tv',
    name: 'Deepto TV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_ec0b7593c72635fe66b8d2524a87ad95_playmist_deepto400x400.jpg',
    priority: 1,
    lookup: ['deepto tv', 'deepto']
  },
  {
    id: 'ch-banglavision',
    name: 'BanglaVision',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_944d1891ce5cb38965f72cf93b0a701b_playmist_banglavision400x400.jpg',
    priority: 1,
    lookup: ['bangla vision', 'banglavision']
  },
  {
    id: 'ch-atn-bangla',
    name: 'ATN Bangla',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/9/91/ATN_Bangla.png',
    priority: 1,
    lookup: ['atn bangla']
  },
  {
    id: 'ch-atn-news',
    name: 'ATN News',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'News'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_e4b47eb68ec5d996ff52a97576a40a23_playmist_atn_news400x400.jpg',
    priority: 1,
    lookup: ['atn news']
  },
  {
    id: 'ch-somoy-tv',
    name: 'Somoy TV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'News'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_da61f516ea2d87e07ca46c0757dbbfdc_playmist_somoy_tv400x400.jpg',
    priority: 1,
    lookup: ['somoy tv', 'somoy']
  },
  {
    id: 'ch-jamuna-tv',
    name: 'Jamuna TV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'News'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/f/fe/Jamuna_TV_logo.svg',
    priority: 1,
    lookup: ['jamuna tv', 'jamuna']
  },
  {
    id: 'ch-channel-24',
    name: 'Channel 24',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'News'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/9/91/Channel24logo.svg',
    priority: 1,
    lookup: ['channel 24']
  },
  {
    id: 'ch-dbc-news',
    name: 'DBC News',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'News'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/9/9f/DBC_News_logo.png',
    priority: 1,
    lookup: ['dbc news', 'dbc']
  },
  {
    id: 'ch-ekattor-tv',
    name: 'Ekattor TV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'News'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_a3f2db7bb28e51b3a1a63c6314f828a2_playmist_ekattor400x400.jpg',
    priority: 1,
    lookup: ['ekattor tv', 'ekattor']
  },
  {
    id: 'ch-boishakhi-tv',
    name: 'Boishakhi TV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/f/f2/Boishakhi_Tv_Logo.png',
    priority: 2,
    lookup: ['boishakhi tv', 'boishakhi']
  },
  {
    id: 'ch-desh-tv',
    name: 'Desh TV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_192e4abf2766861614e287fa44b6bb08_playmist_desh_tv400x400.jpg',
    priority: 2,
    lookup: ['desh tv']
  },
  {
    id: 'ch-ekhon-tv',
    name: 'Ekhon TV',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'News'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/BTV_logo.svg/250px-BTV_logo.svg.png',
    priority: 2,
    lookup: ['ekhon tv']
  },
  {
    id: 'ch-star-jalsha-hd',
    name: 'Star Jalsha HD',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'Kolkata'],
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ad/Star_Jalsha_logo.svg/250px-Star_Jalsha_logo.svg.png',
    priority: 1,
    lookup: ['star jalsha', 'star jalsha hd']
  },
  {
    id: 'ch-zee-bangla-hd',
    name: 'Zee Bangla HD',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'Kolkata'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zee-bangla-in.png',
    priority: 1,
    lookup: ['zee bangla', 'zee bangla hd']
  },
  {
    id: 'ch-colors-bangla-hd',
    name: 'Colors Bangla HD',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'Kolkata'],
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Colors_Bangla_logo.svg/250px-Colors_Bangla_logo.svg.png',
    priority: 1,
    lookup: ['colors bangla', 'colors bangla hd', 'colors bengali hd']
  },
  {
    id: 'ch-sony-aath',
    name: 'Sony Aath',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'Kolkata'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-aath-in.png',
    priority: 1,
    lookup: ['sony aath']
  },
  {
    id: 'ch-dd-bangla',
    name: 'DD Bangla',
    category: 'Bangla',
    categories: ['LiveTV', 'Bangla', 'Kolkata'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/dd-bangla-in.png',
    priority: 2,
    lookup: ['dd bangla']
  },

  // --- NEWS CHANNELS (POPULAR) ---
  {
    id: 'ch-bbc-news',
    name: 'BBC News',
    category: 'News',
    categories: ['LiveTV', 'News'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/bbc-news-uk.png',
    priority: 1,
    lookup: ['bbc news', 'bbc world news']
  },
  {
    id: 'ch-cnn-us',
    name: 'CNN International',
    category: 'News',
    categories: ['LiveTV', 'News'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/cnn-us.png',
    priority: 1,
    lookup: ['cnn', 'cnn (us)', 'cnn international']
  },
  {
    id: 'ch-al-jazeera',
    name: 'Al Jazeera English',
    category: 'News',
    categories: ['LiveTV', 'News'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/aljazeera-uk.png',
    priority: 1,
    lookup: ['aljazeera news', 'al jazeera english', 'al jazeera']
  },
  {
    id: 'ch-dw-news',
    name: 'DW News',
    category: 'News',
    categories: ['LiveTV', 'News'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/dw-de.png',
    priority: 1,
    lookup: ['dw news', 'dw english']
  },
  {
    id: 'ch-ndtv-english',
    name: 'NDTV 24x7',
    category: 'News',
    categories: ['LiveTV', 'News', 'India'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/ndtv-24x7-in.png',
    priority: 1,
    lookup: ['ndtv english', 'ndtv 24x7', 'ndtv news']
  },
  {
    id: 'ch-ndtv-hindi',
    name: 'NDTV India',
    category: 'News',
    categories: ['LiveTV', 'News', 'India'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/ndtv-india-in.png',
    priority: 1,
    lookup: ['ndtv hindi', 'ndtv india']
  },
  {
    id: 'ch-aaj-tak',
    name: 'Aaj Tak HD',
    category: 'News',
    categories: ['LiveTV', 'News', 'India'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/aaj-tak-in.png',
    priority: 1,
    lookup: ['aaj tak', 'aaj tak hd']
  },
  {
    id: 'ch-india-today',
    name: 'India Today',
    category: 'News',
    categories: ['LiveTV', 'News', 'India'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/india-today-in.png',
    priority: 1,
    lookup: ['india today']
  },
  {
    id: 'ch-trt-world',
    name: 'TRT World',
    category: 'News',
    categories: ['LiveTV', 'News'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/turkey/trt-world-tr.png',
    priority: 2,
    lookup: ['trt world']
  },
  {
    id: 'ch-france-24',
    name: 'France 24 English',
    category: 'News',
    categories: ['LiveTV', 'News'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/france-24-en-fr.png',
    priority: 2,
    lookup: ['france 24 english', 'france news 24']
  },

  // --- KIDS CHANNELS (POPULAR) ---
  {
    id: 'ch-cartoon-network',
    name: 'Cartoon Network',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/cartoon-network-in.png',
    priority: 1,
    lookup: ['cartoon network']
  },
  {
    id: 'ch-nickelodeon',
    name: 'Nickelodeon',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/nick-in.png',
    priority: 1,
    lookup: ['nickelodeon', 'nick', 'nick jr']
  },
  {
    id: 'ch-disney-channel',
    name: 'Disney Channel',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/disney-channel-au.png',
    priority: 1,
    lookup: ['disney channel']
  },
  {
    id: 'ch-pogo',
    name: 'Pogo',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/pogo-in.png',
    priority: 1,
    lookup: ['pogo', 'pogo hindi']
  },
  {
    id: 'ch-sony-yay',
    name: 'Sony YAY!',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-yay-in.png',
    priority: 1,
    lookup: ['sony yay', 'sony yay!']
  },
  {
    id: 'ch-duronto-tv',
    name: 'Duronto TV',
    category: 'Kids',
    categories: ['LiveTV', 'Kids', 'Bangla'],
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/1/1a/Duronto_TV_logo.svg/250px-Duronto_TV_logo.svg.png',
    priority: 1,
    lookup: ['duronto tv', 'duronto']
  },
  {
    id: 'ch-discovery-kids',
    name: 'Discovery Kids',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/discovery-kids-in.png',
    priority: 2,
    lookup: ['discovery kids']
  },
  {
    id: 'ch-bbc-cbeebies',
    name: 'BBC Cbeebies',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/bbc-cbeebies-uk.png',
    priority: 2,
    lookup: ['bbc cbeebies', 'cbeebies']
  },
  {
    id: 'ch-tom-jerry-tv',
    name: 'Tom & Jerry TV',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/cartoon-network-in.png',
    priority: 2,
    lookup: ['tom & jerry tv', 'tom & jarry']
  },
  {
    id: 'ch-motu-patlu',
    name: 'Motu Patlu TV',
    category: 'Kids',
    categories: ['LiveTV', 'Kids'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/nickelodeon-sonic-in.png',
    priority: 2,
    lookup: ['motu patlu']
  },
  {
    id: 'ch-gopal-bhar-tv',
    name: 'Gopal Bhar TV',
    category: 'Kids',
    categories: ['LiveTV', 'Kids', 'Bangla'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-aath-in.png',
    priority: 2,
    lookup: ['gopal bhar tv']
  },

  // --- INFOTAINMENT & DISCOVERY (POPULAR) ---
  {
    id: 'ch-discovery-hd',
    name: 'Discovery Channel HD',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment', 'Discovery'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/discovery-channel-au.png',
    priority: 1,
    lookup: ['discovery', 'discovery hd', 'discovery channel', 'discovery বাংলা/hindi all languages']
  },
  {
    id: 'ch-national-geographic-hd',
    name: 'National Geographic HD',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment', 'Discovery'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/national-geographic-au.png',
    priority: 1,
    lookup: ['national geographic', 'national geographic hd', 'national geographic বাংলা/hindi all languages']
  },
  {
    id: 'ch-nat-geo-wild',
    name: 'Nat Geo Wild',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment', 'Discovery'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/nat-geo-wild-de.png',
    priority: 1,
    lookup: ['nat geo wild', 'national geographic wild']
  },
  {
    id: 'ch-animal-planet-eng',
    name: 'Animal Planet',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment', 'Discovery'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/animal-planet-au.png',
    priority: 1,
    lookup: ['animal planet', 'animal planet eng', 'animal planet hd']
  },
  {
    id: 'ch-history-tv18-hd',
    name: 'History TV18 HD',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/history-tv18-in.png',
    priority: 1,
    lookup: ['history tv18', 'history tv18 hd']
  },
  {
    id: 'ch-sony-bbc-earth',
    name: 'Sony BBC Earth',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-bbc-earth-in.png',
    priority: 1,
    lookup: ['sony bbc earth', 'sony bbc earth hd']
  },
  {
    id: 'ch-discovery-science-hindi',
    name: 'Discovery Science',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment', 'Discovery'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/canada/discovery-science-ca.png',
    priority: 2,
    lookup: ['discovery science', 'discovery science hindi']
  },
  {
    id: 'ch-discovery-turbo',
    name: 'Discovery Turbo',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment', 'Discovery'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/discovery-turbo-au.png',
    priority: 2,
    lookup: ['discovery turbo']
  },
  {
    id: 'ch-tlc',
    name: 'TLC',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/tlc-au.png',
    priority: 2,
    lookup: ['tlc']
  },
  {
    id: 'ch-travel-xp',
    name: 'Travel XP',
    category: 'Infotainment',
    categories: ['LiveTV', 'Infotainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/travel-xp-in.png',
    priority: 2,
    lookup: ['travel xp english', 'travel xp']
  },

  // --- ENTERTAINMENT & MOVIES (POPULAR) ---
  {
    id: 'ch-star-plus-hd',
    name: 'Star Plus HD',
    category: 'India',
    categories: ['LiveTV', 'India', 'Entertainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-plus-in.png',
    priority: 1,
    lookup: ['star plus', 'star plus hd', 'star plus 4k']
  },
  {
    id: 'ch-zee-tv-hd',
    name: 'Zee TV HD',
    category: 'India',
    categories: ['LiveTV', 'India', 'Entertainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zee-tv-in.png',
    priority: 1,
    lookup: ['zee tv', 'zee tv hd']
  },
  {
    id: 'ch-set-hd',
    name: 'Sony Entertainment Television (SET)',
    category: 'India',
    categories: ['LiveTV', 'India', 'Entertainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-entertainment-television-in.png',
    priority: 1,
    lookup: ['set', 'set hd', 'sony entertainment', 'sony tv']
  },
  {
    id: 'ch-sony-sab-hd',
    name: 'Sony SAB HD',
    category: 'India',
    categories: ['LiveTV', 'India', 'Entertainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-sab-in.png',
    priority: 1,
    lookup: ['sony sab', 'sony sab hd']
  },
  {
    id: 'ch-colors-hd',
    name: 'Colors HD',
    category: 'India',
    categories: ['LiveTV', 'India', 'Entertainment'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/colors-in.png',
    priority: 1,
    lookup: ['colors', 'colors hd', 'colors 4k']
  },
  {
    id: 'ch-star-gold-hd',
    name: 'Star Gold HD',
    category: 'Movie',
    categories: ['LiveTV', 'India', 'Movie'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-gold-in.png',
    priority: 1,
    lookup: ['star gold', 'star gold hd', 'star gold 4k', 'star gold select hd']
  },
  {
    id: 'ch-sony-max-hd',
    name: 'Sony MAX HD',
    category: 'Movie',
    categories: ['LiveTV', 'India', 'Movie'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-max-in.png',
    priority: 1,
    lookup: ['sony max', 'sony max hd']
  },
  {
    id: 'ch-zee-cinema-hd',
    name: 'Zee Cinema HD',
    category: 'Movie',
    categories: ['LiveTV', 'India', 'Movie'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zee-cinema-in.png',
    priority: 1,
    lookup: ['zee cinema', 'zee cinema hd', 'zee cinema 4k']
  },
  {
    id: 'ch-colors-cineplex',
    name: 'Colors Cineplex',
    category: 'Movie',
    categories: ['LiveTV', 'India', 'Movie'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/colors-cineplex-in.png',
    priority: 1,
    lookup: ['colors cineplex', 'colors cineplex bollywood', 'colors cineplex 4k']
  },
  {
    id: 'ch-star-movies-hd',
    name: 'Star Movies HD',
    category: 'Movie',
    categories: ['LiveTV', 'Movie'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-movies-in.png',
    priority: 1,
    lookup: ['star movies', 'star movies hd', 'star movies select hd']
  },
  {
    id: 'ch-sony-pix-hd',
    name: 'Sony PIX HD',
    category: 'Movie',
    categories: ['LiveTV', 'Movie'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-pix-in.png',
    priority: 1,
    lookup: ['sony pix', 'sony pix hd']
  },
  {
    id: 'ch-b4u-movies',
    name: 'B4U Movies',
    category: 'Movie',
    categories: ['LiveTV', 'Movie'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/b4u-movies-in.png',
    priority: 2,
    lookup: ['b4u movies']
  },

  // --- MUSIC (POPULAR) ---
  {
    id: 'ch-mtv',
    name: 'MTV',
    category: 'Music',
    categories: ['LiveTV', 'Music'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/mtv-beats-in.png',
    priority: 1,
    lookup: ['mtv']
  },
  {
    id: 'ch-9xm',
    name: '9XM',
    category: 'Music',
    categories: ['LiveTV', 'Music'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/9xm-in.png',
    priority: 1,
    lookup: ['9xm']
  },
  {
    id: 'ch-9x-jalwa',
    name: '9X Jalwa',
    category: 'Music',
    categories: ['LiveTV', 'Music'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/9x-jalwa-in.png',
    priority: 2,
    lookup: ['9x jalwa']
  },
  {
    id: 'ch-9x-tashan',
    name: '9X Tashan',
    category: 'Music',
    categories: ['LiveTV', 'Music'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/9x-tashan-in.png',
    priority: 2,
    lookup: ['9x tashan']
  },
  {
    id: 'ch-zoom',
    name: 'Zoom TV',
    category: 'Music',
    categories: ['LiveTV', 'Music'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zoom-in.png',
    priority: 2,
    lookup: ['zoom', 'zoom tv']
  },
  {
    id: 'ch-yrf-music',
    name: 'YRF Music',
    category: 'Music',
    categories: ['LiveTV', 'Music'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/yrf-music-in.png',
    priority: 2,
    lookup: ['yrf music', 'yrf music hd']
  },

  // --- ISLAMIC (POPULAR) ---
  {
    id: 'ch-live-quran-tv',
    name: 'Live Quran TV (Makkah Live)',
    category: 'Islamic',
    categories: ['LiveTV', 'Islamic'],
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Quran_TV_Saudi_logo.svg/250px-Quran_TV_Saudi_logo.svg.png',
    priority: 1,
    lookup: ['live quran tv', 'quran tv', 'saudia arabia', 'makkah live']
  },
  {
    id: 'ch-madani-tv',
    name: 'Madani Tv',
    category: 'Islamic',
    categories: ['LiveTV', 'Islamic'],
    logo: 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-15/images_b8b896039b6eb685a11aab0b7b4a33d3_playmist_madani_tv_400x400.jpg',
    priority: 1,
    lookup: ['madani tv']
  },
  {
    id: 'ch-peace-tv-bangla',
    name: 'Peace Tv Bangla',
    category: 'Islamic',
    categories: ['LiveTV', 'Islamic'],
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ae/Peace_TV_logo.svg/250px-Peace_TV_logo.svg.png',
    priority: 1,
    lookup: ['peace tv bangla']
  },
  {
    id: 'ch-peace-tv-english',
    name: 'Peace Tv English',
    category: 'Islamic',
    categories: ['LiveTV', 'Islamic'],
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ae/Peace_TV_logo.svg/250px-Peace_TV_logo.svg.png',
    priority: 2,
    lookup: ['peace tv english']
  },
  {
    id: 'ch-bahrain-quran',
    name: 'BAHRAIN QURAN',
    category: 'Islamic',
    categories: ['LiveTV', 'Islamic'],
    logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/bahrain/bahrain-quran-bh.png',
    priority: 2,
    lookup: ['bahrain quran']
  }
];

// Helper: Collect all streams across rawChannels, sportsWorking, ayanaWorking, nonAyanaWorking
function findStreamsForChannel(catItem) {
  const matches = [];

  const lookups = (catItem.lookup || [catItem.name]).map(l => l.toLowerCase().trim());
  const checkMatch = (name, id) => {
    const lName = (name || '').toLowerCase().trim();
    const lId = (id || '').toLowerCase().trim();
    if (lId === catItem.id.toLowerCase()) return true;
    return lookups.some(l => lName === l || lName.includes(l) || l.includes(lName));
  };

  // 1. From rawChannels
  rawChannels.forEach(c => {
    if (checkMatch(c.name, c.id)) {
      if (Array.isArray(c.streams)) {
        c.streams.forEach(s => s && s.url && !matches.some(m => m.url === s.url) && matches.push(s));
      }
      if (c.streamUrl && !matches.some(m => m.url === c.streamUrl)) {
        matches.push({ name: `${catItem.name} (Live)`, url: c.streamUrl });
      }
      if (Array.isArray(c.backupUrls)) {
        c.backupUrls.forEach(u => u && !matches.some(m => m.url === u) && matches.push({ name: `${catItem.name} (Backup)`, url: u }));
      }
    }
  });

  // 2. From sportsWorking
  sportsWorking.forEach(item => {
    const ch = item.channel || item;
    const workingUrl = item.workingUrl || ch.streamUrl || ch.url;
    if (checkMatch(ch.name, ch.id)) {
      if (workingUrl && !matches.some(m => m.url === workingUrl)) {
        matches.unshift({ name: `${catItem.name} (Primary Server)`, url: workingUrl });
      }
    }
  });

  // 3. From ayanaWorking
  ayanaWorking.forEach(ch => {
    if (checkMatch(ch.name, ch.id)) {
      const url = ch.streamUrl || ch.url;
      if (url && !matches.some(m => m.url === url)) {
        matches.unshift({ name: `${catItem.name} (Ayna Official)`, url });
      }
    }
  });

  // 4. From nonAyanaWorking
  nonAyanaWorking.forEach(ch => {
    if (checkMatch(ch.name, ch.id)) {
      const url = ch.streamUrl || ch.url;
      if (url && !matches.some(m => m.url === url)) {
        matches.push({ name: `${catItem.name} (Global)`, url });
      }
    }
  });

  // 5. From jioWorking
  jioWorking.forEach(ch => {
    if (checkMatch(ch.name, `jio-${ch.id}`)) {
      const proxied = `/api/stream-proxy?url=${encodeURIComponent(`https://hey-lookme.shop/live.php?id=${ch.id}`)}`;
      if (!matches.some(m => m.url === proxied)) {
        matches.push({ name: `${catItem.name} (Jio Server HD)`, url: proxied });
      }
    }
  });

  // Filter out any broken workers.dev links
  const validMatches = matches.filter(m => m.url && !m.url.includes('cdn91.rongintv.workers.dev') && (m.url.startsWith('http') || m.url.startsWith('/api/')));

  return validMatches;
}

// Assemble pristine catalog
const builtChannels = [];

channelCatalog.forEach(catItem => {
  const streams = findStreamsForChannel(catItem);
  if (streams.length === 0) {
    console.warn(`[Warning] No working stream found for: ${catItem.name}`);
    return;
  }

  // Format clean stream server labels
  const formattedStreams = streams.map((s, idx) => {
    const serverNum = idx + 1;
    const label = `Server ${serverNum} HD`;
    return {
      name: `${catItem.name} (${label})`,
      serverLabel: label,
      channelName: catItem.name,
      url: s.url,
      quality: s.url.includes('.ts') ? '1080p FHD' : '720p HD'
    };
  });

  const primaryUrl = formattedStreams[0].url;
  const backupUrls = formattedStreams.slice(1).map(s => s.url);

  builtChannels.push({
    id: catItem.id,
    name: catItem.name,
    category: catItem.category,
    categories: catItem.categories || ['LiveTV', catItem.category],
    sports: catItem.sports || [],
    priority: catItem.priority || 1,
    active: true,
    logo: catItem.logo,
    streamUrl: primaryUrl,
    url: primaryUrl,
    stream_url: primaryUrl,
    streams: formattedStreams,
    backupUrls: backupUrls
  });
});

console.log(`\n========================================`);
console.log(`Successfully built pristine catalog: ${builtChannels.length} channels`);
console.log(`========================================`);

const categoryCounts = {};
builtChannels.forEach(c => categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1);
console.log('Category distribution:', categoryCounts);

// Save to channels.json
fs.writeFileSync(path.join(rootDir, 'channels.json'), JSON.stringify(builtChannels, null, 2), 'utf8');

// Sync to data/channels.json and android assets
const dataChannelsPath = path.join(rootDir, 'data', 'channels.json');
if (fs.existsSync(path.dirname(dataChannelsPath))) {
  fs.writeFileSync(dataChannelsPath, JSON.stringify(builtChannels, null, 2), 'utf8');
}
const androidChannelsPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'channels.json');
if (fs.existsSync(path.dirname(androidChannelsPath))) {
  fs.writeFileSync(androidChannelsPath, JSON.stringify(builtChannels, null, 2), 'utf8');
}

// Generate bundled_data.js
console.log('Regenerating bundled_data.js...');
require('./generate_bundled_data.cjs');

console.log('All files synchronized successfully!');
