export const CHARACTER_STATS_SCHEMA_VERSION = "character-stats-v1";
export const CHARACTER_FORMULA_VERSION = "ro-idle-formulas-v0";

export const PRIMARY_STAT_IDS = Object.freeze(["str", "int", "agi", "dex", "con", "luk"]);

export const DEFAULT_CHARACTER_RULES = Object.freeze({
  minimumLevel: 1,
  maximumLevel: 60,
  minimumPrimaryStat: 1,
  maximumPrimaryStat: 99,
  pointsPerLevelBase: 3,
  pointsPerLevelBandSize: 10,
  pointCostBase: 2,
  pointCostBandSize: 10,
});

const DERIVED_DEFINITIONS = Object.freeze({
  physicalAttack: { base: 10, coefficients: { str: 2, dex: 0.5 } },
  magicAttack: { base: 10, coefficients: { int: 2 } },
  maxHp: { base: 100, coefficients: { con: 20, str: 2 } },
  maxResource: { base: 50, coefficients: { int: 5 } },
  attackSpeedRating: { base: 0, coefficients: { agi: 2, dex: 0.5 } },
  hasteRating: { base: 0, coefficients: { dex: 2, int: 0.25 } },
  physicalDefense: { base: 0, coefficients: { con: 1.5, str: 0.25 } },
  magicDefense: { base: 0, coefficients: { con: 0.75, int: 0.75 } },
  physicalPenetration: { base: 0, coefficients: { str: 0.5 } },
  magicPenetration: { base: 0, coefficients: { int: 0.5 } },
  accuracy: { base: 0, coefficients: { dex: 1.5, luk: 0.5 } },
  critRating: { base: 0, coefficients: { luk: 1, dex: 0.25 } },
  critResistance: { base: 0, coefficients: { luk: 0.5, con: 0.25 } },
  movementSpeedRating: { base: 0, coefficients: { agi: 1 } },
});

const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function finite(value, name, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function integer(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeRules(input = {}) {
  const rules = { ...DEFAULT_CHARACTER_RULES, ...input };
  for (const field of Object.keys(DEFAULT_CHARACTER_RULES)) integer(rules[field], `rules.${field}`, 1, 10_000);
  if (rules.minimumLevel > rules.maximumLevel) throw new RangeError("minimumLevel cannot exceed maximumLevel");
  if (rules.minimumPrimaryStat > rules.maximumPrimaryStat) throw new RangeError("minimumPrimaryStat cannot exceed maximumPrimaryStat");
  return rules;
}

function normalizeStatMap(input, name, fallback = 0) {
  const source = input ?? {};
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError(`${name} must be an object`);
  const result = {};
  for (const statId of PRIMARY_STAT_IDS) result[statId] = finite(source[statId] ?? fallback, `${name}.${statId}`);
  for (const field of Object.keys(source)) {
    if (!PRIMARY_STAT_IDS.includes(field)) throw new Error(`${name} contains unknown primary stat ${field}`);
  }
  return result;
}

function normalizeDerivedMap(input, name) {
  const source = input ?? {};
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError(`${name} must be an object`);
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(DERIVED_DEFINITIONS, key)) throw new Error(`${name} contains unknown derived stat ${key}`);
    result[key] = finite(value, `${name}.${key}`);
  }
  return result;
}

function normalizeProvenance(input) {
  const source = input ?? [];
  if (!Array.isArray(source) || source.length > 256) throw new RangeError("provenance must be an array with at most 256 entries");
  return source.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError(`provenance[${index}] must be an object`);
    if (!Number.isFinite(entry.amount)) throw new TypeError(`provenance[${index}].amount must be finite`);
    if (!PRIMARY_STAT_IDS.includes(entry.statId) && typeof entry.statId !== "string") throw new TypeError(`provenance[${index}].statId must be a string`);
    return structuredClone(entry);
  });
}

export function statPointsGrantedAtLevel(level, rulesInput = {}) {
  const rules = normalizeRules(rulesInput);
  integer(level, "level", rules.minimumLevel, rules.maximumLevel);
  if (level === rules.minimumLevel) return 0;
  return rules.pointsPerLevelBase + Math.floor((level - rules.minimumLevel) / rules.pointsPerLevelBandSize);
}

export function totalStatPointBudget(level, rulesInput = {}) {
  const rules = normalizeRules(rulesInput);
  integer(level, "level", rules.minimumLevel, rules.maximumLevel);
  let total = 0;
  for (let current = rules.minimumLevel + 1; current <= level; current += 1) {
    total += statPointsGrantedAtLevel(current, rules);
  }
  return total;
}

export function nextPrimaryPointCost(currentValue, rulesInput = {}) {
  const rules = normalizeRules(rulesInput);
  integer(currentValue, "currentValue", rules.minimumPrimaryStat, rules.maximumPrimaryStat);
  if (currentValue >= rules.maximumPrimaryStat) return null;
  return rules.pointCostBase + Math.floor((currentValue - rules.minimumPrimaryStat) / rules.pointCostBandSize);
}

