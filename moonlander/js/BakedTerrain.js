// BakedTerrain.js — v0.1.0
// Async fetcher + pure bilinear sampler for the per-Apollo-site heightmaps
// produced by `scripts/bake-terrain.mjs`. Each bake is a 65×65 grid of
// normalized heights covering 1600 m of real Moon centered on the site's
// LM coordinates; min/max meters are stored alongside so the sampler can
// reconstruct absolute height in metres, then convert to world units.
//
// World ↔ bake coordinate convention:
//   - Bake is centered on world (x, z) = (0, 0). The play area is anchored
//     at the Apollo LM, which sits at the origin.
//   - Bake row 0 is the NORTH edge; row (size-1) is the SOUTH edge. We map
//     +z to +row, so world z = -halfExtentWU corresponds to row 0.
//   - Bake col 0 is the WEST edge; col (size-1) is the EAST edge. We map
//     +x to +col, so world x = -halfExtentWU corresponds to col 0.
//
// The runtime keeps the procedural sin-sum plane as a fallback for any
// (x, z) outside the bake's footprint; `sampleHeight` returns null in that
// case so the caller can route through `proceduralGround`.

import { apolloSiteForLevel } from './Constants.js';

// One world unit = 0.628 m. Inverse of Constants.METERS_TO_WU (= 3.2/2.008).
const METERS_PER_WU = 2.008 / 3.2;

/**
 * Load the baked-terrain JSON for the current Apollo site. Resolves to the
 * parsed bake object on success, or `null` on 404 / network error / parse
 * error. Caller falls through to procedural in the null case.
 */
export async function loadBakeForLevel(level) {
  const site = apolloSiteForLevel(level);
  if (!site) return null;
  const url = `assets/baked_terrain/${site.id}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[BakedTerrain] ${url} → HTTP ${res.status}`);
      return null;
    }
    const bake = await res.json();
    if (!bake || typeof bake.size !== 'number' || !Array.isArray(bake.heights)) {
      console.warn(`[BakedTerrain] ${url} parsed but schema invalid`);
      return null;
    }
    return bake;
  } catch (err) {
    console.warn(`[BakedTerrain] ${url} fetch failed:`, err?.message || err);
    return null;
  }
}

/**
 * Return the world-unit half-extent the supplied bake covers, plus the
 * meters-per-WU constant the sampler uses. Callers use the half-extent to
 * decide where to fall back to procedural (any |x| or |z| past it).
 */
export function bakeFootprintWU(bake) {
  const halfExtentWU = (bake.groundExtentM / METERS_PER_WU) / 2;
  return { halfExtentWU, metersPerWU: METERS_PER_WU };
}

/**
 * Bilinearly sample the bake at world (x, z). Returns the ground height in
 * world units, or `null` if the bake is missing OR (x, z) lies outside the
 * bake's footprint. Pure function; no side effects, no async.
 */
export function sampleHeight(bake, x, z) {
  if (!bake) return null;
  const halfExtentWU = (bake.groundExtentM / METERS_PER_WU) / 2;
  if (x < -halfExtentWU || x > halfExtentWU || z < -halfExtentWU || z > halfExtentWU) {
    return null;
  }
  const size = bake.size;
  const u = ((x + halfExtentWU) / (2 * halfExtentWU)) * (size - 1);
  const v = ((z + halfExtentWU) / (2 * halfExtentWU)) * (size - 1);
  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const c1 = Math.min(c0 + 1, size - 1);
  const r1 = Math.min(r0 + 1, size - 1);
  const fu = u - c0;
  const fv = v - r0;
  const h = bake.heights;
  const n00 = h[r0 * size + c0];
  const n10 = h[r0 * size + c1];
  const n01 = h[r1 * size + c0];
  const n11 = h[r1 * size + c1];
  const top = n00 * (1 - fu) + n10 * fu;
  const bot = n01 * (1 - fu) + n11 * fu;
  const norm = top * (1 - fv) + bot * fv;
  const heightM = bake.minM + norm * (bake.maxM - bake.minM);
  return heightM / METERS_PER_WU;
}
