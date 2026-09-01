import { ACTION_TIMING_KIND, EFFECT_KIND } from "../../combat-protocol/src/action-schema.js";
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

function actionIntervalMs(action) {
  if (action.timing.kind === ACTION_TIMING_KIND.CHANNEL) return action.timing.tickIntervalMs;
  if (action.timing.kind === ACTION_TIMING_KIND.CAST) return Math.max(action.timing.gcdMs, action.timing.castTimeMs);
  return Math.max(1, action.timing.gcdMs);
}

function findPrimaryAction(compiledBuild) {
  const skillEntryId = compiledBuild.skillSlots.find(Boolean) ?? compiledBuild.weaponSkillEntryIds[0];
  const skill = compiledBuild.compiledSkills.find((entry) => entry.entryId === skillEntryId);
  const action = skill?.actions.find((candidate) => candidate.effects.some((effect) => effect.kind === EFFECT_KIND.DIRECT_DAMAGE));
  if (!skill || !action) throw new Error("compiled build has no authoritative direct-damage action");
  return { skill, action };
}

function eventRoll(seed, eventIndex) {
  return createSeededRng((seed ^ Math.imul(eventIndex + 1, 0x9e3779b1)) >>> 0).nextFloat();
}

export function createMinimalAuthoritativeSimulator(options = {}) {
  const maxEventsPerSegment = options.maxEventsPerSegment ?? 128;
  if (!Number.isInteger(maxEventsPerSegment) || maxEventsPerSegment < 1) {
    throw new RangeError("maxEventsPerSegment must be a positive integer");
  }

  function createInitialState({ compiledBuild, encounter }) {
    assertFinite(encounter.monsterHp, "encounter.monsterHp", 1);
    if (!compiledBuild?.characterStats) assertFinite(encounter.playerBaseDamage, "encounter.playerBaseDamage", 0);
    return deepFreeze({
      simulatedUntilMs: 0,
      nextActionAtMs: 0,
      eventIndex: 0,
      damageRollIndex: 0,
      monsterHp: encounter.monsterHp,
      settled: false,
    });
  }

  function advance({ state, compiledBuild, encounter, rngSeed, targetUntilMs }) {
    if (state.settled || targetUntilMs <= state.simulatedUntilMs) {
      return deepFreeze({ state: structuredClone(state), events: [], settlement: state.settled ? { victory: true } : null });
    }
    assertFinite(targetUntilMs, "targetUntilMs", state.simulatedUntilMs);
    const { skill, action } = findPrimaryAction(compiledBuild);
    const damageEffect = action.effects.find((effect) => effect.kind === EFFECT_KIND.DIRECT_DAMAGE);
    const intervalMs = actionIntervalMs(action);
    const next = structuredClone(state);
    const events = [];
    while (!next.settled && next.nextActionAtMs <= targetUntilMs && events.length < maxEventsPerSegment) {
      const stats = compiledBuild.characterStats?.derived?.final ?? {};
      const damageType = skill.skillTags?.includes("TRUE") ? DAMAGE_TYPES.TRUE : skill.skillTags?.includes("MAGIC") ? DAMAGE_TYPES.MAGIC : DAMAGE_TYPES.PHYSICAL;
      const baseMultiplier = damageEffect.params.baseMultiplier ?? damageEffect.params.multiplier;
      const compiledModifier = baseMultiplier === 0 ? 0 : damageEffect.params.multiplier / baseMultiplier;
      const numericBreakdown = settleDirectDamage({
        damageType,
        attackPower: (damageType === DAMAGE_TYPES.MAGIC ? stats.magicAttack : stats.physicalAttack) ?? encounter.playerBaseDamage,
        skillCoefficient: baseMultiplier * (damageEffect.params.hitCount ?? 1),
        skillLevel: damageEffect.params.skillLevel ?? skill.runtime?.level ?? 1,
        skillLevelGrowth: damageEffect.params.skillLevelGrowth ?? 0.08,
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
        atMs: next.nextActionAtMs,
        type: "authoritative_damage",
        skillEntryId: skill.entryId,
        actionId: action.id,
        damage,
        damageType,
        critical: numericBreakdown.critical,
        numericBreakdown,
        monsterHp: next.monsterHp,
      });
      next.eventIndex += 1;
      next.nextActionAtMs += intervalMs;
      next.settled = next.monsterHp === 0;
    }
    next.simulatedUntilMs = Math.min(targetUntilMs, next.nextActionAtMs);
    const settlement = next.settled
      ? { victory: true, rewardDefinitionId: encounter.rewardDefinitionId, defeatedAtMs: events.at(-1)?.atMs ?? next.simulatedUntilMs }
      : null;
    return deepFreeze({ state: next, events, settlement });
  }

  return Object.freeze({ createInitialState, advance });
}
