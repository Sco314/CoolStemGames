# Asset pipeline — STL → Draco GLB

The Apollo landing-site terrains ship from NASA-3D-Resources as `.stl`
files, which are uncompressed binary triangle data — typically 6-7 MB
each. We re-encode them once as Draco-compressed `.glb` for a 5-10×
shrink before committing.

## Why

A raw STL has no quantization and no entropy coding; every vertex is
three IEEE-754 floats and every face is a 50-byte block. Draco mesh
compression in glTF 2.0 quantizes positions/normals/UVs and applies
edge-breaker entropy coding. For lunar-terrain meshes the result is
typically 700 KB - 1.5 MB instead of 6-7 MB, with no perceptible quality
loss at our terrain scale.

The runtime loader (`js/ModelCache.js:loadTerrainGeometry`) tries the
`.glb` first and falls back to the `.stl` automatically, so missing GLBs
degrade gracefully — the legacy STLs stay as a safety net until every
site has been re-encoded.

## How (one-off, no repo build step)

Use **Blender 4.x** (free, https://blender.org). The whole pass takes
~30 seconds per file.

For each `Apollo NN - Landing Site.stl` in
`moonlander/assets/nasa_models/`:

1. Open Blender. Delete the default cube.
2. **File → Import → Stl (.stl)** — pick the `.stl`.
3. **File → Export → glTF 2.0 (.glb/.gltf)**.
4. In the export panel, set:
   - **Format**: glTF Binary (`.glb`)
   - Expand **Data → Mesh** and **enable Compression** (Draco mesh
     compression). The defaults (Compression Level 6, Position Quant
     14, Normal Quant 10) are fine — they're imperceptible at our
     terrain scale.
5. Save as `Apollo NN - Landing Site.glb` next to the `.stl` in
   `moonlander/assets/nasa_models/`.
6. Sanity-check the file size: expect **500 KB - 2 MB**. If it came out
   bigger than 2 MB, re-export with Draco actually toggled on (it's
   easy to miss the checkbox).

Do **not** delete the `.stl` files. Leave them committed as the
fallback path while the GLBs are rolled out and validated. They can be
removed in a follow-up commit once the GLB path has been live for a
sprint with no fallback log entries.

## Loader behavior

`js/ModelCache.js:loadTerrainGeometry(url)`:

- If `url` ends in `.stl`, delegates to `loadSTL(url)` (uses STLLoader).
- If `url` ends in `.glb`, uses GLTFLoader, walks the scene for the
  first `Mesh`, returns its `BufferGeometry`. The GLB's auto-generated
  material is discarded — `WalkMode.buildGround()` applies its own
  `MeshLambertMaterial`.

`js/modes/WalkMode.js:buildGround()` tries paths in this order:

1. `apolloSiteGlbPath(level)` — per-level Draco GLB
2. `apolloSiteStlPath(level)` — per-level legacy STL
3. `apollo11Glb` — bundled Apollo 11 GLB
4. `apollo11Stl` — bundled Apollo 11 STL (current ground truth)

If all four reject (LOW_END device, 404, parse error), the procedural
sin-displaced plane stays as the only visual ground. Collision and
placement always use the procedural heightmap, never the STL/GLB —
asset failures cannot break the simulation.

## Why no Node build pipeline?

The repo runs as static files served straight from `python -m
http.server`. A `package.json` + `node_modules` for asset prep would
add a hundred MB of dev dependencies just to compress three files
once. Blender is a one-shot tool that produces a deterministic,
checked-in artifact. If we ever need to batch re-encode dozens of
assets, revisit then.
