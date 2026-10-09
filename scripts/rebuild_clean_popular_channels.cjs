const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const channelsPath = path.join(rootDir, 'channels.json');
const rawChannels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

console.log(`Starting clean rebuild. Original count: ${rawChannels.length}`);

// 1. Official, authentic, low-KB logo map
const officialLogos = {
  // Sports
  'ch-tapmad-sports': 'https://www.tapmad.com/images/tapmad_logo.png',
  'ch-t-sports-hd': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-13/images_8b38d691dfaf072e6c964dea814a44ba_playmist_t_sports_hd400x400.jpg',
  'ch-t-sports': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-13/images_8b38d691dfaf072e6c964dea814a44ba_playmist_t_sports_hd400x400.jpg',
  'ch-star-sports-1-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-1-in.png',
  'ch-star-sports-1-hindi': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-1-hindi-in.png',
  'ch-star-sports-2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-2-in.png',
  'ch-star-sports-3': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-3-in.png',
  'ch-sony-sports-ten-1-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-1-in.png',
  'ch-sony-sports-ten-2-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-2-in.png',
  'ch-sony-sports-2-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-2-in.png',
  'ch-sony-sports-ten-2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-2-in.png',
  'ch-sony-sports-ten-3': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-3-in.png',
  'ch-sony-sports-ten-4': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-4-in.png',
  'ch-sony-sports-ten-5-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-ten-5-in.png',
  'ch-ten-sports-hd': 'https://jiotv.catchup.cdn.jio.com/dare_images/images/Ten_HD.png',
  'ch-ptv-sports-hd': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/PTV_Sports_Logo.svg/250px-PTV_Sports_Logo.svg.png',
  'ch-ayna-019de785-39bc-7bd5-b9e5-bab23ceba9ea': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/PTV_Sports_Logo.svg/250px-PTV_Sports_Logo.svg.png',
  'ch-willow-hd': 'https://upload.wikimedia.org/wikipedia/commons/1/10/Willow_Cricket_logo.png',
  'ch-willow-xtra': 'https://upload.wikimedia.org/wikipedia/commons/1/10/Willow_Cricket_logo.png',
  'ch-bein-sports-1-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-1-mea.png',
  'ch-bein-sports-2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-2-mea.png',
  'ch-bein-sports-3-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-3-mea.png',
  'ch-bein-sports-4-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-4-mea.png',
  'ch-bein-sports-5-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/world-middle-east/bein-sports/bein-sports-5-mea.png',
  'ch-bein-sports-xtra': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/bein-sports-xtra-us.png',
  'ch-bein-xtra': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/bein-sports-xtra-us.png',
  'ch-sky-sports-epl': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-premier-league-uk.png',
  'ch-sky-sports-football': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-football-uk.png',
  'ch-sky-sports-cricket': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-cricket-uk.png',
  'ch-sky-sports-f1-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-f1-uk.png',
  'ch-sky-sports-racing': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/sky-sports-racing-uk.png',
  'ch-sky-sport-top-event': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/sky-sport-top-event-de.png',
  'ch-sky-sport-bundesliga': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/sky-sport-bundesliga-1-de.png',
  'ch-sky-sport-uno': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/italy/sky-sport-uno-it.png',
  'ch-tnt-sports-1': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-1-uk.png',
  'ch-tnt-sports-2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-2-uk.png',
  'ch-tnt-sports-3': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-3-uk.png',
  'ch-tnt-sports-4': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/tnt-sports-4-uk.png',
  'ch-eurosport-1': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/eurosport-1-uk.png',
  'ch-eurosport-2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/eurosport-2-uk.png',
  'ch-live-sports-3': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/eurosport-1-uk.png',
  'ch-dazn-1': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/dazn1-uk.png',
  'ch-dazn-2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-2-es.png',
  'ch-dazn-3': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-3-es.png',
  'ch-dazn-4': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-4-es.png',
  'ch-dazn-5': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-es.png',
  'ch-dazn-laliga': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/spain/dazn-laliga-es.png',
  'ch-supersport-grandstand': 'https://upload.wikimedia.org/wikipedia/en/thumb/7/70/SuperSport_logo.svg/250px-SuperSport_logo.svg.png',
  'ch-supersport-tennis': 'https://upload.wikimedia.org/wikipedia/en/thumb/7/70/SuperSport_logo.svg/250px-SuperSport_logo.svg.png',
  'ch-dd-sports': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/dd-sports-in.png',
  'ch-ziggo-sport-1': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/netherlands/ziggo-sport-nl.png',
  'ch-ziggo-sport-2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/netherlands/ziggo-sport-select-nl.png',
  'ch-ziggo-sport-3': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/netherlands/ziggo-sport-voetbal-nl.png',
  'ch-ufc-tv': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/ufc-us.png',
  'ch-astro-cricbuz': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/malaysia/astro-cricket-my.png',
  'ch-motor-vision': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/motorvision-plus-de.png',
  'ch-pk-sports-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/pakistan/a-sports-pk.png',
  'ch-go3-sport-1-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/lithuania/go3-sport-1-lt.png',
  'ch-go3-sport-2-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/lithuania/go3-sport-2-lt.png',
  'ch-stan-sport': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/stan-sport-au.png',
  'ch-tsn': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/canada/tsn1-ca.png',
  'ch-fs1': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/fox-sports-1-us.png',
  'ch-espn2': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/espn-2-us.png',
  'ch-sportsnet-one': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/canada/sportsnet-one-ca.png',
  'ch-mlb-network': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/mlb-network-us.png',
  'ch-nhl-network': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/nhl-network-us.png',
  'ch-sport-1': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Sport1_Logo_2013.svg/250px-Sport1_Logo_2013.svg.png',
  'ch-sport-2': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Sport1_Logo_2013.svg/250px-Sport1_Logo_2013.svg.png',
  'ch-cricket-gold': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-09/images_dde39b3fb713d4946a32e2c8ad5db00a_playmist_cricket_gold_400x400.jpg',
  'ch-trace-sport-stars': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Trace_Sport_Stars_logo.svg/250px-Trace_Sport_Stars_logo.svg.png',
  'ch-gtv': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/GTV_Bangladesh_Logo.svg/250px-GTV_Bangladesh_Logo.svg.png',

  // Bangla & Kolkata
  'ch-btv': 'https://upload.wikimedia.org/wikipedia/commons/4/4f/BTV_NEWS_Logo_-_Bangladesh_Television.png',
  'ch-ntv': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_3a9e612cb34891b7da7adab631627f7a_playmist_ntv400x400.jpg',
  'ch-ntv-720p': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_3a9e612cb34891b7da7adab631627f7a_playmist_ntv400x400.jpg',
  'ch-rtv': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_4df93b0dfb2210852084c7d0d0f77ea6_playmist_rtv400x400.jpg',
  'ch-channel-i': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_8d06b539958742b87eeb4a5e3aa4a54d_playmist_channel_i400x400.jpg',
  'ch-maasranga-tv-hd': 'https://static.wikia.nocookie.net/etv-gspn-bangla/images/a/a3/Maasranga_TV_HD_logo.png',
  'ch-deepto-tv': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_ec0b7593c72635fe66b8d2524a87ad95_playmist_deepto400x400.jpg',
  'ch-banglavision': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_944d1891ce5cb38965f72cf93b0a701b_playmist_banglavision400x400.jpg',
  'ch-atn-bangla': 'https://upload.wikimedia.org/wikipedia/commons/9/91/ATN_Bangla.png',
  'ch-atn-news': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_e4b47eb68ec5d996ff52a97576a40a23_playmist_atn_news400x400.jpg',
  'ch-somoy-tv': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_da61f516ea2d87e07ca46c0757dbbfdc_playmist_somoy_tv400x400.jpg',
  'ch-jamuna-tv': 'https://upload.wikimedia.org/wikipedia/commons/f/fe/Jamuna_TV_logo.svg',
  'ch-channel-24': 'https://upload.wikimedia.org/wikipedia/commons/9/91/Channel24logo.svg',
  'ch-dbc-news': 'https://upload.wikimedia.org/wikipedia/commons/9/9f/DBC_News_logo.png',
  'ch-ekattor-tv': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_a3f2db7bb28e51b3a1a63c6314f828a2_playmist_ekattor400x400.jpg',
  'ch-boishakhi-tv': 'https://upload.wikimedia.org/wikipedia/commons/f/f2/Boishakhi_Tv_Logo.png',
  'ch-desh-tv': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-16/images_192e4abf2766861614e287fa44b6bb08_playmist_desh_tv400x400.jpg',
  'ch-star-jalsha-hd': 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ad/Star_Jalsha_logo.svg/250px-Star_Jalsha_logo.svg.png',
  'ch-zee-bangla': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zee-bangla-in.png',
  'jio-625': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zee-bangla-in.png',
  'ch-colors-bangla-hd': 'https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Colors_Bangla_logo.svg/250px-Colors_Bangla_logo.svg.png',
  'jio-756': 'https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Colors_Bangla_logo.svg/250px-Colors_Bangla_logo.svg.png',
  'ch-sony-aath': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-aath-in.png',
  'ch-dd-bangla': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/dd-bangla-in.png',

  // News
  'ch-bbc-news': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/bbc-news-uk.png',
  'ch-cnn-us': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/cnn-us.png',
  'ch-al-jazeera': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/aljazeera-uk.png',
  'ch-dw-news': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/dw-de.png',
  'ch-ndtv-english': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/ndtv-24x7-in.png',
  'ch-ndtv-hindi': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/ndtv-india-in.png',
  'ch-aaj-tak': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/aaj-tak-in.png',
  'ch-india-today': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/india-today-in.png',
  'ch-trt-world': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/turkey/trt-world-tr.png',
  'ch-france-24': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/france-24-en-fr.png',

  // Kids
  'ch-cartoon-network': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/cartoon-network-in.png',
  'ch-nickelodeon': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/nick-in.png',
  'ch-disney-channel': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/disney-channel-au.png',
  'ch-pogo': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/pogo-in.png',
  'jio-548': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/pogo-in.png',
  'ch-sony-yay': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-yay-in.png',
  'jio-1342': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-yay-in.png',
  'ch-duronto-tv': 'https://upload.wikimedia.org/wikipedia/en/thumb/1/1a/Duronto_TV_logo.svg/250px-Duronto_TV_logo.svg.png',
  'ch-discovery-kids': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/discovery-kids-in.png',
  'ch-bbc-cbeebies': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/bbc-cbeebies-uk.png',
  'ch-tom-jerry-tv': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/cartoon-network-in.png',
  'ch-motu-patlu': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/nickelodeon-sonic-in.png',

  // Infotainment
  'ch-discovery-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/discovery-channel-au.png',
  'ch-national-geographic-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/national-geographic-au.png',
  'jio-1335': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/national-geographic-au.png',
  'ch-nat-geo-wild': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/germany/nat-geo-wild-de.png',
  'ch-animal-planet-eng': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/animal-planet-au.png',
  'ch-history-tv18-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/history-tv18-in.png',
  'jio-146': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/history-tv18-in.png',
  'ch-sony-bbc-earth': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-bbc-earth-in.png',
  'ch-discovery-science-hindi': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/canada/discovery-science-ca.png',
  'ch-discovery-turbo': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/discovery-turbo-au.png',
  'jio-541': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/discovery-turbo-au.png',
  'ch-tlc': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/australia/tlc-au.png',
  'ch-travel-xp': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/travel-xp-in.png',

  // Entertainment & Movies
  'ch-star-plus-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-plus-in.png',
  'ch-zee-tv-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zee-tv-in.png',
  'ch-set-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-entertainment-television-in.png',
  'ch-sony-sab-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-sab-in.png',
  'jio-154': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-sab-in.png',
  'ch-colors-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/colors-in.png',
  'ch-star-gold-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-gold-in.png',
  'jio-1113': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-gold-in.png',
  'ch-sony-max-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-max-in.png',
  'ch-zee-cinema-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zee-cinema-in.png',
  'ch-colors-cineplex': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/colors-cineplex-in.png',
  'jio-1763': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/colors-cineplex-in.png',
  'ch-star-movies-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-movies-in.png',
  'jio-1110': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-movies-in.png',
  'ch-sony-pix-hd': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/sony-pix-in.png',
  'ch-b4u-movies': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/b4u-movies-in.png',

  // Music
  'ch-mtv': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/mtv-beats-in.png',
  'ch-9xm': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/9xm-in.png',
  'jio-587': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/9xm-in.png',
  'ch-9x-jalwa': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/9x-jalwa-in.png',
  'ch-9x-tashan': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/9x-tashan-in.png',
  'ch-zoom': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/zoom-in.png',
  'ch-yrf-music': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/yrf-music-in.png',

  // Islamic
  'ch-live-quran-tv': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Quran_TV_Saudi_logo.svg/250px-Quran_TV_Saudi_logo.svg.png',
  'ch-madani-tv': 'https://web.aynaott.com/storage/019dd92f-107c-7056-9e79-e5233f6e51d9/uploads/images/2026-07-15/images_b8b896039b6eb685a11aab0b7b4a33d3_playmist_madani_tv_400x400.jpg',
  'ch-peace-tv-bangla': 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ae/Peace_TV_logo.svg/250px-Peace_TV_logo.svg.png',
  'ch-peace-tv-english': 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ae/Peace_TV_logo.svg/250px-Peace_TV_logo.svg.png',
  'ch-bahrain-quran': 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/bahrain/bahrain-quran-bh.png'
};

