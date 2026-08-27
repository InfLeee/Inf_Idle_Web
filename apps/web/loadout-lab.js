import { compileActionBuild } from "../../packages/build-compiler/src/compileActionBuild.js";
import { twoHandedSwordA1Config as config } from "../../packages/game-config/two-handed-sword-a1.js?v=inventory-v0-1";
import { assembleTwoHandedSwordA1CompileInput } from "../../packages/server-core/src/two-handed-sword-authority-assembler.js";
import { deriveInventoryEntries, filterInventoryEntries } from "../../packages/inventory-core/src/inventory-view.js";
import { simulateTwoHandedSwordA1 } from "../../tools/simulator/twoHandedSwordA1.js";
import { getLocalSaveStatus, legacyBuildFromSnapshot, loadoutAuthority, publishLoadoutSnapshot, resetLoadoutAuthority } from "./loadout-authority.js?v=inventory-v0-1";

const $ = (id) => document.getElementById(id);
const SUPPORT_STATUS_LABELS = Object.freeze({
  active: "已生效",
  partial: "部分生效",
  incompatible: "不兼容",
  mutual_exclusion: "互斥失效",
  effect_invalid: "目标无效",
  config_error: "配置错误",
});
const SKILL_IMAGES = {
  two_handed_sword_slash: "./assets/skill-slash.png",
  bash: "./assets/skill-bash.png",
  storm_slash: "./assets/skill-storm.png",
  bowling_bash: "./assets/skill-collision.png",
  traumatic_blow: "./assets/skill-execute.png",
  ignition_break: "./assets/skill-collision.png",
  sword_wave_projectile: "./assets/skill-storm.png",
};

let snapshot = loadoutAuthority.snapshot();
let selectedSocketIndex = 0;
let requestSerial = 1;
let acceptanceProof = { weapon: false, skill: false, support: false };
const weaponStatesSeen = new Set();
let acceptanceMessages = [];
let inventoryFilter = "all";
let inventoryQuery = "";
let selectedInventoryInstanceId = null;
const lockedInventoryInstanceIds = Object.freeze(["weapon-instance-a1-demo"]);
const INVENTORY_DRAG_TYPE = "application/x-inf-idle-item";

function requestId(kind) {
  return `loadout-ui-${kind}-${requestSerial++}`;
}

function supportStatusLabel(status) {
  return SUPPORT_STATUS_LABELS[status] ?? status ?? "未编译";
}

function modifierOperationLabel(operation) {
  if (operation.operator === "add_tag" || operation.operator === "remove_tag") {
    const scope = operation.tagScope === "skill" ? "技能" : "动作";
    const sign = operation.operator === "add_tag" ? "+" : "−";
    return `${scope} TAG ${sign}${operation.tag}`;
  }
  return `${operation.path} ${operation.operator === "multiply" ? "×" : operation.operator} ${operation.value}`;
}

function definitionName(registry, definitionId) {
  return registry.skills[definitionId]?.name ?? registry.supports[definitionId]?.name ??
    config.replacementSkills?.find((item) => item.id === definitionId)?.name ?? definitionId;
}

function execute(command, proofKey = null) {
  try {
    snapshot = command();
    $("loadoutCommandState").textContent = "服务器确认成功";
    $("loadoutCommandState").className = "accepted";
    if (proofKey) acceptanceProof[proofKey] = true;
    render();
    publishLoadoutSnapshot(snapshot);
    return true;
  } catch (error) {
    $("loadoutCommandState").textContent = `已拒绝 · ${error.code ?? error.message}`;
    $("loadoutCommandState").className = "rejected";
    return false;
  }
}

function equipSkill(skillInstanceId) {
  const sockets = snapshot.ownershipInput.loadout.skillSockets;
  const equippedAt = sockets.indexOf(skillInstanceId);
  if (equippedAt >= 0) {
    selectedSocketIndex = equippedAt;
    render();
    return;
  }
  const target = sockets[selectedSocketIndex] === null
    ? selectedSocketIndex
    : sockets.findIndex((instanceId) => instanceId === null);
  const socketIndex = target >= 0 ? target : selectedSocketIndex;
  execute(() => loadoutAuthority.equipSkill({
    requestId: requestId("equip"),
    expectedVersion: snapshot.loadoutVersion,
    skillInstanceId,
    socketIndex,
  }), "skill");
}

