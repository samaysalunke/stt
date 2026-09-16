/**
 * Regenerates `src/lib/indiaMapGeometry.ts` — the India outline, its interior
 * state borders and the projection constants used by `MapIndia.astro`.
 *
 *   node scripts/generate-india-map.mjs
 *
 * Run it only when the geometry needs to change. The generated file is committed
 * so a build never depends on the network, and the runtime component never
 * parses GeoJSON.
 *
 * ── Source data ────────────────────────────────────────────────────────────
 * Natural Earth 10m (public domain), via nvkelso/natural-earth-vector.
 *
 * The landmass comes from `ne_10m_admin_0_countries_ind` — the INDIA
 * point-of-view edition. This matters and is not interchangeable with the
 * default file: Natural Earth's default `ne_10m_admin_0_countries` draws
 * de-facto control, which cuts Aksai Chin and Pakistan-administered Kashmir out
 * of India and stops the northern border near 34N. Publishing that outline from
 * an India-facing site is both wrong and, under Indian law, a liability. The
 * POV edition reaches 37.05N and carries the full claimed boundary.
 *
 * State borders come from `ne_10m_admin_1_states_provinces`, which has NO India
 * POV edition — its Indian states reach only 35.50N, short of the claimed
 * extent. So the borders are used for INTERIOR HAIRLINES ONLY and are clipped
 * to the POV landmass at render time. The strip the state data omits simply
 * carries no internal line; nothing is subtracted from the country. Never fill
 * from this layer.
 *
 * ── Projection ─────────────────────────────────────────────────────────────
 * Spherical Mercator, the projection every web map uses, so the shape reads as
 * familiar rather than subtly wrong. Conformal: one scale factor `K` drives
 * both axes, so the outline is never stretched. `MapIndia.astro` re-implements
 * `project()` against the constants exported below — the two must agree, which
 * is why the constants are generated rather than written by hand.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAW = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const SOURCES = {
  land: 'ne_10m_admin_0_countries_ind',
  states: 'ne_10m_admin_1_states_provinces',
};

// Output canvas. Height follows from the projected aspect ratio.
const WIDTH = 520;
const PAD = 6;

// Douglas-Peucker tolerances, in output pixels. The coastline keeps more detail
// than the interior borders because it is the silhouette the eye actually reads.
const TOL_COAST = 0.5;
const TOL_STATE = 0.55;

// An island smaller than this (projected px^2) is a speck at render size and
// renders as noise rather than land. Tuned to keep the Andaman & Nicobar chain
// and the larger Lakshadweep atolls.
const MIN_ISLAND_AREA = 0.6;

const cacheDir = join(tmpdir(), 'stt-india-map-src');

async function load(name) {
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, `${name}.geojson`);
  if (!existsSync(path)) {
    process.stdout.write(`  downloading ${name}…\n`);
    const res = await fetch(`${RAW}/${name}.geojson`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

const mercY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));

const rings = (geometry) => {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.flat();
};

/** Perpendicular-distance simplification over an already-projected ring. */
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = -1;
    let index = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;

    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let dist;
      if (len2 === 0) {
        dist = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        dist = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (dist > maxDist) { maxDist = dist; index = i; }
    }

    if (maxDist > tol2 && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const area = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(sum / 2);
};