// Filter logic:
// Rule 1: Always keep Sports channels ("শুধু স্পোর্টস চ্যানেল গুলো বাদ দিয়ে")
// Rule 2: Keep ONLY popular channels in other categories
// Rule 3: Strip ALL dead cdn91 channels and unknown junk forever ("বাকি সব মুছে দিবা চিরতরে")

const cleanList = [];
const seenIds = new Set();
const seenStreams = new Set();

// Deduplication map by normalized name
const nameGroup = new Map();

for (const ch of rawChannels) {
  // Discard all dead cdn91 channels
  if (ch.id && ch.id.startsWith('ch-cdn91-')) continue;

  const isSports = ch.category === 'Sports' || (Array.isArray(ch.sports) && ch.sports.length > 0);
  const normName = (ch.name || '').trim().toLowerCase().replace(/^(ch-|tv-|hd-)/, '').replace(/\s+/g, ' ');

  // For non-sports, only keep if it is a popular, recognized TV channel or present in officialLogos
  if (!isSports) {
    const isPopular = officialLogos[ch.id] ||
      ['bangla', 'news', 'kids', 'infotainment', 'discovery', 'india', 'movie', 'music', 'islamic', 'kolkata'].includes((ch.category || '').toLowerCase());

    if (!isPopular) continue;

    // Discard obscure foreign channels / 24-7 series loops / random filler
    const lower = (ch.name || '').toLowerCase();
    if (lower.startsWith('24/7:') || lower.includes('fear thy neighbor') || lower.includes('love thy neighbor') || lower.includes('mister rogers')) continue;
    if (lower.startsWith('canal+') || lower.startsWith('polsat') || lower.startsWith('ex-yu:') || lower.startsWith('carib') || lower.startsWith('pt:') || lower.startsWith('tr:')) continue;
    if (lower.includes('أذكار') || lower.includes('ياسر الدوسري') || lower.includes('صوت قرآن')) continue;
  }

  // Deduplicate by channel ID
  if (seenIds.has(ch.id)) continue;

  // Assign official logo
  let finalLogo = officialLogos[ch.id] || ch.logo;
  // If still generic placeholder, replace with verified official logo
  if (!finalLogo || finalLogo.includes('Football_in_the_icon.svg') || finalLogo.includes('Television_icon_grey.svg')) {
    if (isSports) {
      finalLogo = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/star-sports-1-in.png';
    } else {
      finalLogo = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/dd-national-in.png';
    }
  }

  // Group duplicate channels by normalized name to merge servers
  if (nameGroup.has(normName)) {
    const existing = nameGroup.get(normName);
    // Merge streams
    const existingStreams = existing.streams || [];
    const newStreams = ch.streams || [{ name: ch.name, url: ch.streamUrl || ch.url }];
    for (const st of newStreams) {
      if (st && st.url && !existingStreams.some(s => s.url === st.url)) {
        existingStreams.push(st);
      }
    }
    existing.streams = existingStreams;
    if (ch.backupUrls && Array.isArray(ch.backupUrls)) {
      existing.backupUrls = [...new Set([...(existing.backupUrls || []), ...ch.backupUrls])];
    }
    continue;
  }

  // Format streams array with clean server labels
  let streams = [];
  if (Array.isArray(ch.streams) && ch.streams.length > 0) {
    streams = [...ch.streams];
  } else if (ch.streamUrl || ch.url) {
    streams = [{
      name: `${ch.name} (Server 1 HD)`,
      serverLabel: 'Server 1 HD',
      channelName: ch.name,
      url: ch.streamUrl || ch.url,
      quality: '1080p FHD'
    }];
  }

  // Also include backupUrls in streams
  if (Array.isArray(ch.backupUrls)) {
    ch.backupUrls.forEach((bUrl, bIdx) => {
      if (bUrl && !streams.some(s => s.url === bUrl)) {
        streams.push({
          name: `${ch.name} (Server ${streams.length + 1} HD)`,
          serverLabel: `Server ${streams.length + 1} HD`,
          channelName: ch.name,
          url: bUrl,
          quality: '720p HD'
        });
      }
    });
  }

  const primaryUrl = streams[0]?.url || ch.streamUrl || ch.url;
  const backupUrls = streams.slice(1).map(s => s.url);

  const cleanChannel = {
    ...ch,
    logo: finalLogo,
    streamUrl: primaryUrl,
    url: primaryUrl,
    stream_url: primaryUrl,
    streams: streams,
    backupUrls: backupUrls,
    active: true
  };

  seenIds.add(ch.id);
  nameGroup.set(normName, cleanChannel);
  cleanList.push(cleanChannel);
}

console.log(`Clean popular channels catalog created: ${cleanList.length} channels.`);
const byCat = {};
cleanList.forEach(c => byCat[c.category] = (byCat[c.category] || 0) + 1);
console.log('Category breakdown:', byCat);

// Write to channels.json
fs.writeFileSync(channelsPath, JSON.stringify(cleanList, null, 2), 'utf8');

// Sync to data/channels.json and android assets
const dataChannelsPath = path.join(rootDir, 'data', 'channels.json');
if (fs.existsSync(path.dirname(dataChannelsPath))) {
  fs.writeFileSync(dataChannelsPath, JSON.stringify(cleanList, null, 2), 'utf8');
}
const androidChannelsPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'channels.json');
if (fs.existsSync(path.dirname(androidChannelsPath))) {
  fs.writeFileSync(androidChannelsPath, JSON.stringify(cleanList, null, 2), 'utf8');
}

console.log('Syncing bundled_data.js...');
require('./generate_bundled_data.cjs');
console.log('Done!');