function removeSkill(socketIndex) {
  execute(() => loadoutAuthority.unequipSkill({
    requestId: requestId("unequip"),
    expectedVersion: snapshot.loadoutVersion,
    socketIndex,
  }), "skill");
}

function toggleSupport(supportInstanceId) {
  const skillInstanceId = snapshot.ownershipInput.loadout.skillSockets[selectedSocketIndex];
  if (!skillInstanceId) {
    $("loadoutCommandState").textContent = "已拒绝 · 请先选择有技能的孔位";
    $("loadoutCommandState").className = "rejected";
    return;
  }
  const attached = snapshot.ownershipInput.loadout.supportConnections[skillInstanceId] ?? [];
  execute(() => loadoutAuthority.setSupport({
    requestId: requestId("support"),
    expectedVersion: snapshot.loadoutVersion,
    skillInstanceId,
    supportInstanceId,
    enabled: !attached.includes(supportInstanceId),
  }), "support");
}

function setMastery(nodeIds, label) {
  execute(() => loadoutAuthority.setMasterySelection({
    requestId: requestId("mastery"),
    expectedVersion: snapshot.loadoutVersion,
    nodeIds,
  }));
  if ($("loadoutCommandState").classList.contains("accepted")) {
    $("loadoutCommandState").textContent = `服务器确认成功 · ${label}`;
  }
}

function inventoryStatusLabel(entry) {
  if (entry.occupancy === "equipped") return "装备中";
  if (entry.occupancy === "socketed") return `已镶嵌 · 孔 ${entry.socketIndex + 1}`;
  if (entry.occupancy === "connected") return "已连接";
  return "空闲";
}

function inventoryKindLabel(kind) {
  return { weapon: "武器", skill: "技能卡", support: "辅助卡" }[kind] ?? kind;
}

function inventoryGlyph(kind) {
  return { weapon: "⚔", skill: "✦", support: "◇" }[kind] ?? "?";
}

function inventoryEntries() {
  return deriveInventoryEntries(snapshot, { lockedInstanceIds: lockedInventoryInstanceIds });
}

function updateDevDefinitionOptions(registry) {
  const kind = $("devItemKind").value;
  const definitions = kind === "weapon"
    ? Object.values(registry.weapons)
    : kind === "skill"
      ? Object.values(registry.skills).filter((item) => item.sourceType === "skill_card")
      : Object.values(registry.supports);
  const previous = $("devItemDefinition").value;
  $("devItemDefinition").innerHTML = definitions.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  if (definitions.some((item) => item.id === previous)) $("devItemDefinition").value = previous;
}

function renderInventoryDetail(entries) {
  const entry = entries.find((item) => item.instanceId === selectedInventoryInstanceId);
  if (!entry) {
    $("inventoryDetail").innerHTML = "<small>ITEM DETAIL</small><h3>选择一个物品</h3><p>点击查看来源与占用关系；拖到武器区或五孔完成操作。</p>";
    return;
  }
  const occupied = entry.occupiedByWeaponInstanceId ?? "无";
  $("inventoryDetail").innerHTML = `<small>${inventoryKindLabel(entry.kind).toUpperCase()} DETAIL</small><h3>${entry.name}</h3><p>${entry.locked ? "开发基准资产已锁定；" : "可用资产；"}${inventoryStatusLabel(entry)}。</p><dl>
    <div><dt>实例 ID</dt><dd>${entry.instanceId}</dd></div><div><dt>定义 ID</dt><dd>${entry.definitionId}</dd></div>
    <div><dt>等级 / 品质</dt><dd>${entry.level ?? "—"} / ${entry.quality ?? "—"}</dd></div><div><dt>占用武器</dt><dd>${occupied}</dd></div>
  </dl>`;
}

