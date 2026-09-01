import {
  createEncounterAuthoritativeSimulator,
  projectAuthoritativeEncounterState,
} from "../../packages/server-core/src/encounter-authoritative-simulator.js?v=m2b-authority-1";
import { COMBAT_COMMAND, validateCombatCommand } from "../../packages/server-core/src/combat-request-schema.js?v=m2b-authority-1";
import { createAuthoritativeReplayRecord, verifyAuthoritativeReplayRecord } from "../../packages/server-core/src/authoritative-replay-service.js?v=m2c-replay-1";
import { currentLoadoutSnapshot, subscribeLoadoutSnapshot } from "./loadout-authority.js?v=mastery-stats-2";

const $ = (id) => document.getElementById(id);
const simulator = createEncounterAuthoritativeSimulator();
let snapshot = currentLoadoutSnapshot();
let state = null;
let recentEvents = [];
let activeEncounterId = null;
let replayRecord = null;
let replayVerification = null;
const rngSeed = 0x12345678;

const normalEncounter = Object.freeze({
  id: "authority-meadow",
  mode: "endless_world_v1",
  playerBaseDamage: 12,
  playerMaxHp: 100,
  reviveDelayMs: 5_000,
  reviveInitialEncounterDelayMs: 1_150,
  monsterDefinitions: [
    { id: "poring-green", maxHp: 48, attackDamage: 2, attackIntervalMs: 1_200 },
    { id: "poring-pink", maxHp: 62, attackDamage: 3, attackIntervalMs: 1_400 },
  ],
  worldConfig: {
    radarRadiusM: 30,
    stopDistanceM: 3.4,
    monsterApproachSpeedMps: 14,
    initialEncounterDelayMs: 0,
    baseEncounterIntervalMs: 900,
    minimumEncounterIntervalMs: 750,
    encounterCapacityWindowMs: 12_000,
    killRateWindowMs: 12_000,
    baseLivingCapacity: 3,
    minimumLivingCapacity: 6,
    maximumLivingCapacity: 24,
  },
});

function compiledBuild() {
  return snapshot?.compiledBuild ?? null;
}

function setStatus(text, tone = "ready") {
  $("serverAuthorityState").textContent = text;
  $("serverAuthorityState").dataset.tone = tone;
}

