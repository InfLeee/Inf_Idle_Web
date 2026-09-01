export const RUNTIME_RETENTION = Object.freeze({
  maxLogRows: 120,
  maxTransientNodes: 48,
  eventCompactionThreshold: 256,
  radarRenderIntervalMs: 50,
  uiRenderIntervalMs: 160,
  rosterRenderIntervalMs: 500,
  cleanupIntervalMs: 5_000,
  transientFallbackTtlMs: 1_400,
});

const transientEntries = new Map();
let transientSweepTimer = null;
let transientSweepDueAt = Infinity;

function releaseTransientNode(node) {
  transientEntries.delete(node);
  node.remove();
}

function scheduleTransientSweep() {
  let nextDueAt = Infinity;
  for (const entry of transientEntries.values()) nextDueAt = Math.min(nextDueAt, entry.expiresAt);
  if (nextDueAt === Infinity) {
    if (transientSweepTimer !== null) clearTimeout(transientSweepTimer);
    transientSweepTimer = null;
    transientSweepDueAt = Infinity;
    return;
  }
  if (transientSweepTimer !== null && transientSweepDueAt <= nextDueAt) return;
  if (transientSweepTimer !== null) clearTimeout(transientSweepTimer);
  transientSweepDueAt = nextDueAt;
  transientSweepTimer = setTimeout(() => {
    transientSweepTimer = null;
    transientSweepDueAt = Infinity;
    const now = Date.now();
    for (const [node, entry] of transientEntries) {
      if (entry.expiresAt <= now) releaseTransientNode(node);
    }
    scheduleTransientSweep();
  }, Math.max(0, nextDueAt - Date.now()));
}

export function createDamageAccumulator() {
  const state = { total: 0, count: 0, minimum: 0, maximum: 0 };

  return Object.freeze({
    record(value) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError("damage value must be non-negative");
      state.total += value;
      state.count += 1;
      state.minimum = state.count === 1 ? value : Math.min(state.minimum, value);
      state.maximum = Math.max(state.maximum, value);
    },
    reset() {
      state.total = 0;
      state.count = 0;
      state.minimum = 0;
      state.maximum = 0;
    },
    snapshot() {
      return Object.freeze({ ...state });
    },
  });
}

export function compactConsumedEvents(events, consumedCount, options = {}) {
  const threshold = options.threshold ?? RUNTIME_RETENTION.eventCompactionThreshold;
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  if (!Number.isInteger(consumedCount) || consumedCount < 0 || consumedCount > events.length) {
    throw new RangeError("consumedCount must be within the event array");
  }
  if (!Number.isInteger(threshold) || threshold < 1) throw new RangeError("threshold must be positive");
  if (consumedCount < threshold) return { events, eventIndex: consumedCount, removed: 0 };
  return { events: events.slice(consumedCount), eventIndex: 0, removed: consumedCount };
}

export function trimOldestChildren(container, maximum) {
  if (!Number.isInteger(maximum) || maximum < 0) throw new RangeError("maximum must be non-negative");
  let removed = 0;
  while (container.children.length > maximum) {
    container.firstElementChild.remove();
    removed += 1;
  }
  return removed;
}

export function mountTransientNode(container, node, options = {}) {
  const maximum = options.maximum ?? RUNTIME_RETENTION.maxTransientNodes;
  const fallbackTtlMs = options.fallbackTtlMs ?? RUNTIME_RETENTION.transientFallbackTtlMs;
  if (!Number.isInteger(maximum) || maximum < 0) throw new RangeError("maximum must be non-negative");
  if (!Number.isFinite(fallbackTtlMs) || fallbackTtlMs < 0) throw new RangeError("fallbackTtlMs must be non-negative");
  const now = Date.now();
  for (const [expiredNode, entry] of transientEntries) {
    if (entry.expiresAt <= now) releaseTransientNode(expiredNode);
  }
  container.append(node);
  transientEntries.set(node, { container, expiresAt: now + fallbackTtlMs });
  while (container.children.length > maximum) releaseTransientNode(container.firstElementChild);
  node.addEventListener("animationend", () => {
    releaseTransientNode(node);
    scheduleTransientSweep();
  }, { once: true });
  scheduleTransientSweep();
  return node;
}

export function clearTransientNodes(container) {
  let removed = 0;
  for (const [node, entry] of transientEntries) {
    if (entry.container !== container) continue;
    releaseTransientNode(node);
    removed += 1;
  }
  scheduleTransientSweep();
  return removed;
}

export function transientRetentionStats() {
  return Object.freeze({
    trackedNodes: transientEntries.size,
    scheduledSweeps: transientSweepTimer === null ? 0 : 1,
  });
}

export function createSingleFlightAnimationLoop(callback, scheduler = {}) {
  if (typeof callback !== "function") throw new TypeError("animation callback must be a function");
  const request = scheduler.request ?? globalThis.requestAnimationFrame;
  const cancel = scheduler.cancel ?? globalThis.cancelAnimationFrame;
  if (typeof request !== "function" || typeof cancel !== "function") throw new TypeError("animation scheduler is unavailable");
  let running = false;
  let frameId = null;
  const frame = (timestamp) => {
    frameId = null;
    if (!running) return;
    callback(timestamp);
    if (running && frameId === null) frameId = request(frame);
  };
  return Object.freeze({
    start() {
      if (running) return false;
      running = true;
      frameId = request(frame);
      return true;
    },
    stop() {
      if (!running && frameId === null) return false;
      running = false;
      if (frameId !== null) cancel(frameId);
      frameId = null;
      return true;
    },
    isRunning: () => running,
    pendingFrames: () => frameId === null ? 0 : 1,
  });
}
