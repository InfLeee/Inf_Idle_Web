import { CRAFTING_CURRENCIES, ITEM_CATEGORY, RARITY_META, VAAL_EQUIPMENT_OUTCOMES, affixPoolForItem, effectiveBaseStatsForItem } from "../../packages/itemization-core/src/index.js";
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
  local_attack_speed: "武器攻击速度", projectile_skill_level: "投射物技能等级", fire_skill_level: "火焰技能等级", melee_skill_level: "近战技能等级", physical_skill_level: "物理技能等级", area_skill_level: "范围技能等级", weapon_skill_level: "武器技能等级",
  additional_projectile: "额外投射物数量", additional_summon: "额外召唤物数量", weapon_skills: "随机武器技能",
});
const SKILL_NAME = () => Object.fromEntries(Object.values(currentLoadoutSnapshot().ownershipInput.registry.skills).map((entry) => [entry.id, entry.name]));
let targetFilter = "all", currencyCategory = "basic", selectedItemId = null, selectedCurrencyId = null;
const selectedCatalystIds = new Set();
let foresightCacheKey = null, foresightCache = null;

function api() { return window.__INF_IDLE_EQUIPMENT_API__; }
function snapshot() { return api()?.snapshot?.() ?? null; }
function rarityName(item) { return RARITY_META[item.rarity]?.name ?? item.rarity; }
function formatValue(value, unit) { return unit === "percent" ? `${Math.round(value * 100)}%` : String(Math.round(value * 1000) / 1000); }
function itemMeta(item) { return `${rarityName(item)} · 物品 Lv.${item.itemLevel}${item.quality ? ` · 品质 ${item.quality}%` : ""}${item.corrupted ? " · 已腐化" : ""}${item.mirrored ? " · 镜像" : ""}`; }
function itemMetaHtml(item) { return `<em class="rarity-text">${rarityName(item)}</em><strong class="item-level">物品 Lv.${item.itemLevel}</strong>${item.itemLevel >= 81 ? `<i class="t1-eligible">可出 T1</i>` : ""}${item.quality ? `<span>品质 ${item.quality}%</span>` : ""}${item.corrupted ? `<span>已腐化</span>` : ""}${item.mirrored ? `<span>镜像</span>` : ""}`; }

function renderTargetList(state) {
  const items = state.items.filter((item) => [ITEM_CATEGORY.WEAPON, ITEM_CATEGORY.EQUIPMENT].includes(item.category) && (targetFilter === "all" || item.category === targetFilter)).sort((left, right) => Number(Boolean(right.testFixture)) - Number(Boolean(left.testFixture)) || (right.itemLevel ?? 0) - (left.itemLevel ?? 0) || (right.acquiredOrder ?? 0) - (left.acquiredOrder ?? 0));
  if (!items.some((item) => item.instanceId === selectedItemId)) selectedItemId = items.find((item) => !item.loadoutBound)?.instanceId ?? items[0]?.instanceId ?? null;
  $("m4dTargetCount").textContent = `${items.length} 件`;
  $("m4dTargetList").innerHTML = items.length ? items.slice(0, 160).map((item) => `<button type="button" class="rarity-${item.rarity}${item.instanceId === selectedItemId ? " selected" : ""}" data-craft-item="${item.instanceId}"><span>${item.icon}</span><div><b>${item.name}</b><small class="m4d-target-meta">${itemMetaHtml(item)}</small></div><i>${item.affixes?.length ?? 0}/6</i></button>`).join("") : `<p>当前分类没有可打造装备</p>`;
  $("m4dTargetList").querySelectorAll("[data-craft-item]").forEach((button) => button.onclick = () => { selectedItemId = button.dataset.craftItem; render(); });
}