const round = (n) => Math.round(n * 10) / 10;
const toPath = (ring) => `M${ring.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;

console.log('Generating India map geometry…');
const [landGeo, stateGeo] = await Promise.all([load(SOURCES.land), load(SOURCES.states)]);

const india = landGeo.features.find((f) => f.properties.ADM0_A3 === 'IND');
if (!india) throw new Error('India not found in the point-of-view country file');

const landRings = rings(india.geometry);

// ── Fit the projection to the claimed extent ────────────────────────────────
let minLng = Infinity, maxLng = -Infinity, minMy = Infinity, maxMy = -Infinity;
for (const ring of landRings) {
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    const my = mercY(lat);
    if (my < minMy) minMy = my;
    if (my > maxMy) maxMy = my;
  }
}
const K = (WIDTH - PAD * 2) / (maxLng - minLng);
const HEIGHT = Math.ceil((maxMy - minMy) * K + PAD * 2);
const project = ([lng, lat]) => [PAD + (lng - minLng) * K, PAD + (maxMy - mercY(lat)) * K];

// ── Landmass ────────────────────────────────────────────────────────────────
const projected = landRings
  .map((ring) => simplify(ring.map(project), TOL_COAST))
  .filter((ring) => ring.length > 3);
projected.sort((a, b) => area(b) - area(a));

const mainland = projected[0];
const islands = projected.slice(1).filter((ring) => area(ring) >= MIN_ISLAND_AREA);
console.log(`  landmass: mainland ${mainland.length} pts, ${islands.length} islands kept ` +
            `(${projected.length - 1 - islands.length} specks dropped)`);

// ── Interior state borders ──────────────────────────────────────────────────
// Every state ring, simplified. Shared borders are drawn twice (once from each
// neighbour) and the coastal stretches duplicate the outline, but at hairline
// weight under a clip path that is invisible — and it avoids building a full
// topology just to dedupe segments.
const stateFeatures = stateGeo.features.filter((f) => f.properties.adm0_a3 === 'IND');
const stateRings = stateFeatures
  .flatMap((f) => rings(f.geometry))
  .map((ring) => simplify(ring.map(project), TOL_STATE))
  .filter((ring) => ring.length > 3 && area(ring) >= 4);
console.log(`  borders: ${stateFeatures.length} states/UTs, ${stateRings.length} rings`);

const out = `// GENERATED by scripts/generate-india-map.mjs — do not edit by hand.
// Source: Natural Earth 10m (public domain). The outline is the INDIA
// point-of-view edition, so Jammu & Kashmir, Ladakh and Aksai Chin are shown as
// Indian territory; see the generator's header before changing anything here.
//
// Spherical Mercator. \`project()\` below must stay in step with the generator.

/** Canvas the paths are drawn in. */
export const INDIA_VIEWBOX = { width: ${WIDTH}, height: ${HEIGHT} } as const;

/** Projection constants, emitted by the generator alongside the paths. */
const MIN_LNG = ${minLng};
const MAX_MERC_Y = ${maxMy};
const SCALE = ${K};
const PAD = ${PAD};

/** Longitude/latitude to a point in \`INDIA_VIEWBOX\`. */
export function project(lat: number, lng: number): { x: number; y: number } {
  const mercY = (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
  return {
    x: PAD + (lng - MIN_LNG) * SCALE,
    y: PAD + (MAX_MERC_Y - mercY) * SCALE,
  };
}

/** True while a point falls inside the drawn canvas, with a little slack. */
export function withinIndia(x: number, y: number): boolean {
  return x >= -2 && y >= -2 && x <= INDIA_VIEWBOX.width + 2 && y <= INDIA_VIEWBOX.height + 2;
}

/** Mainland silhouette — the claimed extent, filled. */
export const INDIA_MAINLAND = ${JSON.stringify(toPath(mainland))};

/** Offshore territory: the Andaman & Nicobar chain, Lakshadweep and the rest. */
export const INDIA_ISLANDS: string[] = ${JSON.stringify(islands.map(toPath), null, 2)};

/**
 * State and union-territory outlines, for interior hairlines ONLY. Clip this to
 * the landmass when rendering — this layer stops short of the claimed northern
 * extent and must never be used as a fill.
 */
export const INDIA_STATE_BORDERS = ${JSON.stringify(stateRings.map(toPath).join(''))};
`;

const dest = new URL('../src/lib/indiaMapGeometry.ts', import.meta.url);
await writeFile(dest, out);
console.log(`  wrote src/lib/indiaMapGeometry.ts (${(out.length / 1024).toFixed(1)} KB, viewBox ${WIDTH}x${HEIGHT})`);
