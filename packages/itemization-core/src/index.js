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
export const SKILL_AFFIX_OPERATION = Object.freeze({
  ADD_SKILL_LEVEL: "add_skill_level",
  ADD_PROJECTILE_COUNT: "add_projectile_count",
  ADD_SUMMON_COUNT: "add_summon_count",
});
export const CRAFTING_CURRENCY_CATEGORY = Object.freeze({ BASIC: "basic", TARGETED: "targeted", OMEN: "omen", QUALITY: "quality", SOCKET: "socket", SPECIAL: "special", FRAGMENT: "fragment" });
export const CRAFTING_CURRENCIES = deepFreeze([
  { id: "transmutation", name: "蜕变石", icon: "◈", category: "basic", enabled: true, description: "将普通物品升级为具有 1 个词缀的魔法物品。" },
  { id: "greater_transmutation", name: "高级蜕变石", icon: "◈", category: "basic", enabled: true, minimumModifierLevel: 32, description: "蜕变为魔法物品；按 Inf_Idle 等级轴保证新增词缀等级不低于 32。" },
  { id: "perfect_transmutation", name: "完美蜕变石", icon: "◈", category: "basic", enabled: true, minimumModifierLevel: 50, description: "蜕变为魔法物品；按 Inf_Idle 等级轴保证新增词缀等级不低于 50。" },
  { id: "augmentation", name: "增幅石", icon: "✦", category: "basic", enabled: true, description: "为未满词缀的魔法物品增加 1 个随机词缀。" },
  { id: "greater_augmentation", name: "高级增幅石", icon: "✦", category: "basic", enabled: true, minimumModifierLevel: 32, description: "增加魔法词缀；按 Inf_Idle 等级轴保证新增词缀等级不低于 32。" },
  { id: "perfect_augmentation", name: "完美增幅石", icon: "✦", category: "basic", enabled: true, minimumModifierLevel: 50, description: "增加魔法词缀；按 Inf_Idle 等级轴保证新增词缀等级不低于 50。" },
  { id: "regal", name: "富豪石", icon: "♜", category: "basic", enabled: true, description: "将魔法物品升级为稀有物品，并增加 1 个词缀。" },
  { id: "greater_regal", name: "高级富豪石", icon: "♜", category: "basic", enabled: true, minimumModifierLevel: 35, description: "升为稀有物品；新增词缀最低等级 35。" },
  { id: "perfect_regal", name: "完美富豪石", icon: "♜", category: "basic", enabled: true, minimumModifierLevel: 50, description: "升为稀有物品；新增词缀最低等级 50。" },
  { id: "alchemy", name: "点金石", icon: "◆", category: "basic", enabled: true, description: "将普通或魔法物品升级为拥有 4 个随机词缀的稀有物品。" },
  { id: "exalted", name: "崇高石", icon: "✹", category: "basic", enabled: true, description: "为未满词缀的稀有物品增加 1 个随机词缀。" },
  { id: "greater_exalted", name: "高级崇高石", icon: "✹", category: "basic", enabled: true, minimumModifierLevel: 35, description: "增加稀有词缀；新增词缀最低等级 35。" },
  { id: "perfect_exalted", name: "完美崇高石", icon: "✹", category: "basic", enabled: true, minimumModifierLevel: 50, description: "增加稀有词缀；新增词缀最低等级 50。" },
  { id: "chaos", name: "混沌石", icon: "☯", category: "targeted", enabled: true, description: "移除稀有物品的 1 个随机词缀，再增加 1 个随机词缀。" },
  { id: "greater_chaos", name: "高级混沌石", icon: "☯", category: "targeted", enabled: true, minimumModifierLevel: 35, description: "替换稀有词缀；新增词缀最低等级 35。" },
  { id: "perfect_chaos", name: "完美混沌石", icon: "☯", category: "targeted", enabled: true, minimumModifierLevel: 50, description: "替换稀有词缀；新增词缀最低等级 50。" },
  { id: "annulment", name: "剥离石", icon: "✂", category: "targeted", enabled: true, description: "随机移除物品上的 1 个词缀；可被左旋或右旋预兆定向。" },
  { id: "divine", name: "神圣石", icon: "♢", category: "targeted", enabled: true, description: "重掷物品现有词缀在当前阶级内的数值。" },
  { id: "sinistral_alchemy_omen", name: "左旋炼金预兆", icon: "↶", category: "omen", enabled: true, catalyst: true, omenEffect: "alchemy_max_prefixes", compatibleCurrencyIds: ["alchemy"], description: "下一次点金固定生成 3 条前缀与 1 条后缀。" },
  { id: "dextral_alchemy_omen", name: "右旋炼金预兆", icon: "↷", category: "omen", enabled: true, catalyst: true, omenEffect: "alchemy_max_suffixes", compatibleCurrencyIds: ["alchemy"], description: "下一次点金固定生成 1 条前缀与 3 条后缀。" },
  { id: "sinistral_coronation_omen", name: "左旋加冕预兆", icon: "↶", category: "omen", enabled: true, catalyst: true, omenEffect: "add_prefix", compatibleCurrencyIds: ["regal"], description: "下一次富豪石只会增加前缀。" },
  { id: "dextral_coronation_omen", name: "右旋加冕预兆", icon: "↷", category: "omen", enabled: true, catalyst: true, omenEffect: "add_suffix", compatibleCurrencyIds: ["regal"], description: "下一次富豪石只会增加后缀。" },
  { id: "homogenising_coronation_omen", name: "同质化加冕预兆", icon: "◎", category: "omen", enabled: true, catalyst: true, omenEffect: "add_matching_type", compatibleCurrencyIds: ["regal"], description: "下一次富豪石增加与装备现有词缀共享属性类型的词缀。" },
  { id: "greater_exaltation_omen", name: "强效崇高预兆", icon: "✹", category: "omen", enabled: true, catalyst: true, omenEffect: "add_two", compatibleCurrencyIds: ["exalted"], description: "下一次崇高石连续增加 2 条词缀；不足两个空位时不可使用。" },
  { id: "sinistral_exaltation_omen", name: "左旋崇高预兆", icon: "↶", category: "omen", enabled: true, catalyst: true, omenEffect: "add_prefix", compatibleCurrencyIds: ["exalted"], description: "下一次崇高石只会增加前缀。" },
  { id: "dextral_exaltation_omen", name: "右旋崇高预兆", icon: "↷", category: "omen", enabled: true, catalyst: true, omenEffect: "add_suffix", compatibleCurrencyIds: ["exalted"], description: "下一次崇高石只会增加后缀。" },
  { id: "homogenising_exaltation_omen", name: "同质化崇高预兆", icon: "◎", category: "omen", enabled: true, catalyst: true, omenEffect: "add_matching_type", compatibleCurrencyIds: ["exalted"], description: "下一次崇高石增加与装备现有词缀共享属性类型的词缀。" },
  { id: "greater_annulment_omen", name: "强效剥离预兆", icon: "✂", category: "omen", enabled: true, catalyst: true, omenEffect: "remove_two", compatibleCurrencyIds: ["annulment"], description: "下一次剥离石随机移除 2 条未锁定词缀。" },
  { id: "sinistral_omen", name: "左旋剥离预兆", icon: "↶", category: "omen", enabled: true, catalyst: true, omenEffect: "remove_prefix", compatibleCurrencyIds: ["annulment"], description: "下一次剥离石仅从前缀中随机移除。" },
  { id: "dextral_omen", name: "右旋剥离预兆", icon: "↷", category: "omen", enabled: true, catalyst: true, omenEffect: "remove_suffix", compatibleCurrencyIds: ["annulment"], description: "下一次剥离石仅从后缀中随机移除。" },
  { id: "sinistral_erasure_omen", name: "左旋消抹预兆", icon: "↶", category: "omen", enabled: true, catalyst: true, omenEffect: "remove_prefix", compatibleCurrencyIds: ["chaos"], description: "下一次混沌石仅移除一条前缀，再正常增加一条词缀。" },
  { id: "dextral_erasure_omen", name: "右旋消抹预兆", icon: "↷", category: "omen", enabled: true, catalyst: true, omenEffect: "remove_suffix", compatibleCurrencyIds: ["chaos"], description: "下一次混沌石仅移除一条后缀，再正常增加一条词缀。" },
  { id: "whittling_omen", name: "消减预兆", icon: "⌄", category: "omen", enabled: true, catalyst: true, omenEffect: "remove_lowest_level", compatibleCurrencyIds: ["chaos"], description: "下一次混沌石移除可出现物品等级最低的未锁定词缀；若并列则随机选择，再正常增加一条词缀。" },
  { id: "whetstone", name: "磨刀石", icon: "▰", category: "quality", enabled: true, description: "提升战斗武器品质；品质会提高武器基础属性，最高 20%。" },
  { id: "arcanists_etcher", name: "奥术师的铭刻", icon: "▱", category: "quality", enabled: false, description: "提升法杖、长杖或权杖品质。" },
  { id: "armour_scrap", name: "护甲片", icon: "▣", category: "quality", enabled: true, description: "提升四类防具品质；品质会提高防具基础属性，最高 20%。" },
  { id: "glassblowers_bauble", name: "玻璃弹珠", icon: "◒", category: "quality", enabled: false, description: "提升药剂品质。" },
  { id: "gemcutters_prism", name: "宝石匠的棱镜", icon: "◇", category: "quality", enabled: false, description: "提升技能宝石品质。" },
  { id: "lesser_jeweller", name: "低等工匠石", icon: "⬡", category: "socket", enabled: false, description: "使技能宝石拥有 3 个辅助插槽。" },
  { id: "greater_jeweller", name: "高等工匠石", icon: "⬡", category: "socket", enabled: false, description: "使技能宝石拥有 4 个辅助插槽。" },
  { id: "perfect_jeweller", name: "完美工匠石", icon: "⬡", category: "socket", enabled: false, description: "使技能宝石拥有 5 个辅助插槽。" },
  { id: "artificers_orb", name: "巧匠石", icon: "⬢", category: "socket", enabled: false, description: "为武器或护甲添加增幅器插槽。" },
  { id: "wisdom_scroll", name: "知识卷轴", icon: "▤", category: "special", enabled: false, description: "鉴定一件物品。" },
  { id: "chance", name: "机会石", icon: "?", category: "special", enabled: false, description: "尝试将普通物品升级为传奇物品，也可能摧毁它。" },
  { id: "mirror", name: "卡兰德的魔镜", icon: "◐", category: "special", enabled: true, serviceOperation: true, description: "复制一件指定物品；镜像副本不可再被修改。" },
  { id: "foretelling_braid", name: "辛格拉的发辫", icon: "〽", category: "special", enabled: true, serviceOperation: true, description: "让目标装备预示下一次通货操作的确定结果；下一次改造后预示消失。" },
  { id: "vaal", name: "瓦尔宝珠", icon: "◉", category: "special", enabled: true, description: "随机修改并腐化物品；腐化后不可继续基础打造。" },
  { id: "fracturing", name: "破溃宝珠", icon: "❖", category: "special", enabled: true, description: "分裂一件至少拥有 4 个词缀的稀有物品，永久锁定其中 1 个随机词缀。" },
  { id: "transmutation_shard", name: "蜕变石碎片", icon: "◌", category: "fragment", enabled: false, description: "集齐后合成为蜕变石。" },
  { id: "chance_shard", name: "机会石碎片", icon: "◌", category: "fragment", enabled: false, description: "集齐后合成为机会石。" },
  { id: "regal_shard", name: "富豪石碎片", icon: "◌", category: "fragment", enabled: false, description: "集齐后合成为富豪石。" },
  { id: "artificers_shard", name: "巧匠石碎片", icon: "◌", category: "fragment", enabled: false, description: "集齐后合成为巧匠石。" },
]);
export const VAAL_EQUIPMENT_OUTCOMES = deepFreeze([
  { id: "corrupt_only", name: "仅腐化", weight: 30, description: "装备变为已腐化，不产生额外显性变化。" },
  { id: "reroll_one_value", name: "重掷一条词缀数值", weight: 25, description: "随机 1 条未锁定词缀在原有数值区间内重新取值。" },
  { id: "add_corrupted_implicit", name: "获得腐化固有属性", weight: 20, description: "获得 1 条与装备类型匹配的腐化固有属性；具体数值随物品等级变化。" },
  { id: "scale_explicit_values", name: "扭曲显性词缀", weight: 15, description: "随机改变全部未锁定普通属性词缀，最终数值为原值的 70%～130%。" },
  { id: "replace_one_affix", name: "替换一条词缀", weight: 10, description: "移除 1 条未锁定词缀并增加 1 条随机词缀，词缀总数不变。" },
]);
export const RARITY_META = deepFreeze({
  normal: { name: "普通", color: "#f4f1e8", rank: 0, affixCount: 0 }, magic: { name: "魔法", color: "#63a9ff", rank: 1, affixCount: 2 },
  rare: { name: "稀有", color: "#f4c84b", rank: 2, affixCount: 6 }, unique: { name: "暗金", color: "#d98235", rank: 3, affixCount: 0 },
});