function affixLine(affix) {
  const effectLabel = MODIFIER_LABELS[affix.modGroup] ?? STAT_LABELS[affix.statId] ?? "特殊属性";
  const value = affix.operation === "grant_weapon_skills" ? `+${affix.value} 个随机武器技能` : affix.skillModifier ? `+${affix.value} ${effectLabel}` : `+${formatValue(affix.value, affix.unit)} ${effectLabel}`;
  const tierClass = affix.tier ? ` tier-${affix.tier}` : " tier-implicit";
  return `<li class="m4d-affix-line${tierClass}${affix.fractured ? " fractured" : ""}"><span>${affix.kind === "prefix" ? "前缀" : affix.kind === "suffix" ? "后缀" : "固有"} · T${affix.tier ?? "—"}${affix.minimumItemLevel ? ` · 物等${affix.minimumItemLevel}` : ""}${affix.fractured ? " · 已破溃" : ""}</span><b>${affix.name}</b><strong>${value}</strong></li>`;
}
function renderItem(item) {
  if (!item) { $("m4dItemPreview").innerHTML = `<div class="empty"><b>尚未选择目标装备</b><span>从左侧装备列表选择一件物品</span></div>`; return; }
  const skillNames = SKILL_NAME();
  const base = effectiveBaseStatsForItem(item).map((entry) => `<li class="m4d-base-line"><span>装备基础属性${entry.qualityAdjusted ? ` · 品质${item.quality}%` : ""}</span><b>${STAT_LABELS[entry.statId] ?? entry.statId}</b><strong>${entry.qualityAdjusted ? `${entry.baseValue} → ${entry.value}` : entry.value}</strong></li>`).join("");
  const implicit = (item.implicitAffixes ?? []).map(affixLine).join("");
  const orderedAffixes = [...(item.affixes ?? []).filter((entry) => entry.kind === "prefix"), ...(item.affixes ?? []).filter((entry) => entry.kind === "suffix")];
  const affixes = orderedAffixes.map(affixLine).join("");
  const skills = (item.rolledWeaponSkillDefinitionIds ?? []).map((id) => `<span>${skillNames[id] ?? id}</span>`).join("");
  $("m4dItemPreview").innerHTML = `<header class="rarity-${item.rarity}"><span>${item.icon}</span><div><small class="m4d-preview-meta">${itemMetaHtml(item)}</small><h3>${item.name}</h3></div><b>v${item.version ?? 1}</b></header><div class="m4d-item-flags"><span>${item.category === ITEM_CATEGORY.WEAPON ? "武器" : item.slotLabel}</span><span>${(item.affixes ?? []).filter((entry) => entry.kind === "prefix").length}/3 前缀</span><span>${(item.affixes ?? []).filter((entry) => entry.kind === "suffix").length}/3 后缀</span>${item.foretelling ? "<strong>辛格拉预示生效中</strong>" : ""}${item.loadoutBound ? "<em>当前战斗武器需先卸下再打造</em>" : ""}</div><ul>${base}${implicit}${affixes}</ul>${item.category === ITEM_CATEGORY.WEAPON ? `<section class="m4d-weapon-skills"><small>武器技艺前缀 · 自动进入武器技能栏</small><div>${skills || "未出现“武器技艺”前缀"}</div></section>` : ""}`;
}

