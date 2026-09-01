export const COMBAT_NUMERICS_SCHEMA_VERSION = "combat-numerics-v0";
export const DAMAGE_TYPES = Object.freeze({ PHYSICAL: "physical", MAGIC: "magic", TRUE: "true" });

export const NUMERIC_LIMITS = Object.freeze({
  maximumMitigationRate: 0.75,
  maximumCritChance: 1,
  baseCritMultiplier: 1.5,
  minimumVariance: 0.95,
  maximumVariance: 1.05,
  maximumSkillLevel: 10,
  skillMoreDamagePerLevel: 0.08,
});

const RATE_CURVES = Object.freeze({
  defense: Object.freeze({ k: 11.117836965294593, c: 23.405972558514932 }),
  penetration: Object.freeze({ k: 29.34086629001883, c: 61.770244821092284 }),
  crit: Object.freeze({ k: 15.028248587570623, c: 31.638418079096047 }),
  critResistance: Object.freeze({ k: 122.37288135593221, c: 257.62711864406776 }),
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function finite(value, name, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

export function ratingRate(value, level, curveName) {
  finite(value, "rating", 0);
  finite(level, "level", 1);
  const curve = RATE_CURVES[curveName];
  if (!curve) throw new Error(`unknown rating curve ${curveName}`);
  return value === 0 ? 0 : value / (value + curve.k * level + curve.c);
}

export function skillLevelMultiplier(level = 1, perLevel = NUMERIC_LIMITS.skillMoreDamagePerLevel) {
  if (!Number.isInteger(level) || level < 1 || level > NUMERIC_LIMITS.maximumSkillLevel) throw new RangeError(`skillLevel must be an integer between 1 and ${NUMERIC_LIMITS.maximumSkillLevel}`);
  finite(perLevel, "skillLevelGrowth", -0.1, 10);
  return 1 + (level - 1) * perLevel;
}

function normalizeMore(values, name) {
  if (!Array.isArray(values) || values.length > 64) throw new RangeError(`${name} must be an array with at most 64 entries`);
  return values.map((value, index) => finite(value, `${name}[${index}]`, -0.999999, 100));
}

function addStage(stages, id, label, input, modifier, output, source = null) {
  stages.push({ id, label, input, modifier, output, ...(source ? { source } : {}) });
  return output;
}

export function settleDirectDamage(input = {}) {
  const damageType = input.damageType ?? DAMAGE_TYPES.PHYSICAL;
  if (!Object.values(DAMAGE_TYPES).includes(damageType)) throw new Error(`unsupported damageType ${damageType}`);
  const attackPower = finite(input.attackPower, "attackPower", 0, 1e15);
  const skillCoefficient = finite(input.skillCoefficient ?? 1, "skillCoefficient", 0, 1e6);
  const levelMultiplier = skillLevelMultiplier(input.skillLevel ?? 1, input.skillLevelGrowth ?? NUMERIC_LIMITS.skillMoreDamagePerLevel);
  const increased = finite(input.increasedDamage ?? 0, "increasedDamage", -0.999999, 100);
  const more = normalizeMore(input.moreDamage ?? [], "moreDamage");
  const typeMultiplier = finite(input.typeDamageMultiplier ?? 1, "typeDamageMultiplier", 0, 100);
  const finalMultiplier = finite(input.finalDamageMultiplier ?? 1, "finalDamageMultiplier", 0, 100);
  const attackerLevel = finite(input.attackerLevel ?? 1, "attackerLevel", 1, 10_000);
  const defenderLevel = finite(input.defenderLevel ?? 1, "defenderLevel", 1, 10_000);
  const defense = finite(input.defense ?? 0, "defense", 0, 1e15);
  const penetration = finite(input.penetration ?? 0, "penetration", 0, 1e15);
  const critRating = finite(input.critRating ?? 0, "critRating", 0, 1e15);
  const critResistance = finite(input.critResistance ?? 0, "critResistance", 0, 1e15);
  const critRoll = finite(input.critRoll ?? 1, "critRoll", 0, 1);
  const varianceRoll = finite(input.varianceRoll ?? 0.5, "varianceRoll", 0, 1);
  const critMultiplier = finite(input.critMultiplier ?? NUMERIC_LIMITS.baseCritMultiplier, "critMultiplier", 1, 100);
  const defenseRate = damageType === DAMAGE_TYPES.TRUE ? 0 : ratingRate(defense, attackerLevel, "defense");
  const penetrationRate = damageType === DAMAGE_TYPES.TRUE ? 0 : ratingRate(penetration, defenderLevel, "penetration");
  const effectiveMitigationRate = damageType === DAMAGE_TYPES.TRUE ? 0 : clamp(defenseRate - penetrationRate, 0, NUMERIC_LIMITS.maximumMitigationRate);
  const rawCritRate = ratingRate(critRating, attackerLevel, "crit");
  const critResistanceRate = ratingRate(critResistance, defenderLevel, "critResistance");
  const effectiveCritChance = clamp(rawCritRate - critResistanceRate, 0, NUMERIC_LIMITS.maximumCritChance);
  const critical = critRoll < effectiveCritChance;
  const varianceMultiplier = NUMERIC_LIMITS.minimumVariance + (NUMERIC_LIMITS.maximumVariance - NUMERIC_LIMITS.minimumVariance) * varianceRoll;
  const stages = [];
  let value = addStage(stages, "attack_power", "攻击力", 0, attackPower, attackPower, input.attackSource);
  value = addStage(stages, "skill_coefficient", "技能基础倍率", value, skillCoefficient, value * skillCoefficient, input.skillSource);
  value = addStage(stages, "skill_level", "技能等级倍率", value, levelMultiplier, value * levelMultiplier, input.skillLevelSource);
  value = addStage(stages, "increased", "增加伤害", value, 1 + increased, value * (1 + increased), input.increasedSource);
  for (const [index, modifier] of more.entries()) value = addStage(stages, `more_${index}`, `更多伤害 ${index + 1}`, value, 1 + modifier, value * (1 + modifier), input.moreSources?.[index]);
  value = addStage(stages, "mitigation", "防御与穿透", value, 1 - effectiveMitigationRate, value * (1 - effectiveMitigationRate));
  value = addStage(stages, "type", "类型与全伤修正", value, typeMultiplier, value * typeMultiplier, input.typeSource);
  value = addStage(stages, "critical", critical ? "暴击" : "未暴击", value, critical ? critMultiplier : 1, value * (critical ? critMultiplier : 1));
  value = addStage(stages, "variance", "随机浮动", value, varianceMultiplier, value * varianceMultiplier);
  value = addStage(stages, "final", "最终修正", value, finalMultiplier, value * finalMultiplier, input.finalSource);
  const finalDamage = Math.max(0, Math.floor(value));
  return deepFreeze({ kind: "DirectDamageSettlement", schemaVersion: COMBAT_NUMERICS_SCHEMA_VERSION, damageType, finalDamage, unroundedDamage: value, critical, rates: { defenseRate, penetrationRate, effectiveMitigationRate, rawCritRate, critResistanceRate, effectiveCritChance }, rolls: { critRoll, varianceRoll, varianceMultiplier }, stages });
}
