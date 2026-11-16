import './style.css';
import maplibregl from 'maplibre-gl';
import { addBaseLayers, addSocietyLayers, BASE_MODES, createMap, OVERVIEW, setBaseMode, setSelected, setStates, startPulse } from './map.js';
import { searchSocieties } from './search.js';
import { createFeed } from './feed.js';
import { AMENITY_KEYS, DEFAULT_CRITERIA, feetLabel, formatINR, matchSociety, matchUnit, priceFor, roomPasses } from './filters.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mobile = matchMedia('(max-width: 700px)').matches;
const REPO = 'https://github.com/kairothq/flat-finder';
const RANK = { match: 3, likely: 2, unknown: 1, no: 0 };

const KINDS = [['apartment', 'Apartments'], ['builder floor', 'Builder floors'], ['villa', 'Villas'], ['plot', 'Plots']];
const AMEN_LABELS = { squash: 'Squash', pool: 'Pool', gym: 'Gym', club: 'Clubhouse', tennis: 'Tennis', badminton: 'Badminton', jogging: 'Jogging track', kids: 'Kids play' };
const DIVY = { // Divy's own Gurugram search, shown as the example
  kinds: ['apartment'], bhk: [2, 3, 4], room: { a: 11.25, b: 12.25 }, minSqft: 1620, mode: 'buy', maxPrice: null, maxRent: null, amenities: ['squash'], ready: false };

let crit = structuredClone(DEFAULT_CRITERIA);
let baseMode = BASE_MODES.includes(new URLSearchParams(location.search).get('map')) ? new URLSearchParams(location.search).get('map') : 'night';
let data, byId, map, feed, selected = null, states = new Map(), tourTimer = null, cityId = 'gurgaon', details = null;

const fmtPrice = (r) => (r >= 1e7 ? `₹${(r / 1e7).toFixed(r >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')} Cr` : `₹${Math.round(r / 1e5)} L`);

