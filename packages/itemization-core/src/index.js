import { createSeededRng } from "../../combat-protocol/src/settlement.js";

export const ITEMIZATION_SCHEMA_VERSION = "itemization-v2";
export const EQUIPMENT_SLOT = Object.freeze({ HEAD: "head", CHEST: "chest", HANDS: "hands", FEET: "feet", NECK: "neck", RING_LEFT: "ring_left", RING_RIGHT: "ring_right" });
export const EQUIPMENT_SLOTS = Object.freeze(Object.values(EQUIPMENT_SLOT));
export const ARMOR_SLOTS = Object.freeze(["head", "chest", "hands", "feet"]);
export const ACCESSORY_SLOTS = Object.freeze(["neck", "ring_left", "ring_right"]);
export const MAP_LEVEL_MODE = Object.freeze({ FIXED: "fixed", DYNAMIC: "dynamic" });
export const ITEM_RARITY = Object.freeze({ NORMAL: "normal", MAGIC: "magic", RARE: "rare", UNIQUE: "unique" });
export const ITEM_RARITIES = Object.freeze(Object.values(ITEM_RARITY));
export const ITEM_CATEGORY = Object.freeze({ WEAPON: "weapon", EQUIPMENT: "equipment", SKILL_CARD: "skill_card", CURRENCY: "currency" });
export const WEAPON_SUBTYPE = Object.freeze({ TWO_HANDED_SWORD: "two_handed_sword", SWORD_SHIELD: "sword_shield" });
export const MOD_SCOPE = Object.freeze({ GLOBAL: "global", LOCAL: "local" });
export const MOD_OPERATION = Object.freeze({ FLAT: "flat", INCREASED: "increased" });
export const RARITY_META = deepFreeze({
  normal: { name: "普通", color: "#f4f1e8", rank: 0, affixCount: 0 }, magic: { name: "魔法", color: "#63a9ff", rank: 1, affixCount: 2 },
  rare: { name: "稀有", color: "#f4c84b", rank: 2, affixCount: 6 }, unique: { name: "暗金", color: "#d98235", rank: 3, affixCount: 0 },
});

const SLOT_LABELS = Object.freeze({ head: "头部", chest: "胸甲", hands: "手部", feet: "脚部", neck: "项链", ring_left: "左戒", ring_right: "右戒" });
const TIER_ROWS = deepFreeze([
  { tier: 8, minimumItemLevel: 1, weight: 1200, power: .45 }, { tier: 7, minimumItemLevel: 8, weight: 900, power: .60 },
  { tier: 6, minimumItemLevel: 16, weight: 700, power: .76 }, { tier: 5, minimumItemLevel: 24, weight: 500, power: .94 },
  { tier: 4, minimumItemLevel: 32, weight: 330, power: 1.14 }, { tier: 3, minimumItemLevel: 40, weight: 190, power: 1.36 },
  { tier: 2, minimumItemLevel: 50, weight: 80, power: 1.61 }, { tier: 1, minimumItemLevel: 60, weight: 25, power: 1.90 },
]);