function renderBackpack(registry) {
  const entries = inventoryEntries();
  if (selectedInventoryInstanceId && !entries.some((item) => item.instanceId === selectedInventoryInstanceId)) {
    selectedInventoryInstanceId = null;
  }
  const visible = filterInventoryEntries(entries, { kind: inventoryFilter, query: inventoryQuery });
  $("inventoryVisibleCount").textContent = `${visible.length} / ${entries.length}`;
  $("inventoryGrid").innerHTML = visible.length ? visible.map((entry) => {
    const occupancyClass = entry.occupancy === "equipped" ? "equipped" : entry.occupancy === "available" ? "" : "occupied";
    return `<button type="button" draggable="true" class="inventory-item ${occupancyClass} ${entry.locked ? "locked" : ""} ${selectedInventoryInstanceId === entry.instanceId ? "selected" : ""}" data-inventory-instance="${entry.instanceId}">
      <span class="item-icon">${inventoryGlyph(entry.kind)}</span><div><strong>${entry.name}</strong><small>${entry.instanceId}</small><small>${inventoryKindLabel(entry.kind)} · ${inventoryStatusLabel(entry)}</small></div><em>${entry.locked ? "锁定 · " : ""}${inventoryStatusLabel(entry)}</em>
    </button>`;
  }).join("") : '<div class="inventory-empty">没有符合当前分类与搜索条件的物品</div>';
  $("inventoryGrid").querySelectorAll("[data-inventory-instance]").forEach((node) => {
    node.addEventListener("click", () => {
      selectedInventoryInstanceId = node.dataset.inventoryInstance;
      renderBackpack(registry);
    });
    node.addEventListener("dragstart", (event) => {
      const entry = entries.find((item) => item.instanceId === node.dataset.inventoryInstance);
      const payload = JSON.stringify({ kind: entry.kind, instanceId: entry.instanceId });
      event.dataTransfer.setData(INVENTORY_DRAG_TYPE, payload);
      event.dataTransfer.setData("text/plain", payload);
      event.dataTransfer.effectAllowed = "move";
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => node.classList.remove("dragging"));
  });
  renderInventoryDetail(entries);
  updateDevDefinitionOptions(registry);
  const weaponDropZone = $("weaponEquipDropZone");
  weaponDropZone.ondragover = (event) => { event.preventDefault(); weaponDropZone.classList.add("inventory-drop-ready"); };
  weaponDropZone.ondragleave = () => weaponDropZone.classList.remove("inventory-drop-ready");
  weaponDropZone.ondrop = (event) => {
    event.preventDefault();
    weaponDropZone.classList.remove("inventory-drop-ready");
    const item = draggedInventoryItem(event);
    if (item?.kind === "weapon") equipWeaponInstance(item.instanceId);
  };
}

function draggedInventoryItem(event) {
  const raw = event.dataTransfer.getData(INVENTORY_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
  try { return JSON.parse(raw); } catch { return null; }
}

function equipWeaponInstance(weaponInstanceId) {
  execute(() => loadoutAuthority.equipWeapon({
    requestId: requestId("equip-weapon"), expectedVersion: snapshot.loadoutVersion, weaponInstanceId,
  }));
}

function equipSkillAt(skillInstanceId, socketIndex) {
  selectedSocketIndex = socketIndex;
  execute(() => loadoutAuthority.equipSkill({
    requestId: requestId("equip"), expectedVersion: snapshot.loadoutVersion, skillInstanceId, socketIndex,
  }), "skill");
}

function connectSupportAt(supportInstanceId, socketIndex) {
  const skillInstanceId = snapshot.ownershipInput.loadout.skillSockets[socketIndex];
  if (!skillInstanceId) {
    $("loadoutCommandState").textContent = "已拒绝 · 辅助卡必须拖到已有技能的孔位";
    $("loadoutCommandState").className = "rejected";
    return;
  }
  selectedSocketIndex = socketIndex;
  const attached = snapshot.ownershipInput.loadout.supportConnections[skillInstanceId] ?? [];
  if (attached.includes(supportInstanceId)) return;
  execute(() => loadoutAuthority.setSupport({
    requestId: requestId("support"), expectedVersion: snapshot.loadoutVersion,
    skillInstanceId, supportInstanceId, enabled: true,
  }), "support");
}

function grantTestItem() {
  const before = new Set(inventoryEntries().map((item) => item.instanceId));
  const ok = execute(() => loadoutAuthority.grantTestItem({
    requestId: requestId("grant-test-item"), expectedVersion: snapshot.loadoutVersion,
    itemKind: $("devItemKind").value, definitionId: $("devItemDefinition").value,
  }));
  if (!ok) return;
  selectedInventoryInstanceId = inventoryEntries().find((item) => !before.has(item.instanceId))?.instanceId ?? null;
  render();
  $("loadoutCommandState").textContent = "服务器确认成功 · 测试物品已加入背包";
}
function renderSockets(skillInstances, registry) {
  const connections = snapshot.ownershipInput.loadout.supportConnections;
  $("authoritySockets").innerHTML = snapshot.ownershipInput.loadout.skillSockets.map((instanceId, index) => {
    const instance = skillInstances.get(instanceId);
    const definition = instance ? registry.skills[instance.definitionId] : null;
    const supports = instanceId ? connections[instanceId] ?? [] : [];
    return `<article class="authority-socket ${selectedSocketIndex === index ? "selected" : ""} ${instance ? "filled" : "empty"}" data-socket-index="${index}">
      <b>${index + 1}</b>
      ${instance ? `<img src="${SKILL_IMAGES[instance.definitionId]}" alt=""><div><strong>${definition.name}</strong><small>${instance.instanceId}</small><span>${supports.length} / ${config.build.supportSlotsPerSkill} 张辅助卡</span></div><button type="button" data-remove-socket="${index}" aria-label="卸下技能">×</button>` : `<div><strong>空孔</strong><small>点击选择，再从背包装入</small></div>`}
    </article>`;
  }).join("");
  $("authoritySockets").querySelectorAll("[data-socket-index]").forEach((node) => node.addEventListener("click", () => {
    selectedSocketIndex = Number(node.dataset.socketIndex);
    render();
  }));
  $("authoritySockets").querySelectorAll("[data-remove-socket]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    removeSkill(Number(button.dataset.removeSocket));
  }));
  $("authoritySockets").querySelectorAll("[data-socket-index]").forEach((node) => {
    node.addEventListener("dragover", (event) => {
      event.preventDefault();
      node.classList.add("inventory-drop-ready");
    });
    node.addEventListener("dragleave", () => node.classList.remove("inventory-drop-ready"));
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("inventory-drop-ready");
      const item = draggedInventoryItem(event);
      const socketIndex = Number(node.dataset.socketIndex);
      if (item?.kind === "skill") equipSkillAt(item.instanceId, socketIndex);
      else if (item?.kind === "support") connectSupportAt(item.instanceId, socketIndex);
    });
  });
}

