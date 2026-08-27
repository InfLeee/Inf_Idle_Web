import { loadoutAuthority } from "./loadout-authority.js?v=compiled-runtime-1";
import {
  advanceCompiledCombat,
  createCompiledCombatState,
  TARGET_SELECTOR_KIND,
} from "../../packages/combat-runtime/src/index.js?v=compiled-runtime-1";
import {
  RUNTIME_RETENTION,
  clearTransientNodes,
  compactConsumedEvents,
  createDamageAccumulator,
  createSingleFlightAnimationLoop,
  mountTransientNode,
  transientRetentionStats,
  trimOldestChildren,
} from "./runtime-retention.js";

const $ = (id) => document.getElementById(id);
const COMBAT_START_MS = 4_000;
const COMBAT_CYCLE_MS = 60_000;
const RADAR_RADIUS_M = 30;
const MELEE_RANGE_M = 3.4;
const REVIVE_DELAY_MS = 5_000;
const DEMO_CONTROL_EVENTS = Object.freeze([{ atMs: 12_300, kind: "stun" }]);
const MAX_MONSTERS = 4;
const MONSTER_TYPES = [
  { id: "slime", name: "绿波波", hp: 800, heal: 80, sprite: "./assets/monster-slime.png" },
  { id: "boar", name: "野猪战士", hp: 1_100, heal: 0, sprite: "./assets/monster-boar.png" },
  { id: "mushroom", name: "蘑菇小妖", hp: 900, heal: 120, sprite: "./assets/monster-mushroom.png" },
  { id: "goblin", name: "哥布林射手", hp: 1_050, heal: 0, sprite: "./assets/monster-goblin.png" },
  { id: "ghost", name: "幽灵布布", hp: 750, heal: 100, sprite: "./assets/monster-ghost.png" },
];
const SKILL_IMAGES = {
  two_handed_sword_slash: "./assets/skill-slash.png",
  bash: "./assets/skill-bash.png",
  storm_slash: "./assets/skill-storm.png",
  bowling_bash: "./assets/skill-collision.png",
  traumatic_blow: "./assets/skill-execute.png",
};
let compiledBuild;
let combatRuntimeState;
let authoritySnapshot = loadoutAuthority.snapshot();
let simulation;
let combatTemplate = [];
let nextCombatCycleAt = COMBAT_START_MS + COMBAT_CYCLE_MS;
let monsters = [];
let pendingSpawns = [];
let nextMonsterId = 1;
let spawnSerial = 0;
let killCount = 0;
let speed = 1;
let running = false;
let simTime = 0;
let lastFrame = 0;
let eventIndex = 0;
let visibleLogCount = 0;
let spirit = 0;
let overclock = false;
const damageAccumulator = createDamageAccumulator();
let lastUiRenderAt = 0;
let lastCleanupAt = 0;
let removedTimelineEvents = 0;
let cleanupCount = 0;
let slashCount = 0;
let auraCount = 0;
let playerHp = 100;
let playerState = "alive";
let reviveAt = 0;
let frameLoop;
let autoStartTimer = null;
let cleanupFeedbackTimer = null;

function compile(snapshot = loadoutAuthority.snapshot()) {
  authoritySnapshot = snapshot;
  compiledBuild = snapshot.compiledBuild;
  if (!compiledBuild) {
    combatTemplate = [];
    const detail = snapshot.characterBuild.equippedWeaponInstanceId === null
      ? "请先从背包装备一把武器"
      : "当前武器至少需要装入一张技能卡";
    simulation = { log: [{ at: 0, type: "radar", label: "构筑未就绪", detail, value: "等待构筑" }] };
    return false;
  }
  combatRuntimeState = createCompiledCombatState(compiledBuild);
  const combat = advanceCompiledCombat({
    state: combatRuntimeState,
    compiledBuild,
    untilMs: COMBAT_CYCLE_MS,
    controlEvents: DEMO_CONTROL_EVENTS,
  });
  combatRuntimeState = combat.state;
  combatTemplate = combat.events;
  nextCombatCycleAt = COMBAT_START_MS + COMBAT_CYCLE_MS;
  simulation = {
    log: [
      { at: 0, type: "radar", label: "开始扫描", detail: "搜索草原 30m 战斗视域", value: "扫描中" },
      ...combat.events.map((event) => ({ ...event, at: event.at + COMBAT_START_MS })),
    ].sort((left, right) => left.at - right.at),
  };
  return true;
}

