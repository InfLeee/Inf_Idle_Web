import { createSeededRng } from "../../combat-protocol/src/settlement.js";
import { DAMAGE_TYPES, settleDirectDamage } from "./index.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function damageContext(compiledBuild, skillEntryId, monster, skillLevelOverride) {
  const skill = compiledBuild?.compiledSkills?.find((entry) => entry.entryId === skillEntryId)
    ?? compiledBuild?.compiledSkills?.find((entry) => entry.actions.some((action) => action.effects.some((effect) => effect.kind === "direct_damage")));
  if (!skill) throw new Error("compiled build has no direct damage skill");
  const action = skill.actions.find((item) => item.effects.some((effect) => effect.kind === "direct_damage"));
  const effect = action.effects.find((item) => item.kind === "direct_damage");
  const stats = compiledBuild.characterStats?.derived?.final ?? {};
  const damageType = skill.skillTags.includes("TRUE") ? DAMAGE_TYPES.TRUE : skill.skillTags.includes("MAGIC") ? DAMAGE_TYPES.MAGIC : DAMAGE_TYPES.PHYSICAL;
  const baseMultiplier = effect.params.baseMultiplier ?? effect.params.multiplier;
  const compiledModifier = baseMultiplier === 0 ? 0 : effect.params.multiplier / baseMultiplier;
  const attackPower = damageType === DAMAGE_TYPES.MAGIC ? stats.magicAttack : stats.physicalAttack;
  const periodMs = Math.max(action.timing.castTimeMs ?? action.timing.tickIntervalMs ?? 0, action.timing.gcdMs ?? 0, action.timing.cooldownMs ?? 0, 1);
  return {
    skill,
    action,
    effect,
    settlementBase: {
      damageType,
      attackPower: attackPower ?? 10,
      skillCoefficient: baseMultiplier * (effect.params.hitCount ?? 1),
      skillLevel: skillLevelOverride ?? effect.params.skillLevel ?? skill.runtime?.level ?? 1,
      skillLevelGrowth: effect.params.skillLevelGrowth ?? 0.08,
      moreDamage: compiledModifier === 1 ? [] : [compiledModifier - 1],
      moreSources: compiledModifier === 1 ? [] : [{ kind: "compiled_build", label: "辅助卡与精通编译结果" }],
      attackerLevel: compiledBuild.characterStats?.level ?? 1,
      defenderLevel: monster.level,
      defense: damageType === DAMAGE_TYPES.MAGIC ? monster.magicDefense : monster.physicalDefense,
      penetration: damageType === DAMAGE_TYPES.MAGIC ? stats.magicPenetration ?? 0 : stats.physicalPenetration ?? 0,
      critRating: stats.critRating ?? 0,
      critResistance: monster.critResistance ?? 0,
      critMultiplier: compiledBuild.characterStats?.combatRates?.baseCritDamageMultiplier ?? 1.5,
      attackSource: { kind: "character_stat", statId: damageType === DAMAGE_TYPES.MAGIC ? "magicAttack" : "physicalAttack" },
      skillSource: { kind: "skill", definitionId: skill.effectiveDefinitionId ?? skill.definitionId },
      skillLevelSource: { kind: "skill_card", entryId: skill.entryId, level: skillLevelOverride ?? effect.params.skillLevel ?? 1 },
    },
    periodMs,
  };
}

export function simulateM3DamageBatch(input = {}) {
  const samples = input.samples ?? 1_000;
  if (!Number.isInteger(samples) || samples < 1 || samples > 100_000) throw new RangeError("samples must be an integer between 1 and 100000");
  const seed = input.seed ?? 20260828;
  if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
  const context = damageContext(input.compiledBuild, input.skillEntryId, input.monster, input.skillLevel);
  const rng = createSeededRng(seed);
  let total = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  let criticalCount = 0;
  let sampleSettlement = null;
  const histogram = Array(10).fill(0);
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const settlement = settleDirectDamage({ ...context.settlementBase, critRoll: rng.nextFloat(), varianceRoll: rng.nextFloat() });
    if (index === 0) sampleSettlement = settlement;
    total += settlement.finalDamage;
    minimum = Math.min(minimum, settlement.finalDamage);
    maximum = Math.max(maximum, settlement.finalDamage);
    if (settlement.critical) criticalCount += 1;
    if (values.length < 2_000) values.push(settlement.finalDamage);
  }
  const averageDamage = total / samples;
  const span = Math.max(1, maximum - minimum + 1);
  for (const value of values) histogram[Math.min(9, Math.floor((value - minimum) / span * 10))] += 1;
  const castsPerSecond = 1_000 / context.periodMs;
  const dps = averageDamage * castsPerSecond;
  return deepFreeze({
    kind: "M3DamageBatch",
    seed,
    samples,
    skillEntryId: context.skill.entryId,
    skillDefinitionId: context.skill.effectiveDefinitionId ?? context.skill.definitionId,
    skillName: context.action.name,
    monsterId: input.monster.id,
    averageDamage,
    minimumDamage: minimum,
    maximumDamage: maximum,
    criticalRate: criticalCount / samples,
    castsPerSecond,
    dps,
    estimatedTtkSeconds: dps > 0 ? input.monster.maxHp / dps : null,
    histogram,
    numericBreakdown: sampleSettlement,
  });
}

export function compareM3DamageBatches(left, right) {
  function delta(field) {
    const absolute = right[field] - left[field];
    return { absolute, relative: left[field] === 0 ? null : absolute / left[field] };
  }
  return deepFreeze({ kind: "M3DamageComparison", averageDamage: delta("averageDamage"), dps: delta("dps"), estimatedTtkSeconds: delta("estimatedTtkSeconds") });
}
