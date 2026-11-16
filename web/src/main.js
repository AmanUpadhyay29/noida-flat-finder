import './style.css';
import { addSocietyLayers, createMap, OVERVIEW, setSelected, setStates, startPulse } from './map.js';
import { createFeed } from './feed.js';
import { AMENITY_KEYS, DEFAULT_CRITERIA, feetLabel, matchSociety, matchUnit, roomPasses } from './filters.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mobile = matchMedia('(max-width: 700px)').matches;
const REPO = 'https://github.com/kairothq/flat-finder';
const RANK = { match: 3, likely: 2, unknown: 1, no: 0 };

const KINDS = [['apartment', 'Apartments'], ['builder floor', 'Builder floors'], ['villa', 'Villas'], ['plot', 'Plots']];
const AMEN_LABELS = { squash: 'Squash', pool: 'Pool', gym: 'Gym', club: 'Clubhouse', tennis: 'Tennis', badminton: 'Badminton', jogging: 'Jogging track', kids: 'Kids play' };
const DIVY = { kinds: ['apartment'], bhk: [2, 3, 4], room: { a: 11.25, b: 12.25 }, minSqft: 1620, maxPrice: null, amenities: ['squash'], ready: false };

let crit = structuredClone(DEFAULT_CRITERIA);
let data, byId, map, feed, selected = null, states = new Map(), tourTimer = null;

const fmtPrice = (r) => (r >= 1e7 ? `₹${(r / 1e7).toFixed(r >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')} Cr` : `₹${Math.round(r / 1e5)} L`);

async function boot() {
  const [city, shapes] = await Promise.all([
    fetch('/data/gurgaon.json').then((r) => r.json()),
    fetch('/data/gurgaon-shapes.geojson').then((r) => r.json()),
  ]);
  data = city;
  byId = new Map(city.societies.map((s) => [s.id, s]));
  $('city-name').textContent = city.city.name;
  $('note').textContent = `${city.counts.on_map.toLocaleString()} societies from Magicbricks · ${city.counts.verified} verified from brochures and HRERA plans · buildings from OpenStreetMap, approximate where unmapped`;

  feed = createFeed($('feed'), $('log-mode'), { events: city.events, byId });
  buildFilters();
  try {
    map = createMap('map', { mobile });
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
    $('f-price').value = crit.maxPrice ? crit.maxPrice / 1e7 : 20;
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
  $('f-price').oninput = () => { const v = +$('f-price').value; crit.maxPrice = v >= 20 ? null : v * 1e7; labels(); applyFilters(); };
  $('f-ready').onchange = () => { crit.ready = $('f-ready').checked; applyFilters(); };
  $('preset-divy').onclick = () => { crit = structuredClone(DIVY); redraw(); applyFilters(); };
  $('btn-replay').onclick = intro;
  $('btn-tour').onclick = tour;
  $('btn-hide').onclick = () => document.body.classList.toggle('bare');

  function readRoom() {
    crit.room = $('f-room-on').checked ? { a: getFtIn('ra'), b: getFtIn('rb') } : null;
    $('f-room').classList.toggle('off', !crit.room);
    applyFilters();
  }
  function labels() {
    $('v-size').textContent = crit.minSqft ? `${crit.minSqft.toLocaleString()} sq ft · ${Math.round(crit.minSqft / 9)} gaj` : 'Any';
    $('v-price').textContent = crit.maxPrice ? `up to ${fmtPrice(crit.maxPrice)}` : 'Any';
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
    li.innerHTML = `<span>${esc(s.name)}</span><span class="tag ${st}">${s.verified ? 'verified · ' : ''}${esc(s.locality || '')}</span>`;
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
  if (fly && map) map.flyTo({ center: [s.lng, s.lat], zoom: mobile ? 15.4 : 16.2, pitch: 62, bearing: map.getBearing() - 25, duration: 2600, essential: true,
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
  const price = s.price_min ? `${fmtPrice(s.price_min)}${s.price_max && s.price_max !== s.price_min ? ' to ' + fmtPrice(s.price_max) : ''}` : 'price not listed';
  $('card').innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div><span class="badge ${st}">${label}</span> ${s.verified ? '<span class="badge match">verified rows</span>' : ''}</div>
    <h2>${esc(s.name)}</h2>
    <div class="meta">${esc(s.developer || '')}${s.locality ? ' · ' + esc(s.locality) : ''} · ${esc(s.config_text || s.kind)}</div>
    <div class="meta">${esc(facts2)} · ${esc(price)}</div>
    ${s.note ? `<div class="fine">${esc(s.note)}</div>` : ''}
    ${rows ? `<table><tr><th>Unit</th><th>Bedrooms</th><th></th><th>Source</th></tr>${rows}</table>` : '<div class="fine">No unit types listed.</div>'}
    ${facts || amen ? `<div class="amen">${facts}${amen}</div>` : ''}
    <div class="links">
      <a href="${esc(s.url)}" target="_blank" rel="noopener">Magicbricks page</a>
      ${s.brochure_url ? `<a href="${esc(s.brochure_url)}" target="_blank" rel="noopener">Brochure</a>` : ''}
      ${plans}
      ${!s.verified ? `<a href="${esc(issue)}" target="_blank" rel="noopener">Research this society →</a>` : ''}
    </div>
    <div class="fine">${s.rera_id ? 'RERA ' + esc(s.rera_id) + ' · ' : ''}${s.shape === 'osm' ? 'Buildings from OpenStreetMap' : s.shape === 'osm-site' ? 'Boundary from OpenStreetMap, towers drawn approximately' : 'Approximate shape: towers drawn from the listed tower count'}</div>`;
  $('card').hidden = false;
  $('card').querySelector('.close').onclick = closeCard;
}

// ---------- tour ----------
function tour() {
  clearTimeout(tourTimer);
  const list = ranked().slice(0, 10);
  if (!list.length) return;
  let i = 0;
  const next = () => {
    if (i >= list.length) { closeCard(); map.flyTo({ ...OVERVIEW, duration: 4000 }); return; }
    openSociety(list[i++].id);
    tourTimer = setTimeout(next, 7000);
  };
  next();
}

boot().catch((e) => { console.error(e); document.title = "ERR " + e.message; });
