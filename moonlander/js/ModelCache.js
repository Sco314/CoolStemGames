// ModelCache.js — v0.1.0
// Session-lifetime cache for GLB / GLTF and STL geometry. Keeps a single
// loaded prototype per URL and returns clones to callers, so re-entering
// walk mode (or placing N tiles of the same terrain STL) doesn't re-decode
// the file. Mirrors AssetCache's "cache owns the asset, never disposed"
// invariant so mode-exit disposal lists don't accidentally delete a cached
// scene's geometry.
//
// Failure modes are explicitly graceful:
//   - On Device.LOW_END the load is skipped entirely (rejects with
//     'low-end'), so the caller's fallback path runs immediately.
//   - On 404 / parse error the load also rejects; callers `.catch()` and
//     fall back to procedural primitives. No console spam beyond a single
//     warn per URL.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader }  from 'three/addons/loaders/STLLoader.js';
import { LOW_END } from './Device.js';

const _modelCache = new Map();   // url → Promise<THREE.Object3D> (prototype)
const _stlCache   = new Map();   // url → Promise<THREE.BufferGeometry>

let _gltfLoader = null;
let _stlLoader = null;

function gltf() { return _gltfLoader || (_gltfLoader = new GLTFLoader()); }
function stl()  { return _stlLoader  || (_stlLoader  = new STLLoader()); }

/**
 * Async-load a GLB/GLTF from `url`. Returns a fresh clone each call so the
 * caller can position/scale it independently. Console-warn (once) on
 * failure; skip outright on low-end devices.
 */
export function loadModel(url) {
  if (LOW_END) return Promise.reject(new Error('low-end'));

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

/**
 * Async-load an STL into a BufferGeometry. STL files have no materials —
 * the caller pairs the geometry with a Material of its choice. Returns
 * the same shared geometry each call (callers must not mutate vertices).
 */
export function loadSTL(url) {
  if (LOW_END) return Promise.reject(new Error('low-end'));

  let geomPromise = _stlCache.get(url);
  if (!geomPromise) {
    geomPromise = new Promise((resolve, reject) => {
      stl().load(
        url,
        (geom) => {
          geom.computeVertexNormals();
          const triCount = geom.attributes.position?.count / 3 | 0;
          console.log(`[ModelCache] loaded ${url} (${triCount} tris)`);
          resolve(geom);
        },
        undefined,
        (err) => {
          console.warn(`[ModelCache] failed to load ${url}:`, err.message || err);
          reject(err);
        }
      );
    });
    _stlCache.set(url, geomPromise);
  }
  return geomPromise;
}

/**
 * Helper: position and scale `obj` so its bounding-box bottom sits at world
 * y = `bottomY` and its tallest dimension is `targetHeight`. Centers x/z on
 * the supplied (cx, cz). Returns the chosen uniform scale so callers can
 * tune. Used by every model placement to avoid floating / buried meshes.
 */
export function placeOnGround(obj, cx, cz, bottomY, targetHeight) {
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
  return scale;
}