function renderBuild() {
  const byEntry = new Map((compiledBuild?.compiledSkills ?? []).map((skill) => [skill.entryId, skill]));
  const slots = compiledBuild?.skillSlots.map((entryId) => entryId ? byEntry.get(entryId) : null) ?? Array(5).fill(null);
  $("skillBar").innerHTML = slots.map((skill) => {
    if (!skill) return `<article class="skill-slot empty"><div><strong>空孔</strong><small>未携带技能</small></div></article>`;
    const action = skill.actions[0];
    const image = SKILL_IMAGES[skill.definitionId] ?? "./assets/skill-slash.png";
    const timing = skill.runtime.backgroundAction ? "独立时钟" : `${action.timing.cooldownMs / 1000}s 冷却`;
    return `<article class="skill-slot" data-skill-id="${skill.definitionId}"><img src="${image}" alt="${action.name}"><div><strong>${action.name}</strong><small>${timing}</small></div></article>`;
  }).join("");
  const connectionCount = Object.values(authoritySnapshot.ownershipInput.loadout.supportConnections)
    .reduce((total, ids) => total + ids.length, 0);
  $("supportCards").innerHTML = `<span class="support-card active">${connectionCount} 张实例已进入最终 Action 编译</span>`;
  const slash = compiledBuild?.compiledSkills.find((skill) => skill.definitionId === "two_handed_sword_slash");
  const slashAction = slash?.actions[0];
  const damage = slashAction?.effects.find((effect) => effect.kind === "direct_damage");
  $("compiledSlash").textContent = slashAction && damage
    ? `最终斩击：${Math.round(slashAction.timing.castTimeMs ?? slashAction.timing.tickIntervalMs ?? 0)}ms · ${damage.params.multiplier.toFixed(2)}×`
    : "当前未携带斩击";
  $("compileStatus").textContent = compiledBuild
    ? `权威 CompiledBuild · ${compiledBuild.buildHash.slice(0, 8)} · Loadout v${authoritySnapshot.loadoutVersion}`
    : `构筑未就绪 · Loadout v${authoritySnapshot.loadoutVersion}`;
  $("startBtn").disabled = false;
}

function reset() {
  frameLoop?.stop();
  if (autoStartTimer !== null) clearTimeout(autoStartTimer);
  autoStartTimer = null;
  if (cleanupFeedbackTimer !== null) clearTimeout(cleanupFeedbackTimer);
  cleanupFeedbackTimer = null;
  running = false;
  simTime = 0;
  lastFrame = 0;
  eventIndex = 0;
  visibleLogCount = 0;
  monsters = [];
  pendingSpawns = compiledBuild ? [
    { at: 1_150, typeIndex: 0, angle: -108 },
    { at: 1_650, typeIndex: 1, angle: -20 },
    { at: 2_200, typeIndex: 2, angle: 62 },
    { at: 2_750, typeIndex: 3, angle: 152 },
  ] : [];
  nextMonsterId = 1;
  spawnSerial = 4;
  killCount = 0;
  spirit = 0;
  overclock = false;
  damageAccumulator.reset();
  lastUiRenderAt = 0;
  lastCleanupAt = 0;
  removedTimelineEvents = 0;
  cleanupCount = 0;
  slashCount = 0;
  auraCount = 0;
  playerHp = 100;
  playerState = "alive";
  reviveAt = 0;
  if (compiledBuild) {
    combatRuntimeState = createCompiledCombatState(compiledBuild);
    const segment = advanceCompiledCombat({
      state: combatRuntimeState,
      compiledBuild,
      untilMs: COMBAT_CYCLE_MS,
      controlEvents: DEMO_CONTROL_EVENTS,
    });
    combatRuntimeState = segment.state;
    combatTemplate = segment.events;
  }
  nextCombatCycleAt = COMBAT_START_MS + COMBAT_CYCLE_MS;
  simulation.log = compiledBuild ? [
    { at: 0, type: "radar", label: "开始扫描", detail: "搜索草原 30m 战斗视域", value: "扫描中" },
    ...combatTemplate.map((event) => ({ ...event, at: event.at + COMBAT_START_MS })),
  ].sort((left, right) => left.at - right.at) : [{
    at: 0,
    type: "radar",
    label: "构筑未就绪",
    detail: authoritySnapshot.characterBuild.equippedWeaponInstanceId === null ? "请先装备武器" : "请为武器装入技能卡",
    value: "待机",
  }];
  $("eventLog").innerHTML = compiledBuild
    ? '<div class="empty-log"><strong>正在准备草原战斗</strong><span>雷达会自动发现多个目标并开始挂机战斗。</span></div>'
    : '<div class="empty-log"><strong>当前没有可运行的战斗构筑</strong><span>从背包将武器拖入独立武器栏后，战斗会自动开始。</span></div>';
  $("radarUnits").replaceChildren();
  clearTransientNodes($("radarFloats"));
  clearTransientNodes($("playerFloats"));
  $("startBtn").textContent = "开始战斗";
  $("logSummary").textContent = "等待自动扫描";
  updateReadout();
}