function renderInventory(skillInstances, registry) {
  const equipped = new Set(snapshot.ownershipInput.loadout.skillSockets.filter(Boolean));
  $("skillInventory").innerHTML = [...skillInstances.values()].map((instance) => {
    const definition = registry.skills[instance.definitionId];
    const socketIndex = snapshot.ownershipInput.loadout.skillSockets.indexOf(instance.instanceId);
    return `<button type="button" class="inventory-skill ${equipped.has(instance.instanceId) ? "equipped" : ""}" data-skill-instance="${instance.instanceId}">
      <img src="${SKILL_IMAGES[instance.definitionId]}" alt=""><span><strong>${definition.name}</strong><small>${socketIndex >= 0 ? `已装备 · 孔 ${socketIndex + 1}` : "背包中 · 点击装入"}</small></span>
    </button>`;
  }).join("");
  $("skillInventory").querySelectorAll("[data-skill-instance]").forEach((button) => button.addEventListener("click", () => {
    equipSkill(button.dataset.skillInstance);
  }));
}

function renderSupports(supportInstances, registry) {
  const selectedSkillId = snapshot.ownershipInput.loadout.skillSockets[selectedSocketIndex];
  const connections = snapshot.ownershipInput.loadout.supportConnections;
  const selectedSupports = selectedSkillId ? connections[selectedSkillId] ?? [] : [];
  const supportLimit = config.build.supportSlotsPerSkill;
  const statusByInstance = new Map((snapshot.compiledBuild?.supportStatuses ?? []).map((item) => [item.sourceInstanceId, item]));
  $("selectedSocketLabel").textContent = selectedSkillId
    ? `当前目标：孔 ${selectedSocketIndex + 1} · 已装 ${selectedSupports.length} / ${supportLimit} · ${supportInstances.size} 张可用`
    : `当前目标：孔 ${selectedSocketIndex + 1}（空）· ${supportInstances.size} 张可用`;
  $("authoritySupports").innerHTML = [...supportInstances.values()].map((instance) => {
    const attachedTarget = Object.entries(connections).find(([, ids]) => ids.includes(instance.instanceId))?.[0];
    const active = attachedTarget === selectedSkillId;
    const capacityBlocked = !active && selectedSupports.length >= supportLimit;
    const targetIndex = snapshot.ownershipInput.loadout.skillSockets.indexOf(attachedTarget);
    const status = statusByInstance.get(instance.instanceId);
    const definition = config.supports.find((item) => item.id === instance.definitionId);
    const requirements = definition?.compatibility?.requireAll?.join(" + ") ?? "无TAG限制";
    const statusClass = status?.status === "mutual_exclusion" ? "mutual-exclusion" : "";
    const transitionTest = [
      "proximity_detonation_support",
      "explosion_aoe_amplification_support",
      "projectile_amplification_support",
    ].includes(instance.definitionId) ? "transition-test" : "";
    return `<button type="button" class="authority-support ${active ? "active" : ""} ${statusClass} ${transitionTest}" data-support-instance="${instance.instanceId}" ${capacityBlocked ? "disabled" : ""}>
      <strong>${definitionName(registry, instance.definitionId)}</strong>
      <small>${attachedTarget ? `已连接孔 ${targetIndex + 1} · ${supportStatusLabel(status?.status)}` : capacityBlocked ? "辅助槽已满" : "未连接"}</small>
      <em>${requirements}</em>
    </button>`;
  }).join("");
  $("authoritySupports").querySelectorAll("[data-support-instance]").forEach((button) => button.addEventListener("click", () => {
    toggleSupport(button.dataset.supportInstance);
  }));
}

