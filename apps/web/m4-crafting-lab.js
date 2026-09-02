import { CRAFTING_CURRENCIES, ITEM_CATEGORY, RARITY_META, affixPoolForItem, effectiveBaseStatsForItem } from "../../packages/itemization-core/src/index.js";
import { currentLoadoutSnapshot } from "./loadout-authority.js?v=m4c-closure-3";

const $ = (id) => document.getElementById(id);
const CATEGORY_META = Object.freeze({
  basic: ["基础塑形", "升阶与增加词缀"], targeted: ["重铸定向", "移除、替换与重掷"], quality: ["品质强化", "武器、防具与宝石品质"],
  socket: ["插槽加工", "技能与装备插槽"], special: ["特殊改造", "复制、腐化与传奇"], fragment: ["碎片", "合成类材料"],
});
const STAT_LABELS = { physicalAttack: "物理攻击", magicAttack: "魔法攻击", maxHp: "最大生命", maxResource: "最大资源", physicalDefense: "物理防御", magicDefense: "魔法防御", accuracy: "命中", critRating: "暴击评级", attackSpeedRating: "攻击速度评级", hasteRating: "施法加速评级", movementSpeedRating: "遇敌速度评级", weaponSkills: "武器技能" };
const MODIFIER_LABELS = Object.freeze({
  life: "最大生命", physical_attack_flat: "物理攻击", magic_attack_flat: "魔法攻击", physical_defense_flat: "物理防御",
  resource: "最大资源", local_physical_flat: "武器基础物理攻击", local_physical_percent: "武器物理攻击提高",
  attack_speed: "攻击速度", accuracy: "命中", critical: "暴击", magic_defense: "魔法防御", movement: "遇敌速度", haste: "施法加速",
  local_attack_speed: "武器攻击速度", projectile_skill_level: "投射物技能等级", fire_skill_level: "火焰技能等级",
  additional_projectile: "额外投射物数量", additional_summon: "额外召唤物数量", weapon_skills: "随机武器技能",
});
const SKILL_NAME = () => Object.fromEntries(Object.values(currentLoadoutSnapshot().ownershipInput.registry.skills).map((entry) => [entry.id, entry.name]));
let targetFilter = "all", currencyCategory = "basic", selectedItemId = null, selectedCurrencyId = null, selectedCatalystId = null;

function api() { return window.__INF_IDLE_EQUIPMENT_API__; }
function snapshot() { return api()?.snapshot?.() ?? null; }
function rarityName(item) { return RARITY_META[item.rarity]?.name ?? item.rarity; }
function formatValue(value, unit) { return unit === "percent" ? `${Math.round(value * 100)}%` : String(Math.round(value * 1000) / 1000); }
function itemMeta(item) { return `${rarityName(item)} · 物品 Lv.${item.itemLevel}${item.quality ? ` · 品质 ${item.quality}%` : ""}${item.corrupted ? " · 已腐化" : ""}${item.mirrored ? " · 镜像" : ""}`; }

function renderTargetList(state) {
  const items = state.items.filter((item) => [ITEM_CATEGORY.WEAPON, ITEM_CATEGORY.EQUIPMENT].includes(item.category) && (targetFilter === "all" || item.category === targetFilter));
  if (!items.some((item) => item.instanceId === selectedItemId)) selectedItemId = items.find((item) => !item.loadoutBound)?.instanceId ?? items[0]?.instanceId ?? null;
  $("m4dTargetCount").textContent = `${items.length} 件`;
  $("m4dTargetList").innerHTML = items.length ? items.slice(0, 160).map((item) => `<button type="button" class="rarity-${item.rarity}${item.instanceId === selectedItemId ? " selected" : ""}" data-craft-item="${item.instanceId}"><span>${item.icon}</span><div><b>${item.name}</b><small>${itemMeta(item)}${item.itemLevel >= 60 ? " · 可出 T1" : ""}</small></div><i>${item.affixes?.length ?? 0}/6</i></button>`).join("") : `<p>当前分类没有可打造装备</p>`;
  $("m4dTargetList").querySelectorAll("[data-craft-item]").forEach((button) => button.onclick = () => { selectedItemId = button.dataset.craftItem; render(); });
}

function affixLine(affix) {
  const effectLabel = MODIFIER_LABELS[affix.modGroup] ?? STAT_LABELS[affix.statId] ?? "特殊属性";
  const value = affix.operation === "grant_weapon_skills" ? `+${affix.value} 个随机武器技能` : affix.skillModifier ? `+${affix.value} ${effectLabel}` : `+${formatValue(affix.value, affix.unit)} ${effectLabel}`;
  return `<li><span>${affix.kind === "prefix" ? "前缀" : affix.kind === "suffix" ? "后缀" : "固有"} · T${affix.tier ?? "—"}</span><b>${affix.name}</b><strong>${value}</strong></li>`;
}
function renderItem(item) {
  if (!item) { $("m4dItemPreview").innerHTML = `<div class="empty"><b>尚未选择目标装备</b><span>从左侧装备列表选择一件物品</span></div>`; return; }
  const skillNames = SKILL_NAME();
  const base = effectiveBaseStatsForItem(item).map((entry) => `<li><span>BASE${entry.qualityAdjusted ? ` · 品质${item.quality}%` : ""}</span><b>${STAT_LABELS[entry.statId] ?? entry.statId}</b><strong>${entry.qualityAdjusted ? `${entry.baseValue} → ${entry.value}` : entry.value}</strong></li>`).join("");
  const implicit = (item.implicitAffixes ?? []).map(affixLine).join("");
  const affixes = (item.affixes ?? []).map(affixLine).join("");
  const skills = (item.rolledWeaponSkillDefinitionIds ?? []).map((id) => `<span>${skillNames[id] ?? id}</span>`).join("");
  $("m4dItemPreview").innerHTML = `<header class="rarity-${item.rarity}"><span>${item.icon}</span><div><small>${itemMeta(item)}</small><h3>${item.name}</h3></div><b>v${item.version ?? 1}</b></header><div class="m4d-item-flags"><span>${item.category === ITEM_CATEGORY.WEAPON ? "武器" : item.slotLabel}</span><span>${(item.affixes ?? []).filter((entry) => entry.kind === "prefix").length}/3 前缀</span><span>${(item.affixes ?? []).filter((entry) => entry.kind === "suffix").length}/3 后缀</span>${item.loadoutBound ? "<em>当前战斗武器需先卸下再打造</em>" : ""}</div><ul>${base}${implicit}${affixes}</ul>${item.category === ITEM_CATEGORY.WEAPON ? `<section class="m4d-weapon-skills"><small>武器技艺前缀 · 自动进入武器技能栏</small><div>${skills || "未出现“武器技艺”前缀"}</div></section>` : ""}`;
}

function renderCurrencyTabs() {
  $("m4dCurrencyTabs").innerHTML = Object.entries(CATEGORY_META).map(([id, [name, hint]]) => `<button type="button" class="${id === currencyCategory ? "active" : ""}" data-currency-category="${id}"><b>${name}</b><small>${hint}</small></button>`).join("");
  $("m4dCurrencyTabs").querySelectorAll("[data-currency-category]").forEach((button) => button.onclick = () => { currencyCategory = button.dataset.currencyCategory; render(); });
}
function renderCurrencies(state) {
  const entries = CRAFTING_CURRENCIES.filter((entry) => entry.category === currencyCategory), target = state.items.find((item) => item.instanceId === selectedItemId);
  $("m4dCurrencyGrid").innerHTML = `${entries.map((entry) => { const levelBlocked = target && (entry.minimumModifierLevel ?? 0) > target.itemLevel; return `<button type="button" class="m4d-currency ${entry.catalyst ? "catalyst" : ""} ${selectedCurrencyId === entry.id || selectedCatalystId === entry.id ? "selected" : ""} ${entry.enabled ? "" : "disabled"} ${levelBlocked ? "level-blocked" : ""}" data-currency-id="${entry.id}" title="${entry.description}${levelBlocked ? ` 当前装备物等不足，需要 Lv.${entry.minimumModifierLevel}。` : ""}"><span>${entry.icon}</span><b>${entry.name}</b><strong>${state.currencies[entry.id] ?? 0}</strong><small>${entry.enabled ? levelBlocked ? `需物等 ${entry.minimumModifierLevel}` : entry.catalyst ? "预兆" : "可使用" : "后续系统"}</small></button>`; }).join("")}<aside id="m4dCurrencyInfo"><b>移动到通货图标查看功能</b><span>当前目录沿用 POE2 名称与基础功能，数值和词缀池属于 Inf_Idle。</span></aside>`;
  $("m4dCurrencyGrid").querySelectorAll("[data-currency-id]").forEach((button) => {
    const entry = CRAFTING_CURRENCIES.find((item) => item.id === button.dataset.currencyId);
    button.onmouseenter = () => { $("m4dCurrencyInfo").innerHTML = `<b>${entry.name} · 持有 ${state.currencies[entry.id] ?? 0}</b><span>${entry.description}</span>`; };
    button.onclick = () => { if (!entry.enabled) { $("m4dCraftResult").textContent = `${entry.name}：对应子系统尚未开放`; return; } if (entry.catalyst) selectedCatalystId = selectedCatalystId === entry.id ? null : entry.id; else selectedCurrencyId = entry.id; render(); };
  });
}

function renderAffixPool(item) {
  if (!item) { $("m4dAffixSummary").textContent = "等待装备"; $("m4dAffixTable").innerHTML = `<p>选择装备后，按物品等级列出完整可用词缀和各阶级范围。</p>`; return; }
  const pool = affixPoolForItem(item), prefix = pool.filter((entry) => entry.kind === "prefix"), suffix = pool.filter((entry) => entry.kind === "suffix");
  const totalWeight = pool.flatMap((entry) => entry.tiers).reduce((sum, tier) => sum + tier.weight, 0);
  $("m4dAffixSummary").textContent = `${pool.length} 类 · ${prefix.length} 前 / ${suffix.length} 后`;
  const group = (title, entries) => `<section><h4>${title}</h4>${entries.map((entry) => { const weight = entry.tiers.reduce((sum, tier) => sum + tier.weight, 0); const chance = totalWeight ? weight / totalWeight * 100 : 0; const modifierLabel = MODIFIER_LABELS[entry.modGroup] ?? STAT_LABELS[entry.statId] ?? "特殊属性"; return `<article><header><span>${entry.kind === "prefix" ? "P" : "S"}</span><div><b>${entry.name}</b><small>${modifierLabel} · ${entry.scope === "local" ? "仅影响本装备" : "影响角色整体"}</small></div><strong>${chance.toFixed(2)}%</strong></header><div>${entry.tiers.slice().reverse().map((tier) => `<p><b>T${tier.tier}</b><span>物等 ${tier.minimumItemLevel}</span><span>${formatValue(tier.minimum, entry.unit)}–${formatValue(tier.maximum, entry.unit)}</span><i>权重 ${tier.weight}</i></p>`).join("")}</div></article>`; }).join("")}</section>`;
  $("m4dAffixTable").innerHTML = group("前缀", prefix) + group("后缀", suffix);
}