function spawnMonster(request) {
  const type = MONSTER_TYPES[request.typeIndex % MONSTER_TYPES.length];
  const cycle = Math.floor(spawnSerial / MONSTER_TYPES.length);
  const maxHp = type.hp + cycle * 90;
  const monster = {
    id: nextMonsterId++, type, name: type.name, hp: maxHp, maxHp,
    heal: type.heal, angle: request.angle, distance: RADAR_RADIUS_M,
    state: "approaching", spawnAt: simTime, engageAt: simTime + 2_800,
    nextHealAt: simTime + 5_200, nextAttackAt: simTime + 4_000 + (nextMonsterId % 4) * 250, deathAt: null,
  };
  monsters.push(monster);
  addLog({ at: simTime }, "多目标刷新", `${monster.name}从30米外圈接近`, `目标 ${monster.id}`, "30.0m", "system");
  spawnRadarFloat(monster, "新出现", "heal");
}

function scheduleReplacement(deadMonster) {
  const occupiedAngles = monsters.filter((monster) => monster.state !== "dead").map((monster) => monster.angle);
  const candidateAngles = [-135, -70, -10, 48, 110, 165];
  const angle = candidateAngles.find((candidate) => occupiedAngles.every((used) => Math.abs(candidate - used) > 35)) ?? ((deadMonster.angle + 137) % 360);
  pendingSpawns.push({ at: simTime + 1_150, typeIndex: spawnSerial % MONSTER_TYPES.length, angle });
  spawnSerial += 1;
}

function updateWorld() {
  const due = pendingSpawns.filter((request) => request.at <= simTime && monsters.filter((monster) => monster.state !== "dead").length < MAX_MONSTERS);
  pendingSpawns = pendingSpawns.filter((request) => !due.includes(request));
  due.forEach(spawnMonster);
  monsters.forEach((monster) => {
    if (monster.state === "approaching") {
      const progress = Math.min(1, (simTime - monster.spawnAt) / (monster.engageAt - monster.spawnAt));
      monster.distance = RADAR_RADIUS_M - progress * (RADAR_RADIUS_M - MELEE_RANGE_M);
      if (progress >= 1) {
        monster.state = "engaged";
        monster.distance = MELEE_RANGE_M;
        addLog({ at: simTime }, "进入攻击范围", `${monster.name}加入交战`, monster.name, `${MELEE_RANGE_M}m`, "system");
      }
    }
    if (monster.state === "engaged" && monster.heal > 0 && simTime >= monster.nextHealAt) {
      monster.nextHealAt += 2_800;
      const healed = Math.min(monster.heal, monster.maxHp - monster.hp);
      if (healed > 0) {
        monster.hp += healed;
        addLog({ at: simTime }, "生命回复", `${monster.name}触发再生`, monster.name, `+${healed}`, "state");
        spawnRadarFloat(monster, `+${healed}`, "heal");
      }
    }
    if (monster.state === "engaged" && playerState === "alive" && simTime >= monster.nextAttackAt) {
      monster.nextAttackAt += 1_650 + (monster.id % 3) * 180;
      damagePlayer(monster, 4 + (monster.id % 4));
    }
  });
  monsters = monsters.filter((monster) => monster.state !== "dead" || simTime - monster.deathAt < 1_050);
}

