import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const COLORS = { match: '#ffd9a0', likely: '#c99a5c', unknown: '#55545c', no: '#1b1b1e' };
export const OVERVIEW = { center: [77.065, 28.425], zoom: 12.4, pitch: 52, bearing: -18 };

const stateColor = (fallback) => ['case',
  ['boolean', ['feature-state', 'sel'], false], '#ffffff',
  ['match', ['feature-state', 'st'], 'match', COLORS.match, 'likely', COLORS.likely, 'unknown', COLORS.unknown, 'no', COLORS.no, fallback]];

export function createMap(container, { mobile }) {
  const map = new maplibregl.Map({
    container,
    attributionControl: { compact: true },
    center: mobile ? OVERVIEW.center : [78.5, 22.5],
    zoom: mobile ? 11.6 : 2.2,
    pitch: mobile ? 45 : 0,
    bearing: mobile ? OVERVIEW.bearing : 0,
    maxPitch: 80,
    style: {
      version: 8,
      projection: { type: 'globe' },
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sky: { 'sky-color': '#07080b', 'horizon-color': '#1a1712', 'fog-color': '#07080b', 'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 0] },
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap contributors · OpenFreeMap' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#050506' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.3, 'raster-saturation': -0.75, 'raster-contrast': 0.15, 'raster-hue-rotate': 200 } },
        { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
          paint: { 'line-color': '#ffcf8a', 'line-opacity': 0.2, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 2.5], 'line-blur': 1 } },
        { id: 'city', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
          paint: { 'fill-extrusion-color': '#17171a', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 } },
      ],
    },
  });
  return map;
}

export function addSocietyLayers(map, shapes, points) {
  map.addSource('shapes', { type: 'geojson', data: shapes, promoteId: 'sid' });
  map.addSource('pts', { type: 'geojson', data: points, promoteId: 'sid' });
  map.addLayer({ id: 'site-fill', type: 'fill', source: 'shapes', filter: ['==', ['get', 'role'], 'site'],
    paint: { 'fill-color': stateColor(COLORS.match),
      'fill-opacity': ['match', ['feature-state', 'st'], 'match', 0.13, 'likely', 0.1, 'unknown', 0.05, 'no', 0, 0.08] } });
  map.addLayer({ id: 'site-line', type: 'line', source: 'shapes', filter: ['==', ['get', 'role'], 'site'],
    paint: { 'line-color': stateColor(COLORS.match), 'line-blur': 1.5,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 2],
      'line-opacity': ['match', ['feature-state', 'st'], 'match', 0.9, 'likely', 0.7, 'unknown', 0.5, 'no', 0.05, 0.5] } });
  map.addLayer({ id: 'glow', type: 'circle', source: 'pts', maxzoom: 15.5,
    paint: { 'circle-color': stateColor(COLORS.match), 'circle-blur': 1,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 12, 6, 15, 24],
      'circle-opacity': ['match', ['feature-state', 'st'], 'match', 0.5, 'likely', 0.35, 'unknown', 0.14, 'no', 0, 0.25] } });
  map.addLayer({ id: 'bld', type: 'fill-extrusion', source: 'shapes', minzoom: 11.5, filter: ['==', ['get', 'role'], 'bld'],
    paint: { 'fill-extrusion-color': stateColor(COLORS.match), 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95,
      'fill-extrusion-vertical-gradient': true } });
  map.addLayer({ id: 'labels', type: 'symbol', source: 'pts', minzoom: 13.2,
    filter: ['==', ['get', 'show'], 1],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, -2.2],
      'text-letter-spacing': 0.04, 'text-optional': true },
    paint: { 'text-color': '#f2f0ec', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4,
      'text-opacity': ['match', ['feature-state', 'st'], 'match', 1, 'likely', 0.85, 'unknown', 0.35, 'no', 0, 0.7] } });
}

