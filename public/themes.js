// City themes: colours and a skyline of each city's landmarks, drawn as inline SVG
// (no external images: works offline at a booth, nothing to license or load).
// The SVGs are constants written here, never built from user input.

const W = 1600;
const H = 400;

/** A symmetrical stepped tower: [halfWidth, topY] pairs from the base up. */
function stepped(cx, tiers, spireTop) {
  const left = [];
  let y = H;
  for (const [half, top] of tiers) {
    left.push([cx - half, y], [cx - half, top]);
    y = top;
  }
  const pts = [...left];
  if (spireTop != null) pts.push([cx - 1.5, spireTop], [cx + 1.5, spireTop]);
  const right = left.map(([x, yy]) => [2 * cx - x, yy]).reverse();
  return `<polygon points="${[...pts, ...right].map((p) => p.join(',')).join(' ')}"/>`;
}

/** Generic background buildings, deterministic for a given seed. */
function filler(seed, { from = 0, to = W, min = 60, max = 200, gap = 6 } = {}) {
  let s = [...seed].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let out = '';
  for (let x = from; x < to; ) {
    const w = 26 + Math.floor(rand() * 46);
    const h = min + Math.floor(rand() * (max - min));
    out += `<rect x="${x}" y="${H - h}" width="${w}" height="${h}"/>`;
    if (rand() > 0.7) out += `<rect x="${x + w / 2 - 2}" y="${H - h - 18}" width="4" height="18"/>`;
    x += w + gap + Math.floor(rand() * 10);
  }
  return out;
}

const svg = (far, mid, near, extra = '') =>
  `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <g class="far">${far}</g><g class="mid">${mid}</g><g class="near">${near}</g>${extra}</svg>`;

// ---------------------------------------------------------------------------
const dubai = () => svg(
  filler('dubai-far', { min: 70, max: 170 }),
  filler('dubai-mid', { min: 40, max: 120, gap: 30 }) +
    // Dunes along the front
    `<path d="M0,400 Q200,350 420,385 T860,375 T1300,380 T1600,370 L1600,400 Z"/>`,
  // Dubai Frame
  `<path d="M392,400 V170 H496 V400 H478 V190 H410 V400 Z"/><rect x="404" y="160" width="80" height="12"/>` +
    // Burj Khalifa
    stepped(800, [[48, 300], [38, 235], [30, 175], [22, 125], [15, 85], [9, 55], [4, 30]], 4) +
    // Museum of the Future: the torus on its green mound
    `<path fill-rule="evenodd" d="M1000,330 C1000,250 1060,215 1105,215 C1160,215 1205,262 1205,325 C1205,360 1180,372 1150,372 L1045,372 C1018,372 1000,358 1000,330 Z M1045,320 C1045,282 1075,262 1102,262 C1135,262 1160,290 1160,322 C1160,336 1150,342 1135,342 L1062,342 C1050,342 1045,334 1045,320 Z"/>` +
    `<path d="M975,400 Q1100,355 1235,400 Z"/>` +
    // Burj Al Arab: mast and sail
    `<rect x="1330" y="130" width="9" height="270"/>` +
    `<path d="M1339,140 Q1450,190 1460,400 L1339,400 Z"/><rect x="1428" y="230" width="34" height="5"/>` +
    // Palms
    palm(150, 330) + palm(610, 345) + palm(1530, 335),
);

function palm(x, top) {
  return `<path d="M${x - 3},400 Q${x + 4},${(top + 400) / 2} ${x},${top} L${x + 4},${top} Q${x + 9},${(top + 400) / 2} ${x + 3},400 Z"/>` +
    `<path d="M${x + 2},${top} q-30,-10 -48,12 q22,-16 48,-8 q-20,-22 -46,-18 q30,-2 46,14 q8,-28 34,-34 q-22,14 -30,36 q26,-18 50,-6 q-28,-4 -48,12 q30,4 40,26 q-20,-14 -46,-22 Z"/>`;
}

// ---------------------------------------------------------------------------
const newYork = () => svg(
  filler('ny-far', { min: 110, max: 230, gap: 3 }),
  filler('ny-mid', { min: 70, max: 170, gap: 8 }),
  // Statue of Liberty on its pedestal
  `<path d="M150,400 V330 H245 V400 Z M162,330 V300 H233 V330 Z M178,300 V282 H217 V300 Z"/>` +
    `<path d="M186,282 L190,200 Q196,180 205,190 L210,282 Z"/><circle cx="198" cy="182" r="9"/>` +
    `<path d="M192,174 l-4,-14 l6,10 l2,-15 l3,15 l5,-12 l-1,15 l9,-9 l-7,13 Z"/>` +
    `<path d="M204,196 L222,140 L227,142 L211,198 Z"/><path d="M219,140 l4,-16 l8,4 l-3,14 Z"/>` +
    // Empire State Building
    stepped(640, [[55, 285], [45, 210], [34, 150], [24, 108], [14, 82], [8, 60], [3, 45]], 18) +
    // Chrysler Building: the crown of stacked arches
    stepped(880, [[42, 250], [32, 175], [26, 150]]) +
    `<path d="M854,150 Q880,110 906,150 Z M860,140 Q880,98 900,140 Z M866,128 Q880,85 894,128 Z M871,116 Q880,72 889,116 Z"/><rect x="878.5" y="38" width="3" height="50"/>` +
    // One World Trade Center
    `<polygon points="1080,400 1080,355 1092,110 1138,110 1150,355 1150,400"/><rect x="1113.5" y="40" width="3" height="72"/>` +
    // Brooklyn Bridge tower
    `<path fill-rule="evenodd" d="M1340,400 V230 H1420 V400 Z M1352,330 V262 Q1362,248 1372,262 V330 Z M1388,330 V262 Q1398,248 1408,262 V330 Z"/>` +
    `<path d="M1200,400 Q1300,330 1342,232 L1346,234 Q1306,334 1206,400 Z M1418,232 Q1460,330 1600,372 L1600,380 Q1456,336 1414,234 Z" />`,
);

