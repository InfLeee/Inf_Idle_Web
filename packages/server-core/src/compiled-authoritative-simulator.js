import {
  advanceCompiledCombat,
  createCompiledCombatState,
  migrateCompiledCombatState,
} from "../../combat-runtime/src/index.js";
import { createSeededRng } from "../../combat-protocol/src/settlement.js";
import { DAMAGE_TYPES, settleDirectDamage } from "../../combat-numerics/src/index.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function assertFinite(value, name, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${name} must be at least ${minimum}`);
}

function eventRoll(seed, eventIndex) {
  return createSeededRng((seed ^ Math.imul(eventIndex + 1, 0x9e3779b1)) >>> 0).nextFloat();
}

function publicRuntimeEvent(event) {
  const allowed = new Set([
    "action_started",
    "channel_started",
    "channel_tick",
    "channel_ended",
    "action_interrupted",
    "resource_changed",
    "state_applied",
    "state_refreshed",
    "state_expired",
    "state_removed",
  ]);
  return allowed.has(event.type) ? { ...structuredClone(event), type: `authoritative_${event.type}` } : null;
}

export function createCompiledAuthoritativeSimulator(options = {}) {
  const maxEventsPerSegment = options.maxEventsPerSegment ?? 128;
  const maxRuntimeEventsPerSegment = options.maxRuntimeEventsPerSegment ?? maxEventsPerSegment * 8;
  if (!Number.isInteger(maxEventsPerSegment) || maxEventsPerSegment < 1) {
    throw new RangeError("maxEventsPerSegment must be a positive integer");
  }
  if (!Number.isInteger(maxRuntimeEventsPerSegment) || maxRuntimeEventsPerSegment < 1) {
    throw new RangeError("maxRuntimeEventsPerSegment must be a positive integer");
  }

  function createInitialState({ compiledBuild, encounter }) {
    assertFinite(encounter.monsterHp, "encounter.monsterHp", 1);
    if (!compiledBuild.characterStats) assertFinite(encounter.playerBaseDamage, "encounter.playerBaseDamage", 0);
    return deepFreeze({
      simulatedUntilMs: 0,
      eventIndex: 0,
      damageRollIndex: 0,
      monsterHp: encounter.monsterHp,
      settled: false,
      actionRuntime: createCompiledCombatState(compiledBuild),
    });
  }

  function advance({ state, compiledBuild, encounter, rngSeed, targetUntilMs }) {
    if (state.settled || targetUntilMs <= state.simulatedUntilMs) {
      return deepFreeze({
        state: structuredClone(state),
        events: [],
        runtimeEvents: [],
        settlement: state.settled ? { victory: true } : null,
      });
    }
    assertFinite(targetUntilMs, "targetUntilMs", state.simulatedUntilMs);
    const actionRuntime = state.actionRuntime.buildHash === compiledBuild.buildHash
      ? state.actionRuntime
      : migrateCompiledCombatState(state.actionRuntime, compiledBuild);
    const runtime = advanceCompiledCombat({
      state: actionRuntime,
      compiledBuild,
      untilMs: targetUntilMs,
      maxEvents: maxRuntimeEventsPerSegment,
      controlEvents: encounter.controlEvents ?? [],
    });
    const next = structuredClone(state);
    next.actionRuntime = structuredClone(runtime.state);
    next.simulatedUntilMs = runtime.state.nowMs;
    const events = [];
    const runtimeEvents = [];
    for (const event of runtime.events) {
      const publicEvent = publicRuntimeEvent(event);
      if (publicEvent) runtimeEvents.push(publicEvent);
      if (event.type !== "damage_intent" || events.length >= maxEventsPerSegment || next.settled) continue;
      const hitCount = Math.max(1, event.hitCount ?? 1);
      const stats = compiledBuild.characterStats?.derived?.final ?? {};
      const damageType = event.skillTags?.includes("TRUE") ? DAMAGE_TYPES.TRUE : event.skillTags?.includes("MAGIC") ? DAMAGE_TYPES.MAGIC : DAMAGE_TYPES.PHYSICAL;
      const baseMultiplier = event.baseMultiplier ?? event.multiplier;
      const compiledModifier = baseMultiplier === 0 ? 0 : event.multiplier / baseMultiplier;
      const numericBreakdown = settleDirectDamage({
        damageType,
        attackPower: (damageType === DAMAGE_TYPES.MAGIC ? stats.magicAttack : stats.physicalAttack) ?? encounter.playerBaseDamage,
        skillCoefficient: baseMultiplier * hitCount,
        skillLevel: event.skillLevel ?? 1,
        skillLevelGrowth: event.skillLevelGrowth ?? 0.08,
        moreDamage: compiledModifier === 1 ? [] : [compiledModifier - 1],
        attackerLevel: compiledBuild.characterStats?.level ?? encounter.playerLevel ?? 1,
        defenderLevel: encounter.monsterLevel ?? 1,
        defense: damageType === DAMAGE_TYPES.MAGIC ? encounter.monsterMagicDefense ?? 0 : encounter.monsterPhysicalDefense ?? 0,
        penetration: damageType === DAMAGE_TYPES.MAGIC ? stats.magicPenetration ?? 0 : stats.physicalPenetration ?? 0,
        critRating: stats.critRating ?? 0,
        critResistance: encounter.monsterCritResistance ?? 0,
        critRoll: eventRoll(rngSeed, next.damageRollIndex++),
        varianceRoll: eventRoll(rngSeed, next.damageRollIndex++),
      });
      const damage = numericBreakdown.finalDamage;
      next.monsterHp = Math.max(0, next.monsterHp - damage);
      events.push({
        index: next.eventIndex,
        atMs: event.at,
        type: "authoritative_damage",
        skillEntryId: event.skillEntryId,
        skillDefinitionId: event.skillDefinitionId,
        actionId: event.actionId,
        targeting: structuredClone(event.targeting),
        hitCount,
        damage,
        damageType,
        critical: numericBreakdown.critical,
        numericBreakdown,
        monsterHp: next.monsterHp,
      });
      next.eventIndex += 1;
      next.settled = next.monsterHp === 0;
    }
    const settlement = next.settled
      ? { victory: true, rewardDefinitionId: encounter.rewardDefinitionId, defeatedAtMs: events.at(-1)?.atMs ?? next.simulatedUntilMs }
      : null;
    return deepFreeze({ state: next, events, runtimeEvents, settlement });
  }

  return Object.freeze({ createInitialState, advance });
}