// Pulse the glow of matches. Cheap: one paint property on ~2,700 circles.
export function startPulse(map) {
  setInterval(() => {
    if (!map.getLayer('glow')) return;
    const k = 1 + 0.35 * Math.sin(performance.now() / 420);
    map.setPaintProperty('glow', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 9, 2 * k, 12, 6 * k, 15, 24 * k]);
  }, 80);
}

export function setStates(map, entries) {
  for (const [sid, st] of entries) {
    map.setFeatureState({ source: 'shapes', id: sid }, { st });
    map.setFeatureState({ source: 'pts', id: sid }, { st });
  }
}

export function setSelected(map, sid, prev) {
  if (prev) for (const src of ['shapes', 'pts']) map.setFeatureState({ source: src, id: prev }, { sel: false });
  if (sid) for (const src of ['shapes', 'pts']) map.setFeatureState({ source: src, id: sid }, { sel: true });
}

// ---------- Streets view: a dark street map with road and area names, from OpenFreeMap vector tiles ----------
const ROAD_W = (major, minor) => ['interpolate', ['exponential', 1.5], ['zoom'], 10, ['match', ['get', 'class'], ['motorway', 'trunk'], major * 0.4, ['primary', 'secondary'], minor * 0.5, 0.3],
  17, ['match', ['get', 'class'], ['motorway', 'trunk'], major * 5, ['primary', 'secondary'], minor * 5, ['tertiary', 'minor'], 8, 4]];
const STREET_LAYERS = [
  { id: 'st-bg', type: 'background', paint: { 'background-color': '#202124' } },
  { id: 'st-green', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland']]], paint: { 'fill-color': '#1f2a22', 'fill-opacity': 0.8 } },
  { id: 'st-park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#22311f', 'fill-opacity': 0.9 } },
  { id: 'st-water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#15233a' } },
  { id: 'st-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0f0f11', 'line-width': ROAD_W(5.5, 4.5), 'line-gap-width': 0 } },
  { id: 'st-road', type: 'line', source: 'omt', 'source-layer': 'transportation',
    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#a08a66', ['primary', 'secondary'], '#646a75', ['tertiary'], '#4d5159', '#3d4047'], 'line-width': ROAD_W(4.5, 3.5) } },
  { id: 'st-rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'],
    paint: { 'line-color': '#5b5b66', 'line-width': 1.2, 'line-dasharray': [3, 2] } },
];
// Names: shown in both views so people can tell which road is which.
const LABEL_LAYERS = [
  { id: 'lbl-road', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 12.5,
    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10, 17, 13], 'text-letter-spacing': 0.04, 'text-max-angle': 30 },
    paint: { 'text-color': '#e4dfd5', 'text-halo-color': 'rgba(0,0,0,.9)', 'text-halo-width': 1.5 } },
  { id: 'lbl-place', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10,
    filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter', 'village', 'town', 'city']]],
    layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'],
      'text-size': ['match', ['get', 'class'], ['city', 'town'], 15, 11.5], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12 },
    paint: { 'text-color': '#9d988e', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.2 } },
  { id: 'lbl-metro', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 12.5,
    filter: ['in', ['get', 'class'], ['literal', ['railway']]],
    layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0.8] },
    paint: { 'text-color': '#8fb4ff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.2 } },
];

export function addBaseLayers(map) {
  for (const l of STREET_LAYERS) map.addLayer({ ...l, layout: { ...(l.layout || {}), visibility: 'none' } }, 'city');
  for (const l of LABEL_LAYERS) map.addLayer(l); // above everything, including societies
}

export function setBaseMode(map, mode) {
  const streets = mode === 'streets';
  for (const l of STREET_LAYERS) map.setLayoutProperty(l.id, 'visibility', streets ? 'visible' : 'none');
  map.setLayoutProperty('sat', 'visibility', streets ? 'none' : 'visible');
  map.setLayoutProperty('roads', 'visibility', streets ? 'none' : 'visible');
  map.setPaintProperty('city', 'fill-extrusion-color', streets ? '#2a2b30' : '#17171a');
  map.setLayoutProperty('lbl-metro', 'visibility', streets ? 'visible' : 'none');
}