function livingMonsters() {
  return monsters.filter((monster) => monster.state !== "dead");
}

function engagedMonsters() {
  return monsters.filter((monster) => monster.state === "engaged");
}

function primaryTarget() {
  return [...engagedMonsters()].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id)[0] ?? null;
}

function monsterPosition(monster) {
  const radians = monster.angle * Math.PI / 180;
  const radius = Math.min(RADAR_RADIUS_M, monster.distance) / RADAR_RADIUS_M * 42;
  return { x: 50 + Math.cos(radians) * radius, y: 50 + Math.sin(radians) * radius };
}

function renderMonsters() {
  const target = primaryTarget();
  const activeIds = new Set(monsters.map((monster) => String(monster.id)));
  $("radarUnits").querySelectorAll(".radar-unit").forEach((node) => {
    if (!activeIds.has(node.dataset.monsterId)) node.remove();
  });
  monsters.forEach((monster) => {
    const position = monsterPosition(monster);
    let node = $("radarUnits").querySelector(`[data-monster-id="${monster.id}"]`);
    if (!node) {
      node = document.createElement("div");
      node.className = "radar-unit";
      node.dataset.monsterId = monster.id;
      node.innerHTML = `<img class="unit-avatar" src="${monster.type.sprite}" alt="${monster.name}"><span class="unit-name">${monster.name}</span><span class="unit-hp"><i></i></span>`;
      $("radarUnits").append(node);
    }
    node.style.left = `${position.x}%`;
    node.style.top = `${position.y}%`;
    node.classList.toggle("dead", monster.state === "dead");
    node.classList.toggle("targeted", target?.id === monster.id);
    node.querySelector(".unit-hp i").style.width = `${monster.hp / monster.maxHp * 100}%`;
  });
  const roster = [...monsters].sort((a, b) => (a.state === "dead") - (b.state === "dead") || a.distance - b.distance);
  $("enemyRoster").innerHTML = roster.length ? roster.map((monster) => `<article class="roster-row ${monster.state === "dead" ? "dead" : ""} ${target?.id === monster.id ? "targeted" : ""}">
    <img src="${monster.type.sprite}" alt=""><div class="roster-info"><strong>${monster.name}</strong><small>HP ${Math.round(monster.hp).toLocaleString()} / ${monster.maxHp.toLocaleString()}</small><i><b style="width:${monster.hp / monster.maxHp * 100}%"></b></i></div><span class="roster-state">${monster.state === "dead" ? "已击败" : monster.state === "engaged" ? "交战中" : `${monster.distance.toFixed(1)}m`}</span>
  </article>`).join("") : '<div class="empty-roster">正在扫描草原...</div>';
}

function totalDamage() { return damageAccumulator.snapshot().total; }

function clockLabel(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s` : minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${(ms / 1000).toFixed(1)}s`;
}

function updateReadout() {
  const damageStats = damageAccumulator.snapshot();
  const total = damageStats.total;
  const average = damageStats.count ? total / damageStats.count : 0;
  const combatSeconds = Math.max(1, (simTime - COMBAT_START_MS) / 1000);
  const living = livingMonsters();
  const engaged = engagedMonsters();
  const reviveSeconds = Math.max(0, (reviveAt - simTime) / 1000);
  $("clock").textContent = clockLabel(simTime);
  $("playerStatus").textContent = `HP ${Math.round(playerHp)}/100 · 斗气 ${Math.round(spirit)}/100`;
  $("playerHpText").textContent = `${Math.round(playerHp)} / 100`;
  $("playerHpBar").style.width = `${playerHp}%`;
  $("playerLifeState").textContent = playerState === "dead" ? `${reviveSeconds.toFixed(1)}s 后复活` : "战斗中";
  $("playerLifeState").classList.toggle("dead", playerState === "dead");
  document.querySelector(".player-summary").classList.toggle("dead", playerState === "dead");
  document.querySelector(".radar-player").classList.toggle("dead", playerState === "dead");
  $("aliveCount").textContent = `存活 ${living.length} / ${MAX_MONSTERS}`;
  $("waveText").textContent = `第 ${Math.floor(killCount / MAX_MONSTERS) + 1} 波 · 击杀 ${killCount}`;
  $("encounterPhase").textContent = playerState === "dead" ? `复活倒计时 ${reviveSeconds.toFixed(1)}s` : engaged.length ? `交战中 · ${engaged.length}目标` : living.length ? "目标接近" : "扫描中";
  $("spiritText").textContent = `${Math.round(spirit)} / 100`;
  $("spiritBar").style.width = `${spirit}%`;
  $("dpsMetric").textContent = Math.round(total / combatSeconds).toLocaleString();
  $("totalMetric").textContent = `总伤害 ${Math.round(total).toLocaleString()}`;
  $("hitMetric").textContent = damageStats.count;
  $("avgMetric").textContent = Math.round(average).toLocaleString();
  $("maxMetric").textContent = damageStats.count ? damageStats.maximum.toLocaleString() : "0";
  $("minMetric").textContent = damageStats.count ? damageStats.minimum.toLocaleString() : "0";
  $("accuracyMetric").textContent = damageStats.count ? "100.0%" : "0.0%";
  $("hitDetail").textContent = damageStats.count;
  $("attemptMetric").textContent = damageStats.count;
  $("slashMetric").textContent = slashCount;
  $("auraMetric").textContent = auraCount;
  $("auraState").textContent = overclock ? "超频生效中" : spirit >= 100 ? "高亮就绪" : "等待斗气满值";
  $("auraChip").textContent = `灵气剑超频 · ${overclock ? "已激活" : "未激活"}`;
  $("auraChip").classList.toggle("active", overclock);
  $("auraChip").classList.toggle("inactive", !overclock);
  renderMonsters();
  updateRuntimeHealth();
}

