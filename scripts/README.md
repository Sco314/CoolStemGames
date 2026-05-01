# Bake scripts

One-shot dev scripts that produce input artifacts for the moonlander runtime.
Not part of the deployed site; never imported at runtime.

## bake-terrain.mjs

Bakes 65×65 height grids covering 1600 m of real Moon per Apollo landing
site, sampled from NASA's CGI Moon Kit LDEM (5760×2880 px, 16-bit, 16 ppd
equirectangular). Outputs single-line JSON to
`moonlander/assets/baked_terrain/<site-id>.json`.

### Run

```
cd scripts
npm install
node bake-terrain.mjs
```

The first run downloads `ldem_16_uint.tif` (~32 MB) from this repo's
Releases page and caches it next to the script. Re-runs reuse the cache.

### Flags

- `--force-download` — re-download the TIFF even if cached.

### Auth

The release asset lives in this (private) repo. Export a fine-grained GitHub
token with `Contents: Read` on this repo before running:

```
export GITHUB_TOKEN=github_pat_xxx
node bake-terrain.mjs
```

Or one-shot: `GITHUB_TOKEN=github_pat_xxx node bake-terrain.mjs`.

Never commit a token — `.gitignore` does not protect against accidentally
hardcoding one in a file.

### Output schema

```
{
  "site": "apollo-11",
  "lat": 0.6741,
  "lon": 23.4733,
  "size": 65,
  "groundExtentM": 1600,
  "minM": <number>,
  "maxM": <number>,
  "heights": [size*size floats in 0..1, row-major,
              row 0 = north edge, col 0 = west edge]
}
```

Reconstruct meters at runtime: `m = minM + (maxM - minM) * heights[i]`.

### Sites

apollo-11, apollo-12, apollo-14, apollo-15, apollo-16, apollo-17.

## bake-moon-globe-textures.mjs

Bakes the whole-moon equirectangular textures consumed by the admin
"Lunar Stationary Orbit" view (`moonlander/js/modes/OrbitMode.js`).
Reuses the same LDEM and LROC GitHub-Releases assets as bake-terrain.

### Outputs

```
moonlander/textures/moon/moon_color_2k.jpg     2048×1024 LROC color (~600-900 KB)
moonlander/textures/moon/moon_normal_1k.png    1024×512  LDEM-derived normals (~1-2 MB)
```

### Run

```
cd scripts
npm install
node bake-moon-globe-textures.mjs            # both textures (default)
node bake-moon-globe-textures.mjs --color    # color only
node bake-moon-globe-textures.mjs --normal   # normals only
```

First run downloads `lroc_color_16bit_srgb_4k.tif` (~60 MB) and
`ldem_16_uint.tif` (~32 MB) from this repo's Releases page and caches
them next to the script. Re-runs reuse the cache.

### Phase B note

When stepping up to higher zoom levels, generate 4k color + 2k normal
variants (rename to `moon_color_4k.jpg` / `moon_normal_2k.png`) and add
LOD selection in OrbitMode based on `gl.getParameter(gl.MAX_TEXTURE_SIZE)`
and the live zoom level. The bake math here is resolution-independent —
just bump the four `*_OUT_*` constants.
