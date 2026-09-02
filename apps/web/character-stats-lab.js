import { nextPrimaryPointCost } from "../../packages/character-stats/src/index.js?v=stats-m2c-1";
import { createEncounterAuthoritativeSimulator } from "../../packages/server-core/src/encounter-authoritative-simulator.js?v=stats-m2c-1";
import {
  allocatePrimaryStat,
  characterProgressionAuthority,
  currentLoadoutSnapshot,
  resetPrimaryStats,
  subscribeLoadoutSnapshot,
} from "./loadout-authority.js?v=m4c-closure-3";

const $ = (id) => document.getElementById(id);
const NAMES = Object.freeze({ str: "力量", int: "智力", agi: "敏捷", dex: "灵巧", con: "体质", luk: "幸运" });
let requestSerial = 0;
let loadoutSnapshot = currentLoadoutSnapshot();
let message = "服务器属性快照已建立";

function progression() {
  return characterProgressionAuthority.snapshot();
}

function render() {
  const snapshot = progression();
  const stats = snapshot.characterStats;
  $("statLevel").textContent = `Lv.${stats.level}`;
  $("statPointBudget").textContent = `${stats.pointBudget.remaining} / ${stats.pointBudget.total}`;
  $("statProgressionVersion").textContent = `Stats v${snapshot.progressionVersion} · ${snapshot.progressionHash.slice(0, 10)}`;
  $("statAuthorityMessage").textContent = message;
  for (const [id, name] of Object.entries(NAMES)) {
    const value = stats.allocations[id];
    const cost = nextPrimaryPointCost(value, stats.rules);
    $(`stat-${id}-value`).textContent = value;
    $(`stat-${id}-detail`).textContent = `最终 ${stats.primary.final[id]} · 下1点 ${cost ?? "已满"}`;
    const button = $(`stat-${id}-add`);
    button.disabled = cost === null || cost > stats.pointBudget.remaining;
    button.title = `${name}提升1点，服务器消耗 ${cost ?? 0} 点`;
  }
  const derived = stats.derived.final;
  $("statPhysicalAttack").textContent = derived.physicalAttack.toFixed(1);
  $("statMagicAttack").textContent = derived.magicAttack.toFixed(1);
  $("statMaxHp").textContent = derived.maxHp.toFixed(0);
  $("statAttackRate").textContent = `${stats.combatRates.attackFrequencyMultiplier.toFixed(3)}×`;
  $("statCastRate").textContent = `${stats.combatRates.castTimeMultiplier.toFixed(3)}×`;
  $("statEncounterRate").textContent = `${stats.combatRates.encounterMovementMultiplier.toFixed(3)}×`;
  $("statBuildProof").textContent = loadoutSnapshot.compiledBuild
    ? `已进入构筑 ${loadoutSnapshot.compiledBuild.buildHash.slice(0, 12)}`
    : "属性已保存；装备带技能武器后进入构筑";
}

function commandId(prefix) {
  requestSerial += 1;
  return `stats-${prefix}-${Date.now()}-${requestSerial}`;
}

for (const statId of Object.keys(NAMES)) {
  $(`stat-${statId}-add`).addEventListener("click", () => {
    const before = progression();
    try {
      allocatePrimaryStat({ requestId: commandId(statId), expectedVersion: before.progressionVersion, statId, amount: 1 });
      message = `服务器确认：${NAMES[statId]} +1，构筑已立即重编译`;
    } catch (error) {
      message = `加点被拒绝 · ${error.code ?? error.message}`;
    }
    render();
  });
}

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