const SLOT_LABELS = Object.freeze({ head: "头部", chest: "胸甲", hands: "手部", feet: "脚部", neck: "项链", ring_left: "左戒", ring_right: "右戒" });
const TIER_ROWS = deepFreeze([
  { tier: 9, minimumItemLevel: 1, weight: 1200, power: .38 }, { tier: 8, minimumItemLevel: 11, weight: 1000, power: .52 },
  { tier: 7, minimumItemLevel: 22, weight: 820, power: .68 }, { tier: 6, minimumItemLevel: 33, weight: 640, power: .84 },
  { tier: 5, minimumItemLevel: 44, weight: 470, power: 1.02 }, { tier: 4, minimumItemLevel: 55, weight: 310, power: 1.23 },
  { tier: 3, minimumItemLevel: 66, weight: 180, power: 1.45 }, { tier: 2, minimumItemLevel: 74, weight: 75, power: 1.68 },
  { tier: 1, minimumItemLevel: 81, weight: 25, power: 1.90 },
]);

function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function integer(value, name, minimum = 1, maximum = 100) { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be ${minimum}-${maximum}`); return value; }
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
function skillAffix(id, name, kind, modGroup, operation, selectorTag, options = {}) {
  return {
    id, name, kind, family: id, modGroup, statId: null, bucket: null,
    scope: MOD_SCOPE.GLOBAL, operation: "skill_modifier", unit: "count",
    domains: options.domains ?? ["accessory", "weapon"],
    slots: options.slots ?? [...ACCESSORY_SLOTS, "weapon"], requiredTags: [],
    rollEnabled: options.rollEnabled ?? true,
    skillModifier: { operation, selector: { skillAll: [selectorTag] } },
    tiers: TIER_ROWS.map((row) => ({
      tier: row.tier, minimumItemLevel: row.minimumItemLevel, weight: row.weight,
      minimum: options.valueForTier?.(row.tier) ?? 1,
      maximum: options.valueForTier?.(row.tier) ?? 1,
    })),
  };
}
function weaponSkillAffix() {
  return {
    id: "weapon_skill_bundle", name: "武器技艺", kind: "prefix", family: "weapon_skill_bundle", modGroup: "weapon_skills",
    statId: null, bucket: null, scope: MOD_SCOPE.LOCAL, operation: "grant_weapon_skills", unit: "count",
    domains: ["weapon"], slots: ["weapon"], requiredTags: [], rollEnabled: true,
    tiers: TIER_ROWS.map((row) => ({ ...row, minimum: 1, maximum: 5 })),
  };
}
const AFFIX_DEFINITIONS = deepFreeze([
  affix("vigorous", "健壮", "prefix", "life", "maxHp", "equipmentBase", 58), affix("brutal", "残暴", "prefix", "physical_attack_flat", "physicalAttack", "equipmentBase", 10, { domains: ["armor", "accessory"] }),
  affix("arcane", "奥秘", "prefix", "magic_attack_flat", "magicAttack", "equipmentBase", 10), affix("armored", "坚甲", "prefix", "physical_defense_flat", "physicalDefense", "equipmentBase", 18, { domains: ["armor"], slots: ARMOR_SLOTS }),
  affix("reservoir", "充盈", "prefix", "resource", "maxResource", "equipmentBase", 18, { domains: ["accessory"], slots: ACCESSORY_SLOTS }), affix("local_heavy", "沉重", "prefix", "local_physical_flat", "physicalAttack", "equipmentBase", 16, { domains: ["weapon"], slots: ["weapon"], scope: MOD_SCOPE.LOCAL, requiredTags: ["attack"] }),
  affix("local_tempered", "精炼", "prefix", "local_physical_percent", "physicalAttack", "basePercent", .14, { domains: ["weapon"], slots: ["weapon"], scope: MOD_SCOPE.LOCAL, operation: MOD_OPERATION.INCREASED, unit: "percent", precision: 3, requiredTags: ["attack"] }),
  affix("swift", "迅捷", "suffix", "attack_speed", "attackSpeedRating", "equipmentBase", 18), affix("precise", "精准", "suffix", "accuracy", "accuracy", "equipmentBase", 24),
  affix("fortunate", "幸运", "suffix", "critical", "critRating", "equipmentBase", 20, { domains: ["accessory", "weapon"], slots: [...ACCESSORY_SLOTS, "weapon"] }), affix("warded", "护佑", "suffix", "magic_defense", "magicDefense", "equipmentBase", 22),
  affix("fleet", "疾行", "suffix", "movement", "movementSpeedRating", "equipmentBase", 16, { domains: ["armor"], slots: ["feet"] }), affix("accelerated", "咏速", "suffix", "haste", "hasteRating", "equipmentBase", 18),
  affix("local_quickness", "利落", "suffix", "local_attack_speed", "attackSpeedRating", "equipmentBase", 22, { domains: ["weapon"], slots: ["weapon"], scope: MOD_SCOPE.LOCAL, requiredTags: ["attack"] }),
  skillAffix("projectile_skill_level", "贯星", "prefix", "projectile_skill_level", SKILL_AFFIX_OPERATION.ADD_SKILL_LEVEL, "PROJECTILE", { valueForTier: (tier) => tier <= 3 ? 2 : 1 }),
  skillAffix("fire_skill_level", "焰脉", "prefix", "fire_skill_level", SKILL_AFFIX_OPERATION.ADD_SKILL_LEVEL, "FIRE", { valueForTier: (tier) => tier <= 3 ? 2 : 1 }),
  skillAffix("melee_skill_level", "斗勇", "prefix", "melee_skill_level", SKILL_AFFIX_OPERATION.ADD_SKILL_LEVEL, "MELEE", { domains: ["weapon"], slots: ["weapon"], valueForTier: (tier) => tier <= 3 ? 2 : 1 }),
  skillAffix("physical_skill_level", "刚烈", "prefix", "physical_skill_level", SKILL_AFFIX_OPERATION.ADD_SKILL_LEVEL, "PHYSICAL", { domains: ["weapon"], slots: ["weapon"], valueForTier: (tier) => tier <= 3 ? 2 : 1 }),
  skillAffix("area_skill_level", "扩境", "prefix", "area_skill_level", SKILL_AFFIX_OPERATION.ADD_SKILL_LEVEL, "AREA", { domains: ["weapon"], slots: ["weapon"], valueForTier: (tier) => tier <= 3 ? 2 : 1 }),
  skillAffix("weapon_skill_level", "传承", "prefix", "weapon_skill_level", SKILL_AFFIX_OPERATION.ADD_SKILL_LEVEL, "WEAPON_SKILL", { domains: ["weapon"], slots: ["weapon"], valueForTier: (tier) => tier <= 3 ? 2 : 1 }),
  skillAffix("additional_projectile", "分裂", "suffix", "additional_projectile", SKILL_AFFIX_OPERATION.ADD_PROJECTILE_COUNT, "PROJECTILE", { valueForTier: (tier) => tier === 1 ? 2 : 1 }),
  weaponSkillAffix(),
  // 召唤运行协议尚未拥有正式技能；保留在权威词缀目录，但在召唤 Action 落地前不进入随机掉落池。
  skillAffix("additional_summon", "统御", "prefix", "additional_summon", SKILL_AFFIX_OPERATION.ADD_SUMMON_COUNT, "SUMMON", { rollEnabled: false, domains: ["accessory"], slots: ACCESSORY_SLOTS }),
]);
const UNIQUE_DEFINITIONS = deepFreeze({ chest: { namePrefix: "逐日者的", fixed: [["vigorous", 3], ["armored", 3], ["warded", 4]] }, weapon: { namePrefix: "晨曦誓约·", fixed: [["local_heavy", 3], ["local_tempered", 3], ["local_quickness", 4]] } });

export function resolveMonsterLevel(input = {}) { if ((input.mode ?? MAP_LEVEL_MODE.FIXED) === MAP_LEVEL_MODE.FIXED) return integer(input.mapLevel, "mapLevel"); if (input.mode === MAP_LEVEL_MODE.DYNAMIC) return integer(input.playerLevel, "playerLevel"); throw new Error(`unknown map level mode ${input.mode}`); }
export function unlockedAffixTier(itemLevel) { integer(itemLevel, "itemLevel"); return TIER_ROWS.filter((row) => row.minimumItemLevel <= itemLevel).at(-1).tier; }
export function eligibleAffixTiers(definitionOrId, itemLevel) { integer(itemLevel, "itemLevel"); const definition = typeof definitionOrId === "string" ? AFFIX_DEFINITIONS.find((entry) => entry.id === definitionOrId) : definitionOrId; if (!definition) throw new Error(`unknown affix definition ${definitionOrId}`); return definition.tiers.filter((tier) => tier.minimumItemLevel <= itemLevel); }
function chooseBase(slot, itemLevel, rng, requiredTag = null) { let entries = BASE_ITEM_DEFINITIONS.filter((entry) => entry.slot === slot && entry.dropLevel <= itemLevel && (!requiredTag || entry.tags.includes(requiredTag))); if (!entries.length) entries = BASE_ITEM_DEFINITIONS.filter((entry) => entry.slot === slot && entry.dropLevel <= itemLevel); const top = Math.max(...entries.map((item) => item.dropLevel)); return weightedPick(entries, rng, (entry) => entry.spawnWeight * (entry.dropLevel === top ? 2.2 : 1)); }
function matchesAffix(definition, domain, slot, tags) { return definition.domains.includes(domain) && definition.slots.includes(slot) && definition.requiredTags.every((tag) => tags.includes(tag)); }
function currencyEligibleTiers(definition, itemLevel, minimumModifierLevel = 0) { const itemEligible = eligibleAffixTiers(definition, itemLevel), preferred = itemEligible.filter((tier) => tier.minimumItemLevel >= minimumModifierLevel); return preferred.length ? preferred : itemEligible.length ? [itemEligible.at(-1)] : []; }
function rollAffix(definition, itemLevel, rng, highAttribute, forcedTier = null, minimumModifierLevel = 0) { const eligible = currencyEligibleTiers(definition, itemLevel, minimumModifierLevel); if (!eligible.length) throw Object.assign(new Error("affix family has no tier available at the item level"), { code: "NO_ELIGIBLE_AFFIX_TIER" }); const row = forcedTier === null ? weightedPick(eligible, rng, (tier) => tier.weight * (highAttribute ? (10 - tier.tier) ** 1.7 : 1)) : eligible.find((tier) => tier.tier === forcedTier) ?? eligible.at(-1); const value = row.minimum + rng.nextFloat() * (row.maximum - row.minimum); return { id: definition.id, name: definition.name, kind: definition.kind, family: definition.family, modGroup: definition.modGroup, statId: definition.statId, bucket: definition.bucket, scope: definition.scope, operation: definition.operation, unit: definition.unit, ...(definition.skillModifier ? { skillModifier: definition.skillModifier } : {}), tier: row.tier, minimumItemLevel: row.minimumItemLevel, weight: row.weight, minimum: row.minimum, maximum: row.maximum, value: roundValue(value, definition.unit === "percent" ? 3 : 0) }; }
function rollAffixes({ domain, slot, tags, rarity, itemLevel, rng, highAttribute }) { const desired = RARITY_META[rarity].affixCount; if (!desired) return []; const perSide = rarity === ITEM_RARITY.MAGIC ? 1 : 3; const definitions = AFFIX_DEFINITIONS.filter((entry) => entry.rollEnabled !== false && matchesAffix(entry, domain, slot, tags)); const selected = []; const groups = new Set(); for (const kind of ["prefix", "suffix"]) while (selected.filter((entry) => entry.kind === kind).length < perSide) { const candidates = definitions.filter((entry) => entry.kind === kind && !groups.has(entry.modGroup)); if (!candidates.length) break; const definition = weightedPick(candidates, rng, (entry) => eligibleAffixTiers(entry, itemLevel).reduce((sum, tier) => sum + tier.weight, 0)); groups.add(definition.modGroup); selected.push(rollAffix(definition, itemLevel, rng, highAttribute)); } return selected.slice(0, desired); }
function fixedUniqueAffixes(slot, itemLevel, rng) { const template = UNIQUE_DEFINITIONS[slot] ?? UNIQUE_DEFINITIONS.chest; return template.fixed.map(([id, tier]) => rollAffix(AFFIX_DEFINITIONS.find((entry) => entry.id === id), itemLevel, rng, true, tier)); }
function makeBaseStats(definition) { return definition.baseStats.map(([statId, value]) => ({ statId, value, bucket: "equipmentBase", scope: definition.slot === "weapon" ? MOD_SCOPE.LOCAL : MOD_SCOPE.GLOBAL, operation: MOD_OPERATION.FLAT })); }
function makeItemName(definition, rarity) { const unique = UNIQUE_DEFINITIONS[definition.slot === "weapon" ? "weapon" : definition.slot] ?? UNIQUE_DEFINITIONS.chest; return rarity === ITEM_RARITY.UNIQUE ? `${unique.namePrefix}${definition.name}` : definition.name; }

function weaponSkillPool(subtype) { return subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? ["two_handed_sword_aura_blade", "two_handed_sword_breaker", "two_handed_sword_guard", "two_handed_sword_execution", "mount"] : ["shield_bash", "guard_followup", "sword_shield_combo", "block_counter", "hold_the_line"]; }
function itemAffixContext(item) { return { domain: item.category === ITEM_CATEGORY.WEAPON ? "weapon" : item.subtype, slot: item.category === ITEM_CATEGORY.WEAPON ? "weapon" : item.slot, tags: item.baseTags ?? [] }; }
function syncWeaponSkillPrefix(item, rng) {
  if (item.category !== ITEM_CATEGORY.WEAPON) return { ...item };
  const affixes = (item.affixes ?? []).map((entry) => ({ ...entry }));
  const index = affixes.findIndex((entry) => entry.operation === "grant_weapon_skills");
  if (index < 0) return { ...item, affixes, rolledWeaponSkills: [], rolledWeaponSkillDefinitionIds: [] };
  const pool = weaponSkillPool(item.subtype); const existing = affixes[index].weaponSkillDefinitionIds?.filter((id) => pool.includes(id)) ?? [];
  const count = Math.max(1, Math.min(5, existing.length || (1 + Math.floor(rng.nextFloat() * Math.min(5, pool.length)))));
  const ids = existing.length ? existing.slice(0, count) : shuffle(pool, rng).slice(0, count);
  affixes[index] = { ...affixes[index], value: ids.length, minimum: 1, maximum: 5, weaponSkillDefinitionIds: ids };
  return { ...item, affixes, rolledWeaponSkills: ids, rolledWeaponSkillDefinitionIds: ids };
}
function craftingDefinition(id) { return CRAFTING_CURRENCIES.find((entry) => entry.id === id); }
function baseCurrencyId(id) { return String(id).replace(/^(greater|perfect)_/, ""); }
function craftFailure(code, message) { throw Object.assign(new Error(message), { code }); }
const MODIFIER_TYPE_TAGS = Object.freeze({
  life: ["life"], physical_attack_flat: ["physical", "attack"], local_physical_flat: ["physical", "attack"], local_physical_percent: ["physical", "attack"],
  magic_attack_flat: ["magic", "attack"], physical_defense_flat: ["physical", "defense"], magic_defense: ["magic", "defense"], resource: ["resource"],
  attack_speed: ["attack", "speed"], local_attack_speed: ["attack", "speed"], accuracy: ["attack", "accuracy"], critical: ["critical"], movement: ["movement", "speed"], haste: ["cast", "speed"],
  projectile_skill_level: ["projectile", "skill"], additional_projectile: ["projectile", "skill"], fire_skill_level: ["fire", "skill"], melee_skill_level: ["melee", "skill"], physical_skill_level: ["physical", "skill"], area_skill_level: ["area", "skill"], weapon_skill_level: ["weapon", "skill"], additional_summon: ["summon", "skill"], weapon_skills: ["weapon", "skill"],
});
function modifierTypeTags(entry) { return MODIFIER_TYPE_TAGS[entry.modGroup] ?? [entry.modGroup]; }
function nextCraftAffix(item, affixes, rng, minimumModifierLevel = 0, constraints = {}) {
  const context = itemAffixContext(item), groups = new Set(affixes.map((entry) => entry.modGroup));
  const prefixCount = affixes.filter((entry) => entry.kind === "prefix").length, suffixCount = affixes.filter((entry) => entry.kind === "suffix").length;
  const matchingTypes = constraints.matchingTypes ? new Set(constraints.matchingTypes) : null;
  const candidates = AFFIX_DEFINITIONS.filter((entry) => entry.rollEnabled !== false && matchesAffix(entry, context.domain, context.slot, context.tags) && !groups.has(entry.modGroup) && (!constraints.kind || entry.kind === constraints.kind) && (!matchingTypes || modifierTypeTags(entry).some((tag) => matchingTypes.has(tag))) && (entry.kind === "prefix" ? prefixCount < 3 : suffixCount < 3) && currencyEligibleTiers(entry, item.itemLevel, minimumModifierLevel).length);
  if (!candidates.length) craftFailure("NO_ELIGIBLE_AFFIX", "item has no eligible affix for this operation");
  const definition = weightedPick(candidates, rng, (entry) => currencyEligibleTiers(entry, item.itemLevel, minimumModifierLevel).reduce((sum, tier) => sum + tier.weight, 0));
  return rollAffix(definition, item.itemLevel, rng, false, null, minimumModifierLevel);
}
function addCraftAffixes(item, affixes, count, rng, minimumModifierLevel = 0) { const result = [...affixes]; while (result.length < count) result.push(nextCraftAffix(item, result, rng, minimumModifierLevel)); return result; }
function omenAddConstraints(catalysts, affixes) {
  const effects = new Set(catalysts.map((entry) => entry.omenEffect)), constraints = {};
  if (effects.has("add_prefix")) constraints.kind = "prefix";
  if (effects.has("add_suffix")) constraints.kind = "suffix";
  if (effects.has("add_matching_type")) constraints.matchingTypes = [...new Set(affixes.flatMap(modifierTypeTags))];
  return constraints;
}
function addAlchemyAffixes(item, affixes, rng, minimumModifierLevel, catalysts) {
  const result = [...affixes];
  const effects = new Set(catalysts.map((entry) => entry.omenEffect));
  const targetKind = effects.has("alchemy_max_prefixes") ? "prefix" : effects.has("alchemy_max_suffixes") ? "suffix" : null;
  while (result.length < 4) {
    const targetCount = targetKind ? result.filter((entry) => entry.kind === targetKind).length : 0;
    const desiredTargetCount = targetKind ? 3 : 0;
    result.push(nextCraftAffix(item, result, rng, minimumModifierLevel, targetKind && targetCount < desiredTargetCount ? { kind: targetKind } : {}));
  }
  return result;
}
function rerollAffixValue(affix, rng) { const value = affix.minimum + rng.nextFloat() * (affix.maximum - affix.minimum); return { ...affix, value: roundValue(value, affix.unit === "percent" ? 3 : 0) }; }
function removableAffixEntries(affixes, kind = null) { return affixes.map((entry, index) => ({ entry, index })).filter(({ entry }) => !entry.fractured && (!kind || entry.kind === kind)); }

export function affixPoolForItem(item) {
  const context = itemAffixContext(item);
  return deepFreeze(AFFIX_DEFINITIONS.filter((entry) => entry.rollEnabled !== false && matchesAffix(entry, context.domain, context.slot, context.tags)).map((definition) => ({ ...definition, tiers: eligibleAffixTiers(definition, item.itemLevel) })));
}

export function craftItemWithCurrency(input = {}) {
  if (input.catalystIds != null && !Array.isArray(input.catalystIds)) craftFailure("INVALID_OMEN_LIST", "catalystIds must be an array");
  const rawCatalystIds = input.catalystIds ?? (input.catalystId ? [input.catalystId] : []);
  if (rawCatalystIds.some((id) => typeof id !== "string") || new Set(rawCatalystIds).size !== rawCatalystIds.length) craftFailure("INVALID_OMEN_LIST", "omen ids must be unique strings");
  const item = structuredClone(input.item), currency = craftingDefinition(input.currencyId), catalystIds = [...rawCatalystIds], catalysts = catalystIds.map(craftingDefinition);
  if (!item?.instanceId) craftFailure("INVALID_CRAFT_ITEM", "craft target is required");
  if (!currency || !currency.enabled || currency.catalyst) craftFailure("CURRENCY_NOT_USABLE", "currency is not enabled for direct crafting");
  if (catalysts.some((entry) => !entry || !entry.enabled || !entry.catalyst)) craftFailure("OMEN_NOT_USABLE", "selected omen is not enabled");
  if (item.mirrored) craftFailure("ITEM_MIRRORED", "mirrored items cannot be modified");
  if (item.corrupted) craftFailure("ITEM_CORRUPTED", "corrupted items cannot be modified again");
  if (catalysts.some((entry) => !entry.compatibleCurrencyIds.includes(baseCurrencyId(currency.id)))) craftFailure("CATALYST_NOT_COMPATIBLE", "selected omen does not modify this currency");
  const omenGroups = catalysts.map((entry) => entry.omenEffect.startsWith("alchemy_") ? "alchemy_side" : ["add_prefix", "add_suffix"].includes(entry.omenEffect) ? "add_side" : ["remove_prefix", "remove_suffix"].includes(entry.omenEffect) ? "remove_side" : entry.omenEffect);
  if (new Set(omenGroups).size !== omenGroups.length) craftFailure("OMEN_COMBINATION_CONFLICT", "selected omens contain conflicting effects");
  if ((currency.minimumModifierLevel ?? 0) > item.itemLevel) craftFailure("CURRENCY_LEVEL_REQUIREMENT", `item level must be at least ${currency.minimumModifierLevel}`);
  const rng = createSeededRng(hashSeed(String(input.serverSeed ?? `${item.instanceId}:${item.version}:${currency.id}`))), operation = baseCurrencyId(currency.id), minimumModifierLevel = currency.minimumModifierLevel ?? 0;
  let rarity = item.rarity, affixes = [...(item.affixes ?? [])], quality = item.quality ?? 0, corrupted = false, implicitAffixes = [...(item.implicitAffixes ?? [])], craftDelta = null;
  if (!["whetstone", "armour_scrap", "vaal"].includes(operation) && rarity === ITEM_RARITY.UNIQUE) craftFailure("ITEM_NOT_CRAFTABLE", "unique items cannot use base affix crafting");
  if (operation === "whetstone" || operation === "armour_scrap") { const valid = operation === "whetstone" ? item.category === ITEM_CATEGORY.WEAPON : item.category === ITEM_CATEGORY.EQUIPMENT && item.subtype === "armor"; if (!valid) craftFailure("QUALITY_TARGET_MISMATCH", "quality currency does not match this item type"); if (quality >= 20) craftFailure("QUALITY_AT_MAXIMUM", "item quality is already 20%"); quality = Math.min(20, quality + (rarity === ITEM_RARITY.NORMAL ? 5 : rarity === ITEM_RARITY.MAGIC ? 2 : 1)); }
  else if (operation === "vaal") {
    corrupted = true;
    const outcome = weightedPick(VAAL_EQUIPMENT_OUTCOMES, rng);
    const removable = removableAffixEntries(affixes);
    if (outcome.id === "reroll_one_value" && removable.length) {
      const target = removable[Math.floor(rng.nextFloat() * removable.length)]; affixes[target.index] = rerollAffixValue(target.entry, rng);
    } else if (outcome.id === "add_corrupted_implicit") {
      const statId = item.category === ITEM_CATEGORY.WEAPON ? "physicalAttack" : "maxHp", value = Math.max(1, Math.round(item.itemLevel * (0.18 + rng.nextFloat() * 0.12)));
      implicitAffixes.push({ id: `corrupted_${statId}`, name: "腐化之力", kind: "implicit", statId, bucket: "equipmentBase", scope: item.category === ITEM_CATEGORY.WEAPON ? MOD_SCOPE.LOCAL : MOD_SCOPE.GLOBAL, operation: MOD_OPERATION.FLAT, unit: "flat", minimum: value, maximum: value, value });
    } else if (outcome.id === "scale_explicit_values") {
      const factor = .7 + rng.nextFloat() * .6;
      affixes = affixes.map((entry) => entry.fractured || !entry.statId ? entry : { ...entry, value: roundValue(entry.value * factor, entry.unit === "percent" ? 3 : 0), corruptedScale: roundValue(factor, 3) });
    } else if (outcome.id === "replace_one_affix" && removable.length) {
      const target = removable[Math.floor(rng.nextFloat() * removable.length)], removedAffix = affixes.splice(target.index, 1)[0], addedAffix = nextCraftAffix(item, affixes, rng);
      affixes.push(addedAffix); craftDelta = { kind: "replace_one_affix", affixCountBefore: item.affixes.length, affixCountAfter: affixes.length, removedAffix, addedAffix };
    }
    craftDelta = { ...(craftDelta ?? {}), kind: craftDelta?.kind ?? "vaal_outcome", vaalOutcomeId: outcome.id, vaalOutcomeName: outcome.name };
  }
  else if (operation === "transmutation") { if (rarity !== ITEM_RARITY.NORMAL) craftFailure("RARITY_MISMATCH", "transmutation requires a normal item"); rarity = ITEM_RARITY.MAGIC; affixes = addCraftAffixes(item, [], 1, rng, minimumModifierLevel); }
  else if (operation === "augmentation") { if (rarity !== ITEM_RARITY.MAGIC || affixes.length >= 2) craftFailure("RARITY_MISMATCH", "augmentation requires a magic item with an open affix"); affixes.push(nextCraftAffix(item, affixes, rng, minimumModifierLevel)); }
  else if (operation === "regal") { if (rarity !== ITEM_RARITY.MAGIC) craftFailure("RARITY_MISMATCH", "regal requires a magic item"); rarity = ITEM_RARITY.RARE; affixes.push(nextCraftAffix(item, affixes, rng, minimumModifierLevel, omenAddConstraints(catalysts, affixes))); }
  else if (operation === "alchemy") { if (![ITEM_RARITY.NORMAL, ITEM_RARITY.MAGIC].includes(rarity)) craftFailure("RARITY_MISMATCH", "alchemy requires a normal or magic item"); rarity = ITEM_RARITY.RARE; affixes = addAlchemyAffixes(item, affixes, rng, minimumModifierLevel, catalysts); }
  else if (operation === "exalted") {
    const addCount = catalysts.some((entry) => entry.omenEffect === "add_two") ? 2 : 1;
    if (rarity !== ITEM_RARITY.RARE || affixes.length + addCount > 6) craftFailure("RARITY_MISMATCH", `exalted requires a rare item with ${addCount} open affix slot(s)`);
    for (let index = 0; index < addCount; index += 1) affixes.push(nextCraftAffix(item, affixes, rng, minimumModifierLevel, omenAddConstraints(catalysts, affixes)));
  }
  else if (operation === "annulment") {
    if (!affixes.length) craftFailure("NO_AFFIX_TO_REMOVE", "item has no affix to remove");
    const effects = new Set(catalysts.map((entry) => entry.omenEffect));
    const removeCount = effects.has("remove_two") ? 2 : 1, kind = effects.has("remove_prefix") ? "prefix" : effects.has("remove_suffix") ? "suffix" : null;
    const removedAffixes = [];
    for (let index = 0; index < removeCount; index += 1) { const candidates = removableAffixEntries(affixes, kind); if (!candidates.length) craftFailure("OMEN_TARGET_EMPTY", "the selected omen has no removable matching affix"); removedAffixes.push(affixes.splice(candidates[Math.floor(rng.nextFloat() * candidates.length)].index, 1)[0]); }
    craftDelta = { kind: "remove_affixes", removedAffixes };
  }
  else if (operation === "chaos") {
    if (rarity !== ITEM_RARITY.RARE || !affixes.length) craftFailure("RARITY_MISMATCH", "chaos requires a rare item with affixes");
    const effects = new Set(catalysts.map((entry) => entry.omenEffect));
    const kind = effects.has("remove_prefix") ? "prefix" : effects.has("remove_suffix") ? "suffix" : null;
    let removable = removableAffixEntries(affixes, kind); if (!removable.length) craftFailure("NO_AFFIX_TO_REMOVE", "item has no removable affix matching this omen");
    if (effects.has("remove_lowest_level")) { const lowestLevel = Math.min(...removable.map(({ entry }) => entry.minimumItemLevel ?? 1)); removable = removable.filter(({ entry }) => (entry.minimumItemLevel ?? 1) === lowestLevel); }
    const removedAffix = affixes.splice(removable[Math.floor(rng.nextFloat() * removable.length)].index, 1)[0];
    const addedAffix = nextCraftAffix(item, affixes, rng, minimumModifierLevel);
    affixes.push(addedAffix);
    craftDelta = { kind: "replace_one_affix", affixCountBefore: item.affixes.length, affixCountAfter: affixes.length, removedAffix, addedAffix };
  }
  else if (operation === "divine") { if (!affixes.length) craftFailure("NO_AFFIX_TO_REROLL", "item has no affix values to reroll"); affixes = affixes.map((entry) => entry.fractured || entry.operation === "grant_weapon_skills" ? entry : rerollAffixValue(entry, rng)); }
  else if (operation === "fracturing") {
    if (rarity !== ITEM_RARITY.RARE || affixes.length < 4) craftFailure("FRACTURE_REQUIREMENT", "fracturing requires a rare item with at least four affixes");
    if (affixes.some((entry) => entry.fractured)) craftFailure("ITEM_ALREADY_FRACTURED", "item already has a fractured affix");
    const index = Math.floor(rng.nextFloat() * affixes.length); affixes[index] = { ...affixes[index], fractured: true };
    craftDelta = { kind: "fracture_affix", fracturedAffix: affixes[index] };
  }
  else craftFailure("CURRENCY_NOT_IMPLEMENTED", "currency has no base-affix implementation");
  affixes = [...affixes.filter((entry) => entry.kind === "prefix"), ...affixes.filter((entry) => entry.kind === "suffix")];
  const crafted = syncWeaponSkillPrefix({ ...item, rarity, affixes, implicitAffixes, quality, corrupted, version: (item.version ?? 1) + 1, craftHistory: [...(item.craftHistory ?? []), { currencyId: currency.id, catalystId: catalystIds[0] ?? null, catalystIds, resultingRarity: rarity, resultingAffixCount: affixes.length, resultingQuality: quality, corrupted, ...(craftDelta ? { delta: craftDelta } : {}) }] }, rng);
  return deepFreeze(crafted);
}

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
    const skillCardSocketCount = 1 + Math.floor(rng.nextFloat() * 5), grantedSkill = rng.nextFloat() < .58 ? { instanceId: `gift-skill-${hashSeed(`${seed}:gift`).toString(16)}`, definitionId: subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? "two_handed_sword_slash" : "shield_bash", name: subtype === WEAPON_SUBTYPE.TWO_HANDED_SWORD ? "斩击" : "盾击", skillLevel: Math.min(10, Math.max(1, Math.ceil(monsterLevel / 6))), detachable: true, socketIndex: Math.floor(rng.nextFloat() * skillCardSocketCount) } : null;
    const weapon = syncWeaponSkillPrefix({ kind: "LootWeaponInstance", schemaVersion: ITEMIZATION_SCHEMA_VERSION, category, subtype, instanceId: `loot-weapon-${hashSeed(`${seed}:${subtype}`).toString(16)}`, baseDefinitionId: definition.id, baseTags: definition.tags, name: makeItemName(definition, rarity), icon: definition.icon, rarity, itemLevel: monsterLevel, requiredLevel: Math.max(definition.requiredLevel, ...affixes.map((entry) => entry.minimumItemLevel), 1), baseStats: makeBaseStats(definition), affixes, skillCardSocketCount, supportSocketsPerSkill: 3, grantedSocketedSkillCard: grantedSkill, quality: 0, corrupted: false, craftHistory: [], version: 1, dropSource: { monsterLevel, mapId: input.mapId ?? null, encounterId: input.encounterId ?? null } }, rng);
    return deepFreeze(weapon);
  }
  throw new Error(`unknown loot category ${category}`);
}
export function aggregateEquipmentBonuses(items = []) {
  const derived = { equipmentBase: {}, basePercent: {}, extra: {} }, provenance = [], skillModifiers = [];
  for (const item of items.filter(Boolean)) {
    const qualityBaseStats = effectiveBaseStatsForItem(item);
    const stats = [...qualityBaseStats, ...(item.implicitAffixes ?? []), ...(item.affixes ?? [])];
    const localFlat = {}, localIncreased = {};
    for (const stat of stats) {
      if (stat.operation === "grant_weapon_skills") {
        provenance.push({ sourceKind: "weapon_skill_affix", sourceId: item.instanceId, sourceName: item.name, statId: "weaponSkills", bucket: "weaponSkill", amount: stat.value, tier: stat.tier ?? 0, scope: MOD_SCOPE.LOCAL, modGroup: stat.modGroup });
        continue;
      }
      if (stat.skillModifier) {
        skillModifiers.push({
          id: `${item.instanceId}:${stat.id}`,
          sourceItemInstanceId: item.instanceId,
          sourceItemName: item.name,
          sourceAffixId: stat.id,
          sourceAffixName: stat.name,
          selector: structuredClone(stat.skillModifier.selector),
          operation: stat.skillModifier.operation,
          value: stat.value,
          tier: stat.tier,
        });
        provenance.push({ sourceKind: "equipment_skill_affix", sourceId: item.instanceId, sourceName: item.name, statId: stat.skillModifier.operation, bucket: "skillModifier", amount: stat.value, tier: stat.tier ?? 0, scope: MOD_SCOPE.GLOBAL, modGroup: stat.modGroup ?? null });
        continue;
      }
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
  return deepFreeze({ derived, provenance, skillModifiers });
}
export function effectiveBaseStatsForItem(item) { const qualityMultiplier = 1 + Math.max(0, Math.min(20, item?.quality ?? 0)) / 100; return deepFreeze((item?.baseStats ?? []).map((stat) => ({ ...stat, baseValue: stat.value, value: roundValue(stat.value * qualityMultiplier, 3), qualityAdjusted: qualityMultiplier > 1, qualityMultiplier }))); }
export const itemizationCatalog = deepFreeze({ bases: BASE_ITEM_DEFINITIONS, affixes: AFFIX_DEFINITIONS, tiers: TIER_ROWS, slotLabels: SLOT_LABELS });
