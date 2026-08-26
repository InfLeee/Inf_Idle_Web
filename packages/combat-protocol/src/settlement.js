export const SETTLEMENT_SCHEMA_VERSION = "settlement-v1";

export const UNIT_CONTRACT = Object.freeze({
  time: "millisecond",
  distance: "meter",
  ratio: "decimal",
  ratioExample: "0.25 means 25%",
});

export const DEFAULT_EVENT_DERIVATION_LIMIT = 8;
export const DEFAULT_GLOBAL_COOLDOWN_MS = 500;

export const SKILL_CAST_TYPE = Object.freeze({
  INSTANT: "instant",
  CAST: "cast",
  CHANNEL: "channel",
});

export const INTERRUPTING_CONTROL_TAG = Object.freeze({
  STUN: "Stun",
  FREEZE: "Freeze",
  KNOCKDOWN: "Knockdown",
  SILENCE: "Silence",
});

export const CHANNEL_END_REASON = Object.freeze({
  RESOURCE_EXHAUSTED: "resource_exhausted",
  TARGET_INVALID: "target_invalid",
  MAX_DURATION: "max_duration",
  ENEMY_CONTROL: "enemy_control",
  CASTER_DEATH: "caster_death",
});

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
}

function assertNumericBoundary(value, name) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`${name} must be a number or infinity`);
  }
}

function sumRatios(values, name) {
  return values.reduce((sum, value, index) => {
    assertFiniteNumber(value, `${name}[${index}]`);
    return sum + value;
  }, 0);
}

function multiplyRatioFactors(values, name) {
  return values.reduce((product, value, index) => {
    assertFiniteNumber(value, `${name}[${index}]`);
    if (value <= -1) throw new RangeError(`${name}[${index}] must be greater than -1`);
    return product * (1 + value);
  }, 1);
}

function roundFinal(value, mode) {
  if (mode === "none") return value;
  if (mode === "floor") return Math.floor(value);
  if (mode === "half_up") return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
  throw new Error(`Unsupported rounding mode: ${mode}`);
}

export function applyModifierPipeline(input, options = {}) {
  const {
    base,
    flat = 0,
    increased = [],
    more = [],
    final = [],
  } = input;
  const { rounding = "none", minimum = -Infinity, maximum = Infinity } = options;

  assertFiniteNumber(base, "base");
  assertFiniteNumber(flat, "flat");
  assertNumericBoundary(minimum, "minimum");
  assertNumericBoundary(maximum, "maximum");
  if (minimum > maximum) throw new RangeError("minimum cannot exceed maximum");

  const increasedFactor = 1 + sumRatios(increased, "increased");
  if (increasedFactor < 0) throw new RangeError("total increased modifier cannot reduce the factor below 0");

  const baseStage = base + flat;
  const increasedStage = baseStage * increasedFactor;
  const moreStage = increasedStage * multiplyRatioFactors(more, "more");
  const finalStage = moreStage * multiplyRatioFactors(final, "final");
  const clamped = Math.min(maximum, Math.max(minimum, finalStage));

  return {
    value: roundFinal(clamped, rounding),
    stages: {
      base: baseStage,
      increased: increasedStage,
      more: moreStage,
      final: finalStage,
      clamped,
    },
  };
}

function calculateScaledDurationMs(input) {
  const {
    baseDurationMs,
    increasedSpeed = [],
    moreSpeed = [],
    minimumDurationMs = 1,
    allowZero = false,
  } = input;

  assertFiniteNumber(baseDurationMs, "baseDurationMs");
  assertFiniteNumber(minimumDurationMs, "minimumDurationMs");
  if (baseDurationMs < 0 || (!allowZero && baseDurationMs === 0)) {
    throw new RangeError("baseDurationMs must be greater than 0 unless zero is allowed");
  }
  if (minimumDurationMs <= 0) throw new RangeError("minimumDurationMs must be greater than 0");
  if (baseDurationMs === 0) return { value: 0, unrounded: 0, clamped: 0 };

  const increasedFactor = 1 + sumRatios(increasedSpeed, "increasedSpeed");
  if (increasedFactor <= 0) throw new RangeError("total increased speed factor must be greater than 0");
  const moreFactor = multiplyRatioFactors(moreSpeed, "moreSpeed");
  const unrounded = baseDurationMs / increasedFactor / moreFactor;
  const clamped = Math.max(minimumDurationMs, unrounded);

  return {
    value: roundFinal(clamped, "half_up"),
    unrounded,
    clamped,
  };
}

export function calculateGlobalCooldownMs(input = {}) {
  const {
    skillDescriptionAcceleration = 0,
    minimumGlobalCooldownMs = 1,
  } = input;
  assertFiniteNumber(skillDescriptionAcceleration, "skillDescriptionAcceleration");
  assertFiniteNumber(minimumGlobalCooldownMs, "minimumGlobalCooldownMs");
  if (skillDescriptionAcceleration < 0) {
    throw new RangeError("skillDescriptionAcceleration cannot be negative");
  }
  if (minimumGlobalCooldownMs <= 0) {
    throw new RangeError("minimumGlobalCooldownMs must be greater than 0");
  }

  const unrounded = DEFAULT_GLOBAL_COOLDOWN_MS / (1 + skillDescriptionAcceleration);
  const clamped = Math.max(minimumGlobalCooldownMs, unrounded);
  return {
    value: roundFinal(clamped, "half_up"),
    base: DEFAULT_GLOBAL_COOLDOWN_MS,
    unrounded,
    clamped,
    source: skillDescriptionAcceleration > 0 ? "skill_description" : "default",
  };
}

