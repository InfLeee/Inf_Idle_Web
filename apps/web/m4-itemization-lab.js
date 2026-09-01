import { EQUIPMENT_SLOTS, ITEM_CATEGORY, MAP_LEVEL_MODE, RARITY_META, aggregateEquipmentBonuses, itemizationCatalog, resolveMonsterLevel } from "../../packages/itemization-core/src/index.js";
import { createAuthoritativeEquipmentService } from "../../packages/server-core/src/authoritative-equipment-service.js";
import { acceptIdentifiedSkillCardGrant, acceptLootWeaponGrant, characterProgressionAuthority, commitCharacterProgression, currentLoadoutSnapshot } from "./loadout-authority.js?v=m4c-1";

const $ = (id) => document.getElementById(id);
const STAT_LABELS = { physicalAttack: "物攻", magicAttack: "魔攻", maxHp: "生命", maxResource: "资源", physicalDefense: "物防", magicDefense: "魔防", accuracy: "命中", critRating: "暴击评级", attackSpeedRating: "攻速评级", movementSpeedRating: "遇敌移速" };
const CATEGORY_LABELS = { weapon: "武器", equipment: "装备", skill_card: "未鉴定技能宝石", currency: "通货" };
const SUBTYPE_OPTIONS = { all: [["all", "全部类型"]], weapon: [["all", "全部武器"], ["two_handed_sword", "双手剑"], ["sword_shield", "盾剑"]], equipment: [["all", "全部部件"], ["armor", "四类防具"], ["accessory", "三类首饰"], ...Object.entries(itemizationCatalog.slotLabels)] };
const SAVE_KEY = "inf-idle.m4c-backpack.v0";
const MAX_EQUIPMENT_ITEMS = 600;
const MAX_VISIBLE_GROUND_LOOT = 160;
const SKILL_DEFINITIONS = Object.values(currentLoadoutSnapshot().ownershipInput.registry.skills).filter((definition) => definition.sourceType === "skill_card");
const SKILL_NAME_BY_ID = Object.fromEntries(Object.values(currentLoadoutSnapshot().ownershipInput.registry.skills).map((definition) => [definition.id, definition.name]));
const EQUIPMENT_SERVICE_OPTIONS = { maximumEquipmentItems: MAX_EQUIPMENT_ITEMS, allowedSkillDefinitionIds: SKILL_DEFINITIONS.map((definition) => definition.id) };

function restoreEquipmentService() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!["m4b-backpack-save-v0", "m4b-backpack-save-v1", "m4b-backpack-save-v2"].includes(saved?.schemaVersion) || !Array.isArray(saved.items)) return createAuthoritativeEquipmentService(EQUIPMENT_SERVICE_OPTIONS);
    const stackByLevel = new Map((saved.skillCardStacks ?? []).map((stack) => [stack.skillLevel, structuredClone(stack)]));
    const items = [];
    for (const item of saved.items.slice(0, MAX_EQUIPMENT_ITEMS)) {
      if (item.category !== ITEM_CATEGORY.SKILL_CARD) items.push(item);
      else {
        const current = stackByLevel.get(item.skillLevel) ?? { kind: "UnidentifiedSkillGemStack", stackId: `uncut-skill-lv-${item.skillLevel}`, category: ITEM_CATEGORY.SKILL_CARD, subtype: "unidentified_skill_gem", name: "未鉴定技能宝石", icon: "✧", skillLevel: item.skillLevel, itemLevel: item.itemLevel, unidentified: true, quantity: 0, acquiredOrder: item.acquiredOrder ?? 0 };
        current.quantity += 1; stackByLevel.set(item.skillLevel, current);
      }
    }
    return createAuthoritativeEquipmentService({ ...EQUIPMENT_SERVICE_OPTIONS, items, skillCardStacks: [...stackByLevel.values()], slots: saved.slots, acquisitionSerial: saved.acquisitionSerial, lootRollSerial: saved.lootRollSerial, gold: saved.gold ?? 0 });
  } catch { return createAuthoritativeEquipmentService(EQUIPMENT_SERVICE_OPTIONS); }
}