function renderMastery() {
  const selected = new Set(Object.keys(snapshot.ownershipInput.loadout.masteryAllocation.nodeRanks));
  $("masteryTrack").innerHTML = config.masteryNodes.map((node) => `<span class="mastery-node ${selected.has(node.id) ? "active" : ""}">
    <i>${selected.has(node.id) ? "✓" : node.cost}</i><b>${node.name}</b><small>${node.scope} · ${node.cost}点</small>
  </span>`).join("");
  const spent = config.masteryNodes.filter((node) => selected.has(node.id)).reduce((total, node) => total + node.cost, 0);
  $("masterySpent").textContent = `${spent} / ${config.build.pointBudget} 点`;
}

function renderSnapshot(registry) {
  const build = snapshot.compiledBuild;
  const occupied = snapshot.ownershipInput.loadout.skillSockets.filter(Boolean).length;
  $("authorityVersion").textContent = `Loadout v${snapshot.loadoutVersion}`;
  const weaponEquipped = snapshot.characterBuild.equippedWeaponInstanceId !== null;
  $("authorityReady").textContent = snapshot.combatReady ? "可进入战斗" : weaponEquipped ? "不可开战：至少需要 1 张技能卡" : "不可开战：未穿戴武器";
  $("authorityReady").className = snapshot.combatReady ? "ready" : "blocked";
  $("authorityHash").textContent = build ? build.buildHash.slice(0, 16) : "未生成";
  $("authoritySocketCount").textContent = `${occupied} / 5`;
  $("authorityWeaponSkills").textContent = `${build?.weaponSkillEntryIds.length ?? 0} 个`;
  $("authorityModifierCount").textContent = `${build?.diagnostics.filter((item) => item.status === "applied").length ?? 0} 条`;
  const slashEntry = build?.compiledSkills.find((entry) => entry.definitionId === "two_handed_sword_slash");
  const slashAction = slashEntry?.actions[0];
  const damage = slashAction?.effects.find((effect) => effect.id === "damage")?.params.multiplier;
  $("authorityFinalSlash").textContent = slashAction
    ? `${Math.round(slashAction.timing.castTimeMs)}ms · ${damage.toFixed(2)}×`
    : "未携带斩击";
  const activeWeapon = snapshot.ownershipInput.weaponInstances.find((item) =>
    item.instanceId === snapshot.ownershipInput.loadout.weaponInstanceId);
  $("authorityWeaponName").textContent = registry.weapons[activeWeapon.definitionId].name;
  $("authorityWeaponInstanceId").textContent = activeWeapon.instanceId;
}


function actionMetrics(entry) {
  const action = entry?.actions?.[0];
  if (!action) return null;
  const damage = action.effects.find((effect) => effect.kind === "direct_damage")?.params?.multiplier ?? null;
  const castTimeMs = Math.round(action.timing?.castTimeMs ?? 0);
  return { castTimeMs, damageMultiplier: damage, text: `${castTimeMs}ms · ${damage === null ? "非伤害" : damage.toFixed(2) + "×"}` };
}

function targetingLabel(entry) {
  const selector = entry?.actions?.[0]?.targeting;
  if (!selector) return "无目标规则";
  if (selector.kind === "enemies_around_self") return `自身周围 ${selector.radiusM}m · 最多 ${selector.maxTargets ?? "不限"} 个目标`;
  if (selector.kind === "enemies_in_radius") return `目标范围 ${selector.radiusM}m · 最多 ${selector.maxTargets ?? "不限"} 个目标`;
  if (selector.kind === "current_target") return "当前目标";
  return "自身";
}

function compileWithoutSupports() {
  if (!snapshot.characterBuild.equippedWeaponInstanceId || !snapshot.combatReady) return null;
  const ownership = structuredClone(snapshot.ownershipInput);
  ownership.loadout.supportConnections = {};
  ownership.loadout.supportInsertionOrder = {};
  return compileActionBuild(assembleTwoHandedSwordA1CompileInput(config, ownership, { maxSupportsPerSkill: config.build.supportSlotsPerSkill }));
}

function setCheck(id, passed) {
  const node = $(id);
  node.classList.toggle("passed", passed);
  node.querySelector("strong").textContent = passed ? "已通过" : "待验证";
}

function renderAcceptance() {
  const equipped = snapshot.characterBuild.equippedWeaponInstanceId !== null;
  $("weaponEquipState").textContent = equipped ? "已穿戴武器实例" : "武器位为空";
  $("weaponToggleBtn").textContent = equipped ? "卸下武器" : "穿戴武器";
  $("weaponToggleBtn").classList.toggle("equip", !equipped);
  setCheck("frontCheckWeapon", acceptanceProof.weapon);
  setCheck("frontCheckSkill", acceptanceProof.skill);
  setCheck("frontCheckSupport", acceptanceProof.support);
  const passed = Object.values(acceptanceProof).filter(Boolean).length;
  $("acceptanceState").textContent = `${passed} / 3 已通过`;
  $("acceptanceState").className = passed === 3 ? "passed" : "";
  $("acceptanceLog").innerHTML = acceptanceMessages.map((message) => `<li>${message}</li>`).join("");
}

function renderBackend(registry) {
  const build = snapshot.compiledBuild;
  if (!build) {
    $("backendSkillRows").innerHTML = '<tr><td colspan="4">未穿戴武器或没有技能卡，服务器未生成战斗构筑。</td></tr>';
    $("backendModifierEvidence").innerHTML = "";
    $("backendBattleProof").textContent = "运行时阻断：当前构筑不可进入战斗";
    $("backendProofState").textContent = "未生成";
    $("backendProofState").className = "blocked";
    return;
  }
  const baseline = compileWithoutSupports();
  const baselineByEntry = new Map(baseline.compiledSkills.map((entry) => [entry.entryId, entry]));
  const applied = build.diagnostics.filter((item) => item.sourceKind === "support_card" && item.status === "applied");
  const conflicted = build.diagnostics.filter((item) => item.sourceKind === "support_card" && item.status === "mutual_exclusion");
  const statusByInstance = new Map(build.supportStatuses.map((item) => [item.sourceInstanceId, item]));
  const supportsBySkill = new Map();
  for (const status of build.supportStatuses) {
    const names = supportsBySkill.get(status.attachedSkillEntryId) ?? [];
    names.push(`${definitionName(registry, status.sourceDefinitionId)}（${supportStatusLabel(status.status)} · 顺序 ${status.insertionOrder}）`);
    supportsBySkill.set(status.attachedSkillEntryId, names);
  }
  $("backendSkillRows").innerHTML = build.compiledSkills.filter((entry) => entry.sourceType === "skill_card").map((entry) => {
    const base = actionMetrics(baselineByEntry.get(entry.entryId));
    const final = actionMetrics(entry);
    const sources = supportsBySkill.get(entry.entryId) ?? [];
    const replaced = entry.effectiveDefinitionId !== entry.definitionId;
    const name = replaced
      ? `${definitionName(registry, entry.definitionId)} → ${definitionName(registry, entry.effectiveDefinitionId)}`
      : definitionName(registry, entry.definitionId);
    return `<tr class="${base?.text !== final?.text || replaced ? "changed" : ""}"><td><b>${name}</b><small>${entry.sourceInstanceId}</small><small>最终 TAG：${entry.skillTags.join(" · ")}</small><small>目标规则：${targetingLabel(entry)}</small></td><td>${base?.text ?? "—"}</td><td><strong>${final?.text ?? "—"}</strong></td><td>${sources.length ? sources.join(" + ") : "无辅助修改"}</td></tr>`;
  }).join("");
  const evidence = [
    ...applied.map((item) => {
      const status = statusByInstance.get(item.sourceInstanceId);
      const target = build.compiledSkills.find((entry) => entry.entryId === item.skillEntryId);
      const operationText = item.type === "skill_replacement"
        ? `完整技能替换 → ${definitionName(registry, item.effectiveDefinitionId)} · ${targetingLabel(target)} · 单次爆炸`
        : item.operations.map(modifierOperationLabel).join("，");
      return `<span><b>${definitionName(registry, item.sourceDefinitionId)}</b> → ${definitionName(registry, target?.definitionId)} · ${supportStatusLabel(status?.status)} · 插入顺序 ${status?.insertionOrder ?? "?"} · ${operationText}</span>`;
    }),
    ...conflicted.map((item) => `<span class="rejected"><b>${definitionName(registry, item.sourceDefinitionId)}</b> · 互斥失效 · 胜者 ${definitionName(registry, item.winnerSourceDefinitionId)} · 胜者顺序 ${item.winnerInsertionOrder}</span>`),
  ];
  $("backendModifierEvidence").innerHTML = evidence.length
    ? evidence.join("")
    : "<span>连接辅助卡后，这里会显示服务器确认的来源实例、目标技能和运算路径。</span>";
  const runtime = simulateTwoHandedSwordA1(legacyBuildFromSnapshot(snapshot), { durationMs: 5_000 });
  const slash = build.compiledSkills.find((entry) => entry.definitionId === "two_handed_sword_slash");
  const metric = actionMetrics(slash);
  $("backendBattleProof").textContent = slash
    ? `5 秒运行时：后台斩击 ${runtime.summary.slashCount} 次；服务器最终值 ${metric.damageMultiplier.toFixed(2)}× / ${metric.castTimeMs}ms。`
    : `5 秒运行时：斩击未装孔，后台斩击 ${runtime.summary.slashCount} 次。`;
  const changed = applied.some((item) => actionMetrics(baselineByEntry.get(item.skillEntryId))?.text !== actionMetrics(build.compiledSkills.find((entry) => entry.entryId === item.skillEntryId))?.text);
  $("backendProofState").textContent = changed ? "辅助修改已生效" : "等待辅助卡修改";
  $("backendProofState").className = changed ? "passed" : "";
}