export function calculateCastTimeMs(input) {
  return calculateScaledDurationMs({
    baseDurationMs: input.baseCastTimeMs,
    increasedSpeed: input.increasedSpeed,
    moreSpeed: input.moreSpeed,
    minimumDurationMs: input.minimumCastTimeMs ?? 1,
    allowZero: true,
  });
}

export function calculateChannelTickIntervalMs(input) {
  return calculateScaledDurationMs({
    baseDurationMs: input.baseTickIntervalMs,
    increasedSpeed: input.increasedSpeed,
    moreSpeed: input.moreSpeed,
    minimumDurationMs: input.minimumTickIntervalMs ?? 1,
  });
}

export function calculateChannelTickTimeMs(input) {
  const { startedAtMs, tickIntervalMs, tickIndex, tickAtStart = false } = input;
  assertFiniteNumber(startedAtMs, "startedAtMs");
  assertFiniteNumber(tickIntervalMs, "tickIntervalMs");
  if (tickIntervalMs <= 0) throw new RangeError("tickIntervalMs must be greater than 0");
  if (!Number.isInteger(tickIndex) || tickIndex < 0) {
    throw new RangeError("tickIndex must be a non-negative integer");
  }
  const intervalCount = tickAtStart ? tickIndex : tickIndex + 1;
  return startedAtMs + intervalCount * tickIntervalMs;
}

export function resolveEnemyControlInterruption(input) {
  const {
    controlTags = [],
    skillTags = [],
    immuneControlTags = [],
    uninterruptible = false,
  } = input;
  if (![controlTags, skillTags, immuneControlTags].every(Array.isArray)) {
    throw new TypeError("controlTags, skillTags and immuneControlTags must be arrays");
  }
  if (uninterruptible) return { interrupted: false, controlTag: null };

  const immuneTags = new Set(immuneControlTags);
  const hardInterrupts = new Set([
    INTERRUPTING_CONTROL_TAG.STUN,
    INTERRUPTING_CONTROL_TAG.FREEZE,
    INTERRUPTING_CONTROL_TAG.KNOCKDOWN,
  ]);

  for (const controlTag of controlTags) {
    if (immuneTags.has(controlTag)) continue;
    if (hardInterrupts.has(controlTag)) return { interrupted: true, controlTag };
    if (controlTag === INTERRUPTING_CONTROL_TAG.SILENCE && skillTags.includes("Spell")) {
      return { interrupted: true, controlTag };
    }
  }
  return { interrupted: false, controlTag: null };
}

function normalizeSeed(seed) {
  if (!Number.isInteger(seed)) throw new TypeError("rng seed must be an integer");
  const normalized = seed >>> 0;
  return normalized === 0 ? 0x9e3779b9 : normalized;
}

export function createSeededRng(seed) {
  let state = normalizeSeed(seed);

  function nextUint32() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  }

  function nextFloat() {
    return nextUint32() / 0x1_0000_0000;
  }

  function rollChance(chance) {
    assertFiniteNumber(chance, "chance");
    if (chance < 0 || chance > 1) throw new RangeError("chance must be between 0 and 1");
    return nextFloat() < chance;
  }

  return Object.freeze({ nextUint32, nextFloat, rollChance });
}

export function createRootCombatEvent(input) {
  if (!input?.id) throw new Error("root event id is required");
  if (!input?.type) throw new Error("root event type is required");
  return Object.freeze({
    id: input.id,
    type: input.type,
    sourceId: input.sourceId ?? null,
    payload: structuredClone(input.payload ?? {}),
    derivedFrom: null,
    derivationDepth: 0,
    triggerChain: Object.freeze([]),
  });
}

export function createDerivedCombatEvent(parent, input, options = {}) {
  const maxDepth = options.maxDepth ?? DEFAULT_EVENT_DERIVATION_LIMIT;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new RangeError("maxDepth must be a positive integer");
  if (!parent?.id || !Number.isInteger(parent.derivationDepth)) throw new TypeError("valid parent event is required");
  if (!input?.id) throw new Error("derived event id is required");
  if (!input?.type) throw new Error("derived event type is required");
  if (!input?.triggerId) throw new Error("derived event triggerId is required");
  if (parent.derivationDepth >= maxDepth) throw new Error(`event derivation depth exceeded: ${maxDepth}`);
  if (parent.triggerChain.includes(input.triggerId)) {
    throw new Error(`recursive event trigger blocked: ${input.triggerId}`);
  }

  return Object.freeze({
    id: input.id,
    type: input.type,
    sourceId: input.sourceId ?? parent.sourceId ?? null,
    payload: structuredClone(input.payload ?? {}),
    derivedFrom: parent.id,
    derivationDepth: parent.derivationDepth + 1,
    triggerChain: Object.freeze([...parent.triggerChain, input.triggerId]),
  });
}