import { createSeededRng } from "../../combat-protocol/src/settlement.js";

export const ITEMIZATION_SCHEMA_VERSION = "itemization-v1";
export const EQUIPMENT_SLOT = Object.freeze({ HEAD: "head", CHEST: "chest", HANDS: "hands", FEET: "feet", NECK: "neck", RING_LEFT: "ring_left", RING_RIGHT: "ring_right" });
export const EQUIPMENT_SLOTS = Object.freeze(Object.values(EQUIPMENT_SLOT));
export const ARMOR_SLOTS = Object.freeze(["head", "chest", "hands", "feet"]);
export const ACCESSORY_SLOTS = Object.freeze(["neck", "ring_left", "ring_right"]);
export const MAP_LEVEL_MODE = Object.freeze({ FIXED: "fixed", DYNAMIC: "dynamic" });
export const ITEM_RARITY = Object.freeze({ NORMAL: "normal", MAGIC: "magic", RARE: "rare", UNIQUE: "unique" });
export const ITEM_RARITIES = Object.freeze(Object.values(ITEM_RARITY));
export const ITEM_CATEGORY = Object.freeze({ WEAPON: "weapon", EQUIPMENT: "equipment", SKILL_CARD: "skill_card", CURRENCY: "currency" });
export const WEAPON_SUBTYPE = Object.freeze({ TWO_HANDED_SWORD: "two_handed_sword", SWORD_SHIELD: "sword_shield" });
export const RARITY_META = deepFreeze({
  normal: { name: "普通", color: "#f4f1e8", rank: 0, affixCount: 0 }, magic: { name: "魔法", color: "#63a9ff", rank: 1, affixCount: 2 },
  rare: { name: "稀有", color: "#f4c84b", rank: 2, affixCount: 6 }, unique: { name: "暗金", color: "#d98235", rank: 3, affixCount: 6 },
});

const SLOT_LABELS = Object.freeze({ head: "头部", chest: "胸甲", hands: "手部", feet: "脚部", neck: "项链", ring_left: "左戒", ring_right: "右戒" });
const BASES = Object.freeze({
  head: { id: "base_guard_helm", name: "守望头盔", icon: "⛑", baseStat: ["physicalDefense", 12] }, chest: { id: "base_guard_coat", name: "守望战甲", icon: "🛡", baseStat: ["physicalDefense", 22] },
  hands: { id: "base_guard_gloves", name: "守望手套", icon: "🧤", baseStat: ["accuracy", 9] }, feet: { id: "base_guard_boots", name: "守望战靴", icon: "🥾", baseStat: ["movementSpeedRating", 8] },
  neck: { id: "base_sun_necklace", name: "日辉项链", icon: "📿", baseStat: ["maxResource", 12] }, ring_left: { id: "base_sun_ring", name: "日辉戒指", icon: "💍", baseStat: ["critRating", 8] }, ring_right: { id: "base_sun_ring", name: "日辉戒指", icon: "💍", baseStat: ["critRating", 8] },
});
const AFFIX_POOL = Object.freeze([
  { id: "vigorous", name: "健壮", kind: "prefix", family: "max_hp", statId: "maxHp", bucket: "equipmentBase", slots: EQUIPMENT_SLOTS, perLevel: 2.4 },
  { id: "brutal", name: "残暴", kind: "prefix", family: "physical_attack", statId: "physicalAttack", bucket: "equipmentBase", slots: EQUIPMENT_SLOTS, perLevel: 0.72 },
  { id: "arcane", name: "奥秘", kind: "prefix", family: "magic_attack", statId: "magicAttack", bucket: "equipmentBase", slots: EQUIPMENT_SLOTS, perLevel: 0.72 },
  { id: "armored", name: "坚甲", kind: "prefix", family: "physical_defense", statId: "physicalDefense", bucket: "equipmentBase", slots: ARMOR_SLOTS, perLevel: 0.9 },
  { id: "swift", name: "迅捷", kind: "suffix", family: "attack_speed", statId: "attackSpeedRating", bucket: "equipmentBase", slots: EQUIPMENT_SLOTS, perLevel: 0.75 },
  { id: "precise", name: "精准", kind: "suffix", family: "accuracy", statId: "accuracy", bucket: "equipmentBase", slots: EQUIPMENT_SLOTS, perLevel: 0.82 },
  { id: "fortunate", name: "幸运", kind: "suffix", family: "critical", statId: "critRating", bucket: "equipmentBase", slots: ACCESSORY_SLOTS, perLevel: 0.62 },
  { id: "warded", name: "护佑", kind: "suffix", family: "magic_defense", statId: "magicDefense", bucket: "equipmentBase", slots: EQUIPMENT_SLOTS, perLevel: 0.8 },
]);
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function integer(value, name, minimum = 1, maximum = 60) { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be ${minimum}-${maximum}`); return value; }
function hashSeed(text) { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0; return value || 1; }

export function resolveMonsterLevel(input = {}) {
  if ((input.mode ?? MAP_LEVEL_MODE.FIXED) === MAP_LEVEL_MODE.FIXED) return integer(input.mapLevel, "mapLevel");
  if (input.mode === MAP_LEVEL_MODE.DYNAMIC) return integer(input.playerLevel, "playerLevel");
  throw new Error(`unknown map level mode ${input.mode}`);
}
export function unlockedAffixTier(itemLevel) { integer(itemLevel, "itemLevel"); return Math.min(6, Math.floor((itemLevel - 1) / 10) + 1); }
function rollAffix(definition, itemLevel, rng, highAttribute) {
  const maximumTier = unlockedAffixTier(itemLevel);
  const tier = highAttribute ? Math.max(1, maximumTier - (rng.nextFloat() < 0.72 ? 0 : 1)) : 1 + Math.floor(rng.nextFloat() * maximumTier);
  const tierScale = 0.72 + tier * 0.28;
  const minimum = Math.max(1, Math.round(itemLevel * definition.perLevel * tierScale * 0.82));
  const maximum = Math.max(minimum, Math.round(itemLevel * definition.perLevel * tierScale * 1.18));
  return { id: definition.id, name: definition.name, kind: definition.kind, family: definition.family, statId: definition.statId, bucket: definition.bucket, tier, minimum, maximum, value: minimum + Math.floor(rng.nextFloat() * (maximum - minimum + 1)) };
}
export function generateEquipmentDrop(input = {}) {
  const monsterLevel = integer(input.monsterLevel, "monsterLevel"); const highAttribute = input.highAttribute ?? true; const rarity = input.rarity ?? (highAttribute ? ITEM_RARITY.RARE : ITEM_RARITY.MAGIC); if (!ITEM_RARITIES.includes(rarity)) throw new Error(`unknown rarity ${rarity}`); const seedText = String(input.seed ?? `drop-${monsterLevel}`); const rng = createSeededRng(hashSeed(seedText));
  const slot = input.slot ?? EQUIPMENT_SLOTS[Math.floor(rng.nextFloat() * EQUIPMENT_SLOTS.length)]; if (!EQUIPMENT_SLOTS.includes(slot)) throw new Error(`unknown equipment slot ${slot}`);
  const base = BASES[slot]; const candidates = AFFIX_POOL.filter((affix) => affix.slots.includes(slot)); const chosen = []; const families = new Set(); const desired = Math.min(RARITY_META[rarity].affixCount, candidates.length);
  const maximumPerSide = rarity === ITEM_RARITY.MAGIC ? 1 : 3;
  while (chosen.length < desired) { const candidate = candidates[Math.floor(rng.nextFloat() * candidates.length)]; if (families.has(candidate.family) || chosen.filter((entry) => entry.kind === candidate.kind).length >= maximumPerSide) continue; families.add(candidate.family); chosen.push(rollAffix(candidate, monsterLevel, rng, highAttribute)); }
  const [baseStatId, baseStatRaw] = base.baseStat; const baseStatValue = Math.max(1, Math.round(baseStatRaw * (0.7 + monsterLevel / 50)));
  return deepFreeze({ kind: "EquipmentItemInstance", schemaVersion: ITEMIZATION_SCHEMA_VERSION, category: ITEM_CATEGORY.EQUIPMENT, subtype: ARMOR_SLOTS.includes(slot) ? "armor" : "accessory", instanceId: `gear-${hashSeed(`${seedText}:${slot}:${monsterLevel}`).toString(16).padStart(8, "0")}`, baseDefinitionId: base.id, name: rarity === ITEM_RARITY.UNIQUE ? `逐日者的${base.name}` : base.name, icon: base.icon, slot, slotLabel: SLOT_LABELS[slot], itemLevel: monsterLevel, requiredLevel: monsterLevel, rarity, baseStats: [{ statId: baseStatId, bucket: "equipmentBase", value: baseStatValue }], affixes: chosen, implicitAffixes: [], quality: 0, corrupted: false, craftHistory: [], version: 1, dropSource: { monsterLevel, mapId: input.mapId ?? null, encounterId: input.encounterId ?? null } });
}

function rollRarity(rng) { const roll = rng.nextFloat(); return roll < .03 ? ITEM_RARITY.UNIQUE : roll < .18 ? ITEM_RARITY.RARE : roll < .45 ? ITEM_RARITY.MAGIC : ITEM_RARITY.NORMAL; }
export function generateMonsterLoot(input = {}) {
  const monsterLevel = integer(input.monsterLevel, "monsterLevel"); const seed = String(input.seed ?? `monster-loot-${monsterLevel}`); const rng = createSeededRng(hashSeed(seed)); const rarity = input.rarity ?? rollRarity(rng); const categoryRoll = rng.nextFloat(); const category = input.category ?? (categoryRoll < .32 ? ITEM_CATEGORY.WEAPON : categoryRoll < .78 ? ITEM_CATEGORY.EQUIPMENT : ITEM_CATEGORY.SKILL_CARD);
  if (category === ITEM_CATEGORY.EQUIPMENT) return generateEquipmentDrop({ ...input, monsterLevel, rarity, highAttribute: rarity === ITEM_RARITY.RARE || rarity === ITEM_RARITY.UNIQUE, seed: `${seed}:equipment` });
  if (category === ITEM_CATEGORY.SKILL_CARD) {
    const skillLevel = Math.min(10, Math.max(1, Math.ceil(monsterLevel / 6)));
    return deepFreeze({ kind: "UnidentifiedSkillGemDrop", schemaVersion: ITEMIZATION_SCHEMA_VERSION, category, subtype: "unidentified_skill_gem", instanceId: `uncut-skill-${hashSeed(`${seed}:${skillLevel}`).toString(16)}`, name: "未鉴定技能宝石", icon: "✧", rarity, itemLevel: monsterLevel, requiredLevel: monsterLevel, skillLevel, unidentified: true, affixes: [], dropSource: { monsterLevel, mapId: input.mapId ?? null, encounterId: input.encounterId ?? null } });
  }
  if (category === ITEM_CATEGORY.WEAPON) {
    const subtype = input.subtype ?? (rng.nextFloat() < .62 ? WEAPON_SUBTYPE.TWO_HANDED_SWORD : WEAPON_SUBTYPE.SWORD_SHIELD); const name = subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? "远征双手剑" : "守护剑盾"; const affixCount = RARITY_META[rarity].affixCount;
    const weaponPool = subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? ["自动斩击", "重刃回响", "破甲追击", "怒意喷发", "横扫余震"] : ["盾击反震", "守势追击", "剑盾连携", "格挡回击", "坚守号令"];
    const affixCandidates = AFFIX_POOL.filter((entry) => ["physicalAttack", "magicAttack", "attackSpeedRating", "accuracy", "critRating", "maxHp"].includes(entry.statId)); const weaponAffixes = []; const usedFamilies = new Set();
    while (weaponAffixes.length < Math.min(affixCount, affixCandidates.length)) { const candidate = affixCandidates[Math.floor(rng.nextFloat() * affixCandidates.length)]; if (usedFamilies.has(candidate.family)) continue; usedFamilies.add(candidate.family); weaponAffixes.push(rollAffix(candidate, monsterLevel, rng, rarity === ITEM_RARITY.RARE || rarity === ITEM_RARITY.UNIQUE)); }
    const skillCardSocketCount = 1 + Math.floor(rng.nextFloat() * 5); const grantedSkill = rng.nextFloat() < .58 ? { instanceId: `gift-skill-${hashSeed(`${seed}:gift`).toString(16)}`, name: subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? "斩击" : "盾击", skillLevel: Math.min(10, Math.max(1, Math.ceil(monsterLevel / 6))), detachable: true, socketIndex: Math.floor(rng.nextFloat() * skillCardSocketCount) } : null;
    const rolledCount = 1 + Math.floor(rng.nextFloat() * 5); const rolledWeaponSkills = [...weaponPool].sort(() => rng.nextFloat() - .5).slice(0, rolledCount);
    return deepFreeze({ kind: "LootWeaponInstance", schemaVersion: ITEMIZATION_SCHEMA_VERSION, category, subtype, instanceId: `loot-weapon-${hashSeed(`${seed}:${subtype}`).toString(16)}`, name: rarity === ITEM_RARITY.UNIQUE ? `晨曦誓约·${name}` : name, icon: subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? "⚔" : "🗡", rarity, itemLevel: monsterLevel, requiredLevel: monsterLevel, affixes: weaponAffixes, skillCardSocketCount, supportSocketsPerSkill: 3, grantedSocketedSkillCard: grantedSkill, rolledWeaponSkills, dropSource: { monsterLevel, mapId: input.mapId ?? null, encounterId: input.encounterId ?? null } });
  }
  throw new Error(`unknown loot category ${category}`);
}
export function aggregateEquipmentBonuses(items = []) {
  const derived = { equipmentBase: {}, basePercent: {}, extra: {} }; const provenance = [];
  for (const item of items.filter(Boolean)) for (const stat of [...(item.baseStats ?? []), ...(item.affixes ?? [])]) { const amount = stat.value; derived[stat.bucket][stat.statId] = (derived[stat.bucket][stat.statId] ?? 0) + amount; provenance.push({ sourceKind: "equipment", sourceId: item.instanceId, sourceName: item.name, statId: stat.statId, bucket: stat.bucket, amount, tier: stat.tier ?? 0 }); }
  return deepFreeze({ derived, provenance });
}
export const itemizationCatalog = deepFreeze({ bases: BASES, affixes: AFFIX_POOL, slotLabels: SLOT_LABELS });