function timeLabel(ms) {
  const seconds = ms / 1000;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${Math.floor(seconds % 1 * 10)}`;
}

function addLog(event, label, detail, target, value, kind = "hit") {
  const empty = $("eventLog").querySelector(".empty-log");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "event-row";
  const system = kind === "system";
  row.innerHTML = `<time>${timeLabel(event.at)}</time><span class="source"><i></i>${system ? "战斗雷达" : "双手剑持有者"}</span><span class="event-name ${kind}">${label} · ${detail}</span><span class="target">${target}</span><strong class="value">${value}</strong>`;
  $("eventLog").append(row);
  visibleLogCount += 1;
  trimOldestChildren($("eventLog"), RUNTIME_RETENTION.maxLogRows);
  if ($("autoScroll").checked) $("eventLog").scrollTop = $("eventLog").scrollHeight;
}

function spawnFloat(text, kind = "damage") {
  const node = document.createElement("span");
  node.className = `float-number ${kind}`;
  node.textContent = text;
  node.style.left = `${42 + Math.random() * 20}%`;
  mountTransientNode($("playerFloats"), node);
}

function spawnRadarFloat(monster, text, kind = "damage") {
  const position = monsterPosition(monster);
  const node = document.createElement("span");
  node.className = `radar-float ${kind}`;
  node.textContent = text;
  node.style.left = `${position.x}%`;
  node.style.top = `${position.y - 2}%`;
  mountTransientNode($("radarFloats"), node);
}

function flashMonster(monsterId) {
  const node = $("radarUnits").querySelector(`[data-monster-id="${monsterId}"]`);
  if (!node) return;
  node.classList.remove("hit-shake");
  void node.offsetWidth;
  node.classList.add("hit-shake");
  setTimeout(() => node.classList.remove("hit-shake"), 230);
}

function flashAttackRange() {
  $("attackRange").classList.remove("pulse");
  void $("attackRange").offsetWidth;
  $("attackRange").classList.add("pulse");
  setTimeout(() => $("attackRange").classList.remove("pulse"), 280);
}

function damagePlayer(monster, value) {
  if (playerState !== "alive") return;
  playerHp = Math.max(0, playerHp - value);
  const event = { at: simTime };
  addLog(event, "怪物攻击", `${monster.name}命中玩家`, "双手剑持有者", value.toLocaleString(), "hit");
  spawnFloat(`-${value}`, "damage");
  if (playerHp <= 0) {
    playerState = "dead";
    reviveAt = simTime + REVIVE_DELAY_MS;
    spirit = 0;
    overclock = false;
    addLog(event, "玩家死亡", "停止输出并进入复活倒计时", "自身", "5.0s", "state");
    spawnFloat("战败", "state");
  }
}

function updatePlayerLife() {
  if (playerState !== "dead" || simTime < reviveAt) return;
  playerState = "alive";
  playerHp = 100;
  reviveAt = 0;
  engagedMonsters().forEach((monster, index) => { monster.nextAttackAt = simTime + 900 + index * 180; });
  addLog({ at: simTime }, "玩家复活", "生命恢复并重新接管挂机序列", "自身", "+100", "state");
  spawnFloat("+100 复活", "heal");
}

function extendCombatTimeline() {
  while (simTime + 5_000 >= nextCombatCycleAt) {
    const nextUntilMs = combatRuntimeState.nowMs + COMBAT_CYCLE_MS;
    const segment = advanceCompiledCombat({
      state: combatRuntimeState,
      compiledBuild,
      untilMs: nextUntilMs,
      controlEvents: DEMO_CONTROL_EVENTS,
    });
    combatRuntimeState = segment.state;
    simulation.log.push(...segment.events.map((event) => ({ ...event, at: event.at + COMBAT_START_MS })));
    nextCombatCycleAt = COMBAT_START_MS + combatRuntimeState.nowMs;
  }
}

function compactTimeline(force = false) {
  const compacted = compactConsumedEvents(simulation.log, eventIndex, {
    threshold: force ? 1 : RUNTIME_RETENTION.eventCompactionThreshold,
  });
  simulation.log = compacted.events;
  eventIndex = compacted.eventIndex;
  removedTimelineEvents += compacted.removed;
  return compacted.removed;
}

function runtimeSnapshot() {
  const damageStats = damageAccumulator.snapshot();
  return Object.freeze({
    simTime,
    logRows: $("eventLog").children.length,
    timelineEvents: simulation.log.length,
    pendingEvents: simulation.log.length - eventIndex,
    radarFloatNodes: $("radarFloats").children.length,
    playerFloatNodes: $("playerFloats").children.length,
    monsterRecords: monsters.length,
    damageCount: damageStats.count,
    damageAggregateFields: Object.keys(damageStats).length,
    cleanupCount,
    removedTimelineEvents,
    trackedTransientNodes: transientRetentionStats().trackedNodes,
    pendingAnimationFrames: frameLoop?.pendingFrames() ?? 0,
    activeAnimationLoops: frameLoop?.isRunning() ? 1 : 0,
    pendingAutoStartTimers: autoStartTimer === null ? 0 : 1,
  });
}

function updateRuntimeHealth() {
  const snapshot = runtimeSnapshot();
  $("runtimeHealth").textContent =
    "运行缓存 · 日志 " + snapshot.logRows + "/" + RUNTIME_RETENTION.maxLogRows +
    " · 队列 " + snapshot.pendingEvents +
    " · 跳字 " + (snapshot.radarFloatNodes + snapshot.playerFloatNodes) +
    " · 受管节点 " + snapshot.trackedTransientNodes +
    " · 动画循环 " + snapshot.activeAnimationLoops + "/1";
}

function runRuntimeCleanup(options = {}) {
  const manual = options.manual ?? false;
  trimOldestChildren($("eventLog"), manual ? 0 : RUNTIME_RETENTION.maxLogRows);
  if (manual) {
    clearTransientNodes($("radarFloats"));
    clearTransientNodes($("playerFloats"));
  }
  compactTimeline(manual);
  cleanupCount += 1;
  updateRuntimeHealth();
}

globalThis.__INF_IDLE_RUNTIME__ = Object.freeze({
  snapshot: runtimeSnapshot,
  cleanup: () => runRuntimeCleanup({ manual: true }),
});

function flash(skillId) {
  const slot = document.querySelector(`[data-skill-id="${skillId}"]`);
  if (!slot) return;
  slot.classList.add("active");
  flashAttackRange();
  setTimeout(() => slot.classList.remove("active"), 170);
}

function defeatMonster(monster, event) {
  if (monster.state === "dead") return;
  monster.state = "dead";
  monster.hp = 0;
  monster.deathAt = simTime;
  killCount += 1;
  addLog(event, "目标击杀", `${monster.name}生命归零`, monster.name, `第 ${killCount} 杀`, "system");
  spawnRadarFloat(monster, "击败！", "kill");
  scheduleReplacement(monster);
}

function applyDamage(event, skillName, multiplier, hitCount, monster) {
  if (!monster || monster.state !== "engaged") return;
  const value = Math.round(multiplier * Math.max(1, hitCount) * 100);
  damageAccumulator.record(value);
  monster.hp = Math.max(0, monster.hp - value);
  addLog(event, `${skillName}命中`, hitCount > 1 ? `${hitCount}段伤害` : "最终Effect结算", monster.name, value.toLocaleString());
  spawnRadarFloat(monster, `-${value.toLocaleString()}`);
  flashMonster(monster.id);
  if (monster.hp <= 0) defeatMonster(monster, event);
}

function processEvent(event) {
  if (playerState === "dead" && event.type !== "radar") return;
  if (event.type === "radar") {
    addLog(event, event.label, event.detail, "草原视域", event.value, "system");
  } else if (event.type === "action_started" || event.type === "channel_started") {
    addLog(event, event.type === "channel_started" ? "开始持续引导" : "开始释放", event.skillName, "当前目标", event.timingKind, "state");
    flash(event.skillDefinitionId);
  } else if (event.type === "damage_intent") {
    const engaged = engagedMonsters();
    const primary = primaryTarget();
    if (!primary) return;
    const area = event.targeting.kind === TARGET_SELECTOR_KIND.ENEMIES_IN_RADIUS ||
      event.targeting.kind === TARGET_SELECTOR_KIND.ENEMIES_AROUND_SELF;
    const maxTargets = event.targeting.maxTargets ?? engaged.length;
    const targets = area ? engaged.slice(0, maxTargets) : [primary];
    targets.forEach((monster) => applyDamage(event, event.skillName, event.multiplier, event.hitCount, monster));
    if (event.skillDefinitionId === "two_handed_sword_slash") slashCount += 1;
    if (event.skillDefinitionId === "two_handed_sword_aura_blade") auraCount += 1;
    flash(event.skillDefinitionId);
  } else if (event.type === "resource_changed") {
    spirit = event.after;
    if (event.delta !== 0) spawnFloat(`${event.delta > 0 ? "+" : ""}${event.delta} 斗气`, "resource");
  } else if (event.type === "state_applied") {
    overclock = event.stateId === "aura_blade_overclock" || overclock;
    addLog(event, "状态获得", event.stateId, "自身", event.durationMs === null ? "持续" : `${event.durationMs / 1000}s`, "state");
    spawnFloat(event.stateId, "state");
  } else if (event.type === "state_expired") {
    if (event.stateId === "aura_blade_overclock") overclock = false;
    addLog(event, "状态结束", event.stateId, "自身", "结束", "state");
  } else if (event.type === "action_interrupted") {
    addLog(event, "释放被打断", event.controlKind, "自身", "失败", "state");
    spawnFloat("眩晕打断", "damage");
  } else if (event.type === "channel_tick" || event.type === "channel_ended") {
    addLog(event, event.type === "channel_tick" ? "引导结算" : "引导结束", event.actionId, "自身", event.reason ?? "Tick", "state");
  }
  $("logSummary").textContent = `${visibleLogCount} 条事件 · ${running ? "实时滚动" : "已暂停"}`;
}

function frame(timestamp) {
  if (!running) return;
  if (!lastFrame) lastFrame = timestamp;
  const elapsed = Math.min(80, timestamp - lastFrame) * speed;
  lastFrame = timestamp;
  simTime += elapsed;
  extendCombatTimeline();
  updatePlayerLife();
  updateWorld();
  while (eventIndex < simulation.log.length && simulation.log[eventIndex].at <= simTime) {
    processEvent(simulation.log[eventIndex]);
    eventIndex += 1;
  }
  compactTimeline();
  if (timestamp - lastCleanupAt >= RUNTIME_RETENTION.cleanupIntervalMs) {
    runRuntimeCleanup();
    lastCleanupAt = timestamp;
  }
  if (timestamp - lastUiRenderAt >= RUNTIME_RETENTION.uiRenderIntervalMs) {
    updateReadout();
    lastUiRenderAt = timestamp;
  }
}

frameLoop = createSingleFlightAnimationLoop(frame);

function synchronizeCombatBuild() {
  const latest = loadoutAuthority.snapshot();
  const latestHash = latest.compiledBuild?.buildHash ?? null;
  const currentHash = compiledBuild?.buildHash ?? null;
  if (latest.loadoutVersion !== authoritySnapshot.loadoutVersion || latestHash !== currentHash) {
    compile(latest);
    renderBuild();
    reset();
  }
  if (compiledBuild) return true;
  const detail = latest.characterBuild.equippedWeaponInstanceId === null
    ? "请先把背包武器装入角色武器栏"
    : "请先在当前武器的五孔中装入至少一张技能卡";
  $("logSummary").textContent = `无法开始 · ${detail}`;
  $("compileStatus").textContent = `构筑未就绪 · Loadout v${latest.loadoutVersion}`;
  return false;
}

$("startBtn").addEventListener("click", () => {
  if (running) {
    running = false;
    frameLoop.stop();
  } else {
    if (!synchronizeCombatBuild()) return;
    running = true;
    lastFrame = 0;
    frameLoop.start();
  }
  $("startBtn").textContent = running ? "暂停战斗" : "继续战斗";
  $("logSummary").textContent = running ? `${visibleLogCount} 条事件 · 实时滚动` : `${visibleLogCount} 条事件 · 已暂停`;
});
$("resetBtn").addEventListener("click", () => { reset(); startAutomatically(); });
$("cleanupBtn").addEventListener("click", () => {
  runRuntimeCleanup({ manual: true });
  $("cleanupBtn").textContent = "已立即压缩";
  if (cleanupFeedbackTimer !== null) clearTimeout(cleanupFeedbackTimer);
  cleanupFeedbackTimer = setTimeout(() => {
    cleanupFeedbackTimer = null;
    $("cleanupBtn").textContent = "立即压缩（可选）";
  }, 900);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) runRuntimeCleanup();
});
document.querySelectorAll("[data-speed]").forEach((button) => button.addEventListener("click", () => {
  speed = Number(button.dataset.speed);
  document.querySelectorAll("[data-speed]").forEach((item) => item.classList.toggle("active", item === button));
}));

window.addEventListener("authoritative-loadout-change", (event) => {
  compile(event.detail.snapshot);
  renderBuild();
  reset();
  if (compiledBuild) startAutomatically();
});
function startAutomatically() {
  if (!compiledBuild) return;
  if (autoStartTimer !== null) clearTimeout(autoStartTimer);
  autoStartTimer = setTimeout(() => {
    autoStartTimer = null;
    if (!running && simTime === 0) $("startBtn").click();
  }, 420);
}

compile();
renderBuild();
reset();
startAutomatically();