// ---------------------------------------------------------------------------
const boston = () => svg(
  filler('boston-far', { min: 70, max: 170 }),
  filler('boston-mid', { min: 50, max: 120, gap: 16 }),
  // Old State House: brick hall with stepped gable and tower
  `<path d="M150,400 V300 H260 V400 Z M150,300 L205,262 L260,300 Z"/>` +
    stepped(205, [[16, 250], [12, 225], [8, 205], [4, 190]], 178) +
    // Custom House Tower: clock tower with pyramid top
    `<rect x="470" y="150" width="56" height="250"/><polygon points="466,150 498,92 530,150"/><rect x="496.5" y="70" width="3" height="24"/>` +
    `<path d="M440,400 V300 H556 V400 Z"/>` +
    // Prudential Tower
    `<rect x="760" y="120" width="58" height="280"/><rect x="786" y="70" width="4" height="52"/>` +
    // John Hancock Tower: the slim glass slab
    `<polygon points="880,400 880,96 935,90 935,400"/>` +
    // Zakim Bridge: two inverted-Y towers and fanned cables
    zakimTower(1220) + zakimTower(1480) +
    `<rect x="1080" y="352" width="520" height="8"/>`,
  `<g class="cables">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="1220" y1="${200 + i * 4}" x2="${1100 + i * 18}" y2="354"/><line x1="1220" y1="${200 + i * 4}" x2="${1340 - i * 16}" y2="354"/><line x1="1480" y1="${200 + i * 4}" x2="${1360 + i * 16}" y2="354"/><line x1="1480" y1="${200 + i * 4}" x2="${1600 - i * 16}" y2="354"/>`).join('')}</g>`,
);

function zakimTower(x) {
  return `<polygon points="${x - 34},400 ${x - 6},250 ${x - 4},180 ${x + 4},180 ${x + 6},250 ${x + 34},400 ${x + 24},400 ${x},262 ${x - 24},400"/>`;
}

// ---------------------------------------------------------------------------
const singapore = () => svg(
  filler('sg-far', { min: 120, max: 240, gap: 4 }),
  filler('sg-mid', { min: 60, max: 150, gap: 14 }),
  // Supertree Grove
  supertree(150, 230) + supertree(250, 180) + supertree(345, 250) +
    // Marina Bay Sands: three towers and the SkyPark across the top
    `<polygon points="640,400 660,150 690,150 700,400"/><polygon points="760,400 772,150 802,150 820,400"/><polygon points="880,400 884,150 914,150 940,400"/>` +
    `<path d="M610,150 Q620,138 650,136 L930,136 Q965,138 985,128 L990,134 Q970,150 930,152 L640,152 Q620,154 610,150 Z"/>` +
    // ArtScience Museum: the lotus
    `<path d="M1080,380 Q1060,320 1070,280 Q1095,320 1105,370 Z M1110,372 Q1105,300 1125,255 Q1145,300 1140,372 Z M1145,370 Q1155,320 1180,280 Q1190,320 1170,380 Z M1060,380 H1190 V400 H1060 Z"/>` +
    // Merlion
    `<path d="M1300,400 V340 Q1300,310 1322,302 Q1345,296 1350,316 L1360,322 L1352,330 Q1356,352 1340,360 L1340,400 Z"/>` +
    // Singapore Flyer
    `<circle cx="1490" cy="250" r="110" class="ring"/><polygon points="1478,360 1490,250 1502,360 1512,400 1468,400"/>`,
  `<g class="spokes">${Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return `<line x1="1490" y1="250" x2="${(1490 + 110 * Math.cos(a)).toFixed(1)}" y2="${(250 + 110 * Math.sin(a)).toFixed(1)}"/>`;
  }).join('')}</g>`,
);

function supertree(x, top) {
  return `<path d="M${x - 8},400 Q${x - 6},${top + 60} ${x - 34},${top + 6} Q${x},${top - 6} ${x + 34},${top + 6} Q${x + 6},${top + 60} ${x + 8},400 Z"/>` +
    `<ellipse cx="${x}" cy="${top + 4}" rx="44" ry="9"/>`;
}

// ---------------------------------------------------------------------------
const melbourne = () => svg(
  filler('mel-far', { min: 80, max: 190 }),
  filler('mel-mid', { min: 50, max: 120, gap: 18 }),
  // Shrine of Remembrance: columned base and stepped pyramid roof
  `<path d="M100,400 V320 H300 V400 Z"/><polygon points="130,320 270,320 255,292 145,292"/>` +
    stepped(200, [[50, 278], [40, 262], [30, 248], [20, 236]], 226) +
    // Flinders Street Station: long hall, green dome and clock tower
    `<path d="M380,400 V320 H760 V400 Z"/><rect x="530" y="270" width="80" height="50"/><path d="M528,272 Q570,190 612,272 Z"/><rect x="567" y="196" width="6" height="14"/>` +
    `<rect x="700" y="230" width="34" height="90"/><polygon points="696,232 717,200 738,232"/>` +
    // Eureka Tower with its gold crown
    `<rect x="880" y="70" width="70" height="330"/>` +
    // Royal Exhibition Building: wings, drum, dome and lantern
    `<path d="M1150,400 V320 H1450 V400 Z"/><rect x="1250" y="262" width="100" height="58"/><path d="M1248,264 Q1300,170 1352,264 Z"/><rect x="1292" y="168" width="16" height="22"/><polygon points="1290,170 1300,150 1310,170"/>`,
  `<rect class="gold" x="880" y="70" width="70" height="34"/>`,
);

// ---------------------------------------------------------------------------
const generic = () => svg(filler('cm-far', { min: 90, max: 220, gap: 4 }), filler('cm-mid', { min: 50, max: 140, gap: 10 }), filler('cm-near', { min: 20, max: 80, gap: 40 }));

export const THEMES = {
  dubai: { name: 'Dubai', greeting: 'Marhaba', lat: 25.2048, lon: 55.2708, zones: ['Asia/Dubai', 'Asia/Muscat'], landmarks: 'Burj Khalifa · Dubai Frame · Museum of the Future · Burj Al Arab', skyline: dubai },
  'new-york': { name: 'New York', greeting: 'Welcome to the Big Apple', lat: 40.7128, lon: -74.006, zones: ['America/New_York'], landmarks: 'Statue of Liberty · Empire State · Chrysler · One World Trade · Brooklyn Bridge', skyline: newYork },
  boston: { name: 'Boston', greeting: 'Welcome, Boston', lat: 42.3601, lon: -71.0589, zones: [], landmarks: 'Old State House · Custom House Tower · Prudential · Hancock · Zakim Bridge', skyline: boston },
  singapore: { name: 'Singapore', greeting: 'Selamat datang', lat: 1.3521, lon: 103.8198, zones: ['Asia/Singapore'], landmarks: 'Supertree Grove · Marina Bay Sands · ArtScience Museum · Merlion · Singapore Flyer', skyline: singapore },
  melbourne: { name: 'Melbourne', greeting: "G'day, Melbourne", lat: -37.8136, lon: 144.9631, zones: ['Australia/Melbourne'], landmarks: 'Shrine of Remembrance · Flinders Street Station · Eureka Tower · Royal Exhibition Building', skyline: melbourne },
};
export const DEFAULT_THEME = { name: '', greeting: '', landmarks: '', skyline: generic };

const km = (aLat, aLon, bLat, bLon) => {
  const r = Math.PI / 180;
  const d = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(d));
};

/** The theme city nearest to a position, if it is within `maxKm`. */
export function nearestCity(lat, lon, maxKm = 300) {
  let best = null;
  for (const [key, t] of Object.entries(THEMES)) {
    const d = km(lat, lon, t.lat, t.lon);
    if (!best || d < best.d) best = { key, d };
  }
  return best && best.d <= maxKm ? best : { key: null, d: best?.d, nearest: best?.key };
}

/** A guess from the browser's time zone, before (or without) asking for the location. */
export function cityFromTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return Object.entries(THEMES).find(([, t]) => t.zones.includes(zone))?.[0] ?? null;
}

let skylineCache = {};
/** Applies a theme to the whole page: colours (CSS, by data-city) and the skyline. */
export function applyTheme(key) {
  const theme = THEMES[key] ?? DEFAULT_THEME;
  document.documentElement.dataset.city = THEMES[key] ? key : 'default';
  let layer = document.getElementById('skyline');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'skyline';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }
  current = key;
  paintSkylines();
  return theme;
}

let current = null;
/** Draws the current city's skyline into the page background and every [data-skyline] element. */
export function paintSkylines() {
  const theme = THEMES[current] ?? DEFAULT_THEME;
  const cacheKey = THEMES[current] ? current : 'default';
  // Constant, author-written SVG (see above): safe to parse as markup.
  skylineCache[cacheKey] ??= theme.skyline();
  for (const el of [document.getElementById('skyline'), ...document.querySelectorAll('[data-skyline]')]) {
    if (el && el.dataset.painted !== cacheKey) {
      el.innerHTML = skylineCache[cacheKey];
      el.dataset.painted = cacheKey;
    }
  }
}
