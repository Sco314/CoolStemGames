import { valueKey } from './valueUtils.js';

/**
 * Orb run registry
 *
 * Layer 1: logical orb state map (keyed by valueUtils.valueKey)
 * Layer 2: render mesh pool with capped active meshes and reuse
 */

const DEFAULTS = {
  maxActiveMeshes: 160,
  maxPersistentRevealed: 320,
  maxPersistentRevealedLowEnd: 120,
  enablePersistentRevealHistory: true,
  maxNearbyFromCamera: 80,
  cameraRevealRadius: 5,
  startNeighborDepth: 1,
};

function cloneVec3(p) {
  if (!p) return { x: 0, y: 0, z: 0 };
  return { x: p.x || 0, y: p.y || 0, z: p.z || 0 };
}

function distSq(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return dx * dx + dy * dy + dz * dz;
}

function nowTs() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now();
  return Date.now();
}

function isLowEndDevice() {
  if (typeof navigator === 'undefined') return false;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  return mem <= 4 || cores <= 4;
}

export function createOrbRunRegistry(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const lowEnd = typeof options.lowEndDevice === 'boolean'
    ? options.lowEndDevice
    : isLowEndDevice();

  const persistentCap = lowEnd
    ? cfg.maxPersistentRevealedLowEnd
    : cfg.maxPersistentRevealed;

  // ── Layer 1: logical orb state ─────────────────────────
  const orbStates = new Map(); // key -> state
  const adjacency = new Map(); // key -> Set<key>
  const currentRunKeys = new Set();

  // LRU for persistent revealed history
  const persistentRevealLru = new Map(); // key -> timestamp

  // ── Layer 2: render registry / mesh pool ───────────────
  const activeMeshes = new Map(); // key -> { mesh, lastUsed }
  const activeMeshLru = new Map(); // key -> timestamp
  const meshPool = []; // reusable mesh instances

  function getState(v) {
    return orbStates.get(valueKey(v)) || null;
  }

  function ensureState({
    number,
    position,
    isRevealed = false,
    isInCurrentRun = false,
    isTerminalLoopOrb = false,
    isRepeatEncounter = false,
    baseColor = 0xffffff,
    currentColor = baseColor,
    scale = 1,
    activationCount = 0,
  }) {
    const key = valueKey(number);
    let state = orbStates.get(key);

    if (!state) {
      state = {
        key,
        number,
        position: cloneVec3(position),
        isRevealed,
        isInCurrentRun,
        isTerminalLoopOrb,
        isRepeatEncounter,
        baseColor,
        currentColor,
        scale,
        activationCount,
      };
      orbStates.set(key, state);
    } else {
      state.number = number;
      if (position) state.position = cloneVec3(position);
      state.isRevealed = isRevealed;
      state.isInCurrentRun = isInCurrentRun;
      state.isTerminalLoopOrb = isTerminalLoopOrb;
      state.isRepeatEncounter = isRepeatEncounter;
      state.baseColor = baseColor;
      state.currentColor = currentColor;
      state.scale = scale;
      state.activationCount = activationCount;
    }

    if (!adjacency.has(key)) adjacency.set(key, new Set());
    return state;
  }

  function upsertOrb(number, patch = {}) {
    const key = valueKey(number);
    const prev = getState(number);
    const next = ensureState({
      number,
      position: patch.position || prev?.position,
      isRevealed: patch.isRevealed ?? prev?.isRevealed ?? false,
      isInCurrentRun: patch.isInCurrentRun ?? prev?.isInCurrentRun ?? false,
      isTerminalLoopOrb: patch.isTerminalLoopOrb ?? prev?.isTerminalLoopOrb ?? false,
      isRepeatEncounter: patch.isRepeatEncounter ?? prev?.isRepeatEncounter ?? false,
      baseColor: patch.baseColor ?? prev?.baseColor ?? 0xffffff,
      currentColor: patch.currentColor ?? prev?.currentColor ?? patch.baseColor ?? prev?.baseColor ?? 0xffffff,
      scale: patch.scale ?? prev?.scale ?? 1,
      activationCount: patch.activationCount ?? prev?.activationCount ?? 0,
    });

    if (next.isInCurrentRun) currentRunKeys.add(key);
    return next;
  }

  function addNeighbor(a, b) {
    const aKey = valueKey(a);
    const bKey = valueKey(b);
    ensureState({ number: a });
    ensureState({ number: b });
    adjacency.get(aKey).add(bKey);
    adjacency.get(bKey).add(aKey);
  }

  function setCurrentRun(numbers = []) {
    for (const key of currentRunKeys) {
      const s = orbStates.get(key);
      if (s) s.isInCurrentRun = false;
    }
    currentRunKeys.clear();

    for (const n of numbers) {
      const s = upsertOrb(n, { isInCurrentRun: true });
      currentRunKeys.add(s.key);
      s.isRevealed = true; // always reveal current run nodes
      rememberPersistently(s.key);
    }
  }

  function rememberPersistently(key) {
    if (!cfg.enablePersistentRevealHistory) return;
    const now = nowTs();
    if (persistentRevealLru.has(key)) persistentRevealLru.delete(key);
    persistentRevealLru.set(key, now);

    while (persistentRevealLru.size > persistentCap) {
      const oldest = persistentRevealLru.keys().next().value;
      persistentRevealLru.delete(oldest);
    }
  }

  function revealNearbyCamera(cameraPosition, revealSet) {
    if (!cameraPosition) return;

    const within = [];
    const radiusSq = cfg.cameraRevealRadius * cfg.cameraRevealRadius;
    for (const state of orbStates.values()) {
      const d2 = distSq(state.position, cameraPosition);
      if (d2 <= radiusSq) within.push({ key: state.key, d2 });
    }
    within.sort((a, b) => a.d2 - b.d2);

    for (let i = 0; i < Math.min(cfg.maxNearbyFromCamera, within.length); i++) {
      revealSet.add(within[i].key);
    }
  }

  function revealNeighborsFromStart(startNumber, revealSet) {
    if (startNumber === undefined || startNumber === null) return;
    const startKey = valueKey(startNumber);
    if (!adjacency.has(startKey)) return;

    const q = [{ key: startKey, depth: 0 }];
    const seen = new Set([startKey]);

    while (q.length) {
      const cur = q.shift();
      revealSet.add(cur.key);
      if (cur.depth >= cfg.startNeighborDepth) continue;

      const nei = adjacency.get(cur.key);
      if (!nei) continue;
      for (const nk of nei) {
        if (seen.has(nk)) continue;
        seen.add(nk);
        q.push({ key: nk, depth: cur.depth + 1 });
      }
    }
  }

  function applyRevealPolicy({ cameraPosition = null, startNumber = null } = {}) {
    const revealSet = new Set();

    // 1) Always reveal current run nodes
    for (const key of currentRunKeys) revealSet.add(key);

    // 2) Reveal neighbors around camera/start orb
    revealNearbyCamera(cameraPosition, revealSet);
    revealNeighborsFromStart(startNumber, revealSet);

    // 3) Optional persistent reveal history (LRU + hard cap)
    if (cfg.enablePersistentRevealHistory) {
      for (const key of persistentRevealLru.keys()) revealSet.add(key);
    }

    for (const [key, state] of orbStates) {
      const isRevealed = revealSet.has(key);
      state.isRevealed = isRevealed;
      if (isRevealed) rememberPersistently(key);
    }

    return revealSet;
  }

  function touchMeshLru(key) {
    const now = nowTs();
    if (activeMeshLru.has(key)) activeMeshLru.delete(key);
    activeMeshLru.set(key, now);
    const entry = activeMeshes.get(key);
    if (entry) entry.lastUsed = now;
  }

  function releaseMesh(key, onRelease) {
    const entry = activeMeshes.get(key);
    if (!entry) return;

    if (onRelease) onRelease(entry.mesh, key);

    activeMeshes.delete(key);
    activeMeshLru.delete(key);
    meshPool.push(entry.mesh);
  }

  function evictMeshIfNeeded(onRelease) {
    while (activeMeshes.size >= cfg.maxActiveMeshes && activeMeshLru.size > 0) {
      let candidate = null;
      for (const key of activeMeshLru.keys()) {
        const st = orbStates.get(key);
        if (st?.isInCurrentRun) continue; // never evict current-run mesh first
        candidate = key;
        break;
      }
      if (!candidate) {
        candidate = activeMeshLru.keys().next().value;
      }
      releaseMesh(candidate, onRelease);
    }
  }

  function acquireMesh(key, { createMesh, resetMesh, onRelease } = {}) {
    const existing = activeMeshes.get(key);
    if (existing) {
      touchMeshLru(key);
      return existing.mesh;
    }

    evictMeshIfNeeded(onRelease);

    let mesh = meshPool.pop() || null;
    if (!mesh) {
      if (!createMesh) return null;
      mesh = createMesh(key);
    } else if (resetMesh) {
      resetMesh(mesh, key);
    }

    const now = nowTs();
    activeMeshes.set(key, { mesh, lastUsed: now });
    activeMeshLru.set(key, now);
    return mesh;
  }

  /**
   * Sync render layer to current reveal flags.
   * Returns current key sets for caller-side renderer bookkeeping.
   */
  function syncRenderLayer({ createMesh, resetMesh, onRelease } = {}) {
    for (const [key, state] of orbStates) {
      if (state.isRevealed) {
        acquireMesh(key, { createMesh, resetMesh, onRelease });
      } else {
        releaseMesh(key, onRelease);
      }
    }

    return {
      activeMeshKeys: new Set(activeMeshes.keys()),
      pooledMeshCount: meshPool.length,
    };
  }

  function incrementActivation(number) {
    const s = upsertOrb(number);
    s.activationCount += 1;
    return s.activationCount;
  }

  function markTerminalLoop(number, isTerminalLoopOrb = true) {
    const s = upsertOrb(number);
    s.isTerminalLoopOrb = !!isTerminalLoopOrb;
  }

  function markRepeatEncounter(number, isRepeatEncounter = true) {
    const s = upsertOrb(number);
    s.isRepeatEncounter = !!isRepeatEncounter;
  }

  function clear() {
    orbStates.clear();
    adjacency.clear();
    currentRunKeys.clear();
    persistentRevealLru.clear();
    activeMeshes.clear();
    activeMeshLru.clear();
    meshPool.length = 0;
  }

  return {
    config: { ...cfg, lowEndDevice: lowEnd, persistentCap },

    // Layer 1 API
    getState,
    getAllStates: () => orbStates,
    upsertOrb,
    addNeighbor,
    setCurrentRun,
    applyRevealPolicy,
    incrementActivation,
    markTerminalLoop,
    markRepeatEncounter,

    // Layer 2 API
    acquireMesh,
    releaseMesh,
    syncRenderLayer,

    // Utility
    clear,
  };
}