function renderCurrencyTabs() {
  $("m4dCurrencyTabs").innerHTML = Object.entries(CATEGORY_META).map(([id, [name, hint]]) => `<button type="button" class="${id === currencyCategory ? "active" : ""}" data-currency-category="${id}"><b>${name}</b><small>${hint}</small></button>`).join("");
  $("m4dCurrencyTabs").querySelectorAll("[data-currency-category]").forEach((button) => button.onclick = () => { currencyCategory = button.dataset.currencyCategory; render(); });
}
function renderCurrencies(state) {
  const entries = CRAFTING_CURRENCIES.filter((entry) => entry.category === currencyCategory), target = state.items.find((item) => item.instanceId === selectedItemId);
  $("m4dCurrencyGrid").innerHTML = `${entries.map((entry) => { const levelBlocked = target && (entry.minimumModifierLevel ?? 0) > target.itemLevel; return `<button type="button" class="m4d-currency ${selectedCurrencyId === entry.id ? "selected" : ""} ${entry.enabled ? "" : "disabled"} ${levelBlocked ? "level-blocked" : ""}" data-currency-id="${entry.id}" title="${entry.description}${levelBlocked ? ` 当前装备物等不足，需要 Lv.${entry.minimumModifierLevel}。` : ""}"><span>${entry.icon}</span><b>${entry.name}</b><strong>${state.currencies[entry.id] ?? 0}</strong><small>${entry.enabled ? levelBlocked ? `需物等 ${entry.minimumModifierLevel}` : "可使用" : "后续系统"}</small></button>`; }).join("")}<aside id="m4dCurrencyInfo"><b>移动到通货图标查看功能</b><span>当前目录沿用 POE2 名称与基础功能，数值和词缀池属于 Inf_Idle。</span></aside>`;
  $("m4dCurrencyGrid").querySelectorAll("[data-currency-id]").forEach((button) => {
    const entry = CRAFTING_CURRENCIES.find((item) => item.id === button.dataset.currencyId);
    button.onmouseenter = () => { $("m4dCurrencyInfo").innerHTML = `<b>${entry.name} · 持有 ${state.currencies[entry.id] ?? 0}</b><span>${entry.description}</span>`; };
    button.onclick = () => { if (!entry.enabled) { $("m4dCraftResult").textContent = `${entry.name}：对应子系统尚未开放`; return; } selectedCurrencyId = entry.id; render(); };
  });
}

function renderOmens(state) {
  const entries = CRAFTING_CURRENCIES.filter((entry) => entry.category === "omen" && entry.enabled), baseId = selectedCurrencyId ? String(selectedCurrencyId).replace(/^(greater|perfect)_/, "") : null;
  $("m4dOmenGrid").innerHTML = entries.map((entry) => { const selected = selectedCatalystIds.has(entry.id), compatible = !baseId || entry.compatibleCurrencyIds.includes(baseId); return `<button type="button" class="m4d-omen ${selected ? "selected" : ""} ${compatible ? "" : "incompatible"}" data-omen-id="${entry.id}" title="${entry.description}"><span>${entry.icon}</span><b>${entry.name}</b><strong>${state.currencies[entry.id] ?? 0}</strong><small>${compatible ? "可配合当前通货" : "与当前通货不兼容"}</small></button>`; }).join("");
  $("m4dOmenGrid").querySelectorAll("[data-omen-id]").forEach((button) => { const entry = CRAFTING_CURRENCIES.find((item) => item.id === button.dataset.omenId); button.onmouseenter = () => { $("m4dOmenInfo").innerHTML = `<b>${entry.name} · 持有 ${state.currencies[entry.id] ?? 0}</b><span>${entry.description}</span>`; }; button.onclick = () => { if (selectedCatalystIds.has(entry.id)) selectedCatalystIds.delete(entry.id); else selectedCatalystIds.add(entry.id); render(); }; });
}

