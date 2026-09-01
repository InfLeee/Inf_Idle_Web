import { nextPrimaryPointCost } from "../../packages/character-stats/src/index.js?v=stats-m2c-2";
import { createEncounterAuthoritativeSimulator } from "../../packages/server-core/src/encounter-authoritative-simulator.js?v=stats-m2c-2";
import {
  allocatePrimaryStat,
  characterProgressionAuthority,
  currentLoadoutSnapshot,
  resetPrimaryStats,
  subscribeLoadoutSnapshot,
  unallocatePrimaryStat,
} from "./loadout-authority.js?v=mastery-stats-2";

const $ = (id) => document.getElementById(id);
const PRIMARY_NAMES = Object.freeze({ str: "力量", int: "智力", agi: "敏捷", dex: "灵巧", con: "体质", luk: "幸运" });
const DERIVED_NAMES = Object.freeze({
  physicalAttack: "物理攻击", magicAttack: "魔法攻击", maxHp: "最大生命", maxResource: "最大资源",
  attackSpeedRating: "攻击速度评级", hasteRating: "吟唱急速评级", physicalDefense: "物理防御",
  magicDefense: "魔法防御", accuracy: "命中", critRating: "暴击评级", critResistance: "暴击抵抗",
  physicalPenetration: "物理穿透", magicPenetration: "魔法穿透", movementSpeedRating: "移动速度评级",
});
const DERIVED_GROUPS = Object.freeze({
  offense: new Set(["physicalAttack", "magicAttack", "physicalPenetration", "magicPenetration", "accuracy", "critRating"]),
  survival: new Set(["maxHp", "maxResource", "physicalDefense", "magicDefense", "critResistance"]),
  tempo: new Set(["attackSpeedRating", "hasteRating", "movementSpeedRating"]),
});
let requestSerial = 0;
let loadoutSnapshot = currentLoadoutSnapshot();
let message = "服务器属性快照已建立";

function progression() {
  return characterProgressionAuthority.snapshot();
}