export function spentStatPoints(allocationsInput, rulesInput = {}) {
  const rules = normalizeRules(rulesInput);
  const allocations = normalizeStatMap(allocationsInput, "allocations", rules.minimumPrimaryStat);
  let spent = 0;
  for (const statId of PRIMARY_STAT_IDS) {
    integer(allocations[statId], `allocations.${statId}`, rules.minimumPrimaryStat, rules.maximumPrimaryStat);
    for (let value = rules.minimumPrimaryStat; value < allocations[statId]; value += 1) {
      spent += nextPrimaryPointCost(value, rules);
    }
  }
  return spent;
}

function defenseRate(value, level, k, c) {
  finite(value, "defense value", 0);
  finite(level, "level", 1);
  return value === 0 ? 0 : value / (value + k * level + c);
}

export function physicalDefenseReduction(value, attackerLevel) {
  return defenseRate(value, attackerLevel, 11.117836965294593, 23.405972558514932);
}

export function penetrationRate(value, defenderLevel) {
  return defenseRate(value, defenderLevel, 29.34086629001883, 61.770244821092284);
}

export function compileCharacterStats(input = {}) {
  const rules = normalizeRules(input.rules);
  const provenance = normalizeProvenance(input.provenance);
  const level = integer(input.level ?? rules.minimumLevel, "level", rules.minimumLevel, rules.maximumLevel);
  const allocations = normalizeStatMap(input.allocations, "allocations", rules.minimumPrimaryStat);
  for (const statId of PRIMARY_STAT_IDS) {
    integer(allocations[statId], `allocations.${statId}`, rules.minimumPrimaryStat, rules.maximumPrimaryStat);
  }
  const spentPoints = spentStatPoints(allocations, rules);
  const totalPoints = totalStatPointBudget(level, rules);
  if (spentPoints > totalPoints) throw new RangeError(`allocations spend ${spentPoints} points but level ${level} grants ${totalPoints}`);

  const masterySkill = normalizeStatMap(input.primaryBonuses?.masterySkill, "primaryBonuses.masterySkill", 0);
  const extra = normalizeStatMap(input.primaryBonuses?.extra, "primaryBonuses.extra", 0);
  const basePrimary = {};
  const finalPrimary = {};
  for (const statId of PRIMARY_STAT_IDS) {
    basePrimary[statId] = allocations[statId] + masterySkill[statId];
    finalPrimary[statId] = basePrimary[statId] + extra[statId];
  }

  const equipmentBase = normalizeDerivedMap(input.derivedBonuses?.equipmentBase, "derivedBonuses.equipmentBase");
  const basePercent = normalizeDerivedMap(input.derivedBonuses?.basePercent, "derivedBonuses.basePercent");
  const extraDerived = normalizeDerivedMap(input.derivedBonuses?.extra, "derivedBonuses.extra");
  const baseDerived = {};
  const finalDerived = {};
  const derivedSources = {};
  for (const [statId, definition] of Object.entries(DERIVED_DEFINITIONS)) {
    const primaryContributions = Object.fromEntries(Object.entries(definition.coefficients)
      .map(([primaryId, coefficient]) => [primaryId, finalPrimary[primaryId] * coefficient]));
    const primaryValue = Object.values(primaryContributions).reduce((total, value) => total + value, 0);
    const equipmentValue = equipmentBase[statId] ?? 0;
    const percentValue = basePercent[statId] ?? 0;
    const extraValue = extraDerived[statId] ?? 0;
    baseDerived[statId] = definition.base + primaryValue + equipmentValue;
    const percentBonus = baseDerived[statId] * percentValue;
    finalDerived[statId] = baseDerived[statId] + percentBonus + extraValue;
    derivedSources[statId] = {
      definitionBase: definition.base,
      primary: primaryContributions,
      equipmentBase: equipmentValue,
      baseSubtotal: baseDerived[statId],
      basePercent: percentValue,
      percentBonus,
      extra: extraValue,
      final: finalDerived[statId],
    };
  }

  const attackFrequencyMultiplier = 1 + finalDerived.attackSpeedRating / 500;
  const castTimeMultiplier = 464.2857142857143 / (finalDerived.hasteRating + 464.2857142857143);
  const encounterMovementMultiplier = 1 + finalDerived.movementSpeedRating / 100;
  return deepFreeze({
    kind: "CharacterStatSnapshot",
    schemaVersion: CHARACTER_STATS_SCHEMA_VERSION,
    formulaVersion: CHARACTER_FORMULA_VERSION,
    level,
    rules: clone(rules),
    pointBudget: { total: totalPoints, spent: spentPoints, remaining: totalPoints - spentPoints },
    provenance,
    allocations,
    primary: { masterySkill, base: basePrimary, extra, final: finalPrimary },
    derived: { base: baseDerived, basePercent, extra: extraDerived, final: finalDerived, sources: derivedSources },
    combatRates: {
      attackFrequencyMultiplier,
      castTimeMultiplier,
      encounterMovementMultiplier,
      gcdMs: 500,
      baseCritDamageMultiplier: 1.5,
    },
  });
}
