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
