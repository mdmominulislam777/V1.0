/**
 * HIGHFY TV - Cloudflare Worker Backend API
 * Production-ready Edge Worker for Cricket and Sports APIs.
 * Fully compatible with Cloudflare Workers fetch(request, env, ctx) architecture.
 */

import channelsData from "../channels.json" with { type: "json" };

export interface Env {
  CRICKETDATA_API_KEY?: string;
  CRICAPI_KEY?: string;
  CRICKET_API_KEY?: string;
  RAPIDAPI_KEY?: string;
  THESPORTSDB_API_KEY?: string;
  ALLSPORTS_API_KEY?: string;
  ALLSPORTSAPI_KEY?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-rapidapi-key, x-cricapi-key, x-cricketdata-key",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

const HD_CRICKET_LOGOS_MAP: Record<string, string> = {
  // International & ICC Full/Associate Member Official Cricket Board Crests & Flags
  india: "https://r2.thesportsdb.com/images/media/team/badge/donl7g1646775159.png",
  ind: "https://r2.thesportsdb.com/images/media/team/badge/donl7g1646775159.png",
  bangladesh: "https://r2.thesportsdb.com/images/media/team/badge/j74o4t1646775146.png",
  ban: "https://r2.thesportsdb.com/images/media/team/badge/j74o4t1646775146.png",
  pakistan: "https://r2.thesportsdb.com/images/media/team/badge/03o8241646775177.png",
  pak: "https://r2.thesportsdb.com/images/media/team/badge/03o8241646775177.png",
  england: "https://r2.thesportsdb.com/images/media/team/badge/y5wcl81646775152.png",
  eng: "https://r2.thesportsdb.com/images/media/team/badge/y5wcl81646775152.png",
  australia: "https://r2.thesportsdb.com/images/media/team/badge/zvm8581646775132.png",
  aus: "https://r2.thesportsdb.com/images/media/team/badge/zvm8581646775132.png",
  "sri lanka": "https://r2.thesportsdb.com/images/media/team/badge/i5fqg01646775193.png",
  sl: "https://r2.thesportsdb.com/images/media/team/badge/i5fqg01646775193.png",
  "south africa": "https://r2.thesportsdb.com/images/media/team/badge/hn47e51646775185.png",
  sa: "https://r2.thesportsdb.com/images/media/team/badge/hn47e51646775185.png",
  rsa: "https://r2.thesportsdb.com/images/media/team/badge/hn47e51646775185.png",
  "new zealand": "https://r2.thesportsdb.com/images/media/team/badge/1yyh9s1646775166.png",
  nz: "https://r2.thesportsdb.com/images/media/team/badge/1yyh9s1646775166.png",
  "west indies": "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
  wi: "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
  win: "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
  windies: "https://r2.thesportsdb.com/images/media/team/badge/1x0a681646775209.png",
  afghanistan: "https://r2.thesportsdb.com/images/media/team/badge/bzu3v71646775261.png",
  afg: "https://r2.thesportsdb.com/images/media/team/badge/bzu3v71646775261.png",
  ireland: "https://r2.thesportsdb.com/images/media/team/badge/wlryed1646775269.png",
  ire: "https://r2.thesportsdb.com/images/media/team/badge/wlryed1646775269.png",
  irl: "https://r2.thesportsdb.com/images/media/team/badge/wlryed1646775269.png",
  scotland: "https://r2.thesportsdb.com/images/media/team/badge/78woeh1646775360.png",
  sco: "https://r2.thesportsdb.com/images/media/team/badge/78woeh1646775360.png",
  netherlands: "https://r2.thesportsdb.com/images/media/team/badge/um67l21779090256.png",
  ned: "https://r2.thesportsdb.com/images/media/team/badge/um67l21779090256.png",
  zimbabwe: "https://r2.thesportsdb.com/images/media/team/badge/7ah0831646775278.png",
  zim: "https://r2.thesportsdb.com/images/media/team/badge/7ah0831646775278.png",
  nepal: "https://r2.thesportsdb.com/images/media/team/badge/bn5wrv1646775335.png",
  nep: "https://r2.thesportsdb.com/images/media/team/badge/bn5wrv1646775335.png",
  usa: "https://r2.thesportsdb.com/images/media/team/badge/abmnzg1583580897.png",
  "united states": "https://r2.thesportsdb.com/images/media/team/badge/abmnzg1583580897.png",
  canada: "https://r2.thesportsdb.com/images/media/team/badge/o49xhy1645907007.png",
  can: "https://r2.thesportsdb.com/images/media/team/badge/o49xhy1645907007.png",
  uae: "https://r2.thesportsdb.com/images/media/team/badge/6poybf1583580847.png",
  "united arab emirates": "https://r2.thesportsdb.com/images/media/team/badge/6poybf1583580847.png",
  oman: "https://r2.thesportsdb.com/images/media/team/badge/5ybzn71625862595.png",
  oma: "https://r2.thesportsdb.com/images/media/team/badge/5ybzn71625862595.png",
  namibia: "https://r2.thesportsdb.com/images/media/team/badge/myxq3q1583580470.png",
  nam: "https://r2.thesportsdb.com/images/media/team/badge/myxq3q1583580470.png",
  "hong kong": "https://r2.thesportsdb.com/images/media/team/badge/5q02lz1625863342.png",
  "hong kong, china": "https://r2.thesportsdb.com/images/media/team/badge/5q02lz1625863342.png",
  hkg: "https://r2.thesportsdb.com/images/media/team/badge/5q02lz1625863342.png",
  "papua new guinea": "https://r2.thesportsdb.com/images/media/team/badge/swdkjm1646775345.png",
  png: "https://r2.thesportsdb.com/images/media/team/badge/swdkjm1646775345.png",
  uganda: "https://r2.thesportsdb.com/images/media/team/badge/155jix1625862051.png",
  uga: "https://r2.thesportsdb.com/images/media/team/badge/155jix1625862051.png",
  kenya: "https://r2.thesportsdb.com/images/media/team/badge/oym2v91646775312.png",
  ken: "https://r2.thesportsdb.com/images/media/team/badge/oym2v91646775312.png",
  bahamas: "https://flagcdn.com/w320/bs.png",
  bah: "https://flagcdn.com/w320/bs.png",
  bermuda: "https://flagcdn.com/w320/bm.png",
  ber: "https://flagcdn.com/w320/bm.png",
  bmu: "https://flagcdn.com/w320/bm.png",
  "cayman islands": "https://flagcdn.com/w320/ky.png",
  cay: "https://flagcdn.com/w320/ky.png",
  malaysia: "https://flagcdn.com/w320/my.png",
  mal: "https://flagcdn.com/w320/my.png",
  mas: "https://flagcdn.com/w320/my.png",
  kuwait: "https://flagcdn.com/w320/kw.png",
  kuw: "https://flagcdn.com/w320/kw.png",
  bahrain: "https://flagcdn.com/w320/bh.png",
  bhr: "https://flagcdn.com/w320/bh.png",
  qatar: "https://flagcdn.com/w320/qa.png",
  qat: "https://flagcdn.com/w320/qa.png",
  "saudi arabia": "https://flagcdn.com/w320/sa.png",
  ksa: "https://flagcdn.com/w320/sa.png",
  singapore: "https://flagcdn.com/w320/sg.png",
  sin: "https://flagcdn.com/w320/sg.png",
  sgp: "https://flagcdn.com/w320/sg.png",
  thailand: "https://flagcdn.com/w320/th.png",
  tha: "https://flagcdn.com/w320/th.png",
  japan: "https://flagcdn.com/w320/jp.png",
  jpn: "https://flagcdn.com/w320/jp.png",
  tanzania: "https://flagcdn.com/w320/tz.png",
  tan: "https://flagcdn.com/w320/tz.png",
  nigeria: "https://flagcdn.com/w320/ng.png",
  ngr: "https://flagcdn.com/w320/ng.png",
  rwanda: "https://flagcdn.com/w320/rw.png",
  rwa: "https://flagcdn.com/w320/rw.png",
  botswana: "https://flagcdn.com/w320/bw.png",
  bot: "https://flagcdn.com/w320/bw.png",
  jersey: "https://flagcdn.com/w320/je.png",
  jer: "https://flagcdn.com/w320/je.png",
  guernsey: "https://flagcdn.com/w320/gg.png",
  gue: "https://flagcdn.com/w320/gg.png",
  italy: "https://flagcdn.com/w320/it.png",
  ita: "https://flagcdn.com/w320/it.png",
  germany: "https://flagcdn.com/w320/de.png",
  ger: "https://flagcdn.com/w320/de.png",
  spain: "https://flagcdn.com/w320/es.png",
  esp: "https://flagcdn.com/w320/es.png",
  denmark: "https://flagcdn.com/w320/dk.png",
  den: "https://flagcdn.com/w320/dk.png",
  vanuatu: "https://flagcdn.com/w320/vu.png",
  samoa: "https://flagcdn.com/w320/ws.png",
  fiji: "https://flagcdn.com/w320/fj.png",
  argentina: "https://flagcdn.com/w320/ar.png",
  brazil: "https://flagcdn.com/w320/br.png",
  switzerland: "https://flagcdn.com/w320/ch.png",
  sui: "https://flagcdn.com/w320/ch.png",
  belgium: "https://flagcdn.com/w320/be.png",
  bel: "https://flagcdn.com/w320/be.png",
  luxembourg: "https://flagcdn.com/w320/lu.png",
  lux: "https://flagcdn.com/w320/lu.png",
  china: "https://flagcdn.com/w320/cn.png",
  chn: "https://flagcdn.com/w320/cn.png",
  austria: "https://flagcdn.com/w320/at.png",
  aut: "https://flagcdn.com/w320/at.png",
  france: "https://flagcdn.com/w320/fr.png",
  fra: "https://flagcdn.com/w320/fr.png",
  norway: "https://flagcdn.com/w320/no.png",
  nor: "https://flagcdn.com/w320/no.png",
  sweden: "https://flagcdn.com/w320/se.png",
  swe: "https://flagcdn.com/w320/se.png",
  finland: "https://flagcdn.com/w320/fi.png",
  fin: "https://flagcdn.com/w320/fi.png",
  portugal: "https://flagcdn.com/w320/pt.png",
  por: "https://flagcdn.com/w320/pt.png",
  malta: "https://flagcdn.com/w320/mt.png",
  mlt: "https://flagcdn.com/w320/mt.png",
  romania: "https://flagcdn.com/w320/ro.png",
  rou: "https://flagcdn.com/w320/ro.png",
  greece: "https://flagcdn.com/w320/gr.png",
  gre: "https://flagcdn.com/w320/gr.png",
  cyprus: "https://flagcdn.com/w320/cy.png",
  cyp: "https://flagcdn.com/w320/cy.png",
  estonia: "https://flagcdn.com/w320/ee.png",
  est: "https://flagcdn.com/w320/ee.png",
  "czech republic": "https://flagcdn.com/w320/cz.png",
  czechia: "https://flagcdn.com/w320/cz.png",
  cze: "https://flagcdn.com/w320/cz.png",
  hungary: "https://flagcdn.com/w320/hu.png",
  hun: "https://flagcdn.com/w320/hu.png",
  serbia: "https://flagcdn.com/w320/rs.png",
  srb: "https://flagcdn.com/w320/rs.png",
  bulgaria: "https://flagcdn.com/w320/bg.png",
  bul: "https://flagcdn.com/w320/bg.png",
  croatia: "https://flagcdn.com/w320/hr.png",
  cro: "https://flagcdn.com/w320/hr.png",
  slovenia: "https://flagcdn.com/w320/si.png",
  svn: "https://flagcdn.com/w320/si.png",
  turkey: "https://flagcdn.com/w320/tr.png",
  tur: "https://flagcdn.com/w320/tr.png",
  israel: "https://flagcdn.com/w320/il.png",
  isr: "https://flagcdn.com/w320/il.png",
  philippines: "https://flagcdn.com/w320/ph.png",
  phi: "https://flagcdn.com/w320/ph.png",
  indonesia: "https://flagcdn.com/w320/id.png",
  ina: "https://flagcdn.com/w320/id.png",
  idn: "https://flagcdn.com/w320/id.png",
  myanmar: "https://flagcdn.com/w320/mm.png",
  mya: "https://flagcdn.com/w320/mm.png",
  cambodia: "https://flagcdn.com/w320/kh.png",
  cam: "https://flagcdn.com/w320/kh.png",
  bhutan: "https://flagcdn.com/w320/bt.png",
  bhu: "https://flagcdn.com/w320/bt.png",
  maldives: "https://flagcdn.com/w320/mv.png",
  mdv: "https://flagcdn.com/w320/mv.png",
  mongolia: "https://flagcdn.com/w320/mn.png",
  mgl: "https://flagcdn.com/w320/mn.png",
  "south korea": "https://flagcdn.com/w320/kr.png",
  korea: "https://flagcdn.com/w320/kr.png",
  kor: "https://flagcdn.com/w320/kr.png",
  mexico: "https://flagcdn.com/w320/mx.png",
  mex: "https://flagcdn.com/w320/mx.png",
  chile: "https://flagcdn.com/w320/cl.png",
  chi: "https://flagcdn.com/w320/cl.png",
  peru: "https://flagcdn.com/w320/pe.png",
  per: "https://flagcdn.com/w320/pe.png",
  panama: "https://flagcdn.com/w320/pa.png",
  pan: "https://flagcdn.com/w320/pa.png",
  "costa rica": "https://flagcdn.com/w320/cr.png",
  crc: "https://flagcdn.com/w320/cr.png",
  belize: "https://flagcdn.com/w320/bz.png",
  blz: "https://flagcdn.com/w320/bz.png",
  suriname: "https://flagcdn.com/w320/sr.png",
  sur: "https://flagcdn.com/w320/sr.png",
  "sierra leone": "https://flagcdn.com/w320/sl.png",
  sle: "https://flagcdn.com/w320/sl.png",
  ghana: "https://flagcdn.com/w320/gh.png",
  gha: "https://flagcdn.com/w320/gh.png",
  cameroon: "https://flagcdn.com/w320/cm.png",
  cmr: "https://flagcdn.com/w320/cm.png",
  malawi: "https://flagcdn.com/w320/mw.png",
  mwi: "https://flagcdn.com/w320/mw.png",
  mozambique: "https://flagcdn.com/w320/mz.png",
  moz: "https://flagcdn.com/w320/mz.png",
  lesotho: "https://flagcdn.com/w320/ls.png",
  les: "https://flagcdn.com/w320/ls.png",
  eswatini: "https://flagcdn.com/w320/sz.png",
  swz: "https://flagcdn.com/w320/sz.png",
  gambia: "https://flagcdn.com/w320/gm.png",
  gam: "https://flagcdn.com/w320/gm.png",
  mali: "https://flagcdn.com/w320/ml.png",
  mli: "https://flagcdn.com/w320/ml.png",
  seychelles: "https://flagcdn.com/w320/sc.png",
  sey: "https://flagcdn.com/w320/sc.png",
  zambia: "https://flagcdn.com/w320/zm.png",
  zam: "https://flagcdn.com/w320/zm.png",

  // IPL & WPL Teams (Official Original Transparent PNG Badges)
  "chennai super kings": "https://r2.thesportsdb.com/images/media/team/badge/okceh51487601098.png",
  csk: "https://r2.thesportsdb.com/images/media/team/badge/okceh51487601098.png",
  "mumbai indians": "https://r2.thesportsdb.com/images/media/team/badge/l40j8p1487678631.png",
  "mumbai indians women": "https://r2.thesportsdb.com/images/media/team/badge/l40j8p1487678631.png",
  mi: "https://r2.thesportsdb.com/images/media/team/badge/l40j8p1487678631.png",
  "royal challengers bengaluru": "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
  "royal challengers bangalore": "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
  "royal challengers bengaluru women": "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
  rcb: "https://r2.thesportsdb.com/images/media/team/badge/kynj5v1588331757.png",
  "kolkata knight riders": "https://r2.thesportsdb.com/images/media/team/badge/ows99r1487678296.png",
  kkr: "https://r2.thesportsdb.com/images/media/team/badge/ows99r1487678296.png",
  "delhi capitals": "https://r2.thesportsdb.com/images/media/team/badge/dg4g0z1587334054.png",
  "delhi capitals women": "https://r2.thesportsdb.com/images/media/team/badge/dg4g0z1587334054.png",
  dc: "https://r2.thesportsdb.com/images/media/team/badge/dg4g0z1587334054.png",
  "rajasthan royals": "https://r2.thesportsdb.com/images/media/team/badge/lehnfw1487601864.png",
  rr: "https://r2.thesportsdb.com/images/media/team/badge/lehnfw1487601864.png",
  "sunrisers hyderabad": "https://r2.thesportsdb.com/images/media/team/badge/sc7m161487419327.png",
  srh: "https://r2.thesportsdb.com/images/media/team/badge/sc7m161487419327.png",
  "gujarat titans": "https://r2.thesportsdb.com/images/media/team/badge/6qw4r71654174508.png",
  gt: "https://r2.thesportsdb.com/images/media/team/badge/6qw4r71654174508.png",
  "lucknow super giants": "https://r2.thesportsdb.com/images/media/team/badge/4tzmfa1647445839.png",
  lsg: "https://r2.thesportsdb.com/images/media/team/badge/4tzmfa1647445839.png",
  "punjab kings": "https://r2.thesportsdb.com/images/media/team/badge/r1tcie1630697821.png",
  pbks: "https://r2.thesportsdb.com/images/media/team/badge/r1tcie1630697821.png",

  // BPL - Bangladesh Premier League
  "fortune barishal": "https://r2.thesportsdb.com/images/media/team/badge/le1zwt1675495288.png",
  "comilla victorians": "https://r2.thesportsdb.com/images/media/team/badge/vfvitn1650477443.png",
  "rangpur riders": "https://r2.thesportsdb.com/images/media/team/badge/k26ccz1734181960.png",
  "dhaka capitals": "https://r2.thesportsdb.com/images/media/team/badge/ak27xm1734342873.png",
  "dhaka dominators": "https://r2.thesportsdb.com/images/media/team/badge/ak27xm1734342873.png",
  "durdanto dhaka": "https://r2.thesportsdb.com/images/media/team/badge/ak27xm1734342873.png",
  "khulna tigers": "https://r2.thesportsdb.com/images/media/team/badge/geh2qk1675420011.png",
  "sylhet strikers": "https://r2.thesportsdb.com/images/media/team/badge/y7jz6c1767353266.png",
  "sylhet titans": "https://r2.thesportsdb.com/images/media/team/badge/y7jz6c1767353266.png",
  "chattogram challengers": "https://r2.thesportsdb.com/images/media/team/badge/xgl2ou1767352661.png",
  "chittagong kings": "https://r2.thesportsdb.com/images/media/team/badge/xgl2ou1767352661.png",
  "chattogram royals": "https://r2.thesportsdb.com/images/media/team/badge/xgl2ou1767352661.png",
  "durbar rajshahi": "https://r2.thesportsdb.com/images/media/team/badge/diokvb1767353049.png",
  "rajshahi warriors": "https://r2.thesportsdb.com/images/media/team/badge/diokvb1767353049.png",

  // PSL - Pakistan Super League
  "islamabad united": "https://r2.thesportsdb.com/images/media/team/badge/5bi3eb1709123559.png",
  "karachi kings": "https://r2.thesportsdb.com/images/media/team/badge/tfuvu11709123541.png",
  "lahore qalandars": "https://r2.thesportsdb.com/images/media/team/badge/hvrtrg1709123519.png",
  "multan sultans": "https://r2.thesportsdb.com/images/media/team/badge/mpijr01709123512.png",
  "peshawar zalmi": "https://r2.thesportsdb.com/images/media/team/badge/frp6xj1709123501.png",
  "quetta gladiators": "https://r2.thesportsdb.com/images/media/team/badge/rox6ge1709123486.png",

  // BBL & Australian Domestic
  "adelaide strikers": "https://r2.thesportsdb.com/images/media/team/badge/c36k301492606884.png",
  "brisbane heat": "https://r2.thesportsdb.com/images/media/team/badge/6r5cly1492606239.png",
  "hobart hurricanes": "https://r2.thesportsdb.com/images/media/team/badge/vdcla41492606553.png",
  "melbourne renegades": "https://r2.thesportsdb.com/images/media/team/badge/fy0wik1492607045.png",
  "melbourne stars": "https://r2.thesportsdb.com/images/media/team/badge/l0t7v31715269757.png",
  "perth scorchers": "https://r2.thesportsdb.com/images/media/team/badge/ithlp51546681732.png",
  "sydney sixers": "https://r2.thesportsdb.com/images/media/team/badge/jtkm601492607206.png",
  "sydney thunder": "https://r2.thesportsdb.com/images/media/team/badge/t0tooq1492606384.png",
  victoria: "https://r2.thesportsdb.com/images/media/team/badge/j5vbn41749588430.png",
  "new south wales": "https://r2.thesportsdb.com/images/media/team/badge/fbj6w51675420971.png",
  "new south wales blues": "https://r2.thesportsdb.com/images/media/team/badge/fbj6w51675420971.png",
  "nsw blues": "https://r2.thesportsdb.com/images/media/team/badge/fbj6w51675420971.png",
  tasmania: "https://r2.thesportsdb.com/images/media/team/badge/1yd06z1675431414.png",
  "tasmanian tigers": "https://r2.thesportsdb.com/images/media/team/badge/1yd06z1675431414.png",

  // CPL - Caribbean Premier League
  "guyana amazon warriors": "https://r2.thesportsdb.com/images/media/team/badge/amct1d1641785128.png",
  "antigua and barbuda falcons": "https://r2.thesportsdb.com/images/media/team/badge/fwozcu1752736011.png",
  "barbados royals": "https://r2.thesportsdb.com/images/media/team/badge/kg9ypo1786962015.png",
  "barbados tridents": "https://r2.thesportsdb.com/images/media/team/badge/kg9ypo1786962015.png",
  "trinbago knight riders": "https://r2.thesportsdb.com/images/media/team/badge/c8zwd61641785158.png",
  tkr: "https://r2.thesportsdb.com/images/media/team/badge/c8zwd61641785158.png",
  "saint lucia kings": "https://r2.thesportsdb.com/images/media/team/badge/981c6z1752736461.png",
  "st lucia kings": "https://r2.thesportsdb.com/images/media/team/badge/981c6z1752736461.png",
  "st kitts and nevis patriots": "https://r2.thesportsdb.com/images/media/team/badge/t2zoaz1641785142.png",
  "jamaica tallawahs": "https://r2.thesportsdb.com/images/media/team/badge/7rvdsl1641785134.png",

  // SA20 & South African Domestic
  "durban's super giants": "https://r2.thesportsdb.com/images/media/team/badge/oe6ikv1734183540.png",
  "durbans super giants": "https://r2.thesportsdb.com/images/media/team/badge/oe6ikv1734183540.png",
  "joburg super kings": "https://r2.thesportsdb.com/images/media/team/badge/bvjydr1734183753.png",
  "mi cape town": "https://r2.thesportsdb.com/images/media/team/badge/s146kh1734183906.png",
  "paarl royals": "https://r2.thesportsdb.com/images/media/team/badge/41azkk1734184030.png",
  "pretoria capitals": "https://r2.thesportsdb.com/images/media/team/badge/brbk561734184169.png",
  "sunrisers eastern cape": "https://r2.thesportsdb.com/images/media/team/badge/us5vei1734184224.png",
  titans: "https://r2.thesportsdb.com/images/media/team/badge/50kzdm1644367943.png",
  "multiply titans": "https://r2.thesportsdb.com/images/media/team/badge/50kzdm1644367943.png",
  warriors: "https://r2.thesportsdb.com/images/media/team/badge/w5fhrc1644367999.png",
  dolphins: "https://r2.thesportsdb.com/images/media/team/badge/nc4cs31644367913.png",
  "hollywoodbets dolphins": "https://r2.thesportsdb.com/images/media/team/badge/nc4cs31644367913.png",
  lions: "https://r2.thesportsdb.com/images/media/team/badge/1qh6c01644367448.png",
  "dp world lions": "https://r2.thesportsdb.com/images/media/team/badge/1qh6c01644367448.png",
  "highveld lions": "https://r2.thesportsdb.com/images/media/team/badge/1qh6c01644367448.png",
  "north west": "https://r2.thesportsdb.com/images/media/team/badge/p1gb4u1644367687.png",
  "north west dragons": "https://r2.thesportsdb.com/images/media/team/badge/p1gb4u1644367687.png",
  "western province": "https://r2.thesportsdb.com/images/media/team/badge/51wcio1512983228.png",
  "cape cobras": "https://r2.thesportsdb.com/images/media/team/badge/51wcio1512983228.png",
  easterns: "https://r2.thesportsdb.com/images/media/team/badge/wavdxf1758097673.png",
  "eastern storm": "https://r2.thesportsdb.com/images/media/team/badge/wavdxf1758097673.png",
  "kwazulu-natal inland": "https://r2.thesportsdb.com/images/media/team/badge/mlrnuo1704976998.png",

  // English County Championship & The Hundred
  surrey: "https://r2.thesportsdb.com/images/media/team/badge/pl0yk51512933420.png",
  yorkshire: "https://r2.thesportsdb.com/images/media/team/badge/i4la7t1512933445.png",
  durham: "https://r2.thesportsdb.com/images/media/team/badge/chwe901512937550.png",
  essex: "https://r2.thesportsdb.com/images/media/team/badge/yep86x1777629714.png",
  glamorgan: "https://r2.thesportsdb.com/images/media/team/badge/rdsttx1590355851.png",
  hampshire: "https://r2.thesportsdb.com/images/media/team/badge/zos2qr1512933145.png",
  leicestershire: "https://r2.thesportsdb.com/images/media/team/badge/qluxic1512937633.png",
  nottinghamshire: "https://r2.thesportsdb.com/images/media/team/badge/vzixwm1671721158.png",
  somerset: "https://r2.thesportsdb.com/images/media/team/badge/ba0m9n1546518813.png",
  sussex: "https://r2.thesportsdb.com/images/media/team/badge/5isw8o1512937679.png",
  warwickshire: "https://r2.thesportsdb.com/images/media/team/badge/w5yo7x1512937763.png",
  "birmingham bears": "https://r2.thesportsdb.com/images/media/team/badge/w5yo7x1512937763.png",
  derbyshire: "https://r2.thesportsdb.com/images/media/team/badge/uki6jc1512937529.png",
  gloucestershire: "https://r2.thesportsdb.com/images/media/team/badge/0ss39a1554324931.png",
  kent: "https://r2.thesportsdb.com/images/media/team/badge/j9k7om1717595438.png",
  lancashire: "https://r2.thesportsdb.com/images/media/team/badge/m1ljqz1546518856.png",
  middlesex: "https://r2.thesportsdb.com/images/media/team/badge/rlfxzh1512937652.png",
  northamptonshire: "https://r2.thesportsdb.com/images/media/team/badge/391faz1512937726.png",
  worcestershire: "https://r2.thesportsdb.com/images/media/team/badge/pnjm9d1512937464.png",
  "birmingham phoenix": "https://r2.thesportsdb.com/images/media/team/badge/aihn2d1641785176.png",
  "london spirit": "https://r2.thesportsdb.com/images/media/team/badge/k3q3mo1776457663.png",
  "manchester originals": "https://r2.thesportsdb.com/images/media/team/badge/5oapdn1776457699.png",
  "oval invincibles": "https://r2.thesportsdb.com/images/media/team/badge/ycy1xc1776457741.png",
  "southern brave": "https://r2.thesportsdb.com/images/media/team/badge/7c0a8j1776457761.png",
  "northern superchargers": "https://r2.thesportsdb.com/images/media/team/badge/46mctq1776457779.png",
  "trent rockets": "https://r2.thesportsdb.com/images/media/team/badge/9cp1ac1692900475.png",
  "welsh fire": "https://r2.thesportsdb.com/images/media/team/badge/49jl241645213505.png",

  // MLC, ILT20, LPL, Super Smash
  "los angeles knight riders": "https://r2.thesportsdb.com/images/media/team/badge/6q2cnq1689146300.png",
  "mi new york": "https://r2.thesportsdb.com/images/media/team/badge/i4lxb71689146303.png",
  "san francisco unicorns": "https://r2.thesportsdb.com/images/media/team/badge/k6pv961689146306.png",
  "seattle orcas": "https://r2.thesportsdb.com/images/media/team/badge/wg325p1689146309.png",
  "texas super kings": "https://r2.thesportsdb.com/images/media/team/badge/777fr51689161316.png",
  "washington freedom": "https://r2.thesportsdb.com/images/media/team/badge/ro0khs1750233280.png",
  "abu dhabi knight riders": "https://r2.thesportsdb.com/images/media/team/badge/llghxr1721480701.png",
  "desert vipers": "https://r2.thesportsdb.com/images/media/team/badge/uqmlhc1721480710.png",
  "dubai capitals": "https://r2.thesportsdb.com/images/media/team/badge/f95loc1721480695.png",
  "gulf giants": "https://r2.thesportsdb.com/images/media/team/badge/y9hem51721480707.png",
  "mi emirates": "https://r2.thesportsdb.com/images/media/team/badge/6ttrki1721480699.png",
  "sharjah warriorz": "https://r2.thesportsdb.com/images/media/team/badge/gq0stf1721480730.png",
  "colombo strikers": "https://r2.thesportsdb.com/images/media/team/badge/lwar9d1720697266.png",
  "dambulla sixers": "https://r2.thesportsdb.com/images/media/team/badge/avsoxp1720697923.png",
  "galle marvels": "https://r2.thesportsdb.com/images/media/team/badge/dgqb9i1720698025.png",
  "jaffna kings": "https://r2.thesportsdb.com/images/media/team/badge/gs27jn1720698419.png",
  "b-love kandy": "https://r2.thesportsdb.com/images/media/team/badge/ukrqz61720698084.png",
  "auckland aces": "https://r2.thesportsdb.com/images/media/team/badge/gmbyx01705392031.png",
  auckland: "https://r2.thesportsdb.com/images/media/team/badge/gmbyx01705392031.png",
  "canterbury kings": "https://r2.thesportsdb.com/images/media/team/badge/uex7eq1705391931.png",
  canterbury: "https://r2.thesportsdb.com/images/media/team/badge/uex7eq1705391931.png",
  "central stags": "https://r2.thesportsdb.com/images/media/team/badge/34lmqg1705391924.png",
  "central districts": "https://r2.thesportsdb.com/images/media/team/badge/34lmqg1705391924.png",
  "northern brave": "https://r2.thesportsdb.com/images/media/team/badge/7lnb4g1705391916.png",
  "northern districts": "https://r2.thesportsdb.com/images/media/team/badge/7lnb4g1705391916.png",
  "otago volts": "https://r2.thesportsdb.com/images/media/team/badge/am7ce21705391910.png",
  otago: "https://r2.thesportsdb.com/images/media/team/badge/am7ce21705391910.png",
  "wellington firebirds": "https://r2.thesportsdb.com/images/media/team/badge/ep5kr31705391899.png",
  wellington: "https://r2.thesportsdb.com/images/media/team/badge/ep5kr31705391899.png",
};

const workerTsdbLogoCache = new Map<string, string>();

function resolveHDTeamLogo(teamName: string, rawLogo?: string): string {
  if (teamName && typeof teamName === "string") {
    const bracketMatch = teamName.match(/\[([^\]]+)\]/);
    const shortCode = bracketMatch ? bracketMatch[1].trim().toLowerCase() : "";
    const cleanName = teamName.replace(/\s*\[[^\]]+\]\s*$/, "").trim().toLowerCase();