function resetLab(announce = true) {
  snapshot = resetLoadoutAuthority();
  selectedSocketIndex = 0;
  acceptanceProof = { weapon: false, skill: false, support: false };
  weaponStatesSeen.clear();
  weaponStatesSeen.add("equipped");
  acceptanceMessages = announce ? ["已恢复基准构筑，可重新执行整套验收。"] : [];
  $("loadoutCommandState").textContent = "服务器确认成功 · 已恢复基准";
  $("loadoutCommandState").className = "accepted";
  render();
  publishLoadoutSnapshot(snapshot);
}

function toggleWeapon() {
  const equipped = snapshot.characterBuild.equippedWeaponInstanceId !== null;
  const ok = equipped
    ? execute(() => loadoutAuthority.unequipWeapon({ requestId: requestId("unequip-weapon"), expectedVersion: snapshot.loadoutVersion }))
    : execute(() => loadoutAuthority.equipWeapon({ requestId: requestId("equip-weapon"), expectedVersion: snapshot.loadoutVersion, weaponInstanceId: snapshot.ownershipInput.loadout.weaponInstanceId }));
  if (!ok) return;
  weaponStatesSeen.add(equipped ? "unequipped" : "equipped");
  acceptanceProof.weapon = weaponStatesSeen.has("equipped") && weaponStatesSeen.has("unequipped");
  acceptanceMessages.push(equipped ? "武器已卸下：服务器撤销编译快照并禁止战斗。" : "武器已重新穿戴：服务器依据武器实例恢复五孔构筑。");
  render();
}

