import { compileActionBuild, stableHash } from "../../build-compiler/src/compileActionBuild.js";

export class ServerBusyError extends Error {
  constructor(maxQueueDepth) {
    super(`Compile queue is full; maximum depth is ${maxQueueDepth}`);
    this.name = "ServerBusyError";
    this.code = "SERVER_BUSY";
    this.retryable = true;
  }
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function readCache(cache, key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function writeCache(cache, key, value, maximum) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maximum) cache.delete(cache.keys().next().value);
}

export function createCompileRequestKey(input) {
  return stableHash(input);
}

export function createBoundedCompileService(options = {}) {
  const maxConcurrency = positiveInteger(options.maxConcurrency ?? 2, "maxConcurrency");
  const maxQueueDepth = positiveInteger(options.maxQueueDepth ?? 100, "maxQueueDepth");
  const maxCacheEntries = positiveInteger(options.maxCacheEntries ?? 1_000, "maxCacheEntries");
  const executeCompile = options.executeCompile ?? compileActionBuild;
  if (typeof executeCompile !== "function") throw new TypeError("executeCompile must be a function");

  const queue = [];
  const pendingByKey = new Map();
  const cache = new Map();
  let active = 0;
  const counters = { requests: 0, cacheHits: 0, deduplicated: 0, rejected: 0, completed: 0, failed: 0 };

  function drain() {
    while (active < maxConcurrency && queue.length > 0) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => executeCompile(job.input, job.compileOptions))
        .then((result) => {
          writeCache(cache, job.key, result, maxCacheEntries);
          counters.completed += 1;
          active -= 1;
          pendingByKey.delete(job.key);
          drain();
          job.resolve(result);
        })
        .catch((error) => {
          counters.failed += 1;
          active -= 1;
          pendingByKey.delete(job.key);
          drain();
          job.reject(error);
        });
    }
  }

  function request(input, requestOptions = {}) {
    counters.requests += 1;
    const key = createCompileRequestKey(input);
    const cached = readCache(cache, key);
    if (cached) {
      counters.cacheHits += 1;
      return Promise.resolve(cached);
    }
    const pending = pendingByKey.get(key);
    if (pending) {
      counters.deduplicated += 1;
      return pending;
    }
    if (active >= maxConcurrency && queue.length >= maxQueueDepth) {
      counters.rejected += 1;
      return Promise.reject(new ServerBusyError(maxQueueDepth));
    }

    let resolveJob;
    let rejectJob;
    const promise = new Promise((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    pendingByKey.set(key, promise);
    queue.push({
      key,
      input: structuredClone(input),
      compileOptions: structuredClone(requestOptions.compileOptions ?? {}),
      resolve: resolveJob,
      reject: rejectJob,
    });
    drain();
    return promise;
  }

  function getStats() {
    return Object.freeze({
      ...counters,
      active,
      queued: queue.length,
      pending: pendingByKey.size,
      cacheEntries: cache.size,
      limits: Object.freeze({ maxConcurrency, maxQueueDepth, maxCacheEntries }),
    });
  }

  function clearCache() {
    cache.clear();
  }

  return Object.freeze({ request, getStats, clearCache });
}