if ($("m4ItemizationLab")) {
  const equipment = restoreEquipmentService();
  let serial = 0; let selectedSlot = "chest"; let categoryFilter = "all"; let bagFilter = "equipment"; let latestPickup = null; let selectedItemId = null; let selectedStackId = null; let pickupBlockedCode = null; let pickupSpeedMultiplier = Math.max(1, Number(globalThis.__INF_IDLE_BATTLE_SPEED__ ?? 1));
  const pickupLogs = []; const activeLootNodes = new Map();
  const radarLootLayer = document.createElement("div"); radarLootLayer.id = "radarLootLayer"; radarLootLayer.className = "radar-loot-layer"; $("radar")?.append(radarLootLayer);
  const request = (prefix, snapshot = equipment.snapshot()) => ({ requestId: `${prefix}-${Date.now()}-${serial += 1}`, expectedVersion: snapshot.equipmentVersion });
  const statLabel = (id) => STAT_LABELS[id] ?? id;
  const rarityLabel = (item) => item.unidentified ? "未鉴定" : (RARITY_META[item.rarity]?.name ?? item.rarity ?? "—");
  function monsterLevel() { return resolveMonsterLevel({ mode: $("m4MapMode").value, mapLevel: Number($("m4MapLevel").value), playerLevel: Number($("m4PlayerLevel").value) }); }
  function persist(snapshot) { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: "m4b-backpack-save-v2", items: snapshot.items, skillCardStacks: snapshot.skillCardStacks, slots: snapshot.slots, acquisitionSerial: snapshot.acquisitionSerial, lootRollSerial: snapshot.lootRollSerial, gold: snapshot.gold })); } catch { /* bounded authority remains usable */ } }
  function syncCharacter(snapshot) { const activeWeaponId = currentLoadoutSnapshot().characterBuild.equippedWeaponInstanceId; const weaponItem = snapshot.items.find((item) => item.loadoutWeaponInstanceId === activeWeaponId) ?? null; const equippedGear = EQUIPMENT_SLOTS.map((slot) => snapshot.items.find((item) => item.instanceId === snapshot.slots[slot]) ?? null); const bonuses = aggregateEquipmentBonuses([...equippedGear, weaponItem]); const progression = characterProgressionAuthority.setAuthorityState({ bonuses }); const loadout = commitCharacterProgression(progression); persist(snapshot); $("m4BuildProof").textContent = loadout.compiledBuild ? `装备数值已进入战斗 · ${loadout.compiledBuild.buildHash.slice(0, 12)}` : "属性已同步 · 当前未装备可战斗武器"; }

  function itemIconHtml(item, equipped) {
    const badge = item.category === ITEM_CATEGORY.WEAPON ? `${item.skillCardSocketCount}孔` : item.slotLabel;
    return `<button type="button" class="m4-item-icon rarity-${item.rarity}${equipped ? " equipped" : ""}${selectedItemId === item.instanceId ? " selected" : ""}" data-item-id="${item.instanceId}" title="${item.name}"><span>${item.icon}</span><b>Lv.${item.itemLevel}</b><small>${badge}</small><i>${rarityLabel(item)}</i></button>`;
  }
  function stackIconHtml(stack) { return `<button type="button" class="m4-item-icon m4-stack-icon${selectedStackId === stack.stackId ? " selected" : ""}" data-stack-id="${stack.stackId}" title="${stack.name} Lv.${stack.skillLevel}"><span>${stack.icon}</span><b>×${stack.quantity}</b><small>技能 Lv.${stack.skillLevel}</small><i>未鉴定</i></button>`; }
  function itemDetailHtml(item, options = {}) {
    const baseStats = (item.baseStats ?? []).map((stat) => `<li class="m4-base-stat"><span>基底 · ${stat.scope === "local" ? "局部" : "全局"}</span><b>+${stat.value} ${statLabel(stat.statId)}</b><small>由 ${item.baseDefinitionId} 提供</small></li>`).join("");
    const affixes = (item.affixes ?? []).map((affix) => { const value = affix.unit === "percent" ? `${Math.round(affix.value * 100)}%` : affix.value; const range = affix.unit === "percent" ? `${Math.round(affix.minimum * 100)}%–${Math.round(affix.maximum * 100)}%` : `${affix.minimum}–${affix.maximum}`; return `<li><span>${affix.kind === "prefix" ? "前" : "后"} · T${affix.tier} ${affix.name} · ${affix.scope === "local" ? "局部" : "全局"}</span><b>+${value} ${statLabel(affix.statId)}</b><small>物等门槛 ${affix.minimumItemLevel} · Roll ${range}</small></li>`; }).join("");
    const detail = item.category === ITEM_CATEGORY.WEAPON ? (item.subtype === "two_handed_sword" ? "双手剑" : "盾剑") : item.slotLabel;
    const equipAction = options.action && item.category === ITEM_CATEGORY.EQUIPMENT ? `<button id="m4DetailEquip" type="button"${options.equipped ? " disabled" : ""}>${options.equipped ? "当前已穿戴" : options.replacing ? "替换当前装备" : "穿戴"}</button>` : "";
    const weaponAction = options.action && item.category === ITEM_CATEGORY.WEAPON ? `<button id="m4DetailWeaponEquip" type="button"${item.subtype !== "two_handed_sword" ? " disabled" : ""}>${item.loadoutBound ? "切换至此武器构筑" : "生成构筑并穿戴"}</button>` : "";
    const discardAction = options.action && !options.equipped && !item.loadoutBound ? `<button id="m4DetailDiscard" class="danger" type="button">丢弃（测试整理）</button>` : "";
    const weaponMeta = item.category === ITEM_CATEGORY.WEAPON ? `<div class="m4-weapon-rolls"><b>${item.skillCardSocketCount} 个技能卡孔</b><b>每技能固定 ${item.supportSocketsPerSkill} 个辅助孔</b><span>赠送技能：${item.grantedSocketedSkillCard ? `${item.grantedSocketedSkillCard.name} Lv.${item.grantedSocketedSkillCard.skillLevel}（可拆）` : "无"}</span><span>武器技能 ${item.rolledWeaponSkills.length}/5：${item.rolledWeaponSkills.map((id) => SKILL_NAME_BY_ID[id] ?? id).join("、")}</span></div>` : "";
    return `<header><span>${item.icon}</span><div><small>${options.title ?? "选中物品"} · ${detail} · ${rarityLabel(item)} · 物品 Lv.${item.itemLevel}</small><strong>${item.name}</strong></div></header>${weaponMeta}<ul>${baseStats}${affixes}</ul>${!affixes ? `<p class="m4-no-affix">普通物品 · 无随机词缀</p>` : ""}<footer><span>需求等级 ${item.requiredLevel} · POE2式 T1 为最高阶</span><div>${weaponAction}${equipAction}${discardAction}</div></footer>`;
  }
  function stackDetailHtml(stack) { const options = SKILL_DEFINITIONS.map((definition) => `<option value="${definition.id}">${definition.name}</option>`).join(""); return `<header><span>${stack.icon}</span><div><small>卡片背包 · 技能等级 Lv.${stack.skillLevel}</small><strong>${stack.name}</strong></div></header><div class="m4-stack-summary"><b>当前堆叠 ×${stack.quantity}</b><span>同等级未鉴定宝石自动归入同一格</span><span>选择后由服务器消耗 1 枚，并生成相同等级的正式技能卡实例</span></div><footer class="m4-identify-actions"><label>鉴定为<select id="m4IdentifyDefinition">${options}</select></label><button id="m4IdentifySkill" type="button">鉴定并送入构筑背包</button></footer>`; }

  function updateSubtypeOptions() { const options = SUBTYPE_OPTIONS[categoryFilter] ?? SUBTYPE_OPTIONS.all; const previous = $("m4SubtypeFilter").value; $("m4SubtypeFilter").innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join(""); $("m4SubtypeFilter").value = options.some(([value]) => value === previous) ? previous : "all"; }
  function filteredItems(snapshot) { const subtype = $("m4SubtypeFilter").value; const rarity = $("m4RarityFilter").value; const sort = $("m4SortMode").value; return snapshot.items.filter((item) => (categoryFilter === "all" || item.category === categoryFilter) && (subtype === "all" || item.subtype === subtype || item.slot === subtype) && (rarity === "all" || item.rarity === rarity)).sort((a, b) => sort === "rarity" ? (RARITY_META[b.rarity].rank - RARITY_META[a.rarity].rank || b.itemLevel - a.itemLevel) : sort === "level" ? (b.itemLevel - a.itemLevel || RARITY_META[b.rarity].rank - RARITY_META[a.rarity].rank) : (a.acquiredOrder ?? 0) - (b.acquiredOrder ?? 0)); }
  function currentSaleFilter() { const rarity = $("m4SaleRarity").value; const position = $("m4SalePosition").value; return { maximumItemLevel: Math.max(1, Math.min(60, Number($("m4SaleMaxLevel").value) || 1)), rarities: rarity === "all" ? [] : [rarity], positions: position === "all" ? [] : [position] }; }
  function saleCandidates(snapshot, filter = currentSaleFilter()) { const equipped = new Set(Object.values(snapshot.slots).filter(Boolean)); return snapshot.items.filter((item) => { const position = item.category === ITEM_CATEGORY.WEAPON ? "weapon" : item.slot; return !equipped.has(item.instanceId) && item.itemLevel <= filter.maximumItemLevel && (!filter.rarities.length || filter.rarities.includes(item.rarity)) && (!filter.positions.length || filter.positions.includes(position)); }); }
  function saleValue(item) { return Math.max(1, item.itemLevel) * ((RARITY_META[item.rarity]?.rank ?? 0) + 1) * 5; }
  function renderSalePreview(snapshot) { const matches = saleCandidates(snapshot); const value = matches.reduce((sum, item) => sum + saleValue(item), 0); $("m4GoldBalance").textContent = `金币 ${snapshot.gold.toLocaleString()}`; $("m4SalePreview").textContent = matches.length ? `将出售 ${matches.length} 件未穿戴装备，预计获得 ${value.toLocaleString()} 金币；该筛选结构将直接作为后续自动出售规则基础。` : "当前没有符合条件的未穿戴装备；已穿戴装备始终受到保护。"; $("m4SellMatched").disabled = matches.length === 0; }

  function renderBag(snapshot) {
    $("m4EquipmentBagPanel").hidden = bagFilter !== "equipment"; $("m4SkillBagPanel").hidden = bagFilter !== "skill_card"; $("m4CurrencyBagPanel").hidden = bagFilter !== "currency";
    if (bagFilter === "equipment") {
      const visible = filteredItems(snapshot); $("m4InventoryCount").textContent = `装备 ${snapshot.items.length} / ${snapshot.maximumEquipmentItems} · 当前 ${visible.length}`; $("m4EquipmentInventory").innerHTML = visible.length ? visible.map((item) => itemIconHtml(item, snapshot.slots[item.slot] === item.instanceId)).join("") : `<p class="empty">当前筛选下没有装备</p>`; renderSalePreview(snapshot);
      const selected = snapshot.items.find((item) => item.instanceId === selectedItemId) ?? null;
      if (selected) {
        const equippedId = selected.category === ITEM_CATEGORY.EQUIPMENT ? snapshot.slots[selected.slot] : null; const equipped = equippedId ? snapshot.items.find((item) => item.instanceId === equippedId) : null;
        $("m4ItemDetail").innerHTML = itemDetailHtml(selected, { title: "背包装备", action: true, equipped: equippedId === selected.instanceId, replacing: Boolean(equipped && equipped.instanceId !== selected.instanceId) });
        const activeWeaponId = currentLoadoutSnapshot().characterBuild.equippedWeaponInstanceId; const activeWeapon = selected.category === ITEM_CATEGORY.WEAPON ? snapshot.items.find((item) => item.loadoutWeaponInstanceId === activeWeaponId) : null;
        $("m4CompareDetail").innerHTML = equipped && equipped.instanceId !== selected.instanceId ? itemDetailHtml(equipped, { title: "当前已穿戴" }) : activeWeapon && activeWeapon.instanceId !== selected.instanceId ? itemDetailHtml(activeWeapon, { title: "当前战斗武器" }) : `<div class="m4-detail-empty"><b>${selected.category === ITEM_CATEGORY.EQUIPMENT ? "该部位当前为空" : selected.loadoutWeaponInstanceId === activeWeaponId ? "当前战斗武器" : "当前没有战斗武器"}</b><span>${selected.category === ITEM_CATEGORY.EQUIPMENT ? "穿戴后这里显示替换前装备" : "点击左侧按钮会生成正式 WeaponLoadout 并立即进入战斗构筑"}</span></div>`;
      } else { $("m4ItemDetail").innerHTML = `<div class="m4-detail-empty"><b>尚未选择装备</b><span>点击左侧图标查看完整属性</span></div>`; $("m4CompareDetail").innerHTML = `<div class="m4-detail-empty"><b>装备对比</b><span>选择防具或首饰后显示同部位已穿戴装备</span></div>`; }
    } else if (bagFilter === "skill_card") {
      const total = snapshot.skillCardStacks.reduce((sum, stack) => sum + stack.quantity, 0); $("m4InventoryCount").textContent = `卡片 ${snapshot.skillCardStacks.length} / ${snapshot.maximumSkillStacks} 格 · 共 ${total}`;
      $("m4SkillInventory").innerHTML = snapshot.skillCardStacks.length ? snapshot.skillCardStacks.map(stackIconHtml).join("") : `<p class="empty">尚未拾取未鉴定技能宝石</p>`;
      const stack = snapshot.skillCardStacks.find((entry) => entry.stackId === selectedStackId); $("m4SkillDetail").innerHTML = stack ? stackDetailHtml(stack) : `<div class="m4-detail-empty"><b>未鉴定技能宝石</b><span>同等级自动堆叠；点击图标查看数量与等级</span></div>`;
    } else $("m4InventoryCount").textContent = "通货背包 · 预留";
  }

  function render(snapshot = equipment.snapshot()) {
    const level = monsterLevel(); globalThis.__INF_IDLE_MAP_MONSTER_LEVEL__ = level; $("m4MonsterLevel").textContent = `Lv.${level}`; $("m4DropLevel").textContent = `物品 Lv.${level}`; $("m4MapLevel").disabled = $("m4MapMode").value === MAP_LEVEL_MODE.DYNAMIC; $("m4PlayerLevel").disabled = $("m4MapMode").value === MAP_LEVEL_MODE.FIXED;
    $("m4AuthorityState").textContent = `Equipment v${snapshot.equipmentVersion} · ${snapshot.equipmentHash.slice(0, 8)}`; $("m4PendingDrops").textContent = `${snapshot.pendingDrops.length.toLocaleString()} / ${snapshot.maximumPendingDrops.toLocaleString()} 件 · 雷达显示 ${activeLootNodes.size}/${MAX_VISIBLE_GROUND_LOOT}`;
    $("m4LatestPickup").textContent = pickupBlockedCode ? `背包已满 · 地图继续保留并排队` : latestPickup ? `${rarityLabel(latestPickup)} · ${latestPickup.name} · Lv.${latestPickup.itemLevel}` : "等待怪物掉落";
    $("m4EquipmentSlots").innerHTML = EQUIPMENT_SLOTS.map((slot) => { const item = snapshot.items.find((entry) => entry.instanceId === snapshot.slots[slot]); const label = itemizationCatalog.slotLabels[slot]; return `<button type="button" class="${selectedSlot === slot ? "selected" : ""} ${item ? "filled" : ""}" data-slot="${slot}"><small>${label}</small><strong>${item ? `${item.icon} ${item.name}` : "空栏位"}</strong><span>${item ? `Lv.${item.itemLevel} · 点击卸下` : "点击选择拟投放部位"}</span></button>`; }).join("");
    renderBag(snapshot);
    const bonusEntries = Object.entries(snapshot.bonuses.derived.equipmentBase); $("m4BonusProof").textContent = bonusEntries.length ? bonusEntries.map(([id, value]) => `${statLabel(id)} +${value}`).join(" · ") : "尚未穿戴装备";
    document.querySelectorAll("[data-slot]").forEach((button) => button.onclick = () => { const slot = button.dataset.slot; if (snapshot.slots[slot]) { const next = equipment.unequip({ ...request("unequip", snapshot), slot }); syncCharacter(next); render(next); } else { selectedSlot = slot; render(snapshot); } });
    document.querySelectorAll(".m4-item-icon[data-item-id]").forEach((button) => button.onclick = () => { selectedItemId = button.dataset.itemId; render(snapshot); });
    document.querySelectorAll(".m4-item-icon[data-stack-id]").forEach((button) => button.onclick = () => { selectedStackId = button.dataset.stackId; render(snapshot); });
    if ($("m4DetailEquip")) $("m4DetailEquip").onclick = () => { const item = snapshot.items.find((entry) => entry.instanceId === selectedItemId); if (!item || item.category !== ITEM_CATEGORY.EQUIPMENT || snapshot.slots[item.slot] === item.instanceId) return; const next = equipment.equip({ ...request("equip", snapshot), instanceId: item.instanceId, slot: item.slot }); syncCharacter(next); render(next); };
    if ($("m4DetailWeaponEquip")) $("m4DetailWeaponEquip").onclick = () => { const item = snapshot.items.find((entry) => entry.instanceId === selectedItemId); if (!item || item.category !== ITEM_CATEGORY.WEAPON) return; try { const result = equipment.authorizeWeaponGrant({ ...request("weapon-grant", snapshot), instanceId: item.instanceId }); const loadout = acceptLootWeaponGrant(result.grant); persist(result.snapshot); syncCharacter(result.snapshot); $("m4BuildProof").textContent = `已穿戴 ${item.name} · ${item.skillCardSocketCount} 技能孔 · Loadout v${loadout.loadoutVersion}`; render(result.snapshot); } catch (error) { $("m4BuildProof").textContent = `武器接入失败 · ${error.code ?? error.message}`; } };
    if ($("m4DetailDiscard")) $("m4DetailDiscard").onclick = () => { const item = snapshot.items.find((entry) => entry.instanceId === selectedItemId); if (!item) return; const next = equipment.discard({ ...request("discard", snapshot), instanceId: item.instanceId }); selectedItemId = null; persist(next); render(next); drainGroundLoot(80); };
    if ($("m4IdentifySkill")) $("m4IdentifySkill").onclick = () => {
      const stack = snapshot.skillCardStacks.find((entry) => entry.stackId === selectedStackId); if (!stack) return;
      try {
        const result = equipment.identifySkillGem({ ...request("identify", snapshot), stackId: stack.stackId, definitionId: $("m4IdentifyDefinition").value });
        const loadout = acceptIdentifiedSkillCardGrant(result.grant);
        persist(result.snapshot);
        if (!result.snapshot.skillCardStacks.some((entry) => entry.stackId === selectedStackId)) selectedStackId = null;
        $("m4BuildProof").textContent = `已鉴定 ${loadout.ownershipInput.registry.skills[result.grant.definitionId].name} Lv.${result.grant.level} · Loadout v${loadout.loadoutVersion}`;
        render(result.snapshot);
      } catch (error) { $("m4BuildProof").textContent = `鉴定失败 · ${error.code ?? error.message}`; }
    };
  }

  function addPickupFeed(item) { const row = document.createElement("li"); row.className = `rarity-${item.rarity}`; row.textContent = `${rarityLabel(item)} · ${item.name} · Lv.${item.itemLevel}${item.skillLevel ? ` · 技能Lv.${item.skillLevel}` : ""}`; $("m4PickupFeed").prepend(row); while ($("m4PickupFeed").children.length > 6) $("m4PickupFeed").lastElementChild.remove(); }
  function renderPickupLog() { $("m4PickupLogCount").textContent = `${pickupLogs.length} 条`; $("m4PickupLog").innerHTML = pickupLogs.length ? pickupLogs.map(({ time, item }) => `<div class="m4-pickup-log-row rarity-${item.rarity}"><time>${time}</time><b>${rarityLabel(item)}</b><span>${CATEGORY_LABELS[item.category]}${item.slotLabel ? ` · ${item.slotLabel}` : ""}</span><strong>${item.icon} ${item.name}</strong><span>物品 Lv.${item.itemLevel}${item.skillLevel ? ` · 技能 Lv.${item.skillLevel}` : ""}</span></div>`).join("") : `<p>等待第一件物品汇聚入包</p>`; }
  function pickupCollectionDurationMs() { return 420 / pickupSpeedMultiplier; }
  function animateCollected(drop) { const node = activeLootNodes.get(drop.dropId); if (!node) return; const duration = pickupCollectionDurationMs(); node.style.setProperty("--loot-collect-duration", `${duration}ms`); node.classList.add("collecting"); node.style.left = "50%"; node.style.top = "50%"; setTimeout(() => { node.remove(); activeLootNodes.delete(drop.dropId); render(); }, duration); }
  function drainGroundLoot(limit = 1) {
    let snapshot = equipment.snapshot(); let collected = 0; pickupBlockedCode = null;
    while (snapshot.pendingDrops.length && collected < limit) {
      const drop = snapshot.pendingDrops[0];
      try { snapshot = equipment.collectDrop({ ...request("collect", snapshot), dropId: drop.dropId }); }
      catch (error) { if (["EQUIPMENT_INVENTORY_FULL", "SKILL_CARD_INVENTORY_FULL"].includes(error.code)) pickupBlockedCode = error.code; else $("m4LatestPickup").textContent = `拾取失败 · ${error.code ?? error.message}`; break; }
      latestPickup = drop.item; pickupLogs.unshift({ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), item: drop.item }); if (pickupLogs.length > 80) pickupLogs.length = 80; addPickupFeed(drop.item); animateCollected(drop); window.dispatchEvent(new CustomEvent("inf-idle:loot-collected", { detail: { item: drop.item } })); collected += 1;
    }
    persist(snapshot); renderPickupLog(); render(snapshot); return collected;
  }
  function animateLootDrop(drop, position, delay = 0) {
    if (activeLootNodes.size >= MAX_VISIBLE_GROUND_LOOT) {
      const oldestVisibleDropId = activeLootNodes.keys().next().value;
      activeLootNodes.get(oldestVisibleDropId)?.remove();
      activeLootNodes.delete(oldestVisibleDropId);
    }
    const item = drop.item; const node = document.createElement("div"); node.className = `radar-loot rarity-${item.rarity}`; node.style.left = `${position.x}%`; node.style.top = `${position.y}%`; node.innerHTML = `<i></i><span>${item.icon}</span><b>${item.name}</b><small>${rarityLabel(item)} · Lv.${item.itemLevel}${item.skillLevel ? ` · 技能Lv.${item.skillLevel}` : ""}</small>`; radarLootLayer.append(node); activeLootNodes.set(drop.dropId, node); requestAnimationFrame(() => node.classList.add("landed"));
    setTimeout(() => drainGroundLoot(1), (1100 + delay) / pickupSpeedMultiplier);
  }

  window.addEventListener("inf-idle:authoritative-monster-defeated", (event) => {
    const detail = event.detail; let snapshot = equipment.snapshot(); const rolled = [];
    for (let dropIndex = 0; dropIndex < 3; dropIndex += 1) {
      try { const known = new Set(snapshot.pendingDrops.map((drop) => drop.dropId)); snapshot = equipment.rollMonsterLoot({ ...request("kill-loot", snapshot), monsterLevel: detail.monsterLevel, mapId: $("m4MapMode").value === "fixed" ? "campaign-grassland" : "final-endless-field", encounterId: `battle-${detail.killCount}`, monsterId: `${detail.monsterId}:${dropIndex}`, seed: `battle:${detail.monsterId}:${detail.killCount}:${detail.monsterLevel}:${dropIndex}` }); const drop = snapshot.pendingDrops.find((entry) => !known.has(entry.dropId)); if (drop) rolled.push(drop); }
      catch (error) { $("m4LatestPickup").textContent = error.code === "GROUND_LOOT_LIMIT_EXCEEDED" ? "地图掉落已达 2,000 件上限" : `掉落失败 · ${error.code ?? error.message}`; break; }
    }
    render(snapshot); rolled.forEach((drop, index) => animateLootDrop(drop, { x: Math.max(8, Math.min(92, detail.x + (index - 1) * 3.5)), y: Math.max(8, Math.min(92, detail.y + (index % 2 === 0 ? -1.5 : 2))) }, index * 180));
  });
  window.addEventListener("inf-idle:battle-speed-changed", (event) => { pickupSpeedMultiplier = Math.max(1, Number(event.detail?.speed ?? 1)); activeLootNodes.forEach((node) => node.style.setProperty("--loot-collect-duration", `${pickupCollectionDurationMs()}ms`)); });

  $("m4SimulateDrop").onclick = () => { const snapshot = equipment.snapshot(); try { const next = equipment.grantDrop({ ...request("drop", snapshot), monsterLevel: monsterLevel(), mapId: "m4a-validation", encounterId: `demo-kill-${serial}`, slot: selectedSlot, seed: `m4-${Date.now()}-${serial}`, highAttribute: true }); persist(next); render(next); } catch (error) { $("m4LatestPickup").textContent = `模拟投放失败 · ${error.code}`; } };
  $("m4SimulateWeapon").onclick = () => { const snapshot = equipment.snapshot(); try { const result = equipment.grantValidationWeapon({ ...request("weapon-drop", snapshot), monsterLevel: monsterLevel(), seed: `m4c-weapon-${Date.now()}-${serial}` }); selectedItemId = result.item.instanceId; categoryFilter = "weapon"; $("m4CategoryTabs").querySelectorAll("button").forEach((entry) => entry.classList.toggle("active", entry.dataset.category === "weapon")); updateSubtypeOptions(); persist(result.snapshot); render(result.snapshot); } catch (error) { $("m4LatestPickup").textContent = `武器投放失败 · ${error.code ?? error.message}`; } };
  ["m4MapMode", "m4MapLevel", "m4PlayerLevel"].forEach((id) => { $(id).addEventListener("change", () => render()); $(id).addEventListener("input", () => render()); });
  $("m4BagTabs").querySelectorAll("[data-bag]").forEach((button) => button.onclick = () => { bagFilter = button.dataset.bag; $("m4BagTabs").querySelectorAll("button").forEach((entry) => entry.classList.toggle("active", entry === button)); render(); });
  $("m4CategoryTabs").querySelectorAll("[data-category]").forEach((button) => button.onclick = () => { categoryFilter = button.dataset.category; $("m4CategoryTabs").querySelectorAll("button").forEach((entry) => entry.classList.toggle("active", entry === button)); updateSubtypeOptions(); render(); });
  ["m4SubtypeFilter", "m4RarityFilter", "m4SortMode"].forEach((id) => $(id).addEventListener("change", () => render()));
  $("m4AutoSort").onclick = () => { render(); $("m4AutoSort").textContent = `已按${$("m4SortMode").selectedOptions[0].textContent}整理`; setTimeout(() => { $("m4AutoSort").textContent = "一键自动排序"; }, 900); };
  ["m4SaleMaxLevel", "m4SaleRarity", "m4SalePosition"].forEach((id) => { $(id).addEventListener("input", () => renderSalePreview(equipment.snapshot())); $(id).addEventListener("change", () => renderSalePreview(equipment.snapshot())); });
  $("m4SellMatched").onclick = () => { const before = equipment.snapshot(); const matches = saleCandidates(before); if (!matches.length) return; try { const next = equipment.sellItems({ ...request("sell", before), filter: currentSaleFilter() }); const soldCount = before.items.length - next.items.length; const earned = next.gold - before.gold; if (matches.some((item) => item.instanceId === selectedItemId)) selectedItemId = null; $("m4SaleResult").textContent = `已出售 ${soldCount} 件 · +${earned.toLocaleString()} 金币`; syncCharacter(next); render(next); drainGroundLoot(80); } catch (error) { $("m4SaleResult").textContent = `出售失败 · ${error.code ?? error.message}`; } };
  $("m4ResetLootTest").onclick = () => { localStorage.removeItem(SAVE_KEY); location.reload(); };
  $("m4ForgeryTest").onclick = () => { try { equipment.grantDrop({ ...request("forgery"), monsterLevel: monsterLevel(), affixes: [{ statId: "physicalAttack", value: 999999 }] }); } catch (error) { $("m4BuildProof").textContent = `服务器已拒绝 · ${error.code}`; } };
  updateSubtypeOptions(); renderPickupLog(); syncCharacter(equipment.snapshot()); render();
}