function number(value) {
  return Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function sourceLines(stats, statId) {
  const source = stats.derived.sources[statId];
  const primaryParts = Object.entries(source.primary)
    .filter(([, value]) => value !== 0)
    .map(([primaryId, value]) => `${primaryId.toUpperCase()}贡献 ${number(value)}`);
  const masterySources = (stats.provenance ?? []).filter((entry) =>
    (entry.targetKind === "derived" && entry.statId === statId) ||
    (entry.targetKind === "primary" && Object.hasOwn(source.primary, entry.statId)),
  ).map((entry) => `精通·${entry.sourceName}：${entry.statId} ${entry.amount >= 0 ? "+" : ""}${number(entry.amount)}${entry.bucket === "basePercent" ? "（基础百分比）" : ""}`);
  return [
    `固定基础 ${number(source.definitionBase)}`,
    ...masterySources,
    ...primaryParts,
    `装备/基础加值 ${number(source.equipmentBase)}`,
    `基础小计 ${number(source.baseSubtotal)}`,
    `基础百分比 ${(source.basePercent * 100).toFixed(1)}%（+${number(source.percentBonus)}）`,
    `额外值 ${number(source.extra)}（不吃百分比）`,
    `最终 ${number(source.final)}`,
  ];
}

function sourceFormula(stats, statId) {
  const source = stats.derived.sources[statId];
  return `基础 ${number(source.baseSubtotal)} + 百分比增量 ${number(source.percentBonus)} + 额外 ${number(source.extra)} = ${number(source.final)}`;
}

function setSummaryTooltip(nodeId, stats, statId) {
  const node = $(nodeId).closest("span");
  node.classList.add("stat-source-tooltip");
  node.dataset.tooltip = sourceLines(stats, statId).join("\n");
  node.setAttribute("tabindex", "0");
}

function detailGroup(statId) {
  return Object.entries(DERIVED_GROUPS).find(([, ids]) => ids.has(statId))?.[0] ?? "other";
}

function renderDerivedDetails(stats) {
  const groupNames = { offense: "输出属性", survival: "生存与资源", tempo: "节奏与探索", other: "其他属性" };
  const entries = Object.keys(stats.derived.final).map((statId) => ({ statId, group: detailGroup(statId) }));
  $("statDerivedDetails").innerHTML = Object.keys(groupNames).map((groupId) => {
    const items = entries.filter((entry) => entry.group === groupId);
    if (!items.length) return "";
    return `<section><h4>${groupNames[groupId]}</h4><div>${items.map(({ statId }) => {
      const source = stats.derived.sources[statId];
      return `<article class="derived-detail-card stat-source-tooltip" tabindex="0" data-tooltip="${sourceLines(stats, statId).join("&#10;")}"><span>${DERIVED_NAMES[statId] ?? statId}</span><strong>${number(source.final)}</strong><small>${sourceFormula(stats, statId)}</small></article>`;
    }).join("")}</div></section>`;
  }).join("");
  $("statRateDetails").innerHTML = [
    ["攻击频率倍率", `${stats.combatRates.attackFrequencyMultiplier.toFixed(3)}×`, "攻击速度评级 ÷ 500 + 1"],
    ["吟唱时间倍率", `${stats.combatRates.castTimeMultiplier.toFixed(3)}×`, "急速按版本化倒数公式换算"],
    ["遇敌频率倍率", `${stats.combatRates.encounterMovementMultiplier.toFixed(3)}×`, "只改变遇敌频率，不直接扩大当前容量"],
    ["公共释放锁", `${stats.combatRates.gcdMs}ms`, "常态不受六维和普通装备属性影响"],
  ].map(([name, value, copy]) => `<article><span>${name}</span><strong>${value}</strong><small>${copy}</small></article>`).join("");
}

function render() {
  const snapshot = progression();
  const stats = loadoutSnapshot.compiledBuild?.characterStats ?? snapshot.characterStats;
  $("statLevel").textContent = `Lv.${stats.level}`;
  $("statPointBudget").textContent = `${stats.pointBudget.remaining} / ${stats.pointBudget.total}`;
  $("statProgressionVersion").textContent = `Stats v${snapshot.progressionVersion} · ${snapshot.progressionHash.slice(0, 10)}`;
  $("statAuthorityMessage").textContent = message;
  for (const [id, name] of Object.entries(PRIMARY_NAMES)) {
    const value = stats.allocations[id];
    const cost = nextPrimaryPointCost(value, stats.rules);
    $(`stat-${id}-value`).textContent = value;
    $(`stat-${id}-detail`).textContent = `最终 ${stats.primary.final[id]} · 下1点 ${cost ?? "已满"}`;
    const add = $(`stat-${id}-add`);
    const subtract = $(`stat-${id}-subtract`);
    add.disabled = cost === null || cost > stats.pointBudget.remaining;
    add.title = `${name}提升1点，服务器消耗 ${cost ?? 0} 点`;
    subtract.disabled = value <= stats.rules.minimumPrimaryStat;
    subtract.title = `${name}退还最后投入的1点及其实际消耗`;
  }
  const derived = stats.derived.final;
  $("statPhysicalAttack").textContent = number(derived.physicalAttack);
  $("statMagicAttack").textContent = number(derived.magicAttack);
  $("statMaxHp").textContent = number(derived.maxHp);
  $("statAttackRate").textContent = `${stats.combatRates.attackFrequencyMultiplier.toFixed(3)}×`;
  $("statCastRate").textContent = `${stats.combatRates.castTimeMultiplier.toFixed(3)}×`;
  $("statEncounterRate").textContent = `${stats.combatRates.encounterMovementMultiplier.toFixed(3)}×`;
  setSummaryTooltip("statPhysicalAttack", stats, "physicalAttack");
  setSummaryTooltip("statMagicAttack", stats, "magicAttack");
  setSummaryTooltip("statMaxHp", stats, "maxHp");
  renderDerivedDetails(stats);
  $("statBuildProof").textContent = loadoutSnapshot.compiledBuild
    ? `已进入构筑 ${loadoutSnapshot.compiledBuild.buildHash.slice(0, 12)}`
    : "属性已保存；装备带技能武器后进入构筑";
}

function commandId(prefix) {
  requestSerial += 1;
  return `stats-${prefix}-${Date.now()}-${requestSerial}`;
}

for (const statId of Object.keys(PRIMARY_NAMES)) {
  $(`stat-${statId}-add`).addEventListener("click", () => {
    const before = progression();
    try {
      allocatePrimaryStat({ requestId: commandId(statId), expectedVersion: before.progressionVersion, statId, amount: 1 });
      message = `服务器确认：${PRIMARY_NAMES[statId]} +1，构筑已立即重编译`;
    } catch (error) {
      message = `加点被拒绝 · ${error.code ?? error.message}`;
    }
    render();
  });
  $(`stat-${statId}-subtract`).addEventListener("click", () => {
    const before = progression();
    try {
      unallocatePrimaryStat({ requestId: commandId(`${statId}-subtract`), expectedVersion: before.progressionVersion, statId, amount: 1 });
      message = `服务器确认：${PRIMARY_NAMES[statId]} -1，实际点数已退还并重编译`;
    } catch (error) {
      message = `减点被拒绝 · ${error.code ?? error.message}`;
    }
    render();
  });
}

$("statDetailsToggle").addEventListener("click", () => {
  const panel = $("statDerivedPanel");
  panel.hidden = !panel.hidden;
  $("statDetailsToggle").setAttribute("aria-expanded", String(!panel.hidden));
  $("statDetailsToggle").textContent = panel.hidden ? "查看二级属性详情" : "收起二级属性详情";
});

$("statReset").addEventListener("click", () => {
  const before = progression();
  try {
    resetPrimaryStats({ requestId: commandId("reset"), expectedVersion: before.progressionVersion });
    message = "服务器确认：六维已洗点，构筑已立即重编译";
  } catch (error) {
    message = `洗点被拒绝 · ${error.code ?? error.message}`;
  }
  render();
});

$("statForgeryTest").addEventListener("click", () => {
  const before = progression();
  try {
    characterProgressionAuthority.allocate({
      requestId: commandId("forgery"), expectedVersion: before.progressionVersion,
      statId: "str", amount: 1, finalPrimary: { str: 999999 },
    });
    message = "异常：伪造最终属性未被拒绝";
  } catch (error) {
    message = `伪造包已拒绝 · ${error.code}`;
  }
  render();
});

$("statDamageTest").addEventListener("click", () => {
  const build = loadoutSnapshot.compiledBuild;
  if (!build) {
    message = "请先装备一把带技能卡的武器，再运行权威伤害样本";
    render();
    return;
  }
  const simulator = createEncounterAuthoritativeSimulator();
  const encounter = {
    id: "stats-proof", mode: "endless_world_v1",
    monsterDefinitions: [{ id: "stats-dummy", maxHp: 999999, attackDamage: 0, attackIntervalMs: 2000 }],
    worldConfig: {
      radarRadiusM: 10, stopDistanceM: 1, monsterApproachSpeedMps: 100, initialEncounterDelayMs: 0,
      baseEncounterIntervalMs: 1000, minimumEncounterIntervalMs: 100,
      encounterCapacityWindowMs: 5000, killRateWindowMs: 5000,
      baseLivingCapacity: 3, minimumLivingCapacity: 6, maximumLivingCapacity: 12,
    },
  };
  const initial = simulator.createInitialState({ compiledBuild: build, encounter, rngSeed: 20260828 });
  const result = simulator.advance({ state: initial, compiledBuild: build, encounter, rngSeed: 20260828, targetUntilMs: 2000 });
  const hits = result.events.filter((event) => event.type === "authoritative_damage");
  const total = hits.reduce((sum, event) => sum + event.damage, 0);
  message = hits.length
    ? `权威Runtime：2秒 ${hits.length} 次命中 / ${total} 伤害（读取当前属性快照）`
    : "权威Runtime已运行，但当前技能在2秒内没有产生伤害事件";
  render();
});

subscribeLoadoutSnapshot((next) => {
  loadoutSnapshot = next;
  render();
});