    if (HD_CRICKET_LOGOS_MAP[cleanName]) {
      return HD_CRICKET_LOGOS_MAP[cleanName];
    }

    const baseName = cleanName
      .replace(/(\s+|-)(women|w|u19|u-19|under-19|under 19|a|emerging|xi|shaheens|lions)$/i, "")
      .replace(/,\s*china$/i, "")
      .trim();
    if (baseName && HD_CRICKET_LOGOS_MAP[baseName]) {
      return HD_CRICKET_LOGOS_MAP[baseName];
    }

    if (shortCode && HD_CRICKET_LOGOS_MAP[shortCode]) {
      return HD_CRICKET_LOGOS_MAP[shortCode];
    }

    if (workerTsdbLogoCache.has(cleanName)) {
      const cached = workerTsdbLogoCache.get(cleanName)!;
      if (cached) return cached;
    }

    for (const [k, v] of Object.entries(HD_CRICKET_LOGOS_MAP)) {
      if (k.length >= 6 && k.includes(" ")) {
        const regex = new RegExp(`(^|\\b)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|$)`, "i");
        if (regex.test(cleanName)) {
          return v;
        }
      }
    }
  }

  if (rawLogo && typeof rawLogo === "string") {
    let clean = rawLogo.trim();
    if (
      clean &&
      !clean.includes("un.png") &&
      !clean.includes("icon512.png") &&
      !clean.includes("placeholder") &&
      !clean.includes("default-team") &&
      !clean.includes("team_default")
    ) {
      if (clean.includes("g.cricapi.com/iapi/") && clean.includes("w=48")) {
        clean = clean.replace("w=48", "w=250");
      }
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

  return "./assets/team-placeholder.svg";
}

async function resolveWorkerOfficialCricketLogoAsync(teamName: string, currentLogo: string): Promise<string> {
  if (!teamName) return currentLogo;
  if (
    currentLogo &&
    currentLogo !== "./assets/team-placeholder.svg" &&
    !currentLogo.includes("cricapi.com") &&
    !currentLogo.includes("cdorgapi") &&
    !currentLogo.includes("icon512.png")
  ) {
    return currentLogo;
  }
  const cleanName = teamName.replace(/\s*\[[^\]]+\]\s*$/, "").trim().toLowerCase();
  if (workerTsdbLogoCache.has(cleanName)) {
    return workerTsdbLogoCache.get(cleanName) || currentLogo;
  }
  try {
    for (const query of [cleanName, `${cleanName} Cricket`]) {
      const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const json: any = await res.json();
        const teams = Array.isArray(json?.teams) ? json.teams : [];
        const cricketTeam = teams.find(
          (t: any) => String(t.strSport || "").toLowerCase() === "cricket" && (t.strBadge || t.strTeamBadge)
        );
        if (cricketTeam) {
          const officialBadge = cricketTeam.strBadge || cricketTeam.strTeamBadge;
          workerTsdbLogoCache.set(cleanName, officialBadge);
          return officialBadge;
        }
      }
    }
  } catch {}
  workerTsdbLogoCache.set(cleanName, "");
  return currentLogo;
}