function renderAffixPool(item) {
  if (!item) { $("m4dAffixSummary").textContent = "等待装备"; $("m4dAffixTable").innerHTML = `<p>选择装备后，按物品等级列出完整可用词缀和各阶级范围。</p>`; return; }
  if (selectedCurrencyId === "vaal") {
    const total = VAAL_EQUIPMENT_OUTCOMES.reduce((sum, entry) => sum + entry.weight, 0);
    $("m4dAffixSummary").textContent = `${VAAL_EQUIPMENT_OUTCOMES.length} 种结果 · 总权重 ${total}`;
    $("m4dAffixTable").innerHTML = `<section class="m4d-vaal-outcomes"><h4>瓦尔宝珠 · 全部可能</h4><p class="m4d-vaal-note">以下权重与服务器实际随机池完全一致；不适用的结果会退化为“仅腐化”。</p>${VAAL_EQUIPMENT_OUTCOMES.map((entry) => `<article><header><span>${entry.weight}</span><div><b>${entry.name}</b><small>${entry.description}</small></div><strong>${(entry.weight / total * 100).toFixed(0)}%</strong></header></article>`).join("")}</section>`;
    return;
  }
  const pool = affixPoolForItem(item), prefix = pool.filter((entry) => entry.kind === "prefix"), suffix = pool.filter((entry) => entry.kind === "suffix");
  const totalWeight = pool.flatMap((entry) => entry.tiers).reduce((sum, tier) => sum + tier.weight, 0);
  $("m4dAffixSummary").textContent = `${pool.length} 类 · ${prefix.length} 前 / ${suffix.length} 后`;
  const group = (title, entries) => `<section><h4>${title}</h4>${entries.map((entry) => { const weight = entry.tiers.reduce((sum, tier) => sum + tier.weight, 0); const chance = totalWeight ? weight / totalWeight * 100 : 0; const modifierLabel = MODIFIER_LABELS[entry.modGroup] ?? STAT_LABELS[entry.statId] ?? "特殊属性"; return `<article><header><span>${entry.kind === "prefix" ? "P" : "S"}</span><div><b>${entry.name}</b><small>${modifierLabel} · ${entry.scope === "local" ? "仅影响本装备" : "影响角色整体"}</small></div><strong>${chance.toFixed(2)}%</strong></header><div>${entry.tiers.slice().reverse().map((tier) => `<p><b>T${tier.tier}</b><span>物等 ${tier.minimumItemLevel}</span><span>${formatValue(tier.minimum, entry.unit)}–${formatValue(tier.maximum, entry.unit)}</span><i>权重 ${tier.weight}</i></p>`).join("")}</div></article>`; }).join("")}</section>`;
  let foresight = "";
  const currency = CRAFTING_CURRENCIES.find((entry) => entry.id === selectedCurrencyId);
  if (item.foretelling && currency && !currency.serviceOperation && !currency.catalyst) {
    const catalystIds = [...selectedCatalystIds], key = `${item.instanceId}:${item.version}:${currency.id}:${catalystIds.join(",") || "none"}`;
    try {
      if (key !== foresightCacheKey) { foresightCache = api().previewCraftItem({ instanceId: item.instanceId, currencyId: currency.id, catalystIds }); foresightCacheKey = key; }
      const preview = foresightCache.item, delta = preview.craftHistory?.at(-1)?.delta;
      const detail = delta?.kind === "replace_one_affix" ? `将移除「${delta.removedAffix.name}」，并增加「${delta.addedAffix.name}」` : delta?.kind === "fracture_affix" ? `将锁定「${delta.fracturedAffix.name}」` : delta?.vaalOutcomeName ? `将发生「${delta.vaalOutcomeName}」` : `打造后为 ${rarityName(preview)}，共 ${preview.affixes?.length ?? 0} 条词缀`;
      foresight = `<section class="m4d-foretelling-preview"><h4>辛格拉的预示</h4><b>${currency.name}的下一次结果已锁定</b><p>${detail}</p><small>正式提交后由服务器使用相同预示种子结算；其他装备修改会令预示消失。</small></section>`;
    } catch (error) { foresight = `<section class="m4d-foretelling-preview blocked"><h4>辛格拉的预示</h4><p>当前操作无法作用于该装备：${error.code ?? error.message}</p></section>`; }
  }
  $("m4dAffixTable").innerHTML = foresight + group("前缀", prefix) + group("后缀", suffix);
}

