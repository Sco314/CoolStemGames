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
