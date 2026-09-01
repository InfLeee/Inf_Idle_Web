export const ENCOUNTER_WORLD_SCHEMA_VERSION = "encounter-world-v1";

const DEFAULTS = Object.freeze({
  radarRadiusM: 30,
  stopDistanceM: 3.4,
  baseEncounterIntervalMs: 3_000,
  minimumEncounterIntervalMs: 750,
  movementSpeedMultiplier: 1,
  monsterApproachSpeedMps: 9.5,
  encounterCapacityWindowMs: 18_000,
  killRateWindowMs: 12_000,
  baseLivingCapacity: 3,
  minimumLivingCapacity: 6,
  maximumLivingCapacity: 24,
  seed: 1,
});

const clone = (value) => structuredClone(value);
const TIME_EPSILON_MS = 0.001;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return value;
}

function normalizeConfig(input = {}) {
  const config = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, input[key] ?? DEFAULTS[key]]));
  positiveFinite(config.radarRadiusM, "radarRadiusM");
  if (!Number.isFinite(config.stopDistanceM) || config.stopDistanceM < 0 || config.stopDistanceM >= config.radarRadiusM) {
    throw new RangeError("stopDistanceM must be inside the radar radius");
  }
  positiveFinite(config.baseEncounterIntervalMs, "baseEncounterIntervalMs");
  positiveFinite(config.minimumEncounterIntervalMs, "minimumEncounterIntervalMs");
  positiveFinite(config.movementSpeedMultiplier, "movementSpeedMultiplier");
  positiveFinite(config.monsterApproachSpeedMps, "monsterApproachSpeedMps");
  if (config.radarRadiusM > 100) throw new RangeError("radarRadiusM exceeds the server limit");
  if (config.movementSpeedMultiplier > 10) throw new RangeError("movementSpeedMultiplier exceeds the server limit");
  if (config.monsterApproachSpeedMps > 100) throw new RangeError("monsterApproachSpeedMps exceeds the server limit");
  positiveFinite(config.encounterCapacityWindowMs, "encounterCapacityWindowMs");
  positiveFinite(config.killRateWindowMs, "killRateWindowMs");
  for (const key of ["baseLivingCapacity", "minimumLivingCapacity", "maximumLivingCapacity"]) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new RangeError(`${key} must be a positive integer`);
  }
  if (config.encounterCapacityWindowMs > 60_000) throw new RangeError("encounterCapacityWindowMs exceeds the server limit");
  if (config.killRateWindowMs > 60_000) throw new RangeError("killRateWindowMs exceeds the server limit");
  if (config.maximumLivingCapacity > 64) throw new RangeError("maximumLivingCapacity exceeds the server limit");
  if (config.minimumLivingCapacity > config.maximumLivingCapacity) throw new RangeError("minimumLivingCapacity cannot exceed maximumLivingCapacity");
  if (config.baseLivingCapacity > config.minimumLivingCapacity) throw new RangeError("baseLivingCapacity cannot exceed minimumLivingCapacity");
  if (!Number.isSafeInteger(config.seed)) throw new TypeError("seed must be a safe integer");
  return config;
}

export function encounterIntervalMs(configOrState) {
  const config = configOrState.config ?? normalizeConfig(configOrState);
  return Math.max(config.minimumEncounterIntervalMs, config.baseEncounterIntervalMs / config.movementSpeedMultiplier);
}

export function encounterFrequencyCapacity(configOrState) {
  const config = configOrState.config ?? normalizeConfig(configOrState);
  const frequencyCapacity = Math.ceil(config.encounterCapacityWindowMs / encounterIntervalMs(config));
  return Math.max(config.minimumLivingCapacity, Math.min(config.maximumLivingCapacity, frequencyCapacity));
}

export function encounterKillRatePerSecond(state) {
  const recentKills = state.recentDefeatAtMs.filter(
    (atMs) => atMs + state.config.killRateWindowMs > state.nowMs + TIME_EPSILON_MS,
  ).length;
  return recentKills / (state.config.killRateWindowMs / 1_000);
}

export function encounterLivingCapacity(state) {
  const frequencyCapacity = encounterFrequencyCapacity(state);
  const throughputCapacity = state.config.baseLivingCapacity + Math.ceil(
    encounterKillRatePerSecond(state) * (state.config.encounterCapacityWindowMs / 1_000),
  );
  return Math.max(state.config.baseLivingCapacity, Math.min(frequencyCapacity, throughputCapacity));
}

function pruneDefeatHistory(state) {
  state.recentDefeatAtMs = state.recentDefeatAtMs.filter(
    (atMs) => atMs + state.config.killRateWindowMs > state.nowMs + TIME_EPSILON_MS,
  );
}

