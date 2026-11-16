// Pure filter logic. A society is "match", "likely", "unknown" (not checked yet) or "no".

const RANK = { match: 3, likely: 2, unknown: 1, no: 0 };

export const DEFAULT_CRITERIA = {
  kinds: ['apartment'],
  bhk: [],          // empty = any
  room: null,       // { a, b } in feet, orientation-free
  minSqft: 0,
  mode: 'buy',      // 'buy' or 'rent'
  maxPrice: null,   // rupees, buying
  maxRent: null,    // rupees per month, renting
  amenities: [],    // amenity keys, see AMENITY_KEYS
  ready: false,     // only ready to move
};

// Amenity keys -> words that identify them in portal amenity names.
export const AMENITY_KEYS = {
  squash: ['squash'],
  pool: ['swimming pool', 'pool'],
  gym: ['gym'],
  club: ['club house', 'clubhouse'],
  tennis: ['tennis'],
  badminton: ['badminton'],
  jogging: ['jogging'],
  kids: ['kids play', "children's play", 'kids club'],
};

export function hasAmenity(s, key) {
  const fact = s.amen_facts?.[key];
  if (fact) return fact.value === 'yes';
  const words = AMENITY_KEYS[key] || [key];
  return s.amenities.some((a) => words.some((w) => a.toLowerCase().includes(w)));
}

export function roomPasses([short, long], { a, b }) {
  const need = [Math.min(a, b), Math.max(a, b)];
  return short + 1e-6 >= need[0] && long + 1e-6 >= need[1];
}

export function unitSize(u) {
  return u.super_sqft || u.size_sqft || u.carpet_sqft || null;
}

export function matchUnit(u, c) {
  if (c.minSqft > 0) {
    const size = unitSize(u);
    if (size == null) return 'unknown';
    if (size < c.minSqft) return 'no';
  }
  if (!c.room) return 'match';
  if (!u.bedrooms?.length) return 'unknown';
  if (u.bedrooms.some((r) => !roomPasses(r, c.room))) return 'no';
  return u.rooms_complete ? 'match' : 'likely';
}

export function matchSociety(s, c) {
  if (c.kinds.length && !c.kinds.includes(s.kind)) return 'no';
  if (c.ready && !/ready/i.test(s.status || '')) return 'no';
  const budget = c.mode === 'rent' ? c.maxRent : c.maxPrice;
  if (budget) {
    const p = priceFor(s, c.mode, c.bhk);
    if (p && p.value > budget) return 'no';
  }
  for (const key of c.amenities) if (!hasAmenity(s, key)) return 'no';

  const unitFilters = c.bhk.length || c.minSqft > 0 || c.room;
  if (!unitFilters) return 'match';
  const units = s.unit_types.filter((u) => !c.bhk.length || c.bhk.includes(u.bhk));
  if (!units.length) return s.unit_types.length ? 'no' : 'unknown';
  let best = 'no';
  for (const u of units) {
    const r = matchUnit(u, c);
    if (RANK[r] > RANK[best]) best = r;
    if (best === 'match') break;
  }
  return best;
}

export function feetLabel(ft) {
  let f = Math.floor(ft + 1e-6);
  let i = Math.round((ft - f) * 12);
  if (i === 12) { f += 1; i = 0; }
  return `${f}'${i}"`;
}

// Cheapest price for the chosen BHKs: listing median first, our estimate otherwise. null when unknown.
export function priceFor(s, mode, bhk = []) {
  let best = null;
  for (const [b, p] of Object.entries(s.prices || {})) {
    if (bhk.length && !bhk.includes(+b)) continue;
    const real = p[mode]?.median;
    const est = p[`${mode}_est`]?.value;
    const v = real ?? est;
    if (v && (!best || v < best.value)) best = { value: v, estimated: real == null, bhk: +b, basis: real == null ? p[`${mode}_est`].basis : null, n: p[mode]?.n };
  }
  if (!best && mode === 'buy' && s.price_min && !bhk.length) best = { value: s.price_min, estimated: false, bhk: null, basis: 'builder price range' };
  return best;
}

export function formatINR(r) {
  if (r == null) return '';
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1).replace(/\.0$/, '')} L`;
  return `₹${Math.round(r / 1000)}k`;
}