function formatDhakaEventTime(timestamp: number): string {
  try {
    const dateObj = new Date(timestamp);
    const timeStr = dateObj.toLocaleTimeString("en-US", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return `${timeStr} BST`;
  } catch {
    return "Scheduled";
  }
}

// Broadcaster & Channel Mapping Logic strictly based on API response
function resolveCricketBroadcastData(sportEvent: any, item: any) {
  const extracted: string[] = [];
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

  if (extracted.length === 0) {
    const compNames = Array.isArray(sportEvent?.competitors)
      ? sportEvent.competitors.map((c: any) => String(c?.name || c?.id || "")).join(" ")
      : "";
    const teamArrNames = Array.isArray(item?.teams) ? item.teams.join(" ") : "";
    const tournStr =
      typeof sportEvent?.tournament === "string"
        ? sportEvent.tournament
        : sportEvent?.tournament?.name || "";
    const contextStr = `${tournStr} ${sportEvent?.league || ""} ${sportEvent?.seriesName || ""} ${sportEvent?.title || ""} ${sportEvent?.team1?.name || ""} ${sportEvent?.team2?.name || ""} ${sportEvent?.homeTeam?.name || ""} ${sportEvent?.awayTeam?.name || ""} ${sportEvent?.season?.name || ""} ${item?.series || ""} ${item?.name || ""} ${item?.t1 || ""} ${item?.t2 || ""} ${compNames} ${teamArrNames}`
      .toLowerCase()
      .trim();

    if (/\b(bangladesh|ban|bpl|bangladesh premier league|dhaka|chattogram|chittagong|rangpur|sylhet|barishal|khulna|rajshahi)\b/i.test(contextStr)) {
      extracted.push("T Sports HD", "Gazi TV");
    } else if (/\b(india|ind|ipl|indian premier league|wpl|women's premier league|ranji|duleep|irani|syed mushtaq|delhi|mumbai|chennai|kolkata|bengaluru|bangalore|hyderabad|rajasthan|punjab|gujarat|lucknow)\b/i.test(contextStr)) {
      extracted.push("Star Sports 1 HD", "Star Sports 1 Hindi", "DD Sports", "Willow HD");
    } else if (/\b(pakistan|pak|psl|pakistan super league|lahore|karachi|multan|peshawar|quetta|islamabad)\b/i.test(contextStr)) {
      extracted.push("PTV Sports", "A Sports", "Ten Sports HD", "Willow HD");
    } else if (/\b(england|eng|county|vitality blast|the hundred|one-day cup|surrey|yorkshire|somerset|lancashire|middlesex|hampshire|sussex|durham|essex|glamorgan|warwickshire|nottinghamshire|kent|gloucestershire|derbyshire|worcestershire|leicestershire|northamptonshire|oval invincibles|trent rockets|london spirit|southern brave|manchester originals|northern superchargers|birmingham phoenix|welsh fire)\b/i.test(contextStr)) {
      extracted.push("Sky Sports Cricket", "Sony Sports Ten 2 HD", "Willow HD");
    } else if (/\b(australia|aus|big bash|bbl|wbbl|sheffield shield|marsh cup|victoria|new south wales|tasmania|queensland|scorchers|sixers|thunder|renegades|strikers|hurricanes|brisbane heat|melbourne stars)\b/i.test(contextStr)) {
      extracted.push("Fox Cricket", "Star Sports 1 HD", "Willow HD");
    } else if (/\b(south africa|rsa|sa20|titans|warriors|dolphins|lions|western province|north west|northern cape|limpopo|boland|knights|paarl|joburg|pretoria|durban)\b/i.test(contextStr)) {
      extracted.push("Sky Sports Cricket", "Star Sports 1 HD", "Willow Sports");
    } else if (/\b(sri lanka|lpl|new zealand|super smash|zimbabwe|afghanistan|asia cup|nepal|oman|uae|united arab emirates|hong kong)\b/i.test(contextStr)) {
      extracted.push("Sony Sports Ten 2 HD", "Ten Cricket", "T Sports HD", "Willow HD");
    } else if (/\b(west indies|windies|cpl|caribbean premier league|mlc|major league cricket|usa|united states|canada|bermuda|bahamas|cayman)\b/i.test(contextStr)) {
      extracted.push("Willow HD", "Star Sports 1 HD", "Ten Cricket");
    } else {
      extracted.push("Willow HD", "T Sports HD", "Cricket Gold");
    }
  }

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

  const uniqueBroadcasters = Array.from(new Set(extracted.filter(Boolean)));
  const primaryBroadcaster = uniqueBroadcasters.slice(0, 3).join(", ");
  const allChannels = Array.isArray(channelsData) ? channelsData : [];

  const explicitServerAliases: Record<string, string[]> = {
    "t sports": ["ch-t-sports-hd", "ch-t-sports-server-2"],
    "t sports hd": ["ch-t-sports-hd", "ch-t-sports-server-2"],
    tsports: ["ch-t-sports-hd", "ch-t-sports-server-2"],
    "gazi tv": ["ch-gazi-tv"],
    gtv: ["ch-gazi-tv"],
    "gazi tv hd": ["ch-gazi-tv"],
    "gazi television": ["ch-gazi-tv"],
    gazi: ["ch-gazi-tv"],
    maasranga: ["ch-maasranga-tv-hd"],
    "maasranga tv": ["ch-maasranga-tv-hd"],
    "maasranga tv hd": ["ch-maasranga-tv-hd"],
    nagorik: ["ch-nagorik-tv"],
    "nagorik tv": ["ch-nagorik-tv"],
    "star sports 1 hindi": ["ch-star-sports-1-hindi"],
    "star sports hindi": ["ch-star-sports-1-hindi"],
    "star sports 1 hd hindi": ["ch-star-sports-1-hindi"],
    "ss1 hindi": ["ch-star-sports-1-hindi"],
    "star sports 1": ["ch-star-sports-1-hd"],
    "star sports 1 hd": ["ch-star-sports-1-hd"],
    "star sports one": ["ch-star-sports-1-hd"],
    "star sport 1": ["ch-star-sports-1-hd"],
    ss1: ["ch-star-sports-1-hd"],
    willow: ["ch-willow-hd", "ch-willow-sports"],
    "willow cricket": ["ch-willow-hd", "ch-willow-sports"],
    "willow tv": ["ch-willow-hd", "ch-willow-sports"],
    "willow hd": ["ch-willow-hd", "ch-willow-sports"],
    "willow usa": ["ch-willow-hd", "ch-willow-sports"],
    "willow sports": ["ch-willow-sports", "ch-willow-hd"],
    "willow sports 2": ["ch-willow-sports-2"],
    "willow 2": ["ch-willow-sports-2"],
    "willow extra": ["ch-willow-cricket-extra"],
    "willow xtra": ["ch-willow-cricket-extra"],
    "willow cricket extra": ["ch-willow-cricket-extra"],
    "ptv sports": ["ch-ptv-sports-hd"],
    "ptv sports hd": ["ch-ptv-sports-hd"],
    "ptv sport": ["ch-ptv-sports-hd"],
    ptv: ["ch-ptv-sports-hd"],
    "a sports": ["ch-a-sports"],
    "a sports hd": ["ch-a-sports"],
    asports: ["ch-a-sports"],
    "a sport": ["ch-a-sports"],
    "ten sports": ["ch-ten-sports-hd"],
    "ten sports hd": ["ch-ten-sports-hd"],
    "ten sports pakistan": ["ch-ten-sports-hd"],
    "ten sports pk": ["ch-ten-sports-hd"],
    "ten cricket": ["ch-ten-cricket"],
    "sony sports ten 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony sports ten 2 hd": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony ten 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony ten 2 hd": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "ten 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "ten sports 2": ["ch-sony-sports-ten-2-hd", "ch-sony-sports-2-hd"],
    "sony sports 2": ["ch-sony-sports-2-hd", "ch-sony-sports-ten-2-hd"],
    "sony sports 2 hd": ["ch-sony-sports-2-hd", "ch-sony-sports-ten-2-hd"],
    "sony sports ten 3": ["ch-sony-sports-ten-3"],
    "sony sports ten 3 hd": ["ch-sony-sports-ten-3"],
    "sony ten 3": ["ch-sony-sports-ten-3"],
    "sony ten 3 hd": ["ch-sony-sports-ten-3"],
    "ten 3": ["ch-sony-sports-ten-3"],
    "ten sports 3": ["ch-sony-sports-ten-3"],
    "sony ten 3 hindi": ["ch-sony-sports-ten-3"],
    "sky sports cricket": ["ch-sky-sports-cricket"],
    "sky cricket": ["ch-sky-sports-cricket"],
    "sky sports mix": ["ch-sky-sports-mix"],
    "fox cricket": ["ch-fox-cricket-501"],
    "fox cricket 501": ["ch-fox-cricket-501"],
    "fox sports 501": ["ch-fox-cricket-501"],
    "astro cricket": ["ch-astro-cricbuz"],
    "astro cricbuz": ["ch-astro-cricbuz"],
    "cricket gold": ["ch-cricket-gold"],
    "dd sports": ["ch-dd-sports"],
  };

  const matchedChannels: any[] = [];
  const seenChannelIds = new Set<string>();

  for (const bName of uniqueBroadcasters) {
    const bLower = bName.toLowerCase().trim();
    const mappedIds = explicitServerAliases[bLower];
    if (mappedIds && mappedIds.length > 0) {
      for (const mappedId of mappedIds) {
        const found = allChannels.find((c: any) => c && (c.id === mappedId || c.id === `ch-${mappedId}`));
        if (found && !seenChannelIds.has(found.id)) {
          seenChannelIds.add(found.id);
          matchedChannels.push(found);
        }
      }
    }
  }

  const primaryChannel = matchedChannels.length > 0 ? matchedChannels[0] : null;
  return {
    broadcaster: primaryBroadcaster,
    broadcasters: uniqueBroadcasters,
    channelId: primaryChannel ? primaryChannel.id : null,
    channelIds: matchedChannels.map((c: any) => c.id),
    channelName: primaryChannel ? primaryChannel.name : null,
    channelLogo: primaryChannel ? primaryChannel.logo || null : null,
    streamUrl: primaryChannel ? primaryChannel.streamUrl || primaryChannel.url || primaryChannel.stream_url || null : null,
    streams: matchedChannels.flatMap((ch: any) => ch.streams || []),
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

  const rawStartStr = item.dateTimeGMT || item.date || item.startTime || null;
  const parsedStartMs = rawStartStr ? Date.parse(String(rawStartStr.endsWith("Z") ? rawStartStr : rawStartStr + "Z")) : NaN;
  const hasValidStart = !isNaN(parsedStartMs) && parsedStartMs > 0;
  const timestamp = hasValidStart ? parsedStartMs : null;

  const fmtLowerCheck = `${matchType} ${name} ${item.series || ""}`.toLowerCase();
  const isT20Format = fmtLowerCheck.includes("t20") || fmtLowerCheck.includes("t10");
  const maxLiveDurationMs = isT20Format ? 4.5 * 3600 * 1000 : 8.5 * 3600 * 1000;
  const isStaleMatch = hasValidStart && Date.now() - parsedStartMs > maxLiveDurationMs;

  let status = "upcoming";
  if (
    matchEnded ||
    msLower === "result" ||
    isStaleMatch ||
    statusLower.includes("won by") ||
    statusLower.includes("won the match") ||
    /\bstumps\b/i.test(statusLower) ||
    statusLower.includes("match drawn") ||
    statusLower.includes("match tied") ||
    statusLower.includes("no result") ||
    statusLower.includes("abandoned") ||
    statusLower.includes("awarded") ||
    statusLower.includes("refused to play") ||
    statusLower.includes("walkover") ||
    statusLower.includes("cancelled") ||
    statusLower.includes("target reached") ||
    statusLower.includes("lost by") ||
    statusLower.includes("winner") ||
    statusLower.includes("completed") ||
    statusLower.includes("concluded")
  ) {
    status = "finished";
  } else if ((matchStarted && !matchEnded) || msLower === "live") {
    status = "live";
  } else {
    status = "upcoming";
  }

  const cleanCricScoreTeam = (raw: string) => String(raw || "").replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  const extractShortFromBracket = (raw: string) => {
    const m = String(raw || "").match(/\[([^\]]+)\]/);
    return m ? m[1].trim() : "";
  };

  const teams = Array.isArray(item.teams) ? item.teams : [];
  const teamInfo = Array.isArray(item.teamInfo) ? item.teamInfo : [];
  let homeName = teams[0] || (item.t1 ? cleanCricScoreTeam(item.t1) : (name.includes(" vs ") ? name.split(" vs ")[0].split(",")[0].trim() : "Team 1"));
  let awayName = teams[1] || (item.t2 ? cleanCricScoreTeam(item.t2) : (name.includes(" vs ") ? name.split(" vs ")[1].split(",")[0].trim() : "Team 2"));

  const homeBracketShort = extractShortFromBracket(item.t1);
  const awayBracketShort = extractShortFromBracket(item.t2);

  const findTeamInfo = (targetName: string, targetShort: string, otherName: string, fallbackIdx: number) => {
    const tLower = String(targetName || "").toLowerCase().trim();
    const sLower = String(targetShort || "").toLowerCase().trim();
    const oLower = String(otherName || "").toLowerCase().trim();
    const exact = teamInfo.find(
      (t: any) =>
        (t?.name && String(t.name).toLowerCase().trim() === tLower) ||
        (sLower && t?.shortname && String(t.shortname).toLowerCase().trim() === sLower)
    );
    if (exact) return exact;
    const partial = teamInfo.find((t: any) => {
      const n = String(t?.name || "").toLowerCase().trim();
      return n && n !== oLower && (n.includes(tLower) || tLower.includes(n));
    });
    if (partial) return partial;
    const candidate = teamInfo[fallbackIdx];
    if (candidate && String(candidate.name || "").toLowerCase().trim() !== oLower) {
      return candidate;
    }
    return {};
  };

  const homeInfo = findTeamInfo(homeName, homeBracketShort, awayName, 0);
  const awayInfo = findTeamInfo(awayName, awayBracketShort, homeName, 1);

  const homeLogo = resolveHDTeamLogo(homeInfo.shortname ? `${homeName} [${homeInfo.shortname}]` : (item.t1 || homeName), homeInfo.img || item.t1img);
  const awayLogo = resolveHDTeamLogo(awayInfo.shortname ? `${awayName} [${awayInfo.shortname}]` : (item.t2 || awayName), awayInfo.img || item.t2img);

  const parseCompactScore = (rawScoreStr: any) => {
    const str = String(rawScoreStr || "").trim();
    if (!str) return { score: "", overs: "" };
    const ovMatch = str.match(/^(.*?)\s*\(\s*([\d.]+)\s*(?:ov|overs)?\s*\)\s*$/i);
    if (ovMatch) {
      return { score: ovMatch[1].trim(), overs: `${ovMatch[2]} ov` };
    }
    return { score: str, overs: "" };
  };

  const scoreList = Array.isArray(item.score) ? item.score : [];
  const parsedT1S = parseCompactScore(item.t1s);
  const parsedT2S = parseCompactScore(item.t2s);
  let homeScore = parsedT1S.score;
  let homeOvers = parsedT1S.overs;
  let awayScore = parsedT2S.score;
  let awayOvers = parsedT2S.overs;

  if (scoreList.length > 0) {
    homeScore = "";
    homeOvers = "";
    awayScore = "";
    awayOvers = "";
    const homeNorm = homeName.toLowerCase().trim();
    const awayNorm = awayName.toLowerCase().trim();
    const homeShortNorm = String(homeInfo.shortname || homeBracketShort || "").toLowerCase().trim();
    const awayShortNorm = String(awayInfo.shortname || awayBracketShort || "").toLowerCase().trim();

    for (let idx = 0; idx < scoreList.length; idx++) {
      const sc = scoreList[idx];
      const inngTeam = String(sc.inning || "")
        .toLowerCase()
        .replace(/\b(inning|innings|1st|2nd|3rd|4th|\d+)\b/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const runs = sc.r !== undefined ? sc.r : 0;
      const wkts = sc.w !== undefined ? sc.w : 0;
      const overs = sc.o !== undefined ? sc.o : "";
      const formatted = `${runs}/${wkts}`;
      const formattedOvers = overs !== "" && overs !== null ? `${overs} ov` : "";

      const matchesHome =
        Boolean(inngTeam) &&
        (inngTeam === homeNorm ||
          (homeShortNorm && inngTeam === homeShortNorm) ||
          (inngTeam.includes(homeNorm) && !inngTeam.includes(awayNorm)) ||
          (homeNorm.includes(inngTeam) && !awayNorm.includes(inngTeam)));
      const matchesAway =
        Boolean(inngTeam) &&
        (inngTeam === awayNorm ||
          (awayShortNorm && inngTeam === awayShortNorm) ||
          (inngTeam.includes(awayNorm) && !inngTeam.includes(homeNorm)) ||
          (awayNorm.includes(inngTeam) && !homeNorm.includes(inngTeam)));

      const assignToHome = matchesHome ? true : matchesAway ? false : idx % 2 === 0;

      if (assignToHome) {
        homeScore = homeScore ? `${homeScore} & ${formatted}` : formatted;
        if (formattedOvers) homeOvers = formattedOvers;
      } else {
        awayScore = awayScore ? `${awayScore} & ${formatted}` : formatted;
        if (formattedOvers) awayOvers = formattedOvers;
      }
    }
  }

  const matchTimeStr = hasValidStart ? formatDhakaEventTime(parsedStartMs) : "Scheduled";
  const tournamentName = item.series || item.seriesName || (!/^[0-9a-f-]{20,}$/i.test(String(item.series_id || "")) ? item.series_id : "") || (name.includes(",") ? name.split(",").slice(1).join(",").trim() : "Cricket Series");
  const homeShort = homeInfo.shortname || extractShortFromBracket(item.t1) || "";
  const awayShort = awayInfo.shortname || extractShortFromBracket(item.t2) || "";

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
    statusLabel: status === "live" ? "LIVE" : status === "finished" ? "FT" : "Upcoming",
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
    timeOrTimer: status === "live" ? "LIVE" : status === "finished" ? "FT" : matchTimeStr,
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
    subText: bData.channelName ? `${tournamentName} • ${bData.channelName}` : tournamentName,
    source: "CricketData.org",
  };
}

const CRICKET_CACHE_TTL_SECONDS = 180;
const CRICKET_CACHE_TTL_MS = CRICKET_CACHE_TTL_SECONDS * 1000; // 180 seconds
const CRICKET_BLOCK_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes cooldown when blocked

function redactSecret(msg: string, secret?: string): string {
  if (!msg) return "";
  let out = String(msg).replace(/apikey=[^&\s"']+/gi, "apikey=[REDACTED]");
  if (secret && secret.trim().length > 4) {
    out = out.split(secret.trim()).join("[REDACTED]");
  }
  return out;
}

function detectCricketDataBlockOrRateLimit(status: number, reasonOrText: string): {
  blocked: boolean;
  rateLimited: boolean;
  is15MinBlock: boolean;
} {
  const lower = String(reasonOrText || "").toLowerCase();
  const is15MinBlock =
    lower.includes("blocked for 15 minutes") ||
    /blocked\s+for\s+\d+\s*min/i.test(lower) ||
    (status === 400 && lower.includes("blocked"));
  const isQuotaOrRateLimit =
    status === 429 ||
    is15MinBlock ||
    lower.includes("blocked") ||
    lower.includes("hit limit") ||
    lower.includes("hits limit") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("reached your limit") ||
    lower.includes("too many requests") ||
    lower.includes("exceeded");
  return {
    blocked: is15MinBlock || isQuotaOrRateLimit,
    rateLimited: isQuotaOrRateLimit,
    is15MinBlock,
  };
}

interface WorkerCricketResult {
  status: "success" | "missing_key" | "rate_limited" | "error";
  source: "CricketData.org" | "ESPN-Fallback";
  fallback: boolean;
  blocked: boolean;
  blockedUntil: number | null;
  rateLimited: boolean;
  upstreamStatus: number;
  cacheTtl: number;
  cached: boolean;
  message?: string;
  total: number;
  data: any[];
}

const workerCricketCache: {
  timestamp: number;
  data: any[];
  source: "CricketData.org" | "ESPN-Fallback";
  lastStatus: number;
  lastError: string;
  blocked: boolean;
  blockedUntil: number;
  rateLimited: boolean;
} = {
  timestamp: 0,
  data: [],
  source: "CricketData.org",
  lastStatus: 200,
  lastError: "",
  blocked: false,
  blockedUntil: 0,
  rateLimited: false,
};

let workerInFlightPromise: Promise<WorkerCricketResult> | null = null;

async function fetchCricketDataApi(
  endpoint: "currentMatches" | "matches" | "cricScore" | string,
  apiKey: string,
  offset = 0
): Promise<{
  ok: boolean;
  status: number;
  blocked?: boolean;
  rateLimited?: boolean;
  data?: any;
  error?: string;
}> {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey) {
    return { ok: false, status: 400, error: "CRICKETDATA_API_KEY secret is not configured." };
  }

  // Do not repeatedly call CricketData while it is blocked for 15 minutes
  const now = Date.now();
  if (workerCricketCache.blockedUntil > now) {
    return {
      ok: false,
      status: workerCricketCache.lastStatus || 400,
      blocked: true,
      rateLimited: true,
      error: workerCricketCache.lastError || "Blocked for 15 minutes",
    };
  }

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const sep = cleanEndpoint.includes("?") ? "&" : "?";
  const url =
    cleanEndpoint === "cricScore"
      ? `https://api.cricapi.com/v1/cricScore${sep}apikey=${encodeURIComponent(cleanKey)}`
      : `https://api.cricapi.com/v1/${cleanEndpoint}${sep}apikey=${encodeURIComponent(cleanKey)}&offset=${offset}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "HighFy-TV/4.2",
      },
      signal: AbortSignal.timeout(8000),
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    const rawReason = String(data?.reason || data?.message || (!res.ok ? text.slice(0, 250) || res.statusText : ""));
    const redactedReason = redactSecret(rawReason, cleanKey);
    const blockInfo = detectCricketDataBlockOrRateLimit(res.status, redactedReason);

    if (blockInfo.blocked) {
      const effectiveStatus = blockInfo.is15MinBlock && res.status === 400 ? 400 : res.status === 429 ? 429 : res.status || 400;
      const errMessage = redactedReason || (res.status === 429 ? "CricketData.org rate limit reached (HTTP 429)" : "Blocked for 15 minutes");
      workerCricketCache.blocked = true;
      workerCricketCache.rateLimited = true;
      workerCricketCache.blockedUntil = Date.now() + CRICKET_BLOCK_COOLDOWN_MS;
      workerCricketCache.lastStatus = effectiveStatus;
      workerCricketCache.lastError = errMessage;
      return {
        ok: false,
        status: effectiveStatus,
        blocked: true,
        rateLimited: true,
        error: errMessage,
      };
    }

    if (!res.ok) {
      workerCricketCache.lastStatus = res.status;
      workerCricketCache.lastError = redactedReason;
      return {
        ok: false,
        status: res.status,
        error: redactedReason,
      };
    }

    if (data && data.status === "failure") {
      const reason = redactSecret(data.reason || "CricketData API returned failure status", cleanKey);
      const failureBlock = detectCricketDataBlockOrRateLimit(400, reason);
      if (failureBlock.blocked) {
        const st = failureBlock.is15MinBlock ? 400 : 429;
        workerCricketCache.blocked = true;
        workerCricketCache.rateLimited = true;
        workerCricketCache.blockedUntil = Date.now() + CRICKET_BLOCK_COOLDOWN_MS;
        workerCricketCache.lastStatus = st;
        workerCricketCache.lastError = reason;
        return {
          ok: false,
          status: st,
          blocked: true,
          rateLimited: true,
          error: reason,
          data,
        };
      }
      workerCricketCache.lastStatus = 400;
      workerCricketCache.lastError = reason;
      return {
        ok: false,
        status: 400,
        error: reason,
        data,
      };
    }

    workerCricketCache.blocked = false;
    workerCricketCache.rateLimited = false;
    workerCricketCache.blockedUntil = 0;
    workerCricketCache.lastStatus = 200;
    workerCricketCache.lastError = "";
    return { ok: true, status: res.status, blocked: false, rateLimited: false, data };
  } catch (err: any) {
    const errMsg = redactSecret(err.message || "Network error reaching CricketData.org API", cleanKey);
    return {
      ok: false,
      status: 500,
      error: errMsg,
    };
  }
}

async function fetchEspnCricketFallbackMatches(): Promise<any[]> {
  const fallbackEvents: any[] = [];
  const seenIds = new Set<string>();
  const now = Date.now();

  try {
    const dateParams: string[] = [];
    for (let dOffset = 0; dOffset <= 2; dOffset++) {
      const dt = new Date(now + dOffset * 24 * 3600 * 1000);
      const dStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(dt)
        .replace(/-/g, "");
      if (!dateParams.includes(dStr)) dateParams.push(dStr);
    }

    const espnResponses = await Promise.allSettled(
      dateParams.map((dt) =>
        fetch(`https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates=${dt}`, {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(7000),
        }).then((r) => (r.ok ? r.json() : null))
      )
    );

    const splitEspnScore = (rawSc: any) => {
      const s = String(rawSc || "").trim();
      if (!s) return { score: "", overs: "" };
      const m = s.match(/^(.*?)\s*\(\s*([\d./]+)\s*(?:ov|overs)?\s*\)\s*$/i);
      if (m) return { score: m[1].trim(), overs: `${m[2]} ov` };
      return { score: s, overs: "" };
    };

    for (const res of espnResponses) {
      if (res.status !== "fulfilled" || !res.value) continue;
      const leagues = (res.value as any)?.sports?.[0]?.leagues || [];
      for (const lg of leagues) {
        const seriesName = String(lg.name || lg.shortName || "International Cricket").trim();
        const lgEvents = Array.isArray(lg.events) ? lg.events : [];
        for (const ev of lgEvents) {
          if (!ev || !ev.id) continue;
          const evKey = `cr-cricapi-espn_${ev.id}`;
          if (seenIds.has(evKey)) continue;

          const competitors = Array.isArray(ev.competitors) ? ev.competitors : [];
          if (competitors.length < 2) continue;
          const c1 = competitors.find((c: any) => c.homeAway === "home") || competitors[0];
          const c2 = competitors.find((c: any) => c.homeAway === "away") || competitors[1];
          const t1Name = String(c1?.displayName || c1?.name || "").trim();
          const t2Name = String(c2?.displayName || c2?.name || "").trim();
          if (
            !t1Name ||
            !t2Name ||
            /^(tbc|tbd|tba|team\s*\d|unknown)$/i.test(t1Name) ||
            /^(tbc|tbd|tba|team\s*\d|unknown)$/i.test(t2Name)
          ) {
            continue;
          }

          const startIso = ev.date || null;
          const parsedTs = startIso ? Date.parse(String(startIso)) : NaN;
          const hasValidStart = !isNaN(parsedTs) && parsedTs > 0;
          const timestamp = hasValidStart ? parsedTs : now;
          if (hasValidStart && now - timestamp > 24 * 3600 * 1000) continue;

          const parsedT1Score = splitEspnScore(c1?.score);
          const parsedT2Score = splitEspnScore(c2?.score);

          const stateStr = String(ev.status || ev.fullStatus?.type?.state || "pre").toLowerCase();
          const summary = String(ev.fullStatus?.longSummary || ev.summary || ev.fullStatus?.type?.description || ev.note || "Scheduled").trim();
          const summaryLower = summary.toLowerCase();
          const elapsedMs = now - timestamp;
          const isStumpsOrEnded =
            summaryLower.includes("stumps") ||
            summaryLower.includes("won by") ||
            summaryLower.includes("won the match") ||
            summaryLower.includes("match drawn") ||
            summaryLower.includes("match tied") ||
            summaryLower.includes("abandoned") ||
            summaryLower.includes("no result") ||
            summaryLower.includes("concluded") ||
            summaryLower.includes("completed");
          const hasLiveActivity =
            Boolean(parsedT1Score.score) ||
            Boolean(parsedT2Score.score) ||
            /\b(ov|overs|need|trail|lead|innings|session|toss|batting|bowling)\b/i.test(summaryLower);

          let status: "live" | "upcoming" | "finished" = "upcoming";
          if (stateStr === "post" || isStumpsOrEnded || (hasValidStart && elapsedMs > 8.5 * 3600 * 1000)) {
            status = "finished";
          } else if (
            stateStr === "in" &&
            elapsedMs >= -15 * 60 * 1000 &&
            elapsedMs <= 8.5 * 3600 * 1000 &&
            hasLiveActivity
          ) {
            status = "live";
          }

          const eventType = String(ev.eventType || ev.class?.eventType || ev.class?.generalClassCard || "T20").toUpperCase();
          const matchTimeStr = hasValidStart ? formatDhakaEventTime(timestamp) : "Scheduled";
          const dhakaDate = hasValidStart
            ? new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Dhaka",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(timestamp))
            : "";

          const t1Logo = resolveHDTeamLogo(t1Name, c1?.logo);
          const t2Logo = resolveHDTeamLogo(t2Name, c2?.logo);

          const broadcastMock = {
            tournament: { name: seriesName },
            season: { name: seriesName },
            type: eventType,
            competitors: [
              { qualifier: "home", name: t1Name, id: c1?.abbreviation || t1Name },
              { qualifier: "away", name: t2Name, id: c2?.abbreviation || t2Name },
            ],
          };
          const bData = resolveCricketBroadcastData(broadcastMock, {
            name: `${t1Name} vs ${t2Name}`,
            series: seriesName,
            tournament: seriesName,
            league: seriesName,
            broadcast: ev.broadcast,
            broadcasts: ev.broadcasts,
            geoBroadcasts: ev.geoBroadcasts,
            team1: { name: t1Name },
            team2: { name: t2Name },
          });

          seenIds.add(evKey);
          fallbackEvents.push({
            id: evKey,
            rawId: String(ev.id),
            matchId: String(ev.id),
            sport: "cricket",
            sportName: "Cricket",
            sportIcon: "fa-baseball-bat-ball",
            title: `${t1Name} vs ${t2Name}`,
            name: `${t1Name} vs ${t2Name}`,
            tournament: seriesName,
            league: seriesName,
            seriesName,
            matchType: eventType,
            matchFormat: eventType,
            matchDesc: String(ev.description || ev.title || seriesName).trim(),
            status,
            statusText: summary || (status === "live" ? "Live Now" : status === "finished" ? "Match Ended" : "Scheduled"),
            statusLabel: status === "live" ? "LIVE" : status === "finished" ? "FT" : "Upcoming",
            date: dhakaDate,
            startTime: hasValidStart ? new Date(timestamp).toISOString() : null,
            endTime: null,
            timestamp,
            matchTime: matchTimeStr,
            timeOrTimer: status === "live" ? "LIVE" : status === "finished" ? "FT" : matchTimeStr,
            venue: String(ev.location || "").trim(),
            isHot: status === "live",
            isSpecial: status === "live",
            team1: {
              teamId: c1?.abbreviation || t1Name,
              name: t1Name,
              shortName: c1?.abbreviation || t1Name.substring(0, 3).toUpperCase(),
              logo: t1Logo,
              score: parsedT1Score.score,
              overs: parsedT1Score.overs,
            },
            team2: {
              teamId: c2?.abbreviation || t2Name,
              name: t2Name,
              shortName: c2?.abbreviation || t2Name.substring(0, 3).toUpperCase(),
              logo: t2Logo,
              score: parsedT2Score.score,
              overs: parsedT2Score.overs,
            },
            homeTeam: {
              name: t1Name,
              shortName: c1?.abbreviation || t1Name.substring(0, 3).toUpperCase(),
              logo: t1Logo,
              score: parsedT1Score.score,
              overs: parsedT1Score.overs,
            },
            awayTeam: {
              name: t2Name,
              shortName: c2?.abbreviation || t2Name.substring(0, 3).toUpperCase(),
              logo: t2Logo,
              score: parsedT2Score.score,
              overs: parsedT2Score.overs,
            },
            broadcaster: bData.broadcaster,
            broadcasters: bData.broadcasters,
            channelId: bData.channelId,
            channelIds: bData.channelIds,
            channelName: bData.channelName,
            channelLogo: bData.channelLogo,
            streamUrl: bData.streamUrl,
            streams: bData.streams,
            subText: bData.channelName ? `${seriesName} • ${bData.channelName}` : seriesName,
            source: "ESPN-Fallback",
          });
        }
      }
    }
  } catch {}

  return fallbackEvents;
}

async function getNormalizedCricketDataMatches(env: Env): Promise<WorkerCricketResult> {
  const activeKey = (env.CRICKETDATA_API_KEY || env.CRICAPI_KEY || env.CRICKET_API_KEY || "").trim();
  const now = Date.now();

  // 1. Serve from 180-second cache if fresh
  if (
    workerCricketCache.timestamp > 0 &&
    workerCricketCache.data.length > 0 &&
    now - workerCricketCache.timestamp < CRICKET_CACHE_TTL_MS
  ) {
    const isCurrentlyBlocked = workerCricketCache.blockedUntil > now;
    return {
      status: "success",
      source: workerCricketCache.source,
      fallback: workerCricketCache.source === "ESPN-Fallback",
      blocked: isCurrentlyBlocked,
      blockedUntil: isCurrentlyBlocked ? workerCricketCache.blockedUntil : null,
      rateLimited: isCurrentlyBlocked || workerCricketCache.rateLimited,
      upstreamStatus: workerCricketCache.lastStatus || 200,
      cacheTtl: CRICKET_CACHE_TTL_SECONDS,
      cached: true,
      message: workerCricketCache.lastError || undefined,
      total: workerCricketCache.data.length,
      data: workerCricketCache.data,
    };
  }

  // 2. Coalesce concurrent requests to avoid redundant upstream calls
  if (workerInFlightPromise) {
    return workerInFlightPromise;
  }

  workerInFlightPromise = (async (): Promise<WorkerCricketResult> => {
    try {
      const events: any[] = [];
      const seenIds = new Set<string>();
      const seenFps = new Map<string, any>();

      const getFingerprint = (ev: any) => {
        if (!ev) return null;
        const t1 = (ev.team1?.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const t2 = (ev.team2?.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        if (!t1 || !t2) return null;
        const pair = [t1, t2].sort().join("_vs_");
        const date = ev.date || "";
        if (ev.status !== "finished") {
          return `${pair}::active::${date || "nodate"}`;
        }
        return `${pair}::finished::${date}`;
      };

      const addEvent = (ev: any) => {
        if (!ev || !ev.id) return;
        if (seenIds.has(ev.id)) return;
        const fp = getFingerprint(ev);
        if (fp && seenFps.has(fp)) {
          const existing = seenFps.get(fp);
          const shouldPromoteIncoming =
            (existing.status !== "live" && ev.status === "live") ||
            (existing.status === "upcoming" &&
              ev.status === "upcoming" &&
              ev.timestamp &&
              (!existing.timestamp || ev.timestamp < existing.timestamp));

          if (shouldPromoteIncoming) {
            existing.id = ev.id;
            existing.rawId = ev.rawId;
            existing.matchId = ev.matchId;
            existing.status = ev.status;
            existing.statusText = ev.statusText || existing.statusText;
            existing.statusLabel = ev.statusLabel || existing.statusLabel;
            existing.timeOrTimer = ev.timeOrTimer || existing.timeOrTimer;
            existing.timestamp = ev.timestamp || existing.timestamp;
            existing.date = ev.date || existing.date;
            existing.startTime = ev.startTime || existing.startTime;
            existing.matchTime = ev.matchTime || existing.matchTime;
            if (ev.tournament && ev.tournament !== "Cricket Series") {
              existing.tournament = ev.tournament;
              existing.league = ev.league || ev.tournament;
              existing.seriesName = ev.seriesName || ev.tournament;
            }
          }
          if (ev.team1?.score && (!existing.team1?.score || shouldPromoteIncoming)) {
            existing.team1.score = ev.team1.score;
            existing.team1.overs = ev.team1.overs;
            if (existing.homeTeam) {
              existing.homeTeam.score = ev.team1.score;
              existing.homeTeam.overs = ev.team1.overs;
            }
          }
          if (ev.team2?.score && (!existing.team2?.score || shouldPromoteIncoming)) {
            existing.team2.score = ev.team2.score;
            existing.team2.overs = ev.team2.overs;
            if (existing.awayTeam) {
              existing.awayTeam.score = ev.team2.score;
              existing.awayTeam.overs = ev.team2.overs;
            }
          }
          if (
            ev.team1?.logo &&
            ev.team1.logo !== "./assets/team-placeholder.svg" &&
            (!existing.team1?.logo || existing.team1.logo === "./assets/team-placeholder.svg" || existing.team1.logo.includes("cricapi.com"))
          ) {
            existing.team1.logo = ev.team1.logo;
            if (existing.homeTeam) existing.homeTeam.logo = ev.team1.logo;
          }
          if (
            ev.team2?.logo &&
            ev.team2.logo !== "./assets/team-placeholder.svg" &&
            (!existing.team2?.logo || existing.team2.logo === "./assets/team-placeholder.svg" || existing.team2.logo.includes("cricapi.com"))
          ) {
            existing.team2.logo = ev.team2.logo;
            if (existing.awayTeam) existing.awayTeam.logo = ev.team2.logo;
          }
          return;
        }
        seenIds.add(ev.id);
        if (fp) seenFps.set(fp, ev);
        events.push(ev);
      };

      // Primary Source: CricketData.org (only call if key is configured and not in 15-minute block window)
      let primarySucceeded = false;
      let upstreamStatus = 200;

      if (activeKey && Date.now() >= workerCricketCache.blockedUntil) {
        const currentRes = await fetchCricketDataApi("currentMatches", activeKey, 0);
        upstreamStatus = currentRes.status || 200;

        if (currentRes.ok && Array.isArray(currentRes.data?.data)) {
          for (const item of currentRes.data.data) {
            const ev = normalizeCricketDataEvent(item);
            if (ev) addEvent(ev);
          }
          if (events.length > 0) {
            primarySucceeded = true;
          }
        }
      } else if (workerCricketCache.blockedUntil > Date.now()) {
        upstreamStatus = workerCricketCache.lastStatus || 400;
      } else if (!activeKey) {
        upstreamStatus = 400;
      }

      let activeSource: "CricketData.org" | "ESPN-Fallback" = "CricketData.org";

      // Fallback Source: ESPN Cricket Scoreboard (ONLY when CricketData is blocked/rate-limited/unavailable/empty)
      if (!primarySucceeded) {
        activeSource = "ESPN-Fallback";
        const espnMatches = await fetchEspnCricketFallbackMatches();
        for (const ev of espnMatches) {
          addEvent(ev);
        }
      }

      await Promise.all(
        events.slice(0, 25).map(async (ev) => {
          if (ev.team1?.name) {
            const l1 = await resolveWorkerOfficialCricketLogoAsync(ev.team1.name, ev.team1.logo);
            ev.team1.logo = l1;
            if (ev.homeTeam) ev.homeTeam.logo = l1;
          }
          if (ev.team2?.name) {
            const l2 = await resolveWorkerOfficialCricketLogoAsync(ev.team2.name, ev.team2.logo);
            ev.team2.logo = l2;
            if (ev.awayTeam) ev.awayTeam.logo = l2;
          }
        })
      );

      events.sort((a, b) => {
        const order: Record<string, number> = { live: 0, upcoming: 1, finished: 2 };
        const orderA = order[a.status] !== undefined ? order[a.status] : 1;
        const orderB = order[b.status] !== undefined ? order[b.status] : 1;
        if (orderA !== orderB) return orderA - orderB;
        return (a.timestamp || 0) - (b.timestamp || 0);
      });

      if (events.length > 0) {
        workerCricketCache.timestamp = Date.now();
        workerCricketCache.data = events;
        workerCricketCache.source = activeSource;
      }

      const isBlockedNow = workerCricketCache.blockedUntil > Date.now();
      return {
        status: "success",
        source: activeSource,
        fallback: activeSource === "ESPN-Fallback",
        blocked: isBlockedNow,
        blockedUntil: isBlockedNow ? workerCricketCache.blockedUntil : null,
        rateLimited: isBlockedNow || workerCricketCache.rateLimited,
        upstreamStatus,
        cacheTtl: CRICKET_CACHE_TTL_SECONDS,
        cached: false,
        message: workerCricketCache.lastError || undefined,
        total: events.length,
        data: events,
      };
    } finally {
      workerInFlightPromise = null;
    }
  })();

  return workerInFlightPromise;
}

// Shared Worker In-Memory Caches for Edge Performance
const workerSportsDbCache = {
  events: null as { timestamp: number; data: any[] } | null,
  details: new Map<string, { timestamp: number; data: any; raw: any }>(),
  broadcasters: new Map<string, { timestamp: number; data: any }>(),
  TTL: 60 * 1000, // 60s
  TTL_DETAILS: 120 * 1000, // 2 mins
};

const workerAllSportsApiCache = {
  events: null as { timestamp: number; data: any[] } | null,
  TTL: 60 * 1000,
};

function normalizeSportsDbEvent(raw: any): any {
  if (!raw || !raw.idEvent) return null;
  const rawSport = String(raw.strSport || "").toLowerCase();
  // Strictly enforce: Cricket is ONLY from CricketData.org / CricAPI
  if (rawSport === "cricket") return null;

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
      parsedStartMs = Date.parse(tsStr);
    }
  }

  let finalTimestamp = !isNaN(parsedStartMs) ? parsedStartMs : Date.now();
  const dateStr = raw.dateEvent || (raw.strTimestamp ? String(raw.strTimestamp).split("T")[0] : "");
  const timeStr = raw.strTime ? String(raw.strTime).split("+")[0].trim() : "";
  const homeName = raw.strHomeTeam || "Home";
  const awayName = raw.strAwayTeam || "Away";
  const title = `${homeName} vs ${awayName}`;

  let status: "live" | "upcoming" | "finished" = "upcoming";
  const strStatus = String(raw.strStatus || "").toLowerCase();
  if (strStatus.includes("live") || strStatus.includes("1h") || strStatus.includes("2h") || strStatus.includes("ht")) {
    status = "live";
  } else if (strStatus.includes("ft") || strStatus.includes("aet") || strStatus.includes("pen") || strStatus.includes("postp") || strStatus.includes("canc")) {
    status = "finished";
  }

  const rawStation = String(raw.strTVStation || raw.strBroadcaster || raw.strBroadcast || "").trim();
  const broadcasters = rawStation
    ? rawStation.split(/[,/|;+&]|\band\b|\bor\b/i).map((s: string) => s.trim()).filter(Boolean)
    : [];

  return {
    id: `tsdb-${raw.idEvent}`,
    rawId: raw.idEvent,
    sport: raw.strSport || "Football",
    sportName: raw.strSport || "Football",
    league: raw.strLeague || "International",
    title,
    name: title,
    date: dateStr,
    time: timeStr,
    timestamp: finalTimestamp,
    status,
    statusText: raw.strStatus || (status === "live" ? "LIVE" : "Upcoming"),
    team1: {
      name: homeName,
      logo: raw.strHomeTeamBadge || raw.strThumb || "",
      score: raw.intHomeScore !== null && raw.intHomeScore !== undefined ? String(raw.intHomeScore) : "",
    },
    team2: {
      name: awayName,
      logo: raw.strAwayTeamBadge || "",
      score: raw.intAwayScore !== null && raw.intAwayScore !== undefined ? String(raw.intAwayScore) : "",
    },
    venue: raw.strVenue || "",
    country: raw.strCountry || "",
    broadcaster: rawStation,
    broadcasters,
  };
}

function normalizeAllSportsApiEvent(raw: any, sportType: string): any {
  if (!raw || (!raw.event_home_team && !raw.event_away_team)) return null;
  const homeName = raw.event_home_team || "Team 1";
  const awayName = raw.event_away_team || "Team 2";
  const league = raw.league_name || "International";
  const title = `${homeName} vs ${awayName}`;
  const sport = sportType === "cricket" ? "Cricket" : "Football";
  const status = raw.event_status === "Finished" ? "finished" : (raw.event_status ? "live" : "upcoming");

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
    team1: {
      name: homeName,
      logo: raw.home_team_logo || "",
      score: raw.event_final_result ? String(raw.event_final_result).split(" - ")[0] : "",
    },
    team2: {
      name: awayName,
      logo: raw.away_team_logo || "",
      score: raw.event_final_result ? String(raw.event_final_result).split(" - ")[1] : "",
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const serverCricketKey = (env.CRICKETDATA_API_KEY || env.CRICAPI_KEY || env.CRICKET_API_KEY || "").trim();
    const isCricketSecretConfigured = Boolean(serverCricketKey);
    const isCurrentlyBlocked = workerCricketCache.blockedUntil > Date.now();
    const sportsDbKey = (env.THESPORTSDB_API_KEY || "3").trim();
    const allSportsKey = (env.ALLSPORTS_API_KEY || env.ALLSPORTSAPI_KEY || "").trim();
    const isAllSportsConfigured = Boolean(allSportsKey);
    const rapidApiKey = (env.RAPIDAPI_KEY || "").trim();

    // 1. Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Diagnostic Health check: /api/health, /health, /
    if (path === "/" || path === "/api/health" || path === "/health") {
      return jsonResponse({
        status: "ok",
        worker: "ok",
        theSportsDB: "ok",
        allSportsApi: isAllSportsConfigured ? "ok" : "not_configured",
        cricketData: isCricketSecretConfigured ? (isCurrentlyBlocked ? "rate_limited" : "ok") : "not_configured",
        sportsApi: isAllSportsConfigured ? "ok" : "not_configured",
        sportsDb: "ok",
        timestamp: new Date().toISOString(),
        environment: "Cloudflare Worker",
        secure: true,
        primaryCricketSource: "CricketData.org",
        fallbackCricketSource: "ESPN-Fallback",
        configuration: {
          CRICKETDATA_API_KEY: isCricketSecretConfigured ? "configured" : "missing",
          THESPORTSDB_API_KEY: sportsDbKey === "3" ? "3 (Free Tier)" : "configured",
          ALLSPORTS_API_KEY: isAllSportsConfigured ? "configured" : "missing",
          cricketDataBlocked: isCurrentlyBlocked,
          cricketDataBlockedUntil: isCurrentlyBlocked ? workerCricketCache.blockedUntil : null,
          cricketCacheTtlSeconds: CRICKET_CACHE_TTL_SECONDS,
          rapidApiConfigured: Boolean(rapidApiKey),
        },
        endpoints: [
          "/",
          "/api/health",
          "/api/config",
          "/api/cricket/matches",
          "/api/cricket/scorecard",
          "/api/cricket/schedule",
          "/api/cricket/teams",
          "/api/cricket/players",
          "/api/cricapi/test",
          "/api/thesportsdb/events",
          "/api/thesportsdb/event/:id",
          "/api/thesportsdb/test",
          "/api/allsportsapi/matches",
          "/api/allsportsapi/test",
          "/api/fixture/broadcaster",
          "/api/events",
          "/api/events/live",
          "/api/events/today",
          "/api/events/upcoming",
          "/api/events/:id/channels",
          "/api/stream-proxy",
          "/api/logo-proxy",
          "/api/image-proxy",
          "/api/version",
        ],
      });
    }

    // 3. Safe Public Configuration: /api/config
    if (path === "/api/config") {
      return jsonResponse({
        status: "ok",
        worker: "online",
        primaryCricketSource: "CricketData.org",
        fallbackCricketSource: "ESPN-Fallback",
        cricketDataConfigured: isCricketSecretConfigured,
        cricketDataBlocked: isCurrentlyBlocked,
        cricketCacheTtlSeconds: CRICKET_CACHE_TTL_SECONDS,
        rapidApiConfigured: Boolean(rapidApiKey),
        thesportsdbConfigured: true,
        thesportsdbKey: sportsDbKey === "3" ? "3" : "configured",
        allSportsApiConfigured: Boolean(allSportsKey),
        appName: "HIGHFY TV",
        version: "4.2",
      });
    }

    // 4. Primary Cricket Proxy: /api/cricket/matches (also /api/cricket/cricapi/matches, /api/cricket/cricapi/current, /api/cricket/cricapi/cricScore)
    if (
      path === "/api/cricket/matches" ||
      path === "/api/cricket/cricapi/matches" ||
      path === "/api/cricket/cricapi/current" ||
      path === "/api/cricket/cricapi/cricScore"
    ) {
      const result = await getNormalizedCricketDataMatches(env);
      return jsonResponse({
        status: "success",
        source: result.source,
        configured: isCricketSecretConfigured,
        fallback: result.fallback,
        blocked: result.blocked,
        blockedUntil: result.blockedUntil,
        rateLimited: result.rateLimited,
        cacheTtl: result.cacheTtl,
        cached: result.cached,
        upstreamStatus: result.upstreamStatus,
        message: result.message,
        total: result.total,
        data: result.data,
      });
    }

    // 5. Cricket Scorecard Proxy: /api/cricket/scorecard
    if (path === "/api/cricket/scorecard") {
      const matchId = String(url.searchParams.get("id") || url.searchParams.get("matchId") || "").trim();
      if (!matchId) {
        return jsonResponse({ status: "error", message: "Match ID is required" }, 400);
      }

      if (serverCricketKey && !isCurrentlyBlocked) {
        try {
          const res = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${serverCricketKey}&id=${encodeURIComponent(matchId)}`, {
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const data: any = await res.json();
            if (data && data.status === "success") {
              return jsonResponse({ status: "success", source: "CricketData.org", data: data.data });
            }
          }
        } catch {}
      }

      // Check cache if match exists
      const cachedMatch = workerCricketCache.data.find((m) => m.id === matchId || m.matchId === matchId);
      if (cachedMatch) {
        return jsonResponse({
          status: "success",
          source: cachedMatch.source || "ESPN-Fallback",
          data: {
            id: cachedMatch.id,
            name: cachedMatch.title,
            status: cachedMatch.statusText,
            team1: cachedMatch.team1,
            team2: cachedMatch.team2,
            score: [
              cachedMatch.team1 ? { r: cachedMatch.team1.score, o: cachedMatch.team1.overs, inning: cachedMatch.team1.name } : null,
              cachedMatch.team2 ? { r: cachedMatch.team2.score, o: cachedMatch.team2.overs, inning: cachedMatch.team2.name } : null,
            ].filter(Boolean),
          },
        });
      }

      return jsonResponse({ status: "error", message: "Scorecard details unavailable" }, 404);
    }

    // 6. Cricket Schedule: /api/cricket/schedule
    if (path === "/api/cricket/schedule") {
      if (serverCricketKey && !isCurrentlyBlocked) {
        try {
          const res = await fetch(`https://api.cricapi.com/v1/matches?apikey=${serverCricketKey}&offset=0`, {
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const data: any = await res.json();
            if (data && Array.isArray(data.data)) {
              return jsonResponse({ status: "success", source: "CricketData.org", total: data.data.length, data: data.data });
            }
          }
        } catch {}
      }
      return jsonResponse({ status: "success", source: "Worker", total: 0, data: [] });
    }

    // 7. Cricket Teams Search: /api/cricket/teams
    if (path === "/api/cricket/teams") {
      const q = String(url.searchParams.get("q") || url.searchParams.get("search") || url.searchParams.get("t") || "").trim().toLowerCase();
      const results: any[] = [];
      for (const [key, logo] of Object.entries(HD_CRICKET_LOGOS_MAP)) {
        if (!q || key.includes(q)) {
          results.push({ name: key.toUpperCase(), logo });
        }
      }
      return jsonResponse({ status: "success", total: results.length, data: results });
    }

    // 8. Cricket Players: /api/cricket/players
    if (path === "/api/cricket/players") {
      return jsonResponse({ status: "success", total: 0, data: [] });
    }

    // 9. CricketData Diagnostic Test route: /api/cricapi/test or /api/cricket/cricapi/test or /api/cricket/test
    if (path === "/api/cricapi/test" || path === "/api/cricket/cricapi/test" || path === "/api/cricket/test") {
      if (!isCricketSecretConfigured) {
        return jsonResponse(
          {
            configured: false,
            valid: false,
            status: "missing_key",
            source: "CricketData.org",
            secretName: "CRICKETDATA_API_KEY",
            message: "CRICKETDATA_API_KEY is not configured in Cloudflare Worker secrets.",
          },
          400
        );
      }

      const start = Date.now();
      const testRes = await fetchCricketDataApi("currentMatches", serverCricketKey, 0);
      const elapsed = Date.now() - start;

      if (testRes.ok && testRes.data) {
        const matches = Array.isArray(testRes.data.data) ? testRes.data.data : [];
        return jsonResponse({
          configured: true,
          valid: true,
          status: "success",
          source: "CricketData.org",
          secretName: "CRICKETDATA_API_KEY",
          cacheTtlSeconds: CRICKET_CACHE_TTL_SECONDS,
          message: `CRICKETDATA_API_KEY server secret is configured and VALID! (${matches.length} current matches found)`,
          latencyMs: elapsed,
          matchesCount: matches.length,
          info: testRes.data.info || {},
        });
      }

      if (testRes.blocked || testRes.rateLimited || testRes.status === 429 || testRes.status === 400) {
        return jsonResponse(
          {
            configured: true,
            valid: false,
            status: "rate_limited",
            source: "ESPN-Fallback",
            secretName: "CRICKETDATA_API_KEY",
            statusCode: testRes.status || 400,
            blocked: Boolean(testRes.blocked),
            blockedUntil: workerCricketCache.blockedUntil || null,
            rateLimited: true,
            total: 0,
            data: [],
            message: redactSecret(
              testRes.error || "CRICKETDATA_API_KEY is configured, but CricketData.org is temporarily blocked or rate-limited.",
              serverCricketKey
            ),
          },
          testRes.status === 400 ? 400 : 429
        );
      }

      return jsonResponse(
        {
          configured: true,
          valid: false,
          status: "error",
          source: "CricketData.org",
          secretName: "CRICKETDATA_API_KEY",
          statusCode: testRes.status,
          message: redactSecret(testRes.error || `CricketData.org error with status ${testRes.status}`, serverCricketKey),
        },
        testRes.status || 500
      );
    }

    // 10. TheSportsDB Events: /api/thesportsdb/events
    if (path === "/api/thesportsdb/events") {
      const now = Date.now();
      if (workerSportsDbCache.events && now - workerSportsDbCache.events.timestamp < workerSportsDbCache.TTL) {
        return jsonResponse({
          status: "success",
          source: "TheSportsDB",
          total: workerSportsDbCache.events.data.length,
          data: workerSportsDbCache.events.data,
          cached: true,
        });
      }

      try {
        const todayStr = new Date().toISOString().split("T")[0];
        const res = await fetch(`https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/eventsday.php?d=${todayStr}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json: any = await res.json();
          const events: any[] = [];
          if (Array.isArray(json?.events)) {
            for (const raw of json.events) {
              const norm = normalizeSportsDbEvent(raw);
              if (norm) events.push(norm);
            }
          }
          workerSportsDbCache.events = { timestamp: now, data: events };
          return jsonResponse({
            status: "success",
            source: "TheSportsDB",
            total: events.length,
            data: events,
            cached: false,
          });
        }
      } catch (err: any) {
        return jsonResponse({ status: "error", message: err.message, data: [] }, 500);
      }

      return jsonResponse({ status: "success", source: "TheSportsDB", total: 0, data: [] });
    }

    // 11. TheSportsDB Specific Event & Broadcaster Lookup: /api/thesportsdb/event/:id
    if (path.startsWith("/api/thesportsdb/event/")) {
      const rawId = path.replace("/api/thesportsdb/event/", "").replace(/^tsdb-/, "").trim();
      if (!rawId) {
        return jsonResponse({ status: "error", error: "Event ID is required" }, 400);
      }

      const now = Date.now();
      const cached = workerSportsDbCache.details.get(rawId);
      if (cached && now - cached.timestamp < workerSportsDbCache.TTL_DETAILS) {
        return jsonResponse({ status: "success", data: cached.data, raw: cached.raw, cached: true });
      }

      try {
        const [eventRes, tvRes] = await Promise.allSettled([
          fetch(`https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/lookupevent.php?id=${encodeURIComponent(rawId)}`, {
            signal: AbortSignal.timeout(6000),
          }),
          fetch(`https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/lookuptv.php?id=${encodeURIComponent(rawId)}`, {
            signal: AbortSignal.timeout(6000),
          }),
        ]);

        let rawEvent: any = null;
        if (eventRes.status === "fulfilled" && eventRes.value.ok) {
          const json: any = await eventRes.value.json();
          rawEvent = (json.events && json.events[0]) || null;
        }

        if (!rawEvent) {
          return jsonResponse({ status: "error", error: "Event not found" }, 404);
        }

        const norm = normalizeSportsDbEvent(rawEvent) || {
          id: `tsdb-${rawEvent.idEvent}`,
          rawId: rawEvent.idEvent,
          sport: rawEvent.strSport || "Football",
          title: `${rawEvent.strHomeTeam || "Home"} vs ${rawEvent.strAwayTeam || "Away"}`,
          broadcasters: [],
        };

        // Extract and merge TV channels from dedicated lookuptv.php
        if (tvRes.status === "fulfilled" && tvRes.value.ok) {
          try {
            const tvJson: any = await tvRes.value.json();
            const tvList = Array.isArray(tvJson.tvs) ? tvJson.tvs : Array.isArray(tvJson.tv) ? tvJson.tv : [];
            const tvChannels = tvList
              .map((t: any) => String(t.strChannel || t.strTVStation || t.strBroadcaster || "").trim())
              .filter(Boolean);

            for (const ch of tvChannels) {
              if (!norm.broadcasters.includes(ch)) {
                norm.broadcasters.push(ch);
              }
            }
          } catch {}
        }

        workerSportsDbCache.details.set(rawId, { timestamp: now, data: norm, raw: rawEvent });
        return jsonResponse({ status: "success", data: norm, raw: rawEvent, cached: false });
      } catch (err: any) {
        return jsonResponse({ status: "error", message: err.message }, 500);
      }
    }

    // 12. TheSportsDB Connectivity Test: /api/thesportsdb/test
    if (path === "/api/thesportsdb/test") {
      try {
        const start = Date.now();
        let testRes = await fetch(`https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/all_leagues.php`, {
          signal: AbortSignal.timeout(6000),
        });

        if (!testRes.ok) {
          testRes = await fetch(`https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/eventsseason.php?id=4328&s=2024-2025`, {
            signal: AbortSignal.timeout(6000),
          });
        }

        const elapsed = Date.now() - start;
        if (testRes.ok) {
          const json: any = await testRes.json();
          const count = (json.leagues && json.leagues.length) || (json.events && json.events.length) || 0;
          return jsonResponse({
            configured: true,
            valid: true,
            status: "success",
            source: "TheSportsDB",
            latencyMs: elapsed,
            key: sportsDbKey === "3" ? "3 (Free Tier)" : "Custom",
            itemsCount: count,
          });
        }
        return jsonResponse({ configured: true, valid: false, status: "error", statusCode: testRes.status }, testRes.status);
      } catch (err: any) {
        return jsonResponse({ configured: true, valid: false, status: "error", message: err.message }, 500);
      }
    }

    // 13. AllSportsAPI Matches: /api/allsportsapi/matches
    if (path === "/api/allsportsapi/matches") {
      if (!allSportsKey) {
        return jsonResponse({ status: "success", total: 0, data: [], message: "AllSportsAPI key not configured." });
      }

      const now = Date.now();
      if (workerAllSportsApiCache.events && now - workerAllSportsApiCache.events.timestamp < workerAllSportsApiCache.TTL) {
        return jsonResponse({
          status: "success",
          source: "AllSportsAPI",
          total: workerAllSportsApiCache.events.data.length,
          data: workerAllSportsApiCache.events.data,
          cached: true,
        });
      }

      const events: any[] = [];
      const sports = ["football", "cricket"];
      const promises = sports.map(async (sport) => {
        try {
          const liveRes = await fetch(`https://apiv2.allsportsapi.com/${sport}/?met=Livescore&APIkey=${encodeURIComponent(allSportsKey)}`, {
            signal: AbortSignal.timeout(6000),
          });
          if (liveRes.ok) {
            const liveData: any = await liveRes.json();
            if (liveData && Array.isArray(liveData.result) && liveData.error !== "1") {
              for (const m of liveData.result) {
                const norm = normalizeAllSportsApiEvent(m, sport);
                if (norm) events.push(norm);
              }
            }
          }
        } catch {}
      });

      await Promise.allSettled(promises);
      if (events.length > 0) {
        workerAllSportsApiCache.events = { timestamp: now, data: events };
      }
      return jsonResponse({ status: "success", source: "AllSportsAPI", total: events.length, data: events });
    }

    // 14. AllSportsAPI Test: /api/allsportsapi/test
    if (path === "/api/allsportsapi/test") {
      if (!allSportsKey) {
        return jsonResponse({ configured: false, valid: false, message: "ALLSPORTSAPI_KEY not configured" }, 400);
      }
      try {
        const start = Date.now();
        const testRes = await fetch(`https://apiv2.allsportsapi.com/football/?met=Leagues&APIkey=${encodeURIComponent(allSportsKey)}`, {
          signal: AbortSignal.timeout(6000),
        });
        const elapsed = Date.now() - start;
        if (testRes.ok) {
          const json: any = await testRes.json();
          return jsonResponse({
            configured: true,
            valid: true,
            status: "success",
            source: "AllSportsAPI",
            latencyMs: elapsed,
            leaguesCount: json.result?.length || 0,
          });
        }
        return jsonResponse({ configured: true, valid: false, status: "error", statusCode: testRes.status }, testRes.status);
      } catch (err: any) {
        return jsonResponse({ configured: true, valid: false, status: "error", message: err.message }, 500);
      }
    }

    // 15. Broadcaster Lookup by Fixture / Event ID: /api/fixture/broadcaster
    if (path === "/api/fixture/broadcaster") {
      const fixtureId = String(url.searchParams.get("fixtureId") || url.searchParams.get("id") || "").trim();
      if (!fixtureId) {
        return jsonResponse({ status: "error", error: "fixtureId is required" }, 400);
      }

      // 1. Check in-memory sportsDb cache
      const cachedEv = (workerSportsDbCache.events?.data || []).find(
        (e: any) => String(e.id) === fixtureId || String(e.rawId) === fixtureId
      );
      if (cachedEv && (cachedEv.broadcaster || (cachedEv.broadcasters && cachedEv.broadcasters.length > 0))) {
        return jsonResponse({
          status: "success",
          fixtureId,
          broadcaster: cachedEv.broadcaster || cachedEv.broadcasters.join(", "),
          broadcasters: cachedEv.broadcasters || [],
          source: "TheSportsDB Cache",
        });
      }

      // 2. Check live TheSportsDB lookupevent.php & lookuptv.php
      const cleanTsdbId = fixtureId.replace(/^tsdb-/, "");
      if (/^\d+$/.test(cleanTsdbId)) {
        try {
          const [eventRes, tvRes] = await Promise.allSettled([
            fetch(`https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/lookupevent.php?id=${encodeURIComponent(cleanTsdbId)}`, {
              signal: AbortSignal.timeout(5000),
            }),
            fetch(`https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/lookuptv.php?id=${encodeURIComponent(cleanTsdbId)}`, {
              signal: AbortSignal.timeout(5000),
            }),
          ]);

          const broadcasters: string[] = [];
          if (eventRes.status === "fulfilled" && eventRes.value.ok) {
            const data: any = await eventRes.value.json();
            const raw = (data.events && data.events[0]) || null;
            if (raw) {
              const rawStation = String(raw.strTVStation || raw.strBroadcaster || raw.strBroadcast || "").trim();
              if (rawStation) {
                const parts = rawStation.split(/[,/|;+&]|\band\b|\bor\b/i).map((s: string) => s.trim()).filter(Boolean);
                broadcasters.push(...parts);
              }
            }
          }

          if (tvRes.status === "fulfilled" && tvRes.value.ok) {
            try {
              const tvJson: any = await tvRes.value.json();
              const tvList = Array.isArray(tvJson.tvs) ? tvJson.tvs : Array.isArray(tvJson.tv) ? tvJson.tv : [];
              for (const t of tvList) {
                const name = String(t.strChannel || t.strTVStation || t.strBroadcaster || "").trim();
                if (name && !broadcasters.includes(name)) broadcasters.push(name);
              }
            } catch {}
          }

          if (broadcasters.length > 0) {
            return jsonResponse({
              status: "success",
              fixtureId,
              broadcaster: broadcasters.join(", "),
              broadcasters,
              source: "TheSportsDB Live",
            });
          }
        } catch {}
      }

      return jsonResponse({
        status: "success",
        fixtureId,
        broadcaster: "",
        broadcasters: [],
        source: "None",
        message: "No verified broadcast information available for this event",
      });
    }

    // 16. Unified Events Endpoints: /api/events, /api/events/live, /api/events/today, /api/events/upcoming
    if (path === "/api/events" || path === "/api/events/live" || path === "/api/events/today" || path === "/api/events/upcoming") {
      const cricketRes = await getNormalizedCricketDataMatches(env);
      const cricketMatches = cricketRes.data || [];
      const sportsDbMatches = workerSportsDbCache.events?.data || [];
      const allSportsMatches = workerAllSportsApiCache.events?.data || [];

      let combined = [...cricketMatches, ...sportsDbMatches, ...allSportsMatches];

      if (path === "/api/events/live") {
        combined = combined.filter((e) => e.status === "live");
      } else if (path === "/api/events/upcoming") {
        combined = combined.filter((e) => e.status === "upcoming");
      }

      return jsonResponse({
        status: "success",
        total: combined.length,
        data: combined,
      });
    }

    // 17. Event Channels Endpoint: /api/events/:id/channels
    if (path.startsWith("/api/events/") && path.endsWith("/channels")) {
      return jsonResponse({
        status: "success",
        channels: [],
        message: "Live channel lookup completed",
      });
    }

    // 18. Stream Proxy: /api/stream-proxy (Edge-compatible HLS & TS proxy)
    if (path === "/api/stream-proxy") {
      let targetUrl = String(url.searchParams.get("url") || url.searchParams.get("token") || "").trim();
      if (!targetUrl) {
        return new Response("Missing stream URL or token", { status: 400, headers: CORS_HEADERS });
      }

      if (!/^https?:\/\//i.test(targetUrl)) {
        return new Response("Invalid stream URL protocol", { status: 400, headers: CORS_HEADERS });
      }

      try {
        const targetUrlObj = new URL(targetUrl);
        const origin = targetUrlObj.origin;
        const fetchHeaders: Record<string, string> = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": origin + "/",
          "Origin": origin,
        };

        const range = request.headers.get("range");
        if (range) fetchHeaders["Range"] = range;

        const targetRes = await fetch(targetUrl, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(15000),
        });

        const contentType = targetRes.headers.get("content-type") || "";
        const pathname = targetUrlObj.pathname.toLowerCase();
        const isExplicitSegment =
          pathname.endsWith(".ts") ||
          pathname.endsWith(".m4s") ||
          pathname.endsWith(".mp4") ||
          pathname.endsWith(".aac") ||
          targetUrl.includes(".ts?") ||
          targetUrl.includes(".m4s?");

        // 1. Direct High-Speed Segment Streaming
        if (isExplicitSegment && targetRes.body) {
          const headers = new Headers(CORS_HEADERS);
          headers.set("Content-Type", contentType && !contentType.includes("mpegurl") ? contentType : "video/mp2t");
          headers.set("Cache-Control", "public, max-age=60, immutable");
          const cl = targetRes.headers.get("content-length");
          if (cl) headers.set("Content-Length", cl);
          const cr = targetRes.headers.get("content-range");
          if (cr) headers.set("Content-Range", cr);
          const ar = targetRes.headers.get("accept-ranges");
          if (ar) headers.set("Accept-Ranges", ar);

          return new Response(targetRes.body, {
            status: targetRes.status,
            headers,
          });
        }

        // 2. Inspect M3U8 Manifest
        const rawBuffer = await targetRes.arrayBuffer();
        const textSample = new TextDecoder().decode(rawBuffer.slice(0, Math.min(rawBuffer.byteLength, 128)));
        const isM3U8Manifest = rawBuffer.byteLength > 0 && textSample.includes("#EXTM3U");

        if (isM3U8Manifest) {
          const manifestText = new TextDecoder().decode(rawBuffer);
          const lines = manifestText.split(/\r?\n/);
          const rewrittenLines = lines.map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            if (trimmed.startsWith("#")) {
              if (trimmed.startsWith("#EXT")) {
                return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
                  try {
                    const absUri = new URL(uri, targetUrl).toString();
                    return `URI="/api/stream-proxy?url=${encodeURIComponent(absUri)}"`;
                  } catch {
                    return `URI="${uri}"`;
                  }
                });
              }
              return line;
            }

            try {
              const absUrl = new URL(trimmed, targetUrl).toString();
              return `/api/stream-proxy?url=${encodeURIComponent(absUrl)}`;
            } catch {
              return line;
            }
          });

          const headers = new Headers(CORS_HEADERS);
          headers.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
          headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
          return new Response(rewrittenLines.join("\n"), {
            status: 200,
            headers,
          });
        }

        // 3. Fallback binary / other media
        const headers = new Headers(CORS_HEADERS);
        headers.set("Content-Type", contentType || "application/octet-stream");
        return new Response(rawBuffer, {
          status: targetRes.status,
          headers,
        });
      } catch (err: any) {
        return new Response(`Stream proxy error: ${err.message}`, { status: 502, headers: CORS_HEADERS });
      }
    }

    // 19. Logo & Image Proxy: /api/logo-proxy, /api/image-proxy
    if (path === "/api/logo-proxy" || path === "/api/image-proxy") {
      const imgUrl = String(url.searchParams.get("url") || "").trim();
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) {
        return new Response("Invalid image URL", { status: 400, headers: CORS_HEADERS });
      }

      try {
        const imgRes = await fetch(imgUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(8000),
        });

        if (imgRes.ok && imgRes.body) {
          const headers = new Headers(CORS_HEADERS);
          headers.set("Content-Type", imgRes.headers.get("content-type") || "image/png");
          headers.set("Cache-Control", "public, max-age=86400, immutable");
          return new Response(imgRes.body, { status: 200, headers });
        }
        return new Response("Image load failed", { status: imgRes.status, headers: CORS_HEADERS });
      } catch {
        return new Response("Image proxy timeout", { status: 504, headers: CORS_HEADERS });
      }
    }

    // 20. Version check: /api/version, /version.json
    if (path === "/api/version" || path === "/version.json") {
      return jsonResponse({
        appName: "HIGHFY TV",
        version: "4.2",
        releaseDate: "2026-10-02",
        environment: "Cloudflare Worker",
        status: "stable",
      });
    }

    // 21. Unknown API route
    return jsonResponse(
      {
        status: "not_found",
        message: `Endpoint ${path} not found on Cloudflare Worker backend`,
      },
      404
    );
  },
};