function runAcceptance() {
  resetLab(false);
  acceptanceMessages = ["开始联合验收：所有步骤均通过版本化权威命令执行。"];
  toggleWeapon();
  const weaponBlocked = !snapshot.combatReady && snapshot.compiledBuild === null;
  toggleWeapon();
  const weaponRestored = snapshot.combatReady && snapshot.compiledBuild !== null;
  const slashId = "skill-instance-a1-1";
  removeSkill(0);
  const skillRemoved = !snapshot.compiledBuild.compiledSkills.some((entry) => entry.sourceInstanceId === slashId);
  selectedSocketIndex = 0;
  equipSkill(slashId);
  const skillRestored = snapshot.compiledBuild.compiledSkills.some((entry) => entry.sourceInstanceId === slashId);
  toggleSupport("support-instance-a1-1");
  toggleSupport("support-instance-a1-2");
  const slash = snapshot.compiledBuild.compiledSkills.find((entry) => entry.sourceInstanceId === slashId);
  const metric = actionMetrics(slash);
  const diagnostics = snapshot.compiledBuild.diagnostics.filter((item) => item.sourceKind === "support_card" && item.status === "applied");
  acceptanceProof = {
    weapon: weaponBlocked && weaponRestored,
    skill: skillRemoved && skillRestored,
    support: metric.castTimeMs === 220 && metric.damageMultiplier === 1.3 && diagnostics.length === 2 &&
      snapshot.compiledBuild.supportStatuses.length === 2 && snapshot.compiledBuild.supportStatuses.every((item) => item.status === "active"),
  };
  acceptanceMessages.push(
    `武器链路：${acceptanceProof.weapon ? "通过" : "失败"}（卸下阻断、重装恢复）。`,
    `技能链路：${acceptanceProof.skill ? "通过" : "失败"}（卸孔移除编译、装回重新生效）。`,
    `辅助链路：${acceptanceProof.support ? "通过" : "失败"}（目标 220ms / 1.30×，2 条来源记录）。`,
  );
  render();
  const passed = Object.values(acceptanceProof).every(Boolean);
  $("loadoutCommandState").textContent = passed ? "联合验收通过" : "联合验收失败，请查看记录";
  $("loadoutCommandState").className = passed ? "accepted" : "rejected";
  publishLoadoutSnapshot(snapshot);
}

function render() {
  const ownership = snapshot.ownershipInput;
  const registry = ownership.registry;
  const skillInstances = new Map(ownership.skillCardInstances.map((item) => [item.instanceId, item]));
  const supportInstances = new Map(ownership.supportCardInstances.map((item) => [item.instanceId, item]));
  renderBackpack(registry);
  renderSockets(skillInstances, registry);
  renderInventory(skillInstances, registry);
  renderSupports(supportInstances, registry);
  renderMastery();
  renderSnapshot(registry);
  renderAcceptance();
  renderBackend(registry);
}

$("inventoryFilters").querySelectorAll("[data-inventory-filter]").forEach((button) => button.addEventListener("click", () => {
  inventoryFilter = button.dataset.inventoryFilter;
  $("inventoryFilters").querySelectorAll("[data-inventory-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderBackpack(snapshot.ownershipInput.registry);
}));
$("inventorySearch").addEventListener("input", (event) => {
  inventoryQuery = event.target.value;
  renderBackpack(snapshot.ownershipInput.registry);
});
$("devItemKind").addEventListener("change", () => updateDevDefinitionOptions(snapshot.ownershipInput.registry));
$("grantTestItemBtn").addEventListener("click", grantTestItem);
$("masteryBaseBtn").addEventListener("click", () => setMastery(config.build.defaultMasteryNodeIds, "基础路线"));
$("masteryFullBtn").addEventListener("click", () => setMastery(config.recommendedRoute, "完整 30 点路线"));
$("weaponToggleBtn").addEventListener("click", toggleWeapon);
$("resetLoadoutBtn").addEventListener("click", () => resetLab(true));
$("runAcceptanceBtn").addEventListener("click", runAcceptance);

render();
publishLoadoutSnapshot(snapshot);
const initialSaveStatus = getLocalSaveStatus();
if (initialSaveStatus.status === "restored") {
  $("loadoutCommandState").textContent = "\u5df2\u4ece\u672c\u5730\u5b58\u6863\u6062\u590d\u5e76\u91cd\u65b0\u7f16\u8bd1";
  $("loadoutCommandState").className = "accepted";
} else if (initialSaveStatus.status === "rejected") {
  $("loadoutCommandState").textContent = "\u5b58\u6863\u5df2\u62d2\u7edd \u00b7 " + initialSaveStatus.code + " \u00b7 \u5df2\u6062\u590d\u57fa\u51c6";
  $("loadoutCommandState").className = "rejected";
} else if (initialSaveStatus.status === "write_failed") {
  $("loadoutCommandState").textContent = "\u672c\u5730\u5b58\u6863\u5199\u5165\u5931\u8d25";
  $("loadoutCommandState").className = "rejected";
} else if (initialSaveStatus.status === "read_failed") {
  $("loadoutCommandState").textContent = "\u672c\u5730\u5b58\u6863\u8bfb\u53d6\u5931\u8d25 \u00b7 \u5df2\u4f7f\u7528\u57fa\u51c6\u6784\u7b51";
  $("loadoutCommandState").className = "rejected";
}