function renderSelection(state, item) {
  const currency = CRAFTING_CURRENCIES.find((entry) => entry.id === selectedCurrencyId), catalyst = CRAFTING_CURRENCIES.find((entry) => entry.id === selectedCatalystId);
  const levelBlocked = currency && item && (currency.minimumModifierLevel ?? 0) > item.itemLevel;
  $("m4dSelectedCatalyst").textContent = catalyst ? `${catalyst.name} ×${state.currencies[catalyst.id] ?? 0}` : "不使用预兆";
  $("m4dSelectedCurrency").textContent = currency ? `${currency.name} ×${state.currencies[currency.id] ?? 0}${levelBlocked ? ` · 需要物等 ${currency.minimumModifierLevel}` : ""}` : "尚未选择";
  $("m4dClearCatalyst").disabled = !catalyst;
  $("m4dApplyCraft").disabled = !item || !currency || levelBlocked || (state.currencies[currency.id] ?? 0) < 1 || (catalyst && (state.currencies[catalyst.id] ?? 0) < 1);
  $("m4dApplyCraft").title = levelBlocked ? `该通货要求物品等级至少 ${currency.minimumModifierLevel}` : "提交服务器验证并打造";
}

function render() {
  const state = snapshot(); if (!state) return;
  $("m4dAuthorityState").textContent = `Equipment v${state.equipmentVersion} · Craft ${state.craftSerial}`;
  renderTargetList(state); const item = state.items.find((entry) => entry.instanceId === selectedItemId) ?? null;
  renderItem(item); renderCurrencyTabs(); renderCurrencies(state); renderAffixPool(item); renderSelection(state, item);
}

if ($("m4CraftingLab")) {
  $("m4dTargetFilters").querySelectorAll("[data-craft-target]").forEach((button) => button.onclick = () => { targetFilter = button.dataset.craftTarget; $("m4dTargetFilters").querySelectorAll("button").forEach((entry) => entry.classList.toggle("active", entry === button)); render(); });
  $("m4dClearCatalyst").onclick = () => { selectedCatalystId = null; render(); };
  $("m4dApplyCraft").onclick = () => {
    try {
      const beforeItem = snapshot().items.find((item) => item.instanceId === selectedItemId);
      const result = api().craftItem({ instanceId: selectedItemId, currencyId: selectedCurrencyId, catalystId: selectedCatalystId });
      const currencyName = CRAFTING_CURRENCIES.find((entry) => entry.id === selectedCurrencyId).name;
      const history = result.item.craftHistory?.at(-1), delta = history?.delta;
      const change = delta?.kind === "replace_one_affix" ? ` · 移除「${delta.removedAffix.name}」→ 新增「${delta.addedAffix.name}」 · 词缀总数 ${delta.affixCountBefore}→${delta.affixCountAfter}` : ` · 词缀总数 ${beforeItem?.affixes?.length ?? 0}→${result.item.affixes?.length ?? 0}`;
      selectedItemId = result.item.instanceId; $("m4dCraftResult").textContent = `服务器确认 · ${currencyName}成功${change} · v${result.item.version}`;
      if (selectedCatalystId) selectedCatalystId = null; render();
    } catch (error) { $("m4dCraftResult").textContent = `服务器拒绝 · ${error.code ?? error.message}`; }
  };
  $("m4dGrantSelectedCurrency").onclick = () => {
    if (!selectedCurrencyId) { $("m4dCraftResult").textContent = "测试补给：请先选择一种通货"; return; }
    try { const result = api().grantTestCurrencies({ currencyId: selectedCurrencyId, amount: 100 }); $("m4dCraftResult").textContent = `测试补给已确认 · ${CRAFTING_CURRENCIES.find((entry) => entry.id === selectedCurrencyId).name} +100 · 当前 ${result.snapshot.currencies[selectedCurrencyId]}`; render(); }
    catch (error) { $("m4dCraftResult").textContent = `测试补给被拒绝 · ${error.code ?? error.message}`; }
  };
  $("m4dGrantAllCurrencies").onclick = () => {
    try { api().grantTestCurrencies({ currencyId: "all", amount: 100 }); $("m4dCraftResult").textContent = "测试补给已确认 · 全部可用通货 +100"; render(); }
    catch (error) { $("m4dCraftResult").textContent = `测试补给被拒绝 · ${error.code ?? error.message}`; }
  };
  window.addEventListener("inf-idle:equipment-authority-ready", render);
  window.addEventListener("inf-idle:equipment-snapshot-updated", render);
  render();
}
