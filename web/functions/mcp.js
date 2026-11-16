// Flat Finder MCP server (Streamable HTTP, JSON responses), so people can add Flat Finder to Claude as a connector.
// Runs as a Cloudflare Pages Function at /mcp and reads the same static data the website uses.
import { DEFAULT_CRITERIA, NEAR, feetLabel, matchSociety, priceFor } from '../src/filters.js';
import { searchSocieties } from '../src/search.js';

const PROTOCOL = '2025-06-18';
const SITE = 'https://flat-finder.pages.dev';
const cache = new Map();

async function city(env, origin, id) {
  if (!cache.has(id)) {
    const res = await env.ASSETS.fetch(new Request(`${origin}/data/${id}.json`));
    if (!res.ok) throw new Error(`Unknown city "${id}"`);
    cache.set(id, await res.json());
  }
  return cache.get(id);
}

const TOOLS = [
  {
    name: 'search_societies',
    description: 'Find housing societies in an Indian city that fit a home search: BHK, the smallest bedroom the person can live with (both sides, or area), home size, buy budget or monthly rent, amenities and what must be nearby. Returns verified matches first (bedrooms read from builder plans), then likely and "probably fits" (estimated from unit size). Prices are medians of live listings; values marked estimated are Flat Finder estimates.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City id, e.g. "gurgaon"', default: 'gurgaon' },
        mode: { type: 'string', enum: ['buy', 'rent'], default: 'buy' },
        bhk: { type: 'array', items: { type: 'integer' }, description: 'BHK types, e.g. [3,4]' },
        min_bedroom_ft: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Smallest bedroom sides in feet, e.g. [11.25, 12.25]' },
        min_bedroom_sqft: { type: 'number', description: 'Smallest bedroom area in sq ft (1 gaj = 9 sq ft). Use instead of min_bedroom_ft.' },
        min_home_sqft: { type: 'number' },
        max_price_inr: { type: 'number', description: 'Buy budget in rupees' },
        max_rent_inr: { type: 'number', description: 'Monthly rent budget in rupees' },
        amenities: { type: 'array', items: { type: 'string' }, description: 'e.g. ["squash","pool","gym","club","tennis"] or exact amenity names' },
        nearby: { type: 'array', items: { type: 'string', enum: Object.keys(NEAR) }, description: 'park (500 m), metro (1.5 km), school (1 km), hospital (2 km), shopping (1.5 km)' },
        types: { type: 'array', items: { type: 'string', enum: ['apartment', 'builder floor', 'villa', 'plot'] }, default: ['apartment'] },
        ready_to_move: { type: 'boolean' },
        include_estimates: { type: 'boolean', default: true },
        limit: { type: 'integer', default: 15, maximum: 50 },
      },
    },
  },
  {
    name: 'get_society',
    description: 'Full details for one society by name: unit types and bedroom sizes with sources, buy and rent prices per BHK, resident ratings, nearby places, amenities and links.',
    inputSchema: { type: 'object', properties: { city: { type: 'string', default: 'gurgaon' }, name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'compare_societies',
    description: 'Side-by-side comparison of up to 6 societies by name: prices, rents, smallest bedrooms, score, rating, nearby.',
    inputSchema: { type: 'object', properties: { city: { type: 'string', default: 'gurgaon' }, names: { type: 'array', items: { type: 'string' }, maxItems: 6 } }, required: ['names'] },
  },
];

const amenityKey = (a) => {
  const k = a.toLowerCase().trim();
  return ['squash', 'pool', 'gym', 'club', 'tennis', 'badminton', 'jogging', 'kids'].includes(k) ? k : `n:${k}`;
};

function summary(s, st, crit) {
  const p = priceFor(s, crit.mode, crit.bhk);
  const rooms = s.unit_types.flatMap((u) => u.bedrooms || []);
  const small = rooms.length ? rooms.reduce((m, r) => (r[0] < m[0] ? r : m)) : null;
  return {
    name: s.name, locality: s.locality, verdict: st, type: s.kind,
    [crit.mode === 'rent' ? 'rent_from_inr' : 'price_from_inr']: p?.value ?? null, price_is_estimate: p ? p.estimated : null,
    smallest_bedroom_read: small ? `${feetLabel(small[0])} x ${feetLabel(small[1])}` : null,
    flat_finder_score: s.score, resident_rating: s.rating, listings_for_sale: s.sale_count, listings_for_rent: s.rent_count,
    nearest_park_m: s.nearby?.park?.m ?? null, nearest_metro_m: s.nearby?.metro?.m ?? null,
    link: `${SITE}/?open=${s.id}`,
  };
}

function detail(s) {
  return {
    name: s.name, developer: s.developer, locality: s.locality, status: s.status, possession: s.possession, rera: s.rera_id,
    towers: s.towers, units: s.units, acres: s.acres, verified: s.verified, note: s.note,
    unit_types: s.unit_types.map((u) => ({ unit: u.label, bhk: u.bhk, sqft: u.super_sqft || u.size_sqft || u.carpet_sqft,
      bedrooms: (u.bedrooms || []).map((r) => `${feetLabel(r[0])} x ${feetLabel(r[1])}`), all_bedrooms_read: u.rooms_complete,
      estimated_smallest_bedroom: u.est_short ? `at least ${feetLabel(u.est_short)} wide, ~${u.est_area} sq ft (estimate)` : null,
      source: u.source, page: u.page })),
    prices: s.prices, score: s.score, score_parts: s.score_parts, resident_rating: s.rating, rating_count: s.rating_count,
    nearby: s.nearby, amenities: s.amenities, magicbricks: s.url, google_maps: s.gmaps, flat_finder: `${SITE}/?open=${s.id}`,
  };
}

async function callTool(name, args, env, origin) {
  const data = await city(env, origin, args.city || 'gurgaon');
  if (name === 'search_societies') {
    const crit = {
      ...structuredClone(DEFAULT_CRITERIA), mode: args.mode || 'buy', bhk: args.bhk || [], kinds: args.types || ['apartment'],
      room: args.min_bedroom_ft ? { a: args.min_bedroom_ft[0], b: args.min_bedroom_ft[1] } : null, roomArea: args.min_bedroom_sqft || null,
      minSqft: args.min_home_sqft || 0, maxPrice: args.max_price_inr || null, maxRent: args.max_rent_inr || null,
      amenities: (args.amenities || []).map(amenityKey), near: args.nearby || [], ready: !!args.ready_to_move, estimates: args.include_estimates !== false,
    };
    const rank = { match: 3, likely: 2, probable: 1 };
    const hits = data.societies.map((s) => [s, matchSociety(s, crit)]).filter(([, st]) => rank[st])
      .sort((a, b) => rank[b[1]] - rank[a[1]] || b[0].verified - a[0].verified || (b[0].score || 0) - (a[0].score || 0));
    const counts = hits.reduce((c, [, st]) => ((c[st] = (c[st] || 0) + 1), c), {});
    return { city: data.city.name, total: hits.length, counts, how_to_read: 'match = every bedroom read from plans and passes; likely = rooms read so far pass; probable = plans unread, estimated from unit size. Societies without room data are not listed under room filters.',
      results: hits.slice(0, Math.min(args.limit || 15, 50)).map(([s, st]) => summary(s, st, crit)) };
  }
  const find = (n) => searchSocieties(data.societies, n, 1)[0];
  if (name === 'get_society') {
    const s = find(args.name);
    return s ? detail(s) : { error: `No society found for "${args.name}"` };
  }
  if (name === 'compare_societies') {
    return { societies: (args.names || []).slice(0, 6).map((n) => { const s = find(n); return s ? summary(s, s.verified ? 'verified' : 'portal data', { ...DEFAULT_CRITERIA }) : { name: n, error: 'not found' }; }) };
  }
  throw new Error(`Unknown tool ${name}`);
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' } });
  if (request.method === 'GET') return json({ name: 'Flat Finder', mcp: 'POST JSON-RPC here', tools: TOOLS.map((t) => t.name) });
  const origin = new URL(request.url).origin;
  const msg = await request.json().catch(() => null);
  if (!msg) return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  const reply = (result) => json({ jsonrpc: '2.0', id: msg.id, result });
  try {
    switch (msg.method) {
      case 'initialize':
        return reply({ protocolVersion: msg.params?.protocolVersion || PROTOCOL, capabilities: { tools: {} },
          serverInfo: { name: 'flat-finder', version: '0.1.0' },
          instructions: 'Search Indian housing societies by real bedroom sizes, buy or rent budget, amenities and what is nearby. Always say which results are verified, likely or estimated, and share the Flat Finder link for each society.' });
      case 'notifications/initialized':
        return new Response(null, { status: 202 });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const out = await callTool(msg.params.name, msg.params.arguments || {}, env, origin);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
      }
      default:
        return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  } catch (e) {
    return reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
  }
}
