export const MONSTER_NUMERICS_SCHEMA_VERSION = "monster-numerics-v0";
export const MONSTER_TIERS = Object.freeze({ NORMAL: "normal", ELITE: "elite", BOSS: "boss" });

const TIER_RULES = Object.freeze({
  normal: Object.freeze({ name: "普通怪", hp: 1, attack: 1, defense: 1, critResistance: 1, attackIntervalMs: 1_800 }),
  elite: Object.freeze({ name: "精英怪", hp: 4, attack: 1.7, defense: 1.5, critResistance: 1.5, attackIntervalMs: 1_500 }),
  boss: Object.freeze({ name: "Boss", hp: 12, attack: 2.4, defense: 2.2, critResistance: 2.2, attackIntervalMs: 1_300 }),
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function levelScale(level) { return 1 + (level - 1) * 0.12 + (level - 1) ** 2 * 0.005; }

export function createM3MonsterTemplate(input = {}) {
  const tier = input.tier ?? MONSTER_TIERS.NORMAL;
  const rules = TIER_RULES[tier];
  if (!rules) throw new Error(`unsupported monster tier ${tier}`);
  const level = input.level ?? 1;
  if (!Number.isInteger(level) || level < 1 || level > 60) throw new RangeError("monster level must be an integer between 1 and 60");
  const scale = levelScale(level);
  const base = { hp: 180, attack: 18, defense: 10, critResistance: 4 };
  const maxHp = Math.round(base.hp * scale * rules.hp);
  const attackDamage = Math.round(base.attack * scale * rules.attack);
  const physicalDefense = Math.round(base.defense * scale * rules.defense);
  const magicDefense = Math.round(physicalDefense * 0.85);
  const critResistance = Math.round(base.critResistance * scale * rules.critResistance);
  return deepFreeze({
    kind: "MonsterTemplate",
    schemaVersion: MONSTER_NUMERICS_SCHEMA_VERSION,
    id: input.id ?? `m3-${tier}-lv${level}`,
    name: input.name ?? `${level}级${rules.name}`,
    tier,
    level,
    maxHp,
    attackDamage,
    attackIntervalMs: rules.attackIntervalMs,
    attackType: input.attackType ?? "physical",
    physicalDefense,
    magicDefense,
    critResistance,
    sources: {
      curve: "idle-quadratic-v0",
      levelScale: scale,
      base,
      tierMultipliers: { hp: rules.hp, attack: rules.attack, defense: rules.defense, critResistance: rules.critResistance },
    },
  });
}

export function createM3MonsterRoster(level) {
  return deepFreeze(Object.values(MONSTER_TIERS).map((tier) => createM3MonsterTemplate({ tier, level })));
}
