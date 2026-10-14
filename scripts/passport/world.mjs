/* Builds assets/passport-world.json: Natural Earth 1:50m countries (world-atlas),
   simplified, pre-projected to Equal Earth at 1000px wide, one SVG path per ISO
   code, plus a 30° graticule and the sphere outline. Antarctica dropped.
   Run from a scratch dir: npm i world-atlas@2 d3-geo@3 topojson-client@3
   topojson-simplify@3 i18n-iso-countries@7 countries-list@3, then
   node world.mjs 50m 0.08 <repo>/assets/passport-world.json */
import fs from 'fs';
import { geoEqualEarth, geoPath, geoGraticule } from 'd3-geo';
import * as topo from 'topojson-client';
import * as simp from 'topojson-simplify';
import iso from 'i18n-iso-countries';
import { countries } from 'countries-list';
const res = process.argv[2] || '50m';
let t = JSON.parse(fs.readFileSync(`node_modules/world-atlas/countries-${res}.json`));
t = simp.presimplify(t); t = simp.simplify(t, +process.argv[3] || 0.02);
const fc = topo.feature(t, t.objects.countries);
const W = 1000, feats = fc.features.filter(f => f.id !== '010');
const proj = geoEqualEarth().fitWidth(W, { type: 'FeatureCollection', features: feats });
const path = geoPath(proj); const [[,y0],[,y1]] = path.bounds({ type: 'FeatureCollection', features: feats });
proj.translate([proj.translate()[0], proj.translate()[1] - y0 + 4]);
const H = Math.ceil(y1 - y0 + 8);
const CONT = { AF: 'Africa', AS: 'Asia', EU: 'Europe', NA: 'North America', SA: 'South America', OC: 'Oceania', AN: 'Antarctica' };
const r1 = s => s.replace(/(\d+\.\d)\d+/g, '$1');
const out = {}; let miss = [];
for (const f of feats) {
  let cc = iso.numericToAlpha2(f.id);
  if (!cc) { const n = f.properties.name; cc = n === 'Kosovo' ? 'XK' : n === 'N. Cyprus' ? null : n === 'Somaliland' ? null : null; if (!cc) { miss.push(f.properties.name); continue; } }
  const d = path(f); if (!d) continue;
  const dd = d.replace(/(\d+\.\d)\d+/g, '$1');
  const c = path.centroid(f), a = path.area(f);
  const info = countries[cc] || {};
  if (out[cc]) { out[cc].d += dd; continue; }
  out[cc] = { n: info.name || iso.getName(cc, 'en') || f.properties.name, ct: CONT[info.continent] || '', d: dd, c: [Math.round(c[0]*10)/10, Math.round(c[1]*10)/10], a: Math.round(a) };
}
// countries with no shape at this resolution still need a name + continent + a point
const extra = {};
for (const cc of Object.keys(countries)) if (!out[cc] && cc !== 'AQ') {
  extra[cc] = { n: countries[cc].name, ct: CONT[countries[cc].continent] || '' };
}
const g = r1(path(geoGraticule().step([30, 30])())), o = r1(path({ type: 'Sphere' }));
fs.writeFileSync(process.argv[4] || 'world.json', JSON.stringify({ w: W, h: H, g, o, shapes: out, extra }));
console.log('H', H, 'shapes', Object.keys(out).length, 'extra', Object.keys(extra).length, 'bytes', fs.statSync(process.argv[4] || 'world.json').size, 'miss', miss.join(','));