async function boot() {
  const cities = await fetch('/data/cities.json').then((r) => r.json()).catch(() => ({ gurgaon: { name: 'Gurugram' } }));
  const want = new URLSearchParams(location.search).get('city');
  cityId = cities[want] ? want : 'gurgaon';
  const [city, shapes] = await Promise.all([
    fetch(`/data/${cityId}.json`).then((r) => r.json()),
    fetch(`/data/${cityId}-shapes.geojson`).then((r) => r.json()),
  ]);
  data = city;
  OVERVIEW.center = city.city.center;
  OVERVIEW.zoom = city.city.zoom || OVERVIEW.zoom;
  const pick = $('city-pick');
  pick.replaceChildren(...Object.entries(cities).map(([id, c]) => new Option(c.name, id, false, id === cityId)));
  pick.onchange = () => { location.search = `?city=${pick.value}`; };
  byId = new Map(city.societies.map((s) => [s.id, s]));
  const m = city.price_model || {};
  $('note').textContent = `${city.counts.on_map.toLocaleString()} societies · ${(city.counts.for_sale || 0).toLocaleString()} homes for sale, ${(city.counts.for_rent || 0).toLocaleString()} for rent on Magicbricks · ${city.counts.verified} verified from brochures and HRERA plans`;
  $('about-prices').textContent = `Prices and rents are medians of live Magicbricks listings. Where a society has none, "~" marks our estimate: rent is about ${((m.city_yield || 0.025) * 100).toFixed(1)}% of the price per year in ${city.city.name} (measured on ${m.pairs || 0} society and BHK pairs with both, correlation ${m.log_price_rent_correlation ?? 'n/a'}), using the locality's own rate where it has enough data.`;
  $('dl-all').href = `/data/${cityId}-societies.csv`;
  $('dl-units').href = `/data/${cityId}-units.csv`;
  $('dl-results').onclick = exportResults;

  feed = createFeed($('feed'), $('log-mode'), { events: city.events, byId });
  buildFilters();
  try {
    map = createMap('map', { mobile });
    window.__map = map; // handy for debugging in the console
  } catch (e) {
    $('note').textContent = 'Your browser could not start WebGL, so the 3D map is off. Filters and results still work.';
    applyFilters();
    feed.ambient();
    return;
  }

  const points = { type: 'FeatureCollection', features: city.societies.map((s) => ({
    type: 'Feature', properties: { sid: s.id, name: s.name, show: 1 }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) };

  map.once('style.load', () => {
    addSocietyLayers(map, shapes, points);
    addBaseLayers(map);
    setBaseMode(map, baseMode);
    startPulse(map);
    map.on('click', 'bld', (e) => openSociety(e.features[0].properties.sid));
    map.on('click', 'site-fill', (e) => openSociety(e.features[0].properties.sid));
    map.on('click', 'glow', (e) => openSociety(e.features[0].properties.sid));
    for (const l of ['bld', 'site-fill', 'glow']) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
    }
    intro();
  });
}

function intro() {
  closeCard();
  const q = new URLSearchParams(location.search);
  if (q.get('preset') === 'divy') crit = structuredClone(DIVY), buildFilters();
  if (q.get('open')) {
    map.jumpTo(OVERVIEW);
    applyFilters();
    setTimeout(() => openSociety(q.get('open')), 300);
    return;
  }
  const skip = mobile || new URLSearchParams(location.search).has('nointro');
  if (skip) {
    if (!mobile) map.jumpTo(OVERVIEW);
    applyFilters(true);
    feed.ambient();
    return;
  }
  setStates(map, data.societies.map((s) => [s.id, 'no']));
  map.jumpTo({ center: [78.5, 22.5], zoom: 2.2, pitch: 0, bearing: 0 });
  setTimeout(() => {
    map.flyTo({ ...OVERVIEW, duration: 8500, curve: 1.6, essential: true });
    feed.sweep(data.societies, 9000);
  }, 500);
  map.once('moveend', () => applyFilters(true));
}

// ---------- filters UI ----------
function chip(label, on, onClick) {
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function buildFilters() {
  const kind = $('f-kind'), bhk = $('f-bhk'), amen = $('f-amen');
  const redraw = () => {
    kind.replaceChildren(...KINDS.map(([k, l]) => chip(l, crit.kinds.includes(k), () => { toggle(crit.kinds, k); redraw(); applyFilters(); })));
    bhk.replaceChildren(...[1, 2, 3, 4, 5].map((n) => chip(n === 5 ? '5+' : String(n), crit.bhk.includes(n), () => {
      toggle(crit.bhk, n); if (n === 5) toggle(crit.bhk, 6); redraw(); applyFilters(); })));
    amen.replaceChildren(...Object.keys(AMENITY_KEYS).map((k) => chip(AMEN_LABELS[k], crit.amenities.includes(k), () => { toggle(crit.amenities, k); redraw(); applyFilters(); })));
    $('f-room-on').checked = !!crit.room;
    $('f-room').classList.toggle('off', !crit.room);
    const r = crit.room || { a: 11.25, b: 12.25 };
    setFtIn('ra', r.a); setFtIn('rb', r.b);
    $('f-size').value = crit.minSqft;
    document.querySelectorAll('#f-mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === crit.mode));
    setBudgetSlider();
    $('f-ready').checked = crit.ready;
    labels();
  };
  for (const p of ['ra', 'rb']) {
    $(`${p}-ft`).replaceChildren(...range(7, 20).map((f) => new Option(`${f}'`, f)));
    $(`${p}-in`).replaceChildren(...range(0, 11).map((i) => new Option(`${i}"`, i)));
    for (const s of ['ft', 'in']) $(`${p}-${s}`).onchange = () => { $('f-room-on').checked = true; readRoom(); };
  }
  $('f-room-on').onchange = readRoom;
  $('f-size').oninput = () => { crit.minSqft = +$('f-size').value; labels(); applyFilters(); };
  $('f-price').oninput = () => {
    const v = +$('f-price').value, top = +$('f-price').max;
    if (crit.mode === 'rent') crit.maxRent = v >= top ? null : v * 1000; else crit.maxPrice = v >= top ? null : v * 1e7;
    labels(); applyFilters();
  };
  document.querySelectorAll('#f-mode button').forEach((b) => (b.onclick = () => { crit.mode = b.dataset.m; redraw(); applyFilters(); }));
  function setBudgetSlider() {
    const el = $('f-price');
    if (crit.mode === 'rent') { el.min = 10; el.max = 500; el.step = 5; el.value = crit.maxRent ? crit.maxRent / 1000 : 500; }
    else { el.min = 0.25; el.max = 20; el.step = 0.25; el.value = crit.maxPrice ? crit.maxPrice / 1e7 : 20; }
  }
  $('f-ready').onchange = () => { crit.ready = $('f-ready').checked; applyFilters(); };
  $('preset-divy').onclick = () => { crit = structuredClone(DIVY); redraw(); applyFilters(); };
  $('btn-replay').onclick = intro;
  $('btn-tour').onclick = tour;
  $('btn-hide').onclick = () => document.body.classList.toggle('bare');
  buildControls();
  buildSearch();

  function readRoom() {
    crit.room = $('f-room-on').checked ? { a: getFtIn('ra'), b: getFtIn('rb') } : null;
    $('f-room').classList.toggle('off', !crit.room);
    applyFilters();
  }
  function labels() {
    $('v-size').textContent = crit.minSqft ? `${crit.minSqft.toLocaleString()} sq ft · ${Math.round(crit.minSqft / 9)} gaj` : 'Any';
    const b = crit.mode === 'rent' ? crit.maxRent : crit.maxPrice;
    $('v-price').textContent = b ? `up to ${formatINR(b)}${crit.mode === 'rent' ? '/month' : ''}` : 'Any';
    $('l-price').textContent = crit.mode === 'rent' ? 'Monthly rent' : 'Budget';
  }
  redraw();
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const toggle = (arr, v) => { const i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v); };
const setFtIn = (p, ft) => { $(`${p}-ft`).value = Math.floor(ft + 1e-6); $(`${p}-in`).value = Math.round((ft - Math.floor(ft + 1e-6)) * 12); };
const getFtIn = (p) => +$(`${p}-ft`).value + +$(`${p}-in`).value / 12;

// ---------- apply ----------
let waveTimer = null;
function applyFilters(wave = false) {
  const next = new Map(data.societies.map((s) => [s.id, matchSociety(s, crit)]));
  const changed = [...next].filter(([id, st]) => states.get(id) !== st);
  states = next;
  clearInterval(waveTimer);
  if (wave && map) {
    // Light up in a wave from the city centre, like a scan passing over.
    const c = OVERVIEW.center;
    changed.sort((a, b) => dist(byId.get(a[0]), c) - dist(byId.get(b[0]), c));
    let i = 0;
    const per = Math.ceil(changed.length / 30);
    waveTimer = setInterval(() => {
      setStates(map, changed.slice(i, i + per));
      i += per;
      if (i >= changed.length) clearInterval(waveTimer);
    }, 50);
  } else if (map?.getSource?.('shapes')) setStates(map, changed);
  renderCount();
  if (selected) renderCard(byId.get(selected));
}
const dist = (s, c) => (s.lng - c[0]) ** 2 + (s.lat - c[1]) ** 2;

function ranked() {
  return data.societies
    .filter((s) => states.get(s.id) === 'match' || states.get(s.id) === 'likely')
    .sort((a, b) => RANK[states.get(b.id)] - RANK[states.get(a.id)] || b.verified - a.verified || (b.units || 0) - (a.units || 0));
}

function renderCount() {
  const counts = { match: 0, likely: 0, unknown: 0 };
  for (const st of states.values()) if (st in counts) counts[st]++;
  animateNumber($('count'), counts.match + counts.likely);
  const bits = [];
  if (counts.likely) bits.push(`${counts.likely} likely (some rooms unread)`);
  if (counts.unknown) bits.push(`${counts.unknown.toLocaleString()} not checked yet`);
  $('count-sub').textContent = bits.join(' · ');
  const list = ranked().slice(0, 40);
  $('results').replaceChildren(...list.map((s) => {
    const li = document.createElement('li');
    const st = states.get(s.id);
    const p = priceFor(s, crit.mode, crit.bhk);
    const money = p ? `${p.estimated ? '~' : ''}${formatINR(p.value)}${crit.mode === 'rent' ? '/mo' : ''} · ` : '';
    li.innerHTML = `<span>${esc(s.name)}</span><span class="tag ${st}">${money}${s.verified ? 'verified · ' : ''}${esc(s.locality || '')}</span>`;
    li.onclick = () => openSociety(s.id);
    return li;
  }));
}

function animateNumber(el, to) {
  const from = +el.textContent.replace(/,/g, '') || 0;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.max(0, Math.min(1, (t - t0) / 700));
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3)).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- society card ----------
function openSociety(sid, { fly = true } = {}) {
  const s = byId.get(sid);
  if (!s) return;
  if (map) setSelected(map, sid, selected);
  selected = sid;
  if (fly && map) map.flyTo({ center: [s.lng, s.lat], zoom: mobile ? 15.4 : 16.2, pitch: is3d ? 55 : 0, bearing: 0, duration: 2600, essential: true,
    offset: mobile ? [0, -80] : [0, -60] });
  renderCard(s);
  feed.play(sid);
}

function closeCard() {
  $('card').hidden = true;
  if (map && selected) setSelected(map, null, selected);
  selected = null;
  feed?.ambient();
}

function unitVerdict(u) {
  const r = matchUnit(u, { ...crit, room: crit.room });
  return crit.room || crit.minSqft ? r : null;
}

function renderCard(s) {
  const st = states.get(s.id);
  const label = { match: 'Matches your search', likely: 'Likely match', unknown: 'Not checked yet', no: 'Does not match' }[st];
  const rows = s.unit_types.filter((u) => !crit.bhk.length || crit.bhk.includes(u.bhk)).slice(0, 14).map((u) => {
    const v = unitVerdict(u);
    const rooms = u.bedrooms?.length
      ? u.bedrooms.map((r) => `<span style="color:${crit.room && !roomPasses(r, crit.room) ? '#ff9b8a' : 'inherit'}">${feetLabel(r[0])} × ${feetLabel(r[1])}</span>`).join(', ') + (u.rooms_complete ? '' : ' <span class="fine">(not all rooms read)</span>')
      : '<span class="fine">room sizes not read yet</span>';
    const src = u.source ? `<a href="${esc(u.source)}" target="_blank" rel="noopener">${u.confidence === 'primary' ? 'plan' : 'portal'}${u.page ? ' p.' + esc(u.page) : ''}</a>` : '';
    const size = u.super_sqft ? `${u.super_sqft.toLocaleString()} super` : u.carpet_sqft ? `${u.carpet_sqft.toLocaleString()} carpet` : u.size_sqft ? `${u.size_sqft.toLocaleString()}` : '';
    return `<tr><td>${esc(u.label)}<div class="fine">${size ? size + ' sq ft' : ''}</div></td><td>${rooms}</td><td>${v ? `<span class="badge ${v}">${v === 'unknown' ? 'unread' : v}</span>` : ''}</td><td>${src}</td></tr>`;
  }).join('');
  const want = new Set(crit.amenities.flatMap((k) => AMENITY_KEYS[k]));
  const facts = Object.entries(s.amen_facts || {}).map(([k, f]) => `<span class="hit">${esc(AMEN_LABELS[k] || k)}: ${esc(f.value)} (<a href="${esc(f.source)}" target="_blank" rel="noopener">p.${esc(f.page)}</a>)</span>`).join('');
  const amen = s.amenities.slice(0, 30).map((a) => `<span class="${[...want].some((w) => a.toLowerCase().includes(w)) ? 'hit' : ''}">${esc(a)}</span>`).join('');
  const plans = Object.entries(s.plan_links || {}).map(([b, urls]) => urls.slice(0, 2).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${b} BHK plan${urls.length > 1 ? ' ' + (i + 1) : ''}</a>`).join(' ')).join(' ');
  const issue = `${REPO}/issues/new?title=${encodeURIComponent('Research: ' + s.name)}&body=${encodeURIComponent(`Please verify room sizes and amenities for ${s.name} (${s.locality || ''}).\n\nPortal page: ${s.url}\n${s.brochure_url ? 'Brochure: ' + s.brochure_url : ''}`)}`;
  const facts2 = [s.towers && `${s.towers} towers`, s.units && `${Number(s.units).toLocaleString()} units`, s.acres && `${s.acres} acres`, s.status, s.possession && `possession ${s.possession}`].filter(Boolean).join(' · ');
  const price = s.price_min ? `builder range ${fmtPrice(s.price_min)}${s.price_max && s.price_max !== s.price_min ? ' to ' + fmtPrice(s.price_max) : ''}` : 'builder price not listed';
  const cell = (real, est, rent) => real
    ? `<b>${formatINR(real.median)}${rent ? '/mo' : ''}</b><div class="fine">${real.n > 1 ? `${formatINR(real.min)} to ${formatINR(real.max)} · ` : ''}${real.n} listing${real.n > 1 ? 's' : ''}</div>`
    : est ? `<b class="est" title="${esc(est.basis)}">~${formatINR(est.value)}${rent ? '/mo' : ''}</b><div class="fine">our estimate: ${esc(est.basis)}</div>` : '<span class="fine">no data</span>';
  const priceRows = Object.entries(s.prices || {}).filter(([b]) => !crit.bhk.length || crit.bhk.includes(+b)).map(([b, p]) =>
    `<tr><td>${b} BHK${p.psf ? `<div class="fine">₹${p.psf.toLocaleString()}/sq ft</div>` : ''}</td><td>${cell(p.buy, p.buy_est)}</td><td>${cell(p.rent, p.rent_est, true)}</td></tr>`).join('');
  const d = details?.[s.id];
  const stars = s.rating ? `<span class="stars">★ ${s.rating.toFixed(1)}</span> <span class="fine">${s.rating_count || 0} resident ratings · ${s.review_count || 0} reviews on Magicbricks</span>` : '<span class="fine">No resident ratings yet</span>';
  const counts = (s.sale_count || s.rent_count) ? `${(s.sale_count || 0).toLocaleString()} for sale · ${(s.rent_count || 0).toLocaleString()} for rent right now` : '';
  const ratingBars = d && Object.keys(d.ratings || {}).length ? `<div class="bars">${Object.entries(d.ratings).map(([k, v]) => `<div><span>${esc(k)}</span><i style="--w:${(v / 5) * 100}%"></i><b>${v}</b></div>`).join('')}</div>` : '';
  const reviews = d?.reviews?.length ? `<div class="reviews">${d.reviews.slice(0, 3).map((r) => `<blockquote>${esc(r.text)}<cite>${esc(r.by || 'Resident')}${r.date ? ' · ' + esc(r.date) : ''}</cite></blockquote>`).join('')}</div>` : '';
  const trend = d?.trend?.length > 1 ? sparkline(d.trend) : '';
  const about = d?.description ? `<details><summary>About this project</summary><p class="fine">${esc(d.description)}</p></details>` : '';
  const gdir = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
  $('card').innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div><span class="badge ${st}">${label}</span> ${s.verified ? '<span class="badge match">verified rows</span>' : ''}</div>
    <h2>${esc(s.name)}</h2>
    <div class="meta">${esc(s.developer || '')}${s.locality ? ' · ' + esc(s.locality) : ''} · ${esc(s.config_text || s.kind)}${s.kind_inferred ? ' <span class="fine">(type inferred from name)</span>' : ''}</div>
    <div class="meta">${esc(facts2)} · ${esc(price)}</div>
    <div class="meta">${stars}${counts ? ' · ' + counts : ''}</div>
    ${s.note ? `<div class="fine">${esc(s.note)}</div>` : ''}
    ${priceRows ? `<table class="prices"><tr><th>Home</th><th>Buy</th><th>Rent</th></tr>${priceRows}</table>` : ''}
    ${trend}
    ${rows ? `<table><tr><th>Unit</th><th>Bedrooms</th><th></th><th>Source</th></tr>${rows}</table>` : '<div class="fine">No unit types listed.</div>'}
    ${facts || amen ? `<div class="amen">${facts}${amen}</div>` : ''}
    ${ratingBars}${reviews}${about}
    <div class="links">
      <a href="${esc(s.gmaps)}" target="_blank" rel="noopener">Google Maps and reviews</a>
      <a href="${esc(gdir)}" target="_blank" rel="noopener">Directions</a>
      <a href="${esc(s.url)}" target="_blank" rel="noopener">Magicbricks page</a>
      ${s.brochure_url ? `<a href="${esc(s.brochure_url)}" target="_blank" rel="noopener">Brochure</a>` : ''}
      ${plans}
      ${!s.verified ? `<a href="${esc(issue)}" target="_blank" rel="noopener">Research this society →</a>` : ''}
    </div>
    <div class="fine">${s.rera_id ? 'RERA ' + esc(s.rera_id) + ' · ' : ''}${s.shape === 'osm' ? 'Buildings from OpenStreetMap' : s.shape === 'osm-site' ? 'Boundary from OpenStreetMap, towers drawn approximately' : 'Approximate shape: towers drawn from the listed tower count'}</div>`;
  $('card').hidden = false;
  $('card').querySelector('.close').onclick = closeCard;
  if (!details) loadDetails().then(() => { if (selected === s.id) renderCard(s); });
}

let detailsPromise = null;
function loadDetails() {
  detailsPromise ||= fetch(`/data/${cityId}-details.json`).then((r) => r.json()).then((d) => (details = d)).catch(() => (details = {}));
  return detailsPromise;
}

function sparkline(trend) {
  const vals = trend.map((t) => t[1]), lo = Math.min(...vals), hi = Math.max(...vals), w = 220, h = 40;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8)}`).join(' ');
  const ch = ((vals.at(-1) - vals[0]) / vals[0]) * 100;
  return `<div class="trend"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>
    <span class="fine">Average price per sq ft ${trend[0][0]} to ${trend.at(-1)[0]}: ₹${vals[0].toLocaleString()} to ₹${vals.at(-1).toLocaleString()} (${ch >= 0 ? '+' : ''}${ch.toFixed(0)}%)</span></div>`;
}

// ---------- CSV export of the current results ----------
function exportResults() {
  const cols = ['name', 'locality', 'verdict', 'type', 'price_or_rent', 'estimated', 'for_sale', 'for_rent', 'rating', 'towers', 'units', 'magicbricks_url', 'google_maps_url', 'flat_finder_url'];
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = ranked().map((s) => {
    const p = priceFor(s, crit.mode, crit.bhk);
    return [s.name, s.locality, states.get(s.id), s.kind, p?.value, p ? p.estimated : '', s.sale_count, s.rent_count, s.rating, s.towers, s.units, s.url, s.gmaps,
      `${location.origin}/?city=${cityId}&open=${s.id}`];
  });
  const blob = new Blob([[cols, ...rows].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `flat-finder-${cityId}-${crit.mode}-results.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- map buttons (Google Maps style) ----------
let is3d = true;
function setBase(mode) {
  baseMode = mode;
  document.body.dataset.base = mode;
  if (map?.getLayer?.('st-bg')) setBaseMode(map, mode);
  document.querySelectorAll('#layers button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const q = new URLSearchParams(location.search);
  mode === 'night' ? q.delete('map') : q.set('map', mode);
  history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
}

function buildControls() {
  document.body.dataset.base = baseMode;
  $('ctl-in').onclick = () => map?.zoomIn();
  $('ctl-out').onclick = () => map?.zoomOut();
  $('ctl-tilt').onclick = () => {
    is3d = !is3d;
    $('ctl-tilt').textContent = is3d ? '2D' : '3D';
    map?.easeTo({ pitch: is3d ? 50 : 0, bearing: 0, duration: 800 });
  };
  $('ctl-home').onclick = () => { closeCard(); map?.flyTo({ ...OVERVIEW, pitch: is3d ? OVERVIEW.pitch : 0, duration: 2000 }); };
  $('ctl-locate').onclick = () => {
    if (!navigator.geolocation) return;
    $('ctl-locate').classList.add('busy');
    navigator.geolocation.getCurrentPosition((p) => {
      $('ctl-locate').classList.remove('busy');
      const at = [p.coords.longitude, p.coords.latitude];
      if (!youMarker) { const el = document.createElement('div'); el.className = 'you'; youMarker = new maplibregl.Marker({ element: el }); }
      youMarker.setLngLat(at).addTo(map);
      map.flyTo({ center: at, zoom: 15, bearing: 0, duration: 2000 });
    }, () => $('ctl-locate').classList.remove('busy'), { enableHighAccuracy: true, timeout: 10000 });
  };
  $('layers-btn').onclick = () => $('layers').classList.toggle('open');
  document.querySelectorAll('#layers button[data-mode]').forEach((b) => (b.onclick = () => { setBase(b.dataset.mode); $('layers').classList.remove('open'); }));
  setBase(baseMode);
}
let youMarker = null;

// ---------- society search ----------
function buildSearch() {
  const input = $('q'), list = $('q-results');
  let items = [], active = -1;
  const close = () => { list.hidden = true; active = -1; };
  const render = () => {
    items = searchSocieties(data.societies, input.value);
    if (!items.length) {
      list.innerHTML = input.value.trim() ? '<li class="empty">No society by that name</li>' : '';
      list.hidden = !input.value.trim();
      return;
    }
    list.replaceChildren(...items.map((s, i) => {
      const li = document.createElement('li');
      const st = states.get(s.id);
      li.className = i === active ? 'on' : '';
      li.innerHTML = `<span>${esc(s.name)}</span><span class="tag ${st}">${esc(s.locality || '')}${s.verified ? ' · verified' : ''}</span>`;
      li.onmousedown = (e) => { e.preventDefault(); pick(s); };
      return li;
    }));
    list.hidden = false;
  };
  const pick = (s) => { input.value = s.name; close(); input.blur(); openSociety(s.id); };
  input.oninput = () => { active = -1; render(); };
  input.onfocus = render;
  input.onblur = close;
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === 'Enter' && items.length) pick(items[Math.max(0, active)]);
    else if (e.key === 'Escape') { close(); input.blur(); }
  };
  addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); input.focus(); }
  });
}

// ---------- tour ----------
function tour() {
  clearTimeout(tourTimer);
  const list = ranked().slice(0, 10);
  if (!list.length) return;
  let i = 0;
  const next = () => {
    if (i >= list.length) { closeCard(); map.flyTo({ ...OVERVIEW, pitch: is3d ? OVERVIEW.pitch : 0, duration: 4000 }); return; }
    openSociety(list[i++].id);
    tourTimer = setTimeout(next, 7000);
  };
  next();
}

boot().catch((e) => { console.error(e); document.title = "ERR " + e.message; });