function randomUnit(seed, serial) {
  let value = (seed ^ Math.imul(serial + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0x1_0000_0000;
}

function approachDurationMs(config) {
  return Math.round((config.radarRadiusM - config.stopDistanceM) / config.monsterApproachSpeedMps * 1_000);
}

function monsterDistanceAt(monster, nowMs, config) {
  if (monster.state === "engaged") return config.stopDistanceM;
  const progress = Math.max(0, Math.min(1, (nowMs - monster.spawnedAtMs) / (monster.engageAtMs - monster.spawnedAtMs)));
  return config.radarRadiusM - progress * (config.radarRadiusM - config.stopDistanceM);
}

function materializeDistances(state) {
  for (const monster of state.monsters) monster.distanceM = monsterDistanceAt(monster, state.nowMs, state.config);
}

function emit(state, events, event) {
  events.push({ index: state.eventIndex, at: state.nowMs, ...event });
  state.eventIndex += 1;
}

function livingCount(state) {
  return state.monsters.length;
}

function pauseOrResumeExploration(state, events) {
  const full = livingCount(state) >= encounterLivingCapacity(state);
  if (full && !state.encounterPaused) {
    state.encounterPaused = true;
    state.nextEncounterAtMs = null;
    emit(state, events, { type: "encounter_generation_paused", reason: "living_monster_cap" });
  } else if (!full && state.encounterPaused) {
    state.encounterPaused = false;
    state.nextEncounterAtMs = state.nowMs + encounterIntervalMs(state);
    emit(state, events, { type: "encounter_generation_resumed", reason: "capacity_available", nextEncounterAtMs: state.nextEncounterAtMs });
  }
}

function spawnEncounter(state, events) {
  const serial = state.encounterSerial;
  const durationMs = approachDurationMs(state.config);
  const monster = {
    id: state.nextMonsterId,
    encounterSerial: serial,
    angleDeg: Math.round(randomUnit(state.config.seed, serial) * 359),
    distanceM: state.config.radarRadiusM,
    state: "approaching",
    spawnedAtMs: state.nowMs,
    engageAtMs: state.nowMs + durationMs,
  };
  state.nextMonsterId += 1;
  state.encounterSerial += 1;
  state.monsters.push(monster);
  emit(state, events, { type: "monster_spawned", monster: clone(monster) });
  if (livingCount(state) < encounterLivingCapacity(state)) {
    state.nextEncounterAtMs = state.nowMs + encounterIntervalMs(state);
  }
  pauseOrResumeExploration(state, events);
}

function finishApproaches(state, events) {
  for (const monster of state.monsters) {
    if (monster.state !== "approaching" || monster.engageAtMs > state.nowMs) continue;
    monster.state = "engaged";
    monster.distanceM = state.config.stopDistanceM;
    emit(state, events, { type: "monster_approach_completed", monsterId: monster.id, distanceM: monster.distanceM });
  }
}

export function createEncounterWorldState(input = {}) {
  const config = normalizeConfig(input);
  const initialEncounterDelayMs = input.initialEncounterDelayMs ?? encounterIntervalMs(config);
  if (!Number.isFinite(initialEncounterDelayMs) || initialEncounterDelayMs < 0) {
    throw new RangeError("initialEncounterDelayMs must be a non-negative finite number");
  }
  return deepFreeze({
    schemaVersion: ENCOUNTER_WORLD_SCHEMA_VERSION,
    nowMs: 0,
    eventIndex: 0,
    config,
    playerPosition: { xM: 0, yM: 0 },
    encounterSerial: 0,
    nextMonsterId: 1,
    nextEncounterAtMs: initialEncounterDelayMs,
    encounterPaused: false,
    recentDefeatAtMs: [],
    monsters: [],
  });
}

export function advanceEncounterWorld(input) {
  const untilMs = input.untilMs;
  if (!Number.isFinite(untilMs) || untilMs < input.state.nowMs) throw new RangeError("untilMs must not move backwards");
  const maxEvents = input.maxEvents ?? 1_024;
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new RangeError("maxEvents must be a positive integer");
  const state = clone(input.state);
  const events = [];
  pruneDefeatHistory(state);
  pauseOrResumeExploration(state, events);

  while (state.nowMs <= untilMs && events.length < maxEvents) {
    const nextApproachAt = state.monsters
      .filter((monster) => monster.state === "approaching")
      .reduce((minimum, monster) => Math.min(minimum, monster.engageAtMs), Number.POSITIVE_INFINITY);
    const nextKillExpiryAt = state.recentDefeatAtMs.length
      ? state.recentDefeatAtMs[0] + state.config.killRateWindowMs
      : Number.POSITIVE_INFINITY;
    const nextAt = Math.min(state.nextEncounterAtMs ?? Number.POSITIVE_INFINITY, nextApproachAt, nextKillExpiryAt, untilMs);
    if (!Number.isFinite(nextAt) || nextAt < state.nowMs) break;
    const capacityBeforePrune = encounterLivingCapacity(state);
    state.nowMs = nextAt;
    pruneDefeatHistory(state);
    const capacityAfterPrune = encounterLivingCapacity(state);
    if (capacityAfterPrune !== capacityBeforePrune) {
      emit(state, events, {
        type: "encounter_capacity_changed",
        reason: "kill_rate_decay",
        frequencyCapacity: encounterFrequencyCapacity(state),
        livingCapacity: capacityAfterPrune,
        killRatePerSecond: encounterKillRatePerSecond(state),
      });
      pauseOrResumeExploration(state, events);
    }
    finishApproaches(state, events);
    if (events.length >= maxEvents) break;
    if (state.nextEncounterAtMs !== null && state.nextEncounterAtMs <= state.nowMs) spawnEncounter(state, events);
    if (state.nowMs === untilMs) break;
  }

  if (events.length < maxEvents) state.nowMs = untilMs;
  materializeDistances(state);
  return deepFreeze({ state, events });
}

export function defeatEncounterMonster(input) {
  const state = clone(input.state);
  const atMs = input.atMs ?? state.nowMs;
  if (atMs !== state.nowMs) throw new RangeError("defeat must be applied at the current encounter time");
  const index = state.monsters.findIndex((monster) => monster.id === input.monsterId);
  if (index < 0) return deepFreeze({ state, events: [] });
  const [monster] = state.monsters.splice(index, 1);
  const events = [];
  state.recentDefeatAtMs.push(state.nowMs);
  pruneDefeatHistory(state);
  emit(state, events, {
    type: "monster_defeated",
    monsterId: monster.id,
    frequencyCapacity: encounterFrequencyCapacity(state),
    livingCapacity: encounterLivingCapacity(state),
    killRatePerSecond: encounterKillRatePerSecond(state),
  });
  pauseOrResumeExploration(state, events);
  return deepFreeze({ state, events });
}

export function configureEncounterWorld(input) {
  const state = clone(input.state);
  const previousInterval = encounterIntervalMs(state);
  const previousRemaining = state.nextEncounterAtMs === null ? null : Math.max(0, state.nextEncounterAtMs - state.nowMs);
  state.config = normalizeConfig({ ...state.config, ...input.changes });
  if (previousRemaining !== null && !state.encounterPaused) {
    const progress = Math.max(0, Math.min(1, 1 - previousRemaining / previousInterval));
    state.nextEncounterAtMs = state.nowMs + (1 - progress) * encounterIntervalMs(state);
  }
  const events = [];
  pauseOrResumeExploration(state, events);
  emit(state, events, {
    type: "encounter_configuration_changed",
    movementSpeedMultiplier: state.config.movementSpeedMultiplier,
    monsterApproachSpeedMps: state.config.monsterApproachSpeedMps,
    frequencyCapacity: encounterFrequencyCapacity(state),
    livingCapacity: encounterLivingCapacity(state),
    killRatePerSecond: encounterKillRatePerSecond(state),
    encounterIntervalMs: encounterIntervalMs(state),
  });
  return deepFreeze({ state, events });
}
export function restartEncounterWorld(input) {
  const previous = input.state;
  const atMs = input.atMs ?? previous.nowMs;
  const initialEncounterDelayMs = input.initialEncounterDelayMs ?? encounterIntervalMs(previous);
  if (!Number.isFinite(atMs) || atMs < previous.nowMs) throw new RangeError("restart time must not move backwards");
  if (!Number.isFinite(initialEncounterDelayMs) || initialEncounterDelayMs < 0) {
    throw new RangeError("initialEncounterDelayMs must be a non-negative finite number");
  }
  const removedMonsterCount = previous.monsters.length;
  const state = {
    schemaVersion: ENCOUNTER_WORLD_SCHEMA_VERSION,
    nowMs: atMs,
    eventIndex: previous.eventIndex,
    config: clone(previous.config),
    playerPosition: { xM: 0, yM: 0 },
    encounterSerial: previous.encounterSerial,
    nextMonsterId: previous.nextMonsterId,
    nextEncounterAtMs: atMs + initialEncounterDelayMs,
    encounterPaused: false,
    recentDefeatAtMs: [],
    monsters: [],
  };
  const events = [];
  emit(state, events, {
    type: "encounter_world_restarted",
    reason: input.reason ?? "manual_restart",
    removedMonsterCount,
    nextEncounterAtMs: state.nextEncounterAtMs,
  });
  return deepFreeze({ state, events });
}