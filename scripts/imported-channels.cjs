const fs = require('fs');
const path = require('path');

const inputJson = [
  {
    "name": "Makkah Live",
    "category": "ISLAM",
    "logo": "https://i.imgur.com/colOISC.jpeg",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/25079.ts"
  },
  {
    "name": "BTV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/kG5drsLM/20260918-143128.png",
    "streamUrl": "https://tvsen6.aynaott.com/TjGR1GcxKetHNVcMVxbq/index.m3u8"
  },
  {
    "name": "Jamuna",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/kG5drsL7/20260918-143215.png",
    "streamUrl": "https://tvsen6.aynaott.com/KGdZEdA7qQ43dmPkgk1j/index.m3u8"
  },
  {
    "name": "Ekattor HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/hjcBscrd/20260918-142223.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/428.ts"
  },
  {
    "name": "SOMOY TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/FznXhcQZ/20260918-143603.png",
    "streamUrl": "https://tvsen6.aynaott.com/4XcqdovJzbbC9WdJA9gk/index.m3u8"
  },
  {
    "name": "DBC News",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/ZRHhD27M/20260918-142610.png",
    "streamUrl": "https://tvsen6.aynaott.com/pF66Tkz0qFwP2aMMqHyt/index.m3u8"
  },
  {
    "name": "Channel 24",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/j2jrVcmG/20260918-142912.png",
    "streamUrl": "https://stream.ottplus.live/live/channel_24_abr/index.m3u8"
  },
  {
    "name": "Boishakhi",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/D0Y37sK1/20260918-143507.png",
    "streamUrl": "https://tvsen6.aynaott.com/1d3uG9VCgrR9DRtWZM57/index.m3u8"
  },
  {
    "name": "SRK",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/NFPvQTwj/20260918-143351.png",
    "streamUrl": "https://srknowapp.ncare.live/srktvhlswodrm/srktv.stream/playlist.m3u8"
  },
  {
    "name": "Ekhon",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/854Vn9Kc/20260918-142309.png",
    "streamUrl": "https://stream.ottplus.live/live/ekhon_tv_abr/live/ekhon_tv_hd_720/chunks.m3u8"
  },
  {
    "name": "N TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/bJgjFWCb/20260918-142451.png",
    "streamUrl": "https://tvsen5.aynaott.com/xV4jEKf3D9zc/index.m3u8"
  },
  {
    "name": "RTV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/L5sMdDw7/20260918-142828.png",
    "streamUrl": "http://tvsen5.aynascope.net/RtvHD/index.m3u8"
  },
  {
    "name": "BD | SA Tv (12)",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/DfCTQV49/20260918-143638.png",
    "streamUrl": "https://tvsen6.aynaott.com/rELXiuUXqbgzPb06Npom/index.m3u8"
  },
  {
    "name": "NTV UK",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/bJgjFWCb/20260918-142451.png",
    "streamUrl": "https://app.ncare.live/c3VydmVyX8RpbEU9Mi8xNy8yMDE0GIDU6RgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcGVMZEJCTEFWeVN3PTOmdFsaWRtaW51aiPhnPTI2/ntvuk00332211.stream/playlist.m3u8"
  },
  {
    "name": "NEXUS TV HD (26)",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/d3ScJdKq/20260918-143258.png",
    "streamUrl": "https://stream.ottplus.live/live/nexus_tv_abr/index.m3u8"
  },
  {
    "name": "Banglavision",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/wMBdK2nq/20260918-143054.png",
    "streamUrl": "https://tvsen5.aynaott.com/tgUzpPc9r6xw/index.m3u8"
  },
  {
    "name": "G-Serise",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/sx2RFmq0/20260918-142649.png",
    "streamUrl": "https://vods2.aynaott.com/gseriesDrama/tracks-v1a1/mono.ts.m3u8"
  },
  {
    "name": "Peace TV Bangla",
    "category": "ISLAM",
    "logo": "https://i.postimg.cc/0jNqgnhR/20260918-143009.png",
    "streamUrl": "https://dzkyvlfyge.erbvr.com/PeaceTvBangla/tracks-v3a1/mono.m3u8"
  },
  {
    "name": "Deepto",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/J42R8w1c/20260918-105856.png",
    "streamUrl": "https://byphdgllyk.gpcdn.net/hls/deeptotv/index.m3u8"
  },
  {
    "name": "Star Jalsha HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/k4sdhz1S/20260918-142403.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/198.ts"
  },
  {
    "name": "Zee Bangla HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/zvf1m76p/20260918-142751.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/23305.ts"
  },
  {
    "name": "Colors Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/qqZHpndq/20260918-143437.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/23306.ts"
  },
  {
    "name": "Sun Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/pLmX5WGL/20260917-185112.png",
    "streamUrl": "https://ireentv.pages.dev/Sun_Bangla_Server_1.m3u8"
  },
  {
    "name": "Zee Bangla Cinema",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/wBsvZqLs/20260917-182117.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/410.ts"
  },
  {
    "name": "Jalsha Movies HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/wTTBHcLS/20260917-184350.png",
    "streamUrl": "http://steveit4.net:80/live/3D458C361A77/80DD123017CE/76205.ts"
  },
  {
    "name": "JALSHA MOVIES",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/655QwLC9/20260917-184444.png",
    "streamUrl": "https://box.bbaria.net:8083/Jalsha_Movie/tracks-v1a1/mono.m3u8"
  },
  {
    "name": "Colors HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/1tsQBsHt/20260918-142129.png",
    "streamUrl": "http://flowutc.com:80/live/34FQ94W/64CW3PG/72156.ts"
  },
  {
    "name": "Ananda",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/VvWg5ZmC/20260919-102539.png",
    "streamUrl": "https://app24.jagobd.com.bd/c3VydmVyX8RpbEU9Mi8xNy8yMFDEEHGcfRgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcEdsEfeDeKiNkVN3PTOmdFseWRtaW51aiPhnPTI2/anandatv.stream/tracks-v1a1/mono.m3u8"
  },
  {
    "name": "Channel 9 HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/gkTGp9Y8/20260918-105823.png",
    "streamUrl": "http://premiumtvs.space/live/YqXTywueEV/damp2purchase/434.ts"
  },
  {
    "name": "HINDI - DD NATIONAL",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/15jySx9N/20260918-105648.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72180.ts"
  },
  {
    "name": "ATN Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/pXTP3Vty/20260918-105226.png",
    "streamUrl": "https://raw.githubusercontent.com/IPTVFlixBD/OopsTv/refs/heads/main/Channels/908660.m3u8"
  },
  {
    "name": "Bangla Tv",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/15jySx9q/20260918-105617.png",
    "streamUrl": "https://tvsen6.aynaott.com/39ee93nUbCCmm5LsyD4t/index.m3u8"
  },
  {
    "name": "IN - ASIAN TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/QxtjvNrK/20260918-105540.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/1126364.ts"
  },
  {
    "name": "Enter TV.......93",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/SNsmHQpM/20260918-105406.png",
    "streamUrl": "https://live1.entertv.com.bd/entertv/index.fmp4.m3u8"
  },
  {
    "name": "Independent TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/7Y6qjPyL/20260918-105253.png",
    "streamUrl": "https://akash-backup.sm-monirul-islam-rs.workers.dev/independent_tv.m3u8"
  },
  {
    "name": "ATN News",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/RCGMP624/20260918-105041.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/427.ts"
  },
  {
    "name": "Bijoy Tv",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/FFG9Pdw1/20260918-105155.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/408.ts"
  },
  {
    "name": "News 21 Bangla TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/59pxPYTs/20260918-104720.png",
    "streamUrl": "http://103.190.133.68:1935/news21live/live/playlist.m3u8"
  },
  {
    "name": "Ekushe TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/J7K1TDSV/20260918-104904.png",
    "streamUrl": "http://210.4.72.204/hls-live/livepkgr/_definst_/liveevent/livestream3.m3u8"
  },
  {
    "name": "Rajdhani",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/jqvs8wBS/20260918-105116.png",
    "streamUrl": "https://stream.shariarsuvo.com/hls5/rajdhanicable.m3u8"
  },
  {
    "name": "Islamic TV.......82",
    "category": "ISLAM",
    "logo": "https://i.postimg.cc/ZYjTfBXZ/20260918-105008.png",
    "streamUrl": "https://app24.jagobd.com.bd/c3VydmVyX8RpbEU9Mi8xNy8yMFDEEHGcfRgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcEdsEfeDeKiNkVN3PTOmdFseWRtaW51aiPhnPTI2/islamictvbd.stream/index.m3u8"
  },
  {
    "name": "Desh TV (19)",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/Kj9x4wtT/20260917-204336.png",
    "streamUrl": "https://stream.ottplus.live/live/desh_tv_abr/index.m3u8"
  },
  {
    "name": "Sony Aath",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/rshMz352/20260917-204241.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/4083.ts"
  },
  {
    "name": "Enter 10 Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/SRZkj3Cw/20260917-204147.png",
    "streamUrl": "https://amg01448-samsungin-enterr10bangla-samsungin-ad-gg.amagi.tv/playlist/amg01448-samsungin-enterr10bangla-samsungin/playlist.m3u8"
  },
  {
    "name": "Global TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/rsyqVMRc/20260917-203512.png",
    "streamUrl": "https://stream.ottplus.live/live/global_tv_abr/index.m3u8"
  },
  {
    "name": "Mohona Tv",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/4y8snqVD/20260917-203419.png",
    "streamUrl": "https://stream.ottplus.live/live/mohona_tv_abr/index.m3u8"
  },
  {
    "name": "Star Movies HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/XqNnj4G9/20260917-203333.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/9384.ts"
  },
  {
    "name": "HINDI - MTV HD",
    "category": "Bangladesh",
    "logo": "https://go4.pw/PHILIPINES/MTV_Asia.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/510200.ts"
  },
  {
    "name": "HBO",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/G2xcnH2L/20260917-203251.png",
    "streamUrl": "http://alpha3-ott.me:80/play/live.php?mac=00:1B:79:47:12:B3&stream=261769&extension=ts&play_token=cIO5B0mIxx"
  },
  {
    "name": "MADANI TV Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/Hx9p1Vxj/20260917-203017.png",
    "streamUrl": "https://streaming.madanichannel.tv/static/streaming-playlists/hls/d3e49b76-ac06-4689-a641-9200445b647f/master.m3u8"
  },
  {
    "name": "My Tv",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/mDsbnQbk/20260917-203116.png",
    "streamUrl": "https://app.ncare.live/c3VydmVyX8RpbEU9Mi8xNy8yMDE0GIDU6RgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcGVMZEJCTEFWeVN3PTOmdFsaWRtaW51aiPhnPTI2/mytv-up-off.stream/live-orgin/mytv-up-off.stream/playlist.m3u8"
  },
  {
    "name": "Channel i",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/jjNxv8Yp/20260917-202936.png",
    "streamUrl": "https://tvsen6.aynaott.com/FNHpYvGZ7FkCE10PwTHm/index.m3u8"
  },
  {
    "name": "Sony PIX HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/Zq3bjfzc/20260917-185551.png",
    "streamUrl": "http://steveit4.net:80/live/3D458C361A77/80DD123017CE/72148.ts"
  },
  {
    "name": "Maasranga",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/8CWpwygm/20260917-185459.png",
    "streamUrl": "https://mtv.sunplex.live/MAASRANGA/index.m3u8"
  },
  {
    "name": "Sony SAB HD",
    "category": "NM. BANGLA",
    "logo": "https://i.postimg.cc/P50fmg94/20260917-185405.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/145.ts"
  },
  {
    "name": "Colors Bangla Cinema",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/BnjQPSY6/20260917-185326.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/271038.ts"
  },
  {
    "name": "Sony Aath",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/rshMz352/20260917-204241.png",
    "streamUrl": "https://live20.bozztv.com/giatvplayout7/giatv-209611/index.m3u8"
  },
  {
    "name": "MNX HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/jqhjGknR/20260917-184302.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/1020230.ts"
  },
  {
    "name": "HUM TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/YCvqLrnq/20260917-185153.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/510208.ts"
  },
  {
    "name": "Star Plus HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/x1BjKwh2/20260917-185237.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/1019856.ts"
  },
  {
    "name": "Akash Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/50VxrwxH/20260917-203209.png",
    "streamUrl": "https://cdn-4.pishow.tv/live/969/master.m3u8"
  },
  {
    "name": "Sony Max HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/rFnwp09G/20260917-185021.png",
    "streamUrl": "http://steveit4.net:80/live/3D458C361A77/80DD123017CE/1020169.ts"
  },
  {
    "name": "Khusbo Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/ZK75qBLN/20260917-184946.png",
    "streamUrl": "https://cdn-4.pishow.tv/live/1473/master.m3u8"
  },
  {
    "name": "Disney Channel",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/NfJj09xD/20260917-184849.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/19741.ts"
  },
  {
    "name": "Probashi TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/FssKmg07/20260917-184649.png",
    "streamUrl": "http://158.69.24.53:8080/probashi_tv/tracks-v1a1/mono.m3u8"
  },
  {
    "name": "Ruposhi Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/vHqZmgv9/20260917-184738.png",
    "streamUrl": "https://mumt05.tangotv.in/87NeALx2RUPASIBANGLA/index.m3u8"
  },
  {
    "name": "R Plus News",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/Bnh1fq0X/RPlus-News-logo-2017.webp",
    "streamUrl": "https://thelegitpro.in/pntv/rplusnews24x7/index.m3u8"
  },
  {
    "name": "Zee Tv",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/43tfw8Rw/Zee_TV.png",
    "streamUrl": "http://flowutc.com:80/live/34FQ94W/64CW3PG/72135.ts"
  },
  {
    "name": "TV9 Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/X77v3c9n/20260917-184526.png",
    "streamUrl": "https://dyjmyiv3bp2ez.cloudfront.net/pub-iotv9banaen8yq/liveabr/playlist.m3u8"
  },
  {
    "name": "Sony Television HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/T2cPZHLj/20260917-183818.png",
    "streamUrl": "http://38.96.178.205/SONYHD/index.m3u8"
  },
  {
    "name": "Aaj Tak HD",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/ZnTTqdP5/Aaj-Tak-HD-v2.webp",
    "streamUrl": "https://aajtaklive-amd.akamaized.net/hls/live/2014416/aajtak/aajtaklive/live_720p/chunks.m3u8"
  },
  {
    "name": "NDTV Hindi",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/26xDgSs9/NDTV.webp",
    "streamUrl": "https://ndtvindiaelemarchana.akamaized.net/hls/live/2003679-b/ndtvindia/master.m3u8"
  },
  {
    "name": "Star News",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/L4Vsr0gR/20260917-184217.png",
    "streamUrl": "https://app24.jagobd.com.bd/c3VydmVyX8RpbEU9Mi8xNy8yMFDEEHGcfRgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcEdsEfeDeKiNkVN3PTOmdFseWRtaW51aiPhnPTI2/starnewsbd.stream/playlist.m3u8"
  },
  {
    "name": "IN | News18 Bangla 33",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/NGx0WP2B/20260917-184127.png",
    "streamUrl": "https://amg01448-samsungin-news18bangla-samsungin-ad-qy.amagi.tv/ts-eu-w1-n2/playlist/amg01448-samsungin-news18bangla-samsungin/playlist.m3u8"
  },
  {
    "name": "& Tv",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/pVBdg15M/20260917-184050.png",
    "streamUrl": "https://stream.ottplus.live/live/and_tv_hd_abr/index.m3u8"
  },
  {
    "name": "Sony Television",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/T2cPZHLj/20260917-183818.png",
    "streamUrl": "https://stream.ottplus.live/live/sony_ent_sd_abr/index.m3u8"
  },
  {
    "name": "Star Gold Select HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/9XBfvNRG/20260917-183941.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/210.ts"
  },
  {
    "name": "Star Gold THRILLS",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/Y08qYhB9/20260917-183853.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/773735.ts"
  },
  {
    "name": "Colors Cineplex FHD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/FzGs37XF/20260917-183735.png",
    "streamUrl": "http://41smartpro.xyz:80/live/bmg12mk788/UPBTUU4/1020166.ts"
  },
  {
    "name": "Star Movies Select HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/kG7g2WZf/20260917-183528.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/23270.ts"
  },
  {
    "name": "Movie Bangla",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/Wzs1d0KC/20260917-183444.png",
    "streamUrl": "http://alvetv.com/moviebanglatv/8080/index.m3u8"
  },
  {
    "name": "HBO 3",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/nrnhXq5d/20260917-183624.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/68811.ts"
  },
  {
    "name": "Movies Now",
    "category": "MOVIE",
    "logo": "https://static.epg.best/in/MoviesNow.in.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/152387.ts"
  },
  {
    "name": "Rakuten TV Action Movies",
    "category": "MOVIE",
    "logo": "https://imgur.com/79g2kA.png",
    "streamUrl": "https://54045f0c40fd442c8b06df076aaf1e85.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6065/master.m3u8"
  },
  {
    "name": "Sony KAL Hindi",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/mkTgP7qY/20260917-183408.png",
    "streamUrl": "https://wurlsonypicturestv.global.transmit.live/hls/68deeb1c0238cda82df543dd/v1/spt_sonykal_1/lg_us/latest/main/hls/playlist.m3u8"
  },
  {
    "name": "Amar Digital TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/bJxvYm69/20260917-183322.png",
    "streamUrl": "https://app.ncare.live/c3VydmVyX8RpbEU9Mi8xNy8yMDE0GIDU6RgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcGVMZEJCTEFWeVN3PTOmdFsaWRtaW51aiPhnPTI/amarbanglatv.stream/playlist.m3u8"
  },
  {
    "name": "History TV18 HD Hindi",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/JnNh7pTc/20260917-183241.png",
    "streamUrl": "https://n18syndication.akamaized.net/bpk-tv/History_TV18_Hindi_NW18_MOB/output01/master.m3u8"
  },
  {
    "name": "Wild Flix Hindi",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/tT3gRBrs/20260917-183147.png",
    "streamUrl": "https://cc-qgrxgp51645lw.akamaized.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-qgrxgp51645lw/IQJW/WBD/WildFlix_IN/WildFlix_IN.m3u8"
  },
  {
    "name": "Quran TV",
    "category": "ISLAM",
    "logo": "https://i.postimg.cc/T3f1NQyV/20260524-024937.png",
    "streamUrl": "https://live.kwikmotion.com/sharjahtvquranlive/shqurantv.smil/sharjahtvquranpublish/shqurantv_source/chunks.m3u8"
  },
  {
    "name": "Iqra Bangla",
    "category": "ISLAM",
    "logo": "https://i.postimg.cc/26Q5j0Hz/20260917-183055.png",
    "streamUrl": "https://app.ncare.live/c3VydmVyX8RpbEU9Mi8xNy8yMDE0GIDU6RgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcGVMZEJCTEFWeVN3PTOmdFsaWRtaW51aiPhnPTI2/iqrabanglatvoffice.stream/live-orgin/iqrabanglatvoffice.stream/chunks.m3u8"
  },
  {
    "name": "T sports",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/fLcbW8HQ/20260917-182941.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/18452.ts"
  },
  {
    "name": "PTV Sports HD",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/1thtZkr7/20260917-182334.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/1404537.ts"
  },
  {
    "name": "G TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/63cN1gjc/20260918-142530.png",
    "streamUrl": "https://app.ncare.live/c3VydmVyX8RpbEU9Mi8xNy8yMDE0GIDU6RgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcGVMZEJCTEFWeVN3PTOmdFsaWRtaW51aiPhnPTI2/gazibdz.stream/live-orgin/gazibdz.stream/playlist.m3u8"
  },
  {
    "name": "Star Gold HD",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/50Bt9sPV/20260917-182843.png",
    "streamUrl": "http://steveit4.net:80/live/3D458C361A77/80DD123017CE/1020175.ts"
  },
  {
    "name": "Movies Thriller (1080p)",
    "category": "MOVIE",
    "logo": "https://imgur.com/79g2kMA.pn",
    "streamUrl": "https://shd-amg-fast.edgenextcdn.net/tx012/playlist.m3u8"
  },
  {
    "name": "Discovery বাংলা/Hindi All Languages",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/d1P1KbjW/20260917-182634.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/98872.ts"
  },
  {
    "name": "National Geographic বাংলা/HINDI All languages",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/1thtZkrM/20260917-182512.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/98874.ts"
  },
  {
    "name": "Star Gold 2 HD 4K",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/wv8vdCkT/20260917-182745.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/1020177.ts"
  },
  {
    "name": "Nagorik TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/ZqyR2bpL/20260917-182236.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/3802.ts"
  },
  {
    "name": "Rakuten TV Comedy Movies",
    "category": "MOVIE",
    "logo": "https://imgur.com/79g2kMA.ng",
    "streamUrl": "https://9be783d652cd4b099cf63e1dc134c4a3.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6181/master.m3u8"
  },
  {
    "name": "Zee 24 Ghanta",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/Wbb4j60b/20260917-184609.png",
    "streamUrl": "https://d2dsoyvkr33m05.cloudfront.net/index_5.m3u8"
  },
  {
    "name": "Sony Movies",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/wBsvZqL3/20260917-182021.png",
    "streamUrl": "https://a-cdn.klowdtv.com/live1/smc_720p/chunks.m3u8"
  },
  {
    "name": "Jungle Book",
    "category": "Cartoon",
    "logo": "https://i.imgur.com/ubZMeQv.jpg",
    "streamUrl": "https://cc-4bhi5osabejc9.akamaized.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-4bhi5osabejc9/junglebook.m3u8"
  },
  {
    "name": "Nick Bangla/Hindi/All Languages 4K",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/0y4jVMMD/20260917-181909.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/98880.ts"
  },
  {
    "name": "Carton Vantu Bangla 4k",
    "category": "Cartoon",
    "logo": "https://imglink.cc/cdn/_OIh6UYTpa.jpg",
    "streamUrl": "https://live20.bozztv.com/giatvplayout7/giatv-209869/tracks-v1a1/mono.ts.m3u8?nocache=1785119026625"
  },
  {
    "name": "Jago News 24",
    "category": "Bangladesh",
    "logo": "https://raw.githubusercontent.com/BadhanStrom/img/refs/heads/main/Jago_News_24.png",
    "streamUrl": "https://app.ncare.live/live-orgin/jagonews24.stream/playlist.m3u8"
  },
  {
    "name": "Sony YaY Hindi",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/g06JQz8n/20260917-181809.png",
    "streamUrl": "https://stream.ottplus.live/live/sony_yay_abr/live/sony_yay_720/chunks.m3u8"
  },
  {
    "name": "Rongeen",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/rwHsf00p/20260917-181702.png",
    "streamUrl": "https://server.thelegitpro.in/rongeentv/rongeentv/tracks-v1a1/mono.m3u8"
  },
  {
    "name": "National Geographic Bangla",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/Pq8x9XYc/20260917-182420.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/7342.ts"
  },
  {
    "name": "DISCOVERy Hindi",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/FHNy7VBR/20260919-105419.png",
    "streamUrl": "http://202.70.146.135:8000/play/a05z/index.m3u8"
  },
  {
    "name": "Travelxp Bangla",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/K8xznqFF/20260919-103738.png",
    "streamUrl": "http://premiumtvs.space/live/YqXTywueEV/damp2purchase/20622.ts"
  },
  {
    "name": "Investigation Discovery HINDI",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/hPfqpC9r/20260918-145142.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/23790.ts"
  },
  {
    "name": "Travel XP HD HINDI",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/K8xznqFF/20260919-103738.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/181.ts"
  },
  {
    "name": "Animal Planet HD Hindi/All Languages",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/rF32bSJg/Animal_Planet_.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/98873.ts"
  },
  {
    "name": "TRACE UK",
    "category": "Music",
    "logo": "https://a.jsrdn.com/hls/23073/trace-uk/logo_20240627_183320_70.png",
    "streamUrl": "https://d2l4tng0wskzvn.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-i4w0aagbo260c/Trace_GB.m3u8"
  },
  {
    "name": "ANIMAL PLANET Hindi",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/rF32bSJg/Animal_Planet_.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/5249.ts"
  },
  {
    "name": "DISCOVERY PAKISTAN Hindi",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/FHNy7VBR/20260919-105419.png",
    "streamUrl": "https://app.ncare.live/c3VydmVyX8RpbEU9Mi8xNy8yMDE0GIDU6RgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcGVMZEJCTEFWeVN3PTOmdFsaWRtaW51aiPhnPTI2/discoverpakistan.stream/playlist.m3u8"
  },
  {
    "name": "Sony BBC Earth HINDI/All languages",
    "category": "Discovery",
    "logo": "https://jiotvimages.cdn.jio.com/dare_images/images/SonyBBCEarthEng.png",
    "streamUrl": "http://202.70.146.135:8000/play/a067/index.m3u8"
  },
  {
    "name": "UFC TV",
    "category": "WWE",
    "logo": "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhpk7qcLQpJwBYzXGY25LdrndzWRDs3tgwp5rY0W-pkxJQ9UVDcWvE88Ng6AGWlHpHNhjQrb28lJ2r4V_BW1fVkLySo3sB1nzTwt_LuRQ9cYGim_FInDnyZWBuULFUFI_Vr9YdIpTs7KvDsVb0CEy_XYJCmUXB4Jpo1uPnXTjh09EqP_sJLqgb6Dwf1uA/s1080/1000060530.png",
    "streamUrl": "https://linear-893.frequency.stream/mt/plex/893/hls/master/playlist_640x360.m3u8"
  },
  {
    "name": "UFC FIGHT PASS",
    "category": "WWE",
    "logo": "https://i.imgur.com/Fx1n84p.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/1426214.ts"
  },
  {
    "name": "Cartoon Network HD",
    "category": "Cartoon",
    "logo": "https://upload.wikimedia.org/wikipedia/commons/8/80/Cartoon_Network_2010_logo.svg",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/117177.ts"
  },
  {
    "name": "Discovery Kids",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/jq3m6LbV/20260919-110230.png",
    "streamUrl": "https://stream.ottplus.live/live/discovery_kids_abr/index.m3u8"
  },
  {
    "name": "Pogo",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/442qvmTD/20260919-110734.png",
    "streamUrl": "https://stream.ottplus.live/live/pogo_sd_abr/index.m3u8"
  },
  {
    "name": "Motu Patlu",
    "category": "Cartoon",
    "logo": "https://i.imgur.com/5U9wof3.jpeg",
    "streamUrl": "https://live20.bozztv.com/giatvplayout7/giatv-209622/tracks-v1a1/mono.ts.m3u8"
  },
  {
    "name": "Tom & Jerry TV",
    "category": "Cartoon",
    "logo": "https://gia.tv/streams/pptv/208314.jpg?1750373428",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/661308.ts"
  },
  {
    "name": "Channel 16",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/QdCVgkMR/20260917-181607.png",
    "streamUrl": "https://app24.jagobd.com.bd/c3VydmVyX8RpbEU9Mi8xNy8yMFDEEHGcfRgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcEdsEfeDeKiNkVN3PTOmdFseWRtaW51aiPhnPTI2/channel16bd.stream/tracks-v1a1/mono.m3u8"
  },
  {
    "name": "Doraemon TV",
    "category": "Cartoon",
    "logo": "https://static.wikia.nocookie.net/logopedia/images/e/e4/Doraemon2005.svg",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/147746.ts"
  },
  {
    "name": "Nikki HD",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/Cx5dCHKt/20260917-181443.png",
    "streamUrl": "http://iptv.prosto.tv:7000/ch72/video.m3u8"
  },
  {
    "name": "Disney Junior",
    "category": "Cartoon",
    "logo": "https://go4.pw/EUROPE/FRANCE/DISNEYJUNIORHD.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/175130.ts"
  },
  {
    "name": "Cartoon Network HD Hindi",
    "category": "Cartoon",
    "logo": "https://upload.wikimedia.org/wikipedia/commons/8/80/Cartoon_Network_2010_logo.svg",
    "streamUrl": "https://stream.ottplus.bd/live/cn_hd_abr/live/cn_hd/chunks.m3u8"
  },
  {
    "name": "Hungama",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/g2jryq01/20260917-181314.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/638050.ts"
  },
  {
    "name": "Colors Cineplex Bollywood",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/fRyk7jbP/20260917-181146.png",
    "streamUrl": "http://202.70.146.135:8000/play/a058/index.m3u8"
  },
  {
    "name": "ISLAM বাংলা",
    "category": "ISLAM",
    "logo": "https://cdnhost.akashbd.net/assets/uploads/channels_images/1770548420-84091417.jpeg?v=10.5.15",
    "streamUrl": "https://app24.jagobd.com.bd/c3VydmVyX8RpbEU9Mi8xNy8yMFDEEHGcfRgzQ6NTAgdEoaeFzbF92YWxIZTO0U0ezN1IzMyfvcEdsEfeDeKiNkVN3PTOmdFseWRtaW51aiPhnPTI2/islamchbangla.stream/tracks-v1a1/mono.m3u8"
  },
  {
    "name": "Iqraa TV",
    "category": "ISLAM",
    "logo": "https://i.postimg.cc/9FJrqNcz/20260917-180900.png",
    "streamUrl": "https://playlist.fasttvcdn.com/pl/dlkqw1ftuvuuzkcb4pxdcg/Iqraafasttv1/playlist.m3u8"
  },
  {
    "name": "Zoom",
    "category": "Music",
    "logo": "https://i.postimg.cc/yYvkSr7V/20260917-180631.png",
    "streamUrl": "https://d2esfk1pb9cdob.cloudfront.net/master.m3u8"
  },
  {
    "name": "Bengali Beats",
    "category": "Music",
    "logo": "https://i.postimg.cc/028zjq1K/BENGALI-BEATS.png",
    "streamUrl": "https://live20.bozztv.com/giatvplayout7/giatv-209587/tracks-v1a1/mono.ts.m3u8"
  },
  {
    "name": "Sangeet Bangla",
    "category": "Music",
    "logo": "https://i.postimg.cc/nc0CQwnr/20260917-180209.png",
    "streamUrl": "http://flowutc.com:80/live/34FQ94W/64CW3PG/34727.ts"
  },
  {
    "name": "9XM",
    "category": "Music",
    "logo": "https://i.postimg.cc/rmMkjMJF/20260918-112157.png",
    "streamUrl": "https://wiselp.wiseplayout.com/9XM/HD1080/HD1080.m3u8"
  },
  {
    "name": "9X Jalwa",
    "category": "Music",
    "logo": "https://i.postimg.cc/tTpjkp5q/20260918-112106.png",
    "streamUrl": "https://wiselp.wiseplayout.com/9X_Jalwa/master.m3u8"
  },
  {
    "name": "Music India",
    "category": "Music",
    "logo": "https://i.postimg.cc/ZR4SH4cZ/20260918-112026.png",
    "streamUrl": "http://flowutc.com:80/live/34FQ94W/64CW3PG/72218.ts"
  },
  {
    "name": "yrf Music",
    "category": "Music",
    "logo": "https://i.postimg.cc/4dsgPs1r/20260918-111946.png",
    "streamUrl": "https://cdn-uw2-prod.tsv2.amagi.tv/linear/amg01412-xiaomiasia-yrfmusic-xiaomi/playlist.m3u8"
  },
  {
    "name": "Sangeet Bhojpuri",
    "category": "Music",
    "logo": "https://i.postimg.cc/bvQP1sQq/20260918-111906.png",
    "streamUrl": "https://cdn-4.pishow.tv/live/1293/master.m3u8"
  },
  {
    "name": "9X Tashan",
    "category": "Music",
    "logo": "https://i.postimg.cc/QMpDcHc2/20260918-111823.png",
    "streamUrl": "https://wiselp.wiseplayout.com/9X_Tashan/master.m3u8"
  },
  {
    "name": "A Sports",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/0Npv7bpg/20260918-111738.png",
    "streamUrl": "https://tvsen6.aynaott.com/zv68oqPDu7MZZwmHhRxt/tracks-v1a1/mono.ts.m3u8"
  },
  {
    "name": "Willow Sports",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/KYnbtRt0/20260918-111645.png",
    "streamUrl": "https://warm-caverns-48629-92fab798385f.herokuapp.com/https://d36r8jifhgsk5j.cloudfront.net/Willow_TV540p.m3u8"
  },
  {
    "name": "Willow Sports 2",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/KYnbtRt0/20260918-111645.png",
    "streamUrl": "https://streamhub.dhruvpatil681.workers.dev/2026.m3u8"
  },
  {
    "name": "FOX CRICKET 501",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/43zGpmpM/20260918-111545.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/4748.ts"
  },
  {
    "name": "Ten Cricket",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/N01tR5R7/20260918-111509.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/514856.ts"
  },
  {
    "name": "ASTRO CRICBUZ",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/s2pz5v54/20260918-111431.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/2494.ts"
  },
  {
    "name": "ASTRO Football",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/rp6cdSRf/20260918-111302.png",
    "streamUrl": "https://spoo.me/footballM3U"
  },
  {
    "name": "Best Action TV",
    "category": "MOVIE",
    "logo": "https://cdn.neotvapp.com/file/quickfox/top-tv/channels/BST-1737589548317.jpg",
    "streamUrl": "https://streams2.sofast.tv/ptnr-Khabriya/title-BEST_ACTION_Khabriya/v1/master/611d79b11b77e2f571934fd80ca1413453772ac7/46d81239-7803-45e2-9341-99ca0226fb62/manifest.m3u8"
  },
  {
    "name": "Ten Sports HD",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/Gp0rBkTj/20260918-111219.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/98.ts"
  },
  {
    "name": "NAT GEO WILD HINDI",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/RVNzXPcb/Nag_Geo_Wild.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72219.ts"
  },
  {
    "name": "STAR SPORTS S1 HD",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/mrxRcQ17/20260918-111059.png",
    "streamUrl": "http://livetv.akr4m.com:8080/bdtv/restrem/40.m3u8"
  },
  {
    "name": "EN | Vevo Pop",
    "category": "Music",
    "logo": "https://static.wikia.nocookie.net/logopedia/images/1/15/Vevo2016.svg",
    "streamUrl": "https://d2n3779oy6efpi.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-5rxuagztow0k3/playlist.m3u8"
  },
  {
    "name": "Nick Hindi 4K",
    "category": "Cartoon",
    "logo": "https://i.postimg.cc/3wM7yg00/20260918-111003.png",
    "streamUrl": "http://alpha3-ott.me:80/play/live.php?mac=00:1B:79:47:12:B3&stream=1540023&extension=ts&play_token=3aWC7Ic2NW"
  },
  {
    "name": "Star Sports 1 HD",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/hGFgJ9Qm/20260918-110842.png",
    "streamUrl": "http://steveit4.net:80/live/3D458C361A77/80DD123017CE/1404528.ts"
  },
  {
    "name": "SONY SPORTS TEN 2 HD",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/JhwmybHs/20260918-110810.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/98862.ts"
  },
  {
    "name": "SONY SPORTS TEN 3",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/nh9pcdrj/20260918-110731.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/98863.ts"
  },
  {
    "name": "DSPORTS",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/Dw4nyCZH/20260918-110627.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/4044.ts"
  },
  {
    "name": "Sananda TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/Z5v4KfRg/20260918-110557.png",
    "streamUrl": "http://live-stream.amarbanglatv.in:8080/hls/sanandatv/index.m3u8"
  },
  {
    "name": "GOAL TV",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/wjRgTWMK/20260918-110526.png",
    "streamUrl": "https://streams2.sofast.tv/sofastplayout/WiseM3U8_1/master.m3u8"
  },
  {
    "name": "Channel 1 TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/QdKhx6tn/20260918-110445.png",
    "streamUrl": "https://stream.ottplus.live/live/channel_1_hd_abr/index.m3u8"
  },
  {
    "name": "Star Sports SL 2",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/rmczbb8g/20240825_060019.png",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/9401.ts"
  },
  {
    "name": "Discovery Turbo",
    "category": "Discovery",
    "logo": "https://upload.wikimedia.org/wikipedia/commons/1/11/Discovery_Turbo.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/23917.ts"
  },
  {
    "name": "Adventure Earth ENG",
    "category": "Discovery",
    "logo": "https://www.sefiles.net/merchant/5511/images/site/logo_ae_300x80.png",
    "streamUrl": "https://autentic-adventure-earth-1-gb.lg.wurl.tv/playlist.m3u8"
  },
  {
    "name": "ANIMAL PLANET ENG",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/rF32bSJg/Animal_Planet_.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/98873.ts"
  },
  {
    "name": "Nat Geo Wild HD ENG",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/RVNzXPcb/Nag_Geo_Wild.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/71417.ts"
  },
  {
    "name": "Bangla Waz",
    "category": "ISLAM",
    "logo": "https://i.postimg.cc/GhVnNkQq/20260918-145512.png",
    "streamUrl": "https://live20.bozztv.com/giatvplayout7/giatv-209617/tracks-v1a1/mono.ts.m3u8"
  },
  {
    "name": "ARY MUSIC HD",
    "category": "Music",
    "logo": "https://i1.sndcdn.com/avatars-000391064673-s81kqo-t240x240.jpg",
    "streamUrl": "http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/18309.ts"
  },
  {
    "name": "ESPN 3",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/kXBdfjxQ/20260918-145258.png",
    "streamUrl": "http://opplex.ch:8080/live/abdulrehman/12345678/347278.ts"
  },
  {
    "name": "ESPN 2",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/jdLrZ8zy/20260918-145357.png",
    "streamUrl": "http://opplex.ch:8080/live/abdulrehn/12345678/347278.ts"
  },
  {
    "name": "DISCOVERY SCIENCE Hindi",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/CLXptjNP/01315391144.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/4745.ts"
  },
  {
    "name": "Wipeout Xtra Powered by Banijay",
    "category": "Discovery",
    "logo": "https://tvpnlogopeu.samsungcloud.tv/platform/image/sourcelogo/vc/00/02/34/GBBD3000001QB_20250107T030832SQUARE.png",
    "streamUrl": "https://d36nnn435goed2.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-skhf82opa3tf4/WipeoutXtraPoweredbyBanijay_GB.m3u8"
  },
  {
    "name": "Sport Fishing TV",
    "category": "Discovery",
    "logo": "https://d229kpbsb5jevy.cloudfront.net/yuppfast/content/common/channel/logos/sport-fishing-tv.png",
    "streamUrl": "https://streams2.sofast.tv/v1/master/611d79b11b77e2f571934fd80ca1413453772ac7/eea68b79-bfe2-451e-a227-d637a5b9548a/manifest.m3u8"
  },
  {
    "name": "GOLD TV Sci-Fi Movies HD",
    "category": "MOVIE",
    "logo": "https://go4.pw/GOLDTV/gold tv.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/621134.ts"
  },
  {
    "name": "Sony Pal",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/ZKChVfr3/20260918-145037.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72151.ts"
  },
  {
    "name": "Sony Wah",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/xjs2Grbd/20260918-144735.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72152.ts"
  },
  {
    "name": "beIN Sports Xtra",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/h4CB8F7t/20260918-143710.png",
    "streamUrl": "https://bein-esp-xumo.amagi.tv/playlistR720P.m3u8"
  },
  {
    "name": "Bein Sports 1",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/HWSg0G7W/20260918-143801.png",
    "streamUrl": "http://host.phorious.art/validation/377?deviceMac=10:27:BE:25:67:80&split=33da9c80155413830543e27c8520ba99&smart=1"
  },
  {
    "name": "DAZN LALIGA",
    "category": "SPORTS",
    "logo": "https://i.postimg.cc/gkYxjPb9/20260917-171759.png",
    "streamUrl": "http://31.43.191.125:8080/live/20102023/123456789/243.ts"
  },
  {
    "name": "Super Sport LaLiga",
    "category": "SPORTS",
    "logo": "https://i.imgur.com/Fx1n84p.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/348267.ts"
  },
  {
    "name": "MTV India HD",
    "category": "Bangladesh",
    "logo": "https://go4.pw/PHILIPINES/MTV_Asia.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/510261.ts"
  },
  {
    "name": "&pictures HD",
    "category": "MOVIE",
    "logo": "https://go4.pw/ASIA/INDIA/and-picture.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72165.ts"
  },
  {
    "name": "Enter 10 Movies",
    "category": "MOVIE",
    "logo": "https://go4.pw/ASIA/INDIAN/ENTER10MOVIES.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72195.ts"
  },
  {
    "name": "B4U Movies",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/ZYP9J5gM/B4U-Movie.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72155.ts"
  },
  {
    "name": "Big Magic HD",
    "category": "MOVIE",
    "logo": "https://go4.pw/India/_BIG MAGIC .png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72173.ts"
  },
  {
    "name": "Comedy Active",
    "category": "MOVIE",
    "logo": "https://go4.pw/ASIA/INDIA/comedy-active.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72177.ts"
  },
  {
    "name": "&explorer HD",
    "category": "MOVIE",
    "logo": "https://go4.pw/India/&explorer.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/510293.ts"
  },
  {
    "name": "Discovery Bangla",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/d1P1KbjW/20260917-182634.png",
    "streamUrl": "http://sm-monirul.xyz/@monirul_Islam_SM/exp.php?id=discovery_bangla&sm=.m3u8"
  },
  {
    "name": "Travelxp HD",
    "category": "Discovery",
    "logo": "https://i.postimg.cc/K8xznqFF/20260919-103738.png",
    "streamUrl": "http://66.102.126.10:8000/play/a075/index.m3u8"
  },
  {
    "name": "Miniplex HD",
    "category": "MOVIE",
    "logo": "https://go4.pw/ASIA/INDIA/miniplex-1.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72212.ts"
  },
  {
    "name": "&xplor FHD",
    "category": "MOVIE",
    "logo": "https://go4.pw/ASIA/INDIA/AND-XPLOR.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/809016.ts"
  },
  {
    "name": "Goldmines",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/jq6WRS96/Goldmines.png",
    "streamUrl": "http://mxonlive.xyz/live/xap/112972.m3u8?e=1788562844&token=8b0078215eca2a688bca1e9ab693db1d8414aa296d03a719653f036d5acc8188"
  },
  {
    "name": "Goldmines Movies",
    "category": "MOVIE",
    "logo": "https://i.postimg.cc/sfPB3g8c/Goldmines-Movie.png",
    "streamUrl": "http://mxonlive.xyz/live/xap/112973.m3u8?e=1788562844&token=e1f541bfa14115895c0bf6ded47837db4f513667ae98bb9678e4a67223a7e4de"
  },
  {
    "name": "Duronto TV",
    "category": "Bangladesh",
    "logo": "https://i.postimg.cc/J73yRzgj/Duronto-tv.png",
    "streamUrl": "http://rgkkw.live:8080/live/4dfoydR2gZ/clever3still/433.ts"
  },
  {
    "name": "Zoom TV HD",
    "category": "Music",
    "logo": "https://go4.pw/ASIA/INDIAN/ZOOMTVHD.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/72160.ts"
  },
  {
    "name": "ShowBox Music",
    "category": "Music",
    "logo": "https://go4.pw/ASIA/INDIA/SHOWBOX_MUSIC.png",
    "streamUrl": "http://cccoooeee.com:80/live/2AVDHSB/DP3YEBK/510230.ts"
  },
  {
    "name": "Lionsgate Play Hindi",
    "category": "MOVIE",
    "logo": "https://imgur.com/79g2kMA.",
    "streamUrl": "http://103.159.180.34:5001/live/2327.m3u8"
  },
  {
    "name": "Willow Cricket Extra",
    "category": "SPORTS",
    "logo": "https://i.imgur.com/eOybZMU.png",
    "streamUrl": "http://opplex.ch:8080/live/abdulrehman/12345678/346240.ts"
  },
  {
    "name": "ESPN Deportes VIVO LALIGA",
    "category": "SPORTS",
    "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/ESPN_Deportes.svg/960px-ESPN_Deportes.svg.png",
    "streamUrl": "http://168.228.44.241:9998/play/a0dz/index.m3u8"
  },
  {
    "name": "Sony BBC Earth HD HINDI",
    "category": "Discovery",
    "logo": "https://jiotvimages.cdn.jio.com/dare_images/images/SonyBBCEarthEng.png",
    "streamUrl": "http://alpha3-ott.me:80/play/live.php?mac=00:1B:79:47:12:B3&stream=1118064&extension=ts&play_token=8jt8ds0Mp8"
  },
  {
    "name": "Movistar LaLiga ES VIP SPORTS",
    "category": "SPORTS",
    "logo": "https://i.ibb.co/GfbCxZYH/Super-Sport-La-Liga.png",
    "streamUrl": "http://fonziptv.com:8080/live/pedrogaspar/SgbhzZuDyB/19549.ts"
  },
  {
    "name": "LaLigaTV FHD",
    "category": "SPORTS",
    "logo": "https://static.epg.best/es/LaLigaTV.es.png",
    "streamUrl": "http://mag.max-cdn.com:80/play/live.php?mac=00:1B:79:4D:15:5E&stream=761953&extension=ts&play_token=KCzACCmj1w"
  },
  {
    "name": "Bein Sports 2",
    "category": "SPORTS",
    "logo": "https://i.imgur.com/qxMCL3I.png",
    "streamUrl": "http://opplex.ch:8080/live/abdulrehman/12345678/347264.ts"
  }
];

module.exports = inputJson;