function renderSelection(state, item) {
  const currency = CRAFTING_CURRENCIES.find((entry) => entry.id === selectedCurrencyId), catalysts = [...selectedCatalystIds].map((id) => CRAFTING_CURRENCIES.find((entry) => entry.id === id)).filter(Boolean);
  const levelBlocked = currency && item && (currency.minimumModifierLevel ?? 0) > item.itemLevel;
  const baseId = currency ? String(currency.id).replace(/^(greater|perfect)_/, "") : null, omenCompatible = !currency || catalysts.every((entry) => entry.compatibleCurrencyIds.includes(baseId));
  const omenGroups = catalysts.map((entry) => entry.omenEffect.startsWith("alchemy_") ? "alchemy_side" : ["add_prefix", "add_suffix"].includes(entry.omenEffect) ? "add_side" : ["remove_prefix", "remove_suffix"].includes(entry.omenEffect) ? "remove_side" : entry.omenEffect), omenCombinationValid = new Set(omenGroups).size === omenGroups.length;
  const owned = catalysts.every((entry) => (state.currencies[entry.id] ?? 0) > 0);
  $("m4dSelectedCatalyst").textContent = catalysts.length ? `${catalysts.map((entry) => entry.name).join(" + ")}${omenCompatible ? "" : " · 与当前通货不兼容"}${omenCombinationValid ? "" : " · 组合冲突"}` : "不使用预兆";
  $("m4dSelectedCurrency").textContent = currency ? `${currency.name} ×${state.currencies[currency.id] ?? 0}${levelBlocked ? ` · 需要物等 ${currency.minimumModifierLevel}` : ""}` : "尚未选择";
  $("m4dClearCatalyst").disabled = !catalysts.length;
  $("m4dApplyCraft").disabled = !item || !currency || levelBlocked || !omenCompatible || !omenCombinationValid || !owned || (state.currencies[currency.id] ?? 0) < 1;
  $("m4dApplyCraft").title = levelBlocked ? `该通货要求物品等级至少 ${currency.minimumModifierLevel}` : !omenCompatible ? "该预兆不能影响当前通货" : !omenCombinationValid ? "已选择互相冲突的预兆" : "提交服务器验证并打造";
}

function render() {
  const state = snapshot(); if (!state) return;
  $("m4dAuthorityState").textContent = `Equipment v${state.equipmentVersion} · Craft ${state.craftSerial}`;
  renderTargetList(state); const item = state.items.find((entry) => entry.instanceId === selectedItemId) ?? null;
  renderItem(item); renderOmens(state); renderCurrencyTabs(); renderCurrencies(state); renderAffixPool(item); renderSelection(state, item);
}

if ($("m4CraftingLab")) {
  $("m4dTargetFilters").querySelectorAll("[data-craft-target]").forEach((button) => button.onclick = () => { targetFilter = button.dataset.craftTarget; $("m4dTargetFilters").querySelectorAll("button").forEach((entry) => entry.classList.toggle("active", entry === button)); render(); });
  $("m4dClearCatalyst").onclick = () => { selectedCatalystIds.clear(); render(); };
  $("m4dApplyCraft").onclick = () => {
    try {
      const beforeItem = snapshot().items.find((item) => item.instanceId === selectedItemId);
      const catalystIds = [...selectedCatalystIds], result = api().craftItem({ instanceId: selectedItemId, currencyId: selectedCurrencyId, catalystIds });
      const currencyName = CRAFTING_CURRENCIES.find((entry) => entry.id === selectedCurrencyId).name;
      const history = result.item.craftHistory?.at(-1), delta = history?.delta;
      const change = delta?.kind === "replace_one_affix" ? ` · 移除「${delta.removedAffix.name}」→ 新增「${delta.addedAffix.name}」 · 词缀总数 ${delta.affixCountBefore}→${delta.affixCountAfter}` : delta?.kind === "fracture_affix" ? ` · 已永久锁定「${delta.fracturedAffix.name}」` : delta?.vaalOutcomeName ? ` · 腐化结果「${delta.vaalOutcomeName}」` : selectedCurrencyId === "foretelling_braid" ? " · 下一次通货结果现已可预见" : ` · 词缀总数 ${beforeItem?.affixes?.length ?? 0}→${result.item.affixes?.length ?? 0}`;
      const foretold = beforeItem?.foretelling && selectedCurrencyId !== "foretelling_braid" ? " · 与辛格拉预示一致" : "";
      const omenNames = catalystIds.map((id) => CRAFTING_CURRENCIES.find((entry) => entry.id === id)?.name).filter(Boolean);
      const omenNotice = omenNames.length ? ` · 已消耗${omenNames.join("＋")}（选择已保留）` : "";
      selectedItemId = result.item.instanceId; foresightCacheKey = null; foresightCache = null; $("m4dCraftResult").textContent = `服务器确认 · ${currencyName}成功${change}${foretold}${omenNotice} · v${result.item.version}`;
      render();
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