function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function integer(value, name, minimum = 1, maximum = 60) { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be ${minimum}-${maximum}`); return value; }
function hashSeed(text) { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0; return value || 1; }
function weightedPick(entries, rng, weightOf = (entry) => entry.weight) { const total = entries.reduce((sum, entry) => sum + Math.max(0, weightOf(entry)), 0); if (!entries.length || total <= 0) throw new Error("weighted pool is empty"); let roll = rng.nextFloat() * total; for (const entry of entries) { roll -= Math.max(0, weightOf(entry)); if (roll <= 0) return entry; } return entries.at(-1); }
function roundValue(value, precision = 0) { const factor = 10 ** precision; return Math.round(value * factor) / factor; }
function base(id, name, slot, dropLevel, icon, baseStats, tags, spawnWeight = 100) { return { id, name, slot, dropLevel, requiredLevel: dropLevel, icon, baseStats, tags, spawnWeight }; }

const BASE_ITEM_DEFINITIONS = deepFreeze([
  base("base_iron_helm", "铁制头盔", "head", 1, "⛑", [["physicalDefense", 10]], ["armor", "strength"]), base("base_guard_helm", "守望头盔", "head", 24, "⛑", [["physicalDefense", 28]], ["armor", "strength"]), base("base_sun_helm", "日辉头盔", "head", 50, "⛑", [["physicalDefense", 52]], ["armor", "strength"]),
  base("base_iron_coat", "铁制战甲", "chest", 1, "🛡", [["physicalDefense", 18]], ["armor", "strength"]), base("base_guard_coat", "守望战甲", "chest", 24, "🛡", [["physicalDefense", 52]], ["armor", "strength"]), base("base_sun_coat", "日辉战甲", "chest", 50, "🛡", [["physicalDefense", 94]], ["armor", "strength"]),
  base("base_iron_gloves", "铁制手套", "hands", 1, "🧤", [["accuracy", 8]], ["armor", "attack"]), base("base_guard_gloves", "守望手套", "hands", 24, "🧤", [["accuracy", 22]], ["armor", "attack"]), base("base_sun_gloves", "日辉手套", "hands", 50, "🧤", [["accuracy", 40]], ["armor", "attack"]),
  base("base_iron_boots", "铁制战靴", "feet", 1, "🥾", [["movementSpeedRating", 6]], ["armor", "movement"]), base("base_guard_boots", "守望战靴", "feet", 24, "🥾", [["movementSpeedRating", 16]], ["armor", "movement"]), base("base_sun_boots", "日辉战靴", "feet", 50, "🥾", [["movementSpeedRating", 28]], ["armor", "movement"]),
  base("base_bone_necklace", "骨纹项链", "neck", 1, "📿", [["maxResource", 8]], ["accessory", "resource"]), base("base_sun_necklace", "日辉项链", "neck", 24, "📿", [["maxResource", 20]], ["accessory", "resource"]), base("base_star_necklace", "星辉项链", "neck", 50, "📿", [["maxResource", 36]], ["accessory", "resource"]),
  base("base_iron_ring", "铁纹戒指", "ring_left", 1, "💍", [["critRating", 6]], ["accessory", "critical"]), base("base_sun_ring", "日辉戒指", "ring_left", 24, "💍", [["critRating", 16]], ["accessory", "critical"]), base("base_star_ring", "星辉戒指", "ring_left", 50, "💍", [["critRating", 29]], ["accessory", "critical"]),
  base("base_iron_ring_r", "铁纹戒指", "ring_right", 1, "💍", [["critRating", 6]], ["accessory", "critical"]), base("base_sun_ring_r", "日辉戒指", "ring_right", 24, "💍", [["critRating", 16]], ["accessory", "critical"]), base("base_star_ring_r", "星辉戒指", "ring_right", 50, "💍", [["critRating", 29]], ["accessory", "critical"]),
  base("base_rusted_greatsword", "锈铁双手剑", "weapon", 1, "⚔", [["physicalAttack", 14]], ["weapon", "two_handed_sword", "attack"], 110), base("base_expedition_greatsword", "远征双手剑", "weapon", 24, "⚔", [["physicalAttack", 42]], ["weapon", "two_handed_sword", "attack"], 90), base("base_sun_greatsword", "日辉巨剑", "weapon", 50, "⚔", [["physicalAttack", 74]], ["weapon", "two_handed_sword", "attack"], 55),
  base("base_guard_blade", "守护剑盾", "weapon", 1, "🗡", [["physicalAttack", 9], ["physicalDefense", 12]], ["weapon", "sword_shield", "attack", "armor"], 100),
]);

function tierValues(baseValue, options = {}) { return TIER_ROWS.map((row) => ({ tier: row.tier, minimumItemLevel: row.minimumItemLevel, weight: Math.round(row.weight * (options.weightMultiplier ?? 1)), minimum: roundValue(baseValue * row.power * (options.minimumFactor ?? .86), options.precision ?? 0), maximum: roundValue(baseValue * row.power * (options.maximumFactor ?? 1.14), options.precision ?? 0) })); }
function affix(id, name, kind, modGroup, statId, bucket, baseValue, options = {}) { return { id, name, kind, family: id, modGroup, statId, bucket, scope: options.scope ?? MOD_SCOPE.GLOBAL, operation: options.operation ?? MOD_OPERATION.FLAT, unit: options.unit ?? "flat", domains: options.domains ?? ["armor", "accessory", "weapon"], slots: options.slots ?? [...EQUIPMENT_SLOTS, "weapon"], requiredTags: options.requiredTags ?? [], tiers: tierValues(baseValue, options) }; }
const AFFIX_DEFINITIONS = deepFreeze([
  affix("vigorous", "健壮", "prefix", "life", "maxHp", "equipmentBase", 58), affix("brutal", "残暴", "prefix", "physical_attack_flat", "physicalAttack", "equipmentBase", 10, { domains: ["armor", "accessory"] }),
  affix("arcane", "奥秘", "prefix", "magic_attack_flat", "magicAttack", "equipmentBase", 10), affix("armored", "坚甲", "prefix", "physical_defense_flat", "physicalDefense", "equipmentBase", 18, { domains: ["armor"], slots: ARMOR_SLOTS }),
  affix("reservoir", "充盈", "prefix", "resource", "maxResource", "equipmentBase", 18, { domains: ["accessory"], slots: ACCESSORY_SLOTS }), affix("local_heavy", "沉重", "prefix", "local_physical_flat", "physicalAttack", "equipmentBase", 16, { domains: ["weapon"], slots: ["weapon"], scope: MOD_SCOPE.LOCAL, requiredTags: ["attack"] }),
  affix("local_tempered", "精炼", "prefix", "local_physical_percent", "physicalAttack", "basePercent", .14, { domains: ["weapon"], slots: ["weapon"], scope: MOD_SCOPE.LOCAL, operation: MOD_OPERATION.INCREASED, unit: "percent", precision: 3, requiredTags: ["attack"] }),
  affix("swift", "迅捷", "suffix", "attack_speed", "attackSpeedRating", "equipmentBase", 18), affix("precise", "精准", "suffix", "accuracy", "accuracy", "equipmentBase", 24),
  affix("fortunate", "幸运", "suffix", "critical", "critRating", "equipmentBase", 20, { domains: ["accessory", "weapon"], slots: [...ACCESSORY_SLOTS, "weapon"] }), affix("warded", "护佑", "suffix", "magic_defense", "magicDefense", "equipmentBase", 22),
  affix("fleet", "疾行", "suffix", "movement", "movementSpeedRating", "equipmentBase", 16, { domains: ["armor"], slots: ["feet"] }), affix("accelerated", "咏速", "suffix", "haste", "hasteRating", "equipmentBase", 18),
  affix("local_quickness", "利落", "suffix", "local_attack_speed", "attackSpeedRating", "equipmentBase", 22, { domains: ["weapon"], slots: ["weapon"], scope: MOD_SCOPE.LOCAL, requiredTags: ["attack"] }),
]);
const UNIQUE_DEFINITIONS = deepFreeze({ chest: { namePrefix: "逐日者的", fixed: [["vigorous", 3], ["armored", 3], ["warded", 4]] }, weapon: { namePrefix: "晨曦誓约·", fixed: [["local_heavy", 3], ["local_tempered", 3], ["local_quickness", 4]] } });

export function resolveMonsterLevel(input = {}) { if ((input.mode ?? MAP_LEVEL_MODE.FIXED) === MAP_LEVEL_MODE.FIXED) return integer(input.mapLevel, "mapLevel"); if (input.mode === MAP_LEVEL_MODE.DYNAMIC) return integer(input.playerLevel, "playerLevel"); throw new Error(`unknown map level mode ${input.mode}`); }
export function unlockedAffixTier(itemLevel) { integer(itemLevel, "itemLevel"); return TIER_ROWS.filter((row) => row.minimumItemLevel <= itemLevel).at(-1).tier; }
export function eligibleAffixTiers(definitionOrId, itemLevel) { integer(itemLevel, "itemLevel"); const definition = typeof definitionOrId === "string" ? AFFIX_DEFINITIONS.find((entry) => entry.id === definitionOrId) : definitionOrId; if (!definition) throw new Error(`unknown affix definition ${definitionOrId}`); return definition.tiers.filter((tier) => tier.minimumItemLevel <= itemLevel); }
function chooseBase(slot, itemLevel, rng, requiredTag = null) { let entries = BASE_ITEM_DEFINITIONS.filter((entry) => entry.slot === slot && entry.dropLevel <= itemLevel && (!requiredTag || entry.tags.includes(requiredTag))); if (!entries.length) entries = BASE_ITEM_DEFINITIONS.filter((entry) => entry.slot === slot && entry.dropLevel <= itemLevel); const top = Math.max(...entries.map((item) => item.dropLevel)); return weightedPick(entries, rng, (entry) => entry.spawnWeight * (entry.dropLevel === top ? 2.2 : 1)); }
function matchesAffix(definition, domain, slot, tags) { return definition.domains.includes(domain) && definition.slots.includes(slot) && definition.requiredTags.every((tag) => tags.includes(tag)); }
function rollAffix(definition, itemLevel, rng, highAttribute, forcedTier = null) { const eligible = eligibleAffixTiers(definition, itemLevel); const row = forcedTier === null ? weightedPick(eligible, rng, (tier) => tier.weight * (highAttribute ? (9 - tier.tier) ** 1.7 : 1)) : eligible.find((tier) => tier.tier === forcedTier) ?? eligible.at(-1); const value = row.minimum + rng.nextFloat() * (row.maximum - row.minimum); return { id: definition.id, name: definition.name, kind: definition.kind, family: definition.family, modGroup: definition.modGroup, statId: definition.statId, bucket: definition.bucket, scope: definition.scope, operation: definition.operation, unit: definition.unit, tier: row.tier, minimumItemLevel: row.minimumItemLevel, weight: row.weight, minimum: row.minimum, maximum: row.maximum, value: roundValue(value, definition.unit === "percent" ? 3 : 0) }; }
function rollAffixes({ domain, slot, tags, rarity, itemLevel, rng, highAttribute }) { const desired = RARITY_META[rarity].affixCount; if (!desired) return []; const perSide = rarity === ITEM_RARITY.MAGIC ? 1 : 3; const definitions = AFFIX_DEFINITIONS.filter((entry) => matchesAffix(entry, domain, slot, tags)); const selected = []; const groups = new Set(); for (const kind of ["prefix", "suffix"]) while (selected.filter((entry) => entry.kind === kind).length < perSide) { const candidates = definitions.filter((entry) => entry.kind === kind && !groups.has(entry.modGroup)); if (!candidates.length) break; const definition = weightedPick(candidates, rng, (entry) => eligibleAffixTiers(entry, itemLevel).reduce((sum, tier) => sum + tier.weight, 0)); groups.add(definition.modGroup); selected.push(rollAffix(definition, itemLevel, rng, highAttribute)); } return selected.slice(0, desired); }
function fixedUniqueAffixes(slot, itemLevel, rng) { const template = UNIQUE_DEFINITIONS[slot] ?? UNIQUE_DEFINITIONS.chest; return template.fixed.map(([id, tier]) => rollAffix(AFFIX_DEFINITIONS.find((entry) => entry.id === id), itemLevel, rng, true, tier)); }
function makeBaseStats(definition) { return definition.baseStats.map(([statId, value]) => ({ statId, value, bucket: "equipmentBase", scope: definition.slot === "weapon" ? MOD_SCOPE.LOCAL : MOD_SCOPE.GLOBAL, operation: MOD_OPERATION.FLAT })); }
function makeItemName(definition, rarity) { const unique = UNIQUE_DEFINITIONS[definition.slot === "weapon" ? "weapon" : definition.slot] ?? UNIQUE_DEFINITIONS.chest; return rarity === ITEM_RARITY.UNIQUE ? `${unique.namePrefix}${definition.name}` : definition.name; }

export function generateEquipmentDrop(input = {}) {
  const monsterLevel = integer(input.monsterLevel, "monsterLevel"), highAttribute = input.highAttribute ?? true, rarity = input.rarity ?? (highAttribute ? ITEM_RARITY.RARE : ITEM_RARITY.MAGIC); if (!ITEM_RARITIES.includes(rarity)) throw new Error(`unknown rarity ${rarity}`);
  const seedText = String(input.seed ?? `drop-${monsterLevel}`), rng = createSeededRng(hashSeed(seedText)); const slot = input.slot ?? EQUIPMENT_SLOTS[Math.floor(rng.nextFloat() * EQUIPMENT_SLOTS.length)]; if (!EQUIPMENT_SLOTS.includes(slot)) throw new Error(`unknown equipment slot ${slot}`);
  const definition = chooseBase(slot, monsterLevel, rng), domain = ARMOR_SLOTS.includes(slot) ? "armor" : "accessory", affixes = rarity === ITEM_RARITY.UNIQUE ? fixedUniqueAffixes(slot, monsterLevel, rng) : rollAffixes({ domain, slot, tags: definition.tags, rarity, itemLevel: monsterLevel, rng, highAttribute });
  return deepFreeze({ kind: "EquipmentItemInstance", schemaVersion: ITEMIZATION_SCHEMA_VERSION, category: ITEM_CATEGORY.EQUIPMENT, subtype: domain, instanceId: `gear-${hashSeed(`${seedText}:${slot}:${monsterLevel}`).toString(16).padStart(8, "0")}`, baseDefinitionId: definition.id, baseTags: definition.tags, name: makeItemName(definition, rarity), icon: definition.icon, slot, slotLabel: SLOT_LABELS[slot], itemLevel: monsterLevel, requiredLevel: Math.max(definition.requiredLevel, ...affixes.map((entry) => entry.minimumItemLevel), 1), rarity, baseStats: makeBaseStats(definition), affixes, implicitAffixes: [], quality: 0, corrupted: false, craftHistory: [], version: 1, dropSource: { monsterLevel, mapId: input.mapId ?? null, encounterId: input.encounterId ?? null } });
}
function rollRarity(rng) { const roll = rng.nextFloat(); return roll < .03 ? ITEM_RARITY.UNIQUE : roll < .18 ? ITEM_RARITY.RARE : roll < .45 ? ITEM_RARITY.MAGIC : ITEM_RARITY.NORMAL; }
function shuffle(values, rng) { const result = [...values]; for (let index = result.length - 1; index > 0; index -= 1) { const target = Math.floor(rng.nextFloat() * (index + 1)); [result[index], result[target]] = [result[target], result[index]]; } return result; }
export function generateMonsterLoot(input = {}) {
  const monsterLevel = integer(input.monsterLevel, "monsterLevel"), seed = String(input.seed ?? `monster-loot-${monsterLevel}`), rng = createSeededRng(hashSeed(seed)), rarity = input.rarity ?? rollRarity(rng), categoryRoll = rng.nextFloat(), category = input.category ?? (categoryRoll < .32 ? ITEM_CATEGORY.WEAPON : categoryRoll < .78 ? ITEM_CATEGORY.EQUIPMENT : ITEM_CATEGORY.SKILL_CARD);
  if (category === ITEM_CATEGORY.EQUIPMENT) return generateEquipmentDrop({ ...input, monsterLevel, rarity, highAttribute: rarity === ITEM_RARITY.RARE, seed: `${seed}:equipment` });
  if (category === ITEM_CATEGORY.SKILL_CARD) { const skillLevel = Math.min(10, Math.max(1, Math.ceil(monsterLevel / 6))); return deepFreeze({ kind: "UnidentifiedSkillGemDrop", schemaVersion: ITEMIZATION_SCHEMA_VERSION, category, subtype: "unidentified_skill_gem", instanceId: `uncut-skill-${hashSeed(`${seed}:${skillLevel}`).toString(16)}`, name: "未鉴定技能宝石", icon: "✧", rarity, itemLevel: monsterLevel, requiredLevel: monsterLevel, skillLevel, unidentified: true, affixes: [], dropSource: { monsterLevel, mapId: input.mapId ?? null, encounterId: input.encounterId ?? null } }); }
  if (category === ITEM_CATEGORY.WEAPON) {
    const subtype = input.subtype ?? (rng.nextFloat() < .82 ? WEAPON_SUBTYPE.TWO_HANDED_SWORD : WEAPON_SUBTYPE.SWORD_SHIELD), definition = chooseBase("weapon", monsterLevel, rng, subtype), affixes = rarity === ITEM_RARITY.UNIQUE ? fixedUniqueAffixes("weapon", monsterLevel, rng) : rollAffixes({ domain: "weapon", slot: "weapon", tags: definition.tags, rarity, itemLevel: monsterLevel, rng, highAttribute: rarity === ITEM_RARITY.RARE });
    const weaponPool = subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? ["two_handed_sword_aura_blade", "mount"] : ["shield_bash", "guard_followup", "sword_shield_combo", "block_counter", "hold_the_line"], skillCardSocketCount = 1 + Math.floor(rng.nextFloat() * 5), grantedSkill = rng.nextFloat() < .58 ? { instanceId: `gift-skill-${hashSeed(`${seed}:gift`).toString(16)}`, definitionId: subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? "two_handed_sword_slash" : "shield_bash", name: subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? "斩击" : "盾击", skillLevel: Math.min(10, Math.max(1, Math.ceil(monsterLevel / 6))), detachable: true, socketIndex: Math.floor(rng.nextFloat() * skillCardSocketCount) } : null, rolledCount = 1 + Math.floor(rng.nextFloat() * Math.min(5, weaponPool.length)), rolledWeaponSkillDefinitionIds = shuffle(weaponPool, rng).slice(0, rolledCount);
    return deepFreeze({ kind: "LootWeaponInstance", schemaVersion: ITEMIZATION_SCHEMA_VERSION, category, subtype, instanceId: `loot-weapon-${hashSeed(`${seed}:${subtype}`).toString(16)}`, baseDefinitionId: definition.id, baseTags: definition.tags, name: makeItemName(definition, rarity), icon: definition.icon, rarity, itemLevel: monsterLevel, requiredLevel: Math.max(definition.requiredLevel, ...affixes.map((entry) => entry.minimumItemLevel), 1), baseStats: makeBaseStats(definition), affixes, skillCardSocketCount, supportSocketsPerSkill: 3, grantedSocketedSkillCard: grantedSkill, rolledWeaponSkills: rolledWeaponSkillDefinitionIds, rolledWeaponSkillDefinitionIds, quality: 0, corrupted: false, craftHistory: [], version: 1, dropSource: { monsterLevel, mapId: input.mapId ?? null, encounterId: input.encounterId ?? null } });
  }
  throw new Error(`unknown loot category ${category}`);
}
export function aggregateEquipmentBonuses(items = []) {
  const derived = { equipmentBase: {}, basePercent: {}, extra: {} }, provenance = [];
  for (const item of items.filter(Boolean)) {
    const stats = [...(item.baseStats ?? []), ...(item.affixes ?? [])];
    const localFlat = {}, localIncreased = {};
    for (const stat of stats) {
      if (stat.scope === MOD_SCOPE.LOCAL && stat.operation === MOD_OPERATION.INCREASED) localIncreased[stat.statId] = (localIncreased[stat.statId] ?? 0) + stat.value;
      else if (stat.scope === MOD_SCOPE.LOCAL) localFlat[stat.statId] = (localFlat[stat.statId] ?? 0) + stat.value;
      else { const bucket = stat.bucket ?? "equipmentBase"; derived[bucket][stat.statId] = (derived[bucket][stat.statId] ?? 0) + stat.value; }
      provenance.push({ sourceKind: "equipment", sourceId: item.instanceId, sourceName: item.name, statId: stat.statId, bucket: stat.bucket ?? "equipmentBase", amount: stat.value, tier: stat.tier ?? 0, scope: stat.scope ?? MOD_SCOPE.GLOBAL, modGroup: stat.modGroup ?? null });
    }
    for (const [statId, flat] of Object.entries(localFlat)) {
      const finalLocal = Math.round(flat * (1 + (localIncreased[statId] ?? 0)) * 1000) / 1000;
      derived.equipmentBase[statId] = (derived.equipmentBase[statId] ?? 0) + finalLocal;
      if (localIncreased[statId]) provenance.push({ sourceKind: "local_settlement", sourceId: item.instanceId, sourceName: item.name, statId, bucket: "equipmentBase", amount: finalLocal - flat, tier: 0, scope: MOD_SCOPE.LOCAL, modGroup: "local_settlement" });
    }
  }
  return deepFreeze({ derived, provenance });
}
export const itemizationCatalog = deepFreeze({ bases: BASE_ITEM_DEFINITIONS, affixes: AFFIX_DEFINITIONS, tiers: TIER_ROWS, slotLabels: SLOT_LABELS });