function render() {
  const build = compiledBuild();
  $("serverBuildHash").textContent = build ? build.buildHash.slice(0, 12) : "等待可战斗构筑";
  if (!state) {
    $("serverPlayerState").textContent = "尚未创建会话";
    $("serverMonsterState").textContent = "0 个权威目标";
    $("serverEncounterState").textContent = "等待服务器模拟";
  } else {
    const view = projectAuthoritativeEncounterState(state);
    $("serverPlayerState").textContent = view.player.alive
      ? `存活 · HP ${view.player.hp}/${view.player.maxHp}`
      : `死亡 · ${Math.max(0, (view.player.reviveAtMs - state.simulatedUntilMs) / 1_000).toFixed(1)}秒复活`;
    $("serverMonsterState").textContent = `${view.monsters.length} 个权威目标 · 容量 ${view.encounter.livingCapacity}`;
    $("serverEncounterState").textContent = `${(state.simulatedUntilMs / 1_000).toFixed(1)}秒 · 击杀频率 ${view.encounter.killRatePerSecond.toFixed(2)}/秒`;
  }
  const rows = recentEvents.slice(-10).reverse();
  $("serverAuthorityEvents").innerHTML = rows.length
    ? rows.map((event) => `<li><code>${(event.atMs / 1_000).toFixed(2)}s</code><b>${event.type.replace("authoritative_", "")}</b><span>${event.targetMonsterId ? `目标 #${event.targetMonsterId}` : event.monsterId ? `怪物 #${event.monsterId}` : event.reason ?? "服务器确认"}</span></li>`).join("")
    : "<li class=\"empty\">运行用例后显示服务器事件</li>";
  $("serverReplayRecord").textContent = replayRecord ? replayRecord.recordHash.slice(0, 16) : "尚未生成";
  $("serverReplayInput").textContent = replayRecord ? `种子 ${replayRecord.rngSeed} · ${replayRecord.checkpoints.length} 检查点` : "种子 0x12345678";
  $("serverReplayEvents").textContent = replayVerification ? `${replayVerification.eventCount ?? 0} 世界事件 · ${replayVerification.runtimeEventCount ?? 0} Runtime事件` : "等待复算";
  $("serverReplayVerdict").textContent = replayVerification ? (replayVerification.verified ? "完全一致 · 通过" : `拒绝 · ${replayVerification.mismatches.join(" + ")}`) : "等待验证";
  $("serverReplayVerdict").dataset.tone = replayVerification?.verified ? "verified" : replayVerification ? "rejected" : "idle";
}

function runSegment(targetUntilMs, encounter = normalEncounter) {
  const build = compiledBuild();
  if (!build) {
    setStatus("请先装备带技能的武器", "blocked");
    return false;
  }
  if (!state || state.actionRuntime.buildHash !== build.buildHash || activeEncounterId !== encounter.id) {
    state = simulator.createInitialState({ compiledBuild: build, encounter, rngSeed });
    activeEncounterId = encounter.id;
    recentEvents = [];
  }
  let guard = 0;
  while (state.simulatedUntilMs < targetUntilMs && guard < 20) {
    const segment = simulator.advance({ state, compiledBuild: build, encounter, rngSeed, targetUntilMs });
    state = segment.state;
    recentEvents.push(...segment.events);
    if (recentEvents.length > 80) recentEvents.splice(0, recentEvents.length - 80);
    guard += 1;
  }
  setStatus("服务器权威事件已确认", "ready");
  render();
  return true;
}

$("serverRunTenSeconds").addEventListener("click", () => {
  const build = compiledBuild();
  if (!build) return runSegment(0);
  if (!state || state.actionRuntime.buildHash !== build.buildHash) state = null;
  runSegment((state?.simulatedUntilMs ?? 0) + 10_000);
});

$("serverRunReviveCase").addEventListener("click", () => {
  const build = compiledBuild();
  if (!build) return runSegment(0);
  const deathEncounter = {
    ...normalEncounter,
    id: "authority-death-case",
    playerBaseDamage: 0,
    playerMaxHp: 50,
    monsterDefinitions: [{ id: "stun-brute", maxHp: 9_999, attackDamage: 100, attackIntervalMs: 100 }],
    worldConfig: { ...normalEncounter.worldConfig, initialEncounterDelayMs: 0 },
  };
  state = simulator.createInitialState({ compiledBuild: build, encounter: deathEncounter, rngSeed });
  activeEncounterId = deathEncounter.id;
  recentEvents = [];
  runSegment(5_500, deathEncounter);
});

$("serverRunForgeryCase").addEventListener("click", () => {
  try {
    validateCombatCommand(COMBAT_COMMAND.START, {
      requestId: "forged-browser-packet",
      characterId: "test-character",
      expectedLoadoutVersion: snapshot?.version ?? 0,
      encounterDefinitionId: "authority-meadow",
      monsters: [{ id: 1, hp: 0 }],
      playerHp: 999_999,
    });
    setStatus("异常：伪造包未被拒绝", "blocked");
  } catch (error) {
    setStatus(`已拒绝 · ${error.code}`, "rejected");
    recentEvents.push({ atMs: state?.simulatedUntilMs ?? 0, type: "authoritative_packet_rejected", reason: error.code });
  }
  render();
});

$("serverRunReplayCase").addEventListener("click", () => {
  const build = compiledBuild();
  if (!build) return runSegment(0);
  replayRecord = createAuthoritativeReplayRecord({ compiledBuild: build, encounter: normalEncounter, rngSeed, checkpoints: [5_000, 10_000, 20_000] });
  replayVerification = verifyAuthoritativeReplayRecord({ record: replayRecord, compiledBuild: build, encounter: normalEncounter });
  recentEvents.push({ atMs: 20_000, type: replayVerification.verified ? "authoritative_replay_verified" : "authoritative_replay_rejected", reason: replayVerification.verified ? "事件链与最终状态一致" : replayVerification.mismatches.join("+") });
  setStatus(replayVerification.verified ? "M2C 回放复算完全一致" : "M2C 回放验证失败", replayVerification.verified ? "ready" : "rejected");
  render();
});

$("serverRunReplayForgery").addEventListener("click", () => {
  const build = compiledBuild();
  if (!build) return runSegment(0);
  if (!replayRecord) replayRecord = createAuthoritativeReplayRecord({ compiledBuild: build, encounter: normalEncounter, rngSeed, checkpoints: [5_000, 10_000, 20_000] });
  const forged = structuredClone(replayRecord);
  forged.segments[0].eventHash = "client-forged-event-chain";
  replayVerification = verifyAuthoritativeReplayRecord({ record: forged, compiledBuild: build, encounter: normalEncounter });
  recentEvents.push({ atMs: 20_000, type: "authoritative_replay_rejected", reason: replayVerification.mismatches.join("+") });
  setStatus(`篡改回放已拒绝 · ${replayVerification.mismatches.join(" + ")}`, "rejected");
  render();
});

subscribeLoadoutSnapshot((next) => {
  snapshot = next;
  state = null;
  activeEncounterId = null;
  recentEvents = [];
  replayRecord = null;
  replayVerification = null;
  setStatus(next.compiledBuild ? "构筑已同步，等待运行" : "等待可战斗构筑", next.compiledBuild ? "ready" : "blocked");
  render();
});
