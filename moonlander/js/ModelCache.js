// ModelCache.js — v0.1.0
// Session-lifetime cache for GLB / GLTF geometry. Keeps a single loaded
// prototype per URL and returns clones to callers, so re-entering walk
// mode doesn't re-decode the file. Mirrors AssetCache's "cache owns the
// asset, never disposed" invariant so mode-exit disposal lists don't
// accidentally delete a cached scene's geometry.
//
// Failure modes are explicitly graceful: on 404 / parse error the load
// rejects; callers `.catch()` and fall back to procedural primitives.
// No console spam beyond a single warn per URL.
//
// Note: asset loading is NOT gated by `Device.LOW_END`. Our NASA GLBs
// are 0.5-2.5 MB Draco-compressed each, a one-time cost that any
// Chromebook can absorb. `LOW_END` still drives per-frame perf
// adjustments (particle pool size, starfield/Earth skip), but
// download/decode is unconditional.
//
// Draco decode: every NASA GLB declares `KHR_draco_mesh_compression`
// in `extensionsRequired`, so GLTFLoader needs a DRACOLoader wired in
// or it hard-fails with "No DRACOLoader instance provided". The WASM
// decoder + JS wrapper are vendored at `assets/draco/` (~250 KB)
// rather than fetched from a CDN — no external runtime dep, works
// offline.

import * as THREE from 'three';
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const DRACO_DECODER_PATH = 'assets/draco/';

const _modelCache = new Map(); // url → Promise<THREE.Object3D> (prototype)

let _gltfLoader  = null;
let _dracoLoader = null;

function draco() {
  if (!_dracoLoader) {
    _dracoLoader = new DRACOLoader();
    _dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    // 'js' picks the JS-only fallback; we ship the WASM wrapper +
    // wasm binary, so leave the default decoder type (auto-prefers
    // WASM and falls back internally).
  }
  return _dracoLoader;
}

function gltf() {
  if (!_gltfLoader) {
    _gltfLoader = new GLTFLoader();
    _gltfLoader.setDRACOLoader(draco());
  }
  return _gltfLoader;
}

/**
 * Async-load a GLB/GLTF from `url`. Returns a fresh clone each call so the
 * caller can position/scale it independently. Console-warn (once) on
 * failure.
 */
export function loadModel(url) {
  let proto = _modelCache.get(url);
  if (!proto) {
    proto = new Promise((resolve, reject) => {
      gltf().load(
        url,
        (gltfResult) => {
          const root = gltfResult.scene || gltfResult.scenes?.[0];
          if (!root) { reject(new Error('GLTF has no scene')); return; }
          // Log once so we know the file is present + budget
          const sizeKb = (gltfResult.parser?.json?.buffers?.[0]?.byteLength | 0) / 1024;
          console.log(`[ModelCache] loaded ${url} (${sizeKb.toFixed(0)} KB)`);
          if (sizeKb > 5120) {
            console.warn(`[ModelCache] ${url} is ${sizeKb.toFixed(0)} KB — exceeds 5MB budget`);
          }
          resolve(root);
        },
        undefined,
        (err) => {
          console.warn(`[ModelCache] failed to load ${url}:`, err.message || err);
          reject(err);
        }
      );
    });
    _modelCache.set(url, proto);
  }
  return proto.then(root => root.clone(true));
}

// 1 m in world units, derived from the procedural-astronaut height anchor
// (3.2 wu = 2.008 m). Mirrors `Constants.METERS_TO_WU` — duplicated here
// so the bbox debug log doesn't pull a circular import on Constants.js.
const _METERS_TO_WU = 3.2 / 2.008;

/**
 * Helper: position and scale `obj` so its bounding-box bottom sits at world
 * y = `bottomY` and its tallest dimension is `targetHeight`. Centers x/z on
 * the supplied (cx, cz). Returns the chosen uniform scale so callers can
 * tune. Used by every model placement to avoid floating / buried meshes.
 *
 * Also logs the source GLB's bounding box in meters (pre-scale) so future
 * size-tuning rounds don't have to guess at the model's natural extents.
 * Pass `tag` to label the log line — typically the model identifier (e.g.
 * "habitat-a", "apolloLM"). Optional; falls through to the obj's name.
 */
export function placeOnGround(obj, cx, cz, bottomY, targetHeight, tag = null) {
  obj.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const tallest = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetHeight / tallest;
  obj.scale.setScalar(scale);
  // Recompute bbox after scaling
  obj.updateMatrixWorld(true);
  const bbox2 = new THREE.Box3().setFromObject(obj);
  const min = bbox2.min, max = bbox2.max;
  obj.position.set(
    cx - (min.x + max.x) / 2,
    bottomY - min.y,
    cz - (min.z + max.z) / 2
  );
  // Print pre-scale bbox in meters + the chosen scale so size constants
  // can be tuned to actual GLB extents. Example output:
  //   [placeOnGround] habitat-a: bbox 6.52 × 3.18 × 4.10 m (worst 6.52 m),
  //   target 7.50 m, scale 1.150
  const label = tag || obj.name || 'unnamed';
  console.log(
    `[placeOnGround] ${label}: bbox ` +
    `${(size.x / _METERS_TO_WU).toFixed(2)} × ` +
    `${(size.y / _METERS_TO_WU).toFixed(2)} × ` +
    `${(size.z / _METERS_TO_WU).toFixed(2)} m ` +
    `(worst ${(tallest / _METERS_TO_WU).toFixed(2)} m), ` +
    `target ${(targetHeight / _METERS_TO_WU).toFixed(2)} m, ` +
    `scale ${scale.toFixed(3)}`
  );
  return scale;
}
