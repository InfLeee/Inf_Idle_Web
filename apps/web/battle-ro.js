import {
  currentLoadoutSnapshot,
  loadoutAuthority,
  subscribeLoadoutSnapshot,
} from "./loadout-authority.js?v=m4c-closure-3";
import {
  advanceCompiledCombat,
  advanceEncounterWorld,
  configureEncounterWorld,
  createCompiledCombatState,
  createEncounterWorldState,
  defeatEncounterMonster,
  encounterFrequencyCapacity,
  encounterIntervalMs,
  encounterKillRatePerSecond,
  encounterLivingCapacity,
  restartEncounterWorld,
  TARGET_SELECTOR_KIND,
} from "../../packages/combat-runtime/src/index.js?v=m4c-closure-3";
import {
  RUNTIME_RETENTION,
  clearTransientNodes,
  compactConsumedEvents,
  createDamageAccumulator,
  createSingleFlightAnimationLoop,
  mountTransientNode,
  transientRetentionStats,
  trimOldestChildren,
} from "./runtime-retention.js?v=performance-1";
import { createSeededRng } from "../../packages/combat-protocol/src/settlement.js";
import { createProjectileVolley, resolveProjectileVolleyCollisions } from "../../packages/combat-protocol/src/projectile-volley.js";
import { DAMAGE_TYPES, settleDirectDamage } from "../../packages/combat-numerics/src/index.js";
import { createM3MonsterTemplate } from "../../packages/game-config/m3-monster-templates.js";

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const SUPPORT_STATUS_TEXT = Object.freeze({
  active: "生效",
  partial: "部分生效",
  incompatible: "不兼容",
  mutual_exclusion: "互斥失效",
  effect_invalid: "目标无效",
  config_error: "配置错误",
});
const COMBAT_START_MS = 4_000;
const COMBAT_CYCLE_MS = 60_000;
const BUILD_HOT_SWAP_GCD_MS = 500;
const RADAR_RADIUS_M = 30;
const MELEE_RANGE_M = 3.4;
const REVIVE_DELAY_MS = 5_000;
const DEMO_CONTROL_EVENTS = Object.freeze([{ atMs: 12_300, kind: "stun" }]);
const ENCOUNTER_DEFAULTS = Object.freeze({
  radarRadiusM: RADAR_RADIUS_M, stopDistanceM: MELEE_RANGE_M, baseEncounterIntervalMs: 3_000,
  minimumEncounterIntervalMs: 750, movementSpeedMultiplier: 1, monsterApproachSpeedMps: 9.5,
  encounterCapacityWindowMs: 18_000, killRateWindowMs: 12_000, baseLivingCapacity: 3,
  minimumLivingCapacity: 6, maximumLivingCapacity: 24,
  seed: 20260828, initialEncounterDelayMs: 1_150,
});
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
  ignition_break: "./assets/skill-collision.png",
  sword_wave_projectile: "./assets/skill-storm.png",
};
let compiledBuild;
let combatRuntimeState;
let authoritySnapshot = loadoutAuthority.snapshot();
let simulation;
let combatTemplate = [];
let combatTimelineOffsetMs = COMBAT_START_MS;
let nextCombatCycleAt = COMBAT_START_MS + COMBAT_CYCLE_MS;
let monsters = [];
let encounterState = createEncounterWorldState(ENCOUNTER_DEFAULTS);
let killCount = 0;
let speed = 1;
globalThis.__INF_IDLE_BATTLE_SPEED__ = speed;
let running = false;
let simTime = 0;
let lastFrame = 0;
let eventIndex = 0;
let visibleLogCount = 0;
let spirit = 0;
let overclock = false;
let overclockStacks = 0;
let overclockExpiresAt = null;
const damageAccumulator = createDamageAccumulator();
let lastUiRenderAt = 0;
let lastRadarRenderAt = 0;
let lastRosterRenderAt = -Infinity;
let lastCleanupAt = 0;
let removedTimelineEvents = 0;
let cleanupCount = 0;
let slashCount = 0;
let auraCount = 0;
let playerHp = 100;
let playerMaxHp = 100;
let criticalCount = 0;
let damageRng = createSeededRng(ENCOUNTER_DEFAULTS.seed ^ 0x4d334430);
let playerState = "alive";
let reviveAt = 0;
let frameLoop;
let autoStartTimer = null;
let cleanupFeedbackTimer = null;
let pausedByVisibility = false;
let pausedByUser = false;

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
  combatTimelineOffsetMs = COMBAT_START_MS;
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
  const supportStatuses = compiledBuild?.supportStatuses ?? [];
  const supportRegistry = authoritySnapshot.ownershipInput.registry.supports ?? {};
  const supportsBySkill = new Map();
  for (const status of supportStatuses) {
    const list = supportsBySkill.get(status.attachedSkillEntryId) ?? [];
    list.push(status);
    supportsBySkill.set(status.attachedSkillEntryId, list);
  }
  $("skillBar").innerHTML = slots.map((skill, socketIndex) => {
    if (!skill) return `<article class="skill-slot empty"><div><strong>孔 ${socketIndex + 1} · 空</strong><small>未携带技能</small></div></article>`;
    const action = skill.actions[0];
    const image = SKILL_IMAGES[skill.definitionId] ?? "./assets/skill-slash.png";
    const timing = skill.runtime.backgroundAction ? "独立时钟" : `${action.timing.cooldownMs / 1000}s 冷却`;
    const supports = supportsBySkill.get(skill.entryId) ?? [];
    const supportHtml = supports.length
      ? supports.map((status) => {
        const name = supportRegistry[status.sourceDefinitionId]?.name ?? status.sourceDefinitionId;
        const statusText = SUPPORT_STATUS_TEXT[status.status] ?? status.status;
        const statusClass = String(status.status).replace(/[^a-z_-]/g, "");
        return `<span class="skill-support ${statusClass}" title="${escapeHtml(name)} · ${escapeHtml(statusText)}">${escapeHtml(name)}<b>${escapeHtml(statusText)}</b></span>`;
      }).join("")
      : '<span class="skill-support none">未连接辅助卡</span>';
    return `<article class="skill-slot" data-skill-id="${escapeHtml(skill.definitionId)}"><img src="${image}" alt="${escapeHtml(action.name)}"><div><strong>孔 ${socketIndex + 1} · ${escapeHtml(action.name)}</strong><small>${timing}</small></div><div class="skill-support-list">${supportHtml}</div></article>`;
  }).join("");
  const activeSupportCount = supportStatuses.filter((status) => status.status === "active" || status.status === "partial").length;
  $("supportCards").innerHTML = `<span class="support-card active">${supportStatuses.length} 张连接 · ${activeSupportCount} 张生效</span><span class="support-card">武器技能 ${compiledBuild?.weaponSkillEntryIds.length ?? 0} 个</span>`;
  const primarySkill = slots.find(Boolean);
  const primaryAction = primarySkill?.actions[0];
  const damage = primaryAction?.effects.find((effect) => effect.kind === "direct_damage");
  const actionTimeMs = primaryAction?.timing.castTimeMs ?? primaryAction?.timing.tickIntervalMs ?? 0;
  const range = primaryAction?.targeting.radiusM ? ` · ${primaryAction.targeting.radiusM}m 范围` : "";
  $("compiledSlash").textContent = primaryAction && damage
    ? `当前主技能：${primaryAction.name} · ${Math.round(actionTimeMs)}ms · ${damage.params.multiplier.toFixed(2)}×${range}`
    : "当前没有可执行的主技能";
  $("compileStatus").textContent = compiledBuild
    ? `已实时同步 · ${compiledBuild.buildHash.slice(0, 8)} · Loadout v${authoritySnapshot.loadoutVersion}`
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
  pausedByUser = false;
  simTime = 0;
  lastFrame = 0;
  eventIndex = 0;
  visibleLogCount = 0;
  monsters = [];
  encounterState = createEncounterWorldState({
    ...encounterState.config,
    initialEncounterDelayMs: ENCOUNTER_DEFAULTS.initialEncounterDelayMs,
  });  killCount = 0;
  spirit = 0;
  overclock = false;
  overclockStacks = 0;
  overclockExpiresAt = null;
  damageAccumulator.reset();
  lastUiRenderAt = 0;
  lastRadarRenderAt = 0;
  lastRosterRenderAt = -Infinity;
  lastCleanupAt = 0;
  removedTimelineEvents = 0;
  cleanupCount = 0;
  slashCount = 0;
  auraCount = 0;
  playerMaxHp = compiledBuild?.characterStats?.derived?.final?.maxHp ?? 100;
  playerHp = playerMaxHp;
  criticalCount = 0;
  damageRng = createSeededRng(ENCOUNTER_DEFAULTS.seed ^ 0x4d334430);
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
  combatTimelineOffsetMs = COMBAT_START_MS;
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
  clearTransientNodes($("radarProjectiles"));
  clearTransientNodes($("playerFloats"));
  $("startBtn").textContent = "开始战斗";
  $("logSummary").textContent = "等待自动扫描";
  updateReadout();
}

function spawnMonster(worldMonster) {
  const type = MONSTER_TYPES[worldMonster.encounterSerial % MONSTER_TYPES.length];
  const tier = worldMonster.encounterSerial > 0 && worldMonster.encounterSerial % 12 === 0 ? "elite" : "normal";
  const numeric = createM3MonsterTemplate({ tier, level: globalThis.__INF_IDLE_MAP_MONSTER_LEVEL__ ?? 10 });
  // M4B loot presentation test: keep targets deliberately fragile so several
  // rarity pillars can be inspected without waiting through a balance run.
  const maxHp = Math.max(24, Math.round(numeric.maxHp * 0.24));
  const monster = {
    id: worldMonster.id, type, name: tier === "elite" ? `精英·${type.name}` : type.name, hp: maxHp, maxHp,
    numeric,
    heal: type.heal, angle: worldMonster.angleDeg, distance: worldMonster.distanceM,
    state: worldMonster.state, spawnAt: worldMonster.spawnedAtMs, engageAt: worldMonster.engageAtMs,
    nextHealAt: simTime + 5_200, nextAttackAt: simTime + 4_000 + (worldMonster.id % 4) * 250, deathAt: null,
  };
  monsters.push(monster);
  addLog({ at: simTime }, "探索遇敌", `${monster.name}从30米外圈出现`, `目标 ${monster.id}`, `${worldMonster.distanceM.toFixed(1)}m`, "system");
  spawnRadarFloat(monster, "发现目标", "heal");
}

function processEncounterWorldEvent(event) {
  if (event.type === "monster_spawned") {
    spawnMonster(event.monster);
  } else if (event.type === "monster_approach_completed") {
    const monster = monsters.find((item) => item.id === event.monsterId);
    if (monster) addLog(event, "进入近战范围", `${monster.name}完成自主接近`, monster.name, `${event.distanceM.toFixed(1)}m`, "system");
  } else if (event.type === "encounter_generation_paused") {
    addLog(event, "遇敌暂停", "雷达存活目标达到容量上限", "探索系统", `${encounterLivingCapacity(encounterState)} / ${encounterLivingCapacity(encounterState)}`, "system");
  } else if (event.type === "encounter_generation_resumed") {
    addLog(event, "恢复探索", "击杀释放雷达容量", "探索系统", `${encounterIntervalMs(encounterState) / 1000}s`, "system");
  }
}

function updateWorld() {
  const segment = advanceEncounterWorld({ state: encounterState, untilMs: simTime });
  encounterState = segment.state;
  segment.events.forEach(processEncounterWorldEvent);
  const worldById = new Map(encounterState.monsters.map((monster) => [monster.id, monster]));
  monsters.forEach((monster) => {
    const worldMonster = worldById.get(monster.id);
    if (monster.state !== "dead" && worldMonster) {
      monster.state = worldMonster.state;
      monster.distance = worldMonster.distanceM;
      monster.angle = worldMonster.angleDeg;
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
      monster.nextAttackAt += monster.numeric.attackIntervalMs;
      damagePlayer(monster);
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

function renderMonsterPositions() {
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
}

function renderMonsterRoster() {
  if (simTime - lastRosterRenderAt < RUNTIME_RETENTION.rosterRenderIntervalMs) return;
  lastRosterRenderAt = simTime;
  const target = primaryTarget();
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
  $("encounterIntervalReadout").textContent = `${(encounterIntervalMs(encounterState) / 1000).toFixed(2)}s / 怪`;
  $("encounterFrequencyCapacityReadout").textContent = `移速理论 ${encounterFrequencyCapacity(encounterState)} 怪`;
  $("encounterCapacityReadout").textContent = `当前容量 ${encounterLivingCapacity(encounterState)} 怪`;
  $("encounterKillRateReadout").textContent = `击杀频率 ${encounterKillRatePerSecond(encounterState).toFixed(2)} / 秒`;
  $("playerStatus").textContent = `HP ${Math.round(playerHp)}/${Math.round(playerMaxHp)} · 斗气 ${Math.round(spirit)}/100`;
  $("playerHpText").textContent = `${Math.round(playerHp)} / ${Math.round(playerMaxHp)}`;
  $("playerHpBar").style.width = `${playerHp / playerMaxHp * 100}%`;
  $("playerLifeState").textContent = playerState === "dead" ? `${reviveSeconds.toFixed(1)}s 后复活` : "战斗中";
  $("playerLifeState").classList.toggle("dead", playerState === "dead");
  document.querySelector(".player-summary").classList.toggle("dead", playerState === "dead");
  document.querySelector(".radar-player").classList.toggle("dead", playerState === "dead");
  $("aliveCount").textContent = `存活 ${living.length} / ${encounterLivingCapacity(encounterState)}`;
  $("waveText").textContent = `第 ${Math.floor(killCount / encounterLivingCapacity(encounterState)) + 1} 波 · 击杀 ${killCount}`;
  $("encounterPhase").textContent = playerState === "dead" ? `复活倒计时 ${reviveSeconds.toFixed(1)}s` : engaged.length ? `交战中 · ${engaged.length}目标` : living.length ? "目标接近" : "扫描中";
  $("spiritText").textContent = `${Math.round(spirit)} / 100`;
  $("spiritBar").style.width = `${spirit}%`;
  $("dpsMetric").textContent = Math.round(total / combatSeconds).toLocaleString();
  $("totalMetric").textContent = `总伤害 ${Math.round(total).toLocaleString()}`;
  $("hitMetric").textContent = damageStats.count;
  $("critMetric").textContent = damageStats.count ? `${(criticalCount / damageStats.count * 100).toFixed(1)}%` : "0.0%";
  $("critDetail").textContent = criticalCount;
  $("avgMetric").textContent = Math.round(average).toLocaleString();
  $("maxMetric").textContent = damageStats.count ? damageStats.maximum.toLocaleString() : "0";
  $("minMetric").textContent = damageStats.count ? damageStats.minimum.toLocaleString() : "0";
  $("accuracyMetric").textContent = damageStats.count ? "100.0%" : "0.0%";
  $("hitDetail").textContent = damageStats.count;
  $("attemptMetric").textContent = damageStats.count;
  $("slashMetric").textContent = slashCount;
  $("auraMetric").textContent = auraCount;
  const overclockRemaining = overclockExpiresAt === null ? null : Math.max(0, overclockExpiresAt - simTime);
  $("auraState").textContent = overclock
    ? `Buff · ${overclockStacks}层${overclockRemaining === null ? " · 持续" : ` · ${(overclockRemaining / 1000).toFixed(1)}s`}`
    : spirit >= 100 ? "高亮就绪" : "等待斗气满值";
  $("auraChip").textContent = `灵气剑超频 · ${overclock ? `已激活 ${overclockStacks}层` : "未激活"}`;
  $("auraChip").classList.toggle("active", overclock);
  $("auraChip").classList.toggle("inactive", !overclock);
  renderMonsterRoster();
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

window.addEventListener("inf-idle:loot-collected", (event) => {
  const item = event.detail?.item;
  if (!item) return;
  addLog({ at: simTime }, "自动拾取", `${item.name}汇聚到拾取者`, "冒险背包", `${item.itemLevel}级 · ${item.rarity}`, "system");
  spawnFloat(`拾取 ${item.name}`, "state");
});

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
  // The position is the unit center. Lift the number above the 36px avatar,
  // rather than placing it above the name/HP block below the circle.
  node.style.top = `calc(${position.y}% - 36px)`;
  mountTransientNode($("radarFloats"), node);
}

function spawnProjectileVolley(collision) {
  for (const projectile of collision.projectiles) {
    const node = document.createElement("span");
    node.className = `radar-projectile ${projectile.state}`;
    node.style.setProperty("--projectile-angle", `${projectile.directionAngleDeg}deg`);
    node.style.setProperty("--projectile-distance", `${projectile.distance / RADAR_RADIUS_M * 42}%`);
    node.style.setProperty("--projectile-duration", `${Math.max(70, projectile.distance / 24 * 1000 / speed)}ms`);
    node.innerHTML = "<i></i>";
    mountTransientNode($("radarProjectiles"), node, { maximum: 96, fallbackTtlMs: 1_600 });
  }
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

function damagePlayer(monster) {
  if (playerState !== "alive") return;
  const stats = compiledBuild?.characterStats;
  const settlement = settleDirectDamage({
    damageType: DAMAGE_TYPES.PHYSICAL,
    attackPower: monster.numeric.attackDamage,
    attackerLevel: monster.numeric.level,
    defenderLevel: stats?.level ?? 1,
    defense: stats?.derived?.final?.physicalDefense ?? 0,
    critRoll: 1,
    varianceRoll: damageRng.nextFloat(),
  });
  const value = settlement.finalDamage;
  playerHp = Math.max(0, playerHp - value);
  const event = { at: simTime };
  addLog(event, "怪物攻击", `${monster.name}命中玩家`, "双手剑持有者", value.toLocaleString(), "hit");
  spawnFloat(`-${value}`, "damage");
  if (playerHp <= 0) {
    playerState = "dead";
    reviveAt = simTime + REVIVE_DELAY_MS;
    spirit = 0;
    overclock = false;
    overclockStacks = 0;
    overclockExpiresAt = null;
    addLog(event, "玩家死亡", "停止输出并进入复活倒计时", "自身", "5.0s", "state");
    spawnFloat("战败", "state");
  }
}

function healPlayer(amount, options = {}) {
  if (!Number.isFinite(amount) || amount <= 0 || playerState !== "alive") return 0;
  const healed = Math.min(amount, playerMaxHp - playerHp);
  if (healed <= 0) return 0;
  playerHp += healed;
  const rounded = Math.round(healed);
  addLog({ at: simTime }, options.label ?? "受到治疗", options.detail ?? "恢复生命", "双手剑持有者", `+${rounded}`, "state");
  spawnFloat(`+${rounded}${options.suffix ? ` ${options.suffix}` : ""}`, "heal");
  return healed;
}

function updatePlayerLife() {
  if (playerState !== "dead" || simTime < reviveAt) return;
  playerState = "alive";
  playerHp = 0;
  reviveAt = 0;
  const restarted = restartEncounterWorld({
    state: encounterState,
    atMs: simTime,
    initialEncounterDelayMs: ENCOUNTER_DEFAULTS.initialEncounterDelayMs,
    reason: "player_revived",
  });
  encounterState = restarted.state;
  monsters = [];
  $("radarUnits").replaceChildren();
  clearTransientNodes($("radarFloats"));
  clearTransientNodes($("radarProjectiles"));
  const healed = healPlayer(playerMaxHp, { label: "复活治疗", detail: "恢复全部生命", suffix: "复活" });
  addLog({ at: simTime }, "玩家复活", "生命恢复、清空雷达并重新扫描", "自身", `+${Math.round(healed)}`, "state");
  addLog({ at: simTime }, "遭遇重置", `已清除 ${restarted.events[0].removedMonsterCount} 个残留目标`, "草原视域", `${ENCOUNTER_DEFAULTS.initialEncounterDelayMs / 1000}s 后刷新`, "system");
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
    simulation.log.push(...segment.events.map((event) => ({ ...event, at: event.at + combatTimelineOffsetMs })));
    nextCombatCycleAt = combatTimelineOffsetMs + combatRuntimeState.nowMs;
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
    projectileNodes: $("radarProjectiles").children.length,
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
    " · 投射物 " + snapshot.projectileNodes +
    " · 受管节点 " + snapshot.trackedTransientNodes +
    " · 动画循环 " + snapshot.activeAnimationLoops + "/1";
}

function runRuntimeCleanup(options = {}) {
  const manual = options.manual ?? false;
  trimOldestChildren($("eventLog"), manual ? 0 : RUNTIME_RETENTION.maxLogRows);
  if (manual) {
    clearTransientNodes($("radarFloats"));
    clearTransientNodes($("playerFloats"));
    clearTransientNodes($("radarProjectiles"));
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
  const defeated = defeatEncounterMonster({ state: encounterState, monsterId: monster.id });
  encounterState = defeated.state;
  defeated.events.forEach(processEncounterWorldEvent);
  const dropPosition = monsterPosition(monster);
  window.dispatchEvent(new CustomEvent("inf-idle:authoritative-monster-defeated", { detail: {
    monsterId: monster.id, monsterLevel: monster.numeric.level, monsterName: monster.name,
    killCount, atMs: simTime, x: dropPosition.x, y: dropPosition.y,
  } }));
}

function applyDamage(event, skillName, multiplier, hitCount, monster) {
  if (!monster || monster.state !== "engaged") return;
  const stats = compiledBuild?.characterStats;
  const derived = stats?.derived?.final ?? {};
  const damageType = event.skillTags?.includes("TRUE") ? DAMAGE_TYPES.TRUE : event.skillTags?.includes("MAGIC") ? DAMAGE_TYPES.MAGIC : DAMAGE_TYPES.PHYSICAL;
  const baseMultiplier = event.baseMultiplier ?? multiplier;
  const compiledModifier = baseMultiplier === 0 ? 0 : multiplier / baseMultiplier;
  const settlement = settleDirectDamage({
    damageType,
    attackPower: (damageType === DAMAGE_TYPES.MAGIC ? derived.magicAttack : derived.physicalAttack) ?? 10,
    skillCoefficient: baseMultiplier * Math.max(1, hitCount),
    skillLevel: event.skillLevel ?? 1,
    skillLevelGrowth: event.skillLevelGrowth ?? 0.08,
    moreDamage: compiledModifier === 1 ? [] : [compiledModifier - 1],
    attackerLevel: stats?.level ?? 1,
    defenderLevel: monster.numeric.level,
    defense: damageType === DAMAGE_TYPES.MAGIC ? monster.numeric.magicDefense : monster.numeric.physicalDefense,
    penetration: damageType === DAMAGE_TYPES.MAGIC ? derived.magicPenetration ?? 0 : derived.physicalPenetration ?? 0,
    critRating: derived.critRating ?? 0,
    critResistance: monster.numeric.critResistance,
    critMultiplier: stats?.combatRates?.baseCritDamageMultiplier ?? 1.5,
    critRoll: damageRng.nextFloat(),
    varianceRoll: damageRng.nextFloat(),
  });
  const value = settlement.finalDamage;
  if (settlement.critical) criticalCount += 1;
  damageAccumulator.record(value);
  monster.hp = Math.max(0, monster.hp - value);
  const detail = `${hitCount > 1 ? `${hitCount}段` : "直接"} · 减伤 ${(settlement.rates.effectiveMitigationRate * 100).toFixed(1)}%${settlement.critical ? " · 暴击" : ""}`;
  addLog(event, `${skillName}命中`, detail, monster.name, value.toLocaleString());
  spawnRadarFloat(monster, `${settlement.critical ? "暴击 " : ""}-${value.toLocaleString()}`);
  flashMonster(monster.id);
  if (monster.hp <= 0) defeatMonster(monster, event);
}

function resolveProjectileDamage(event, primary, targets) {
  const volley = createProjectileVolley({
    projectileCount: event.projectileCount ?? event.projectileVolley?.projectileCount ?? 1,
    aimAngleDeg: primary.angle,
    spacingDeg: event.projectileVolley?.spacingDeg,
    sameVolleyHitLimitPerTarget: event.projectileVolley?.sameVolleyHitLimitPerTarget ?? 1,
  });
  const collision = resolveProjectileVolleyCollisions({
    volley,
    origin: { x: 0, y: 0 },
    maximumDistance: RADAR_RADIUS_M,
    targets: targets.map((monster) => {
      const radians = monster.angle * Math.PI / 180;
      return {
        targetId: monster.id,
        x: Math.cos(radians) * monster.distance,
        y: Math.sin(radians) * monster.distance,
        radius: 1.15,
      };
    }),
  });
  spawnProjectileVolley(collision);
  const hitsByTarget = new Map();
  for (const projectile of collision.effectiveHits) {
    hitsByTarget.set(projectile.targetId, (hitsByTarget.get(projectile.targetId) ?? 0) + 1);
  }
  for (const [targetId, projectileHits] of hitsByTarget) {
    const monster = targets.find((entry) => String(entry.id) === String(targetId));
    if (monster) applyDamage(event, event.skillName, event.multiplier, Math.max(1, event.hitCount ?? 1) * projectileHits, monster);
  }
  if (!collision.effectiveHits.length) {
    addLog(event, `${event.skillName}未命中`, `${volley.projectileCount}枚齐射未与目标碰撞`, primary.name, "MISS", "state");
  }
  return collision;
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
    if (event.skillTags?.includes("PROJECTILE") && event.projectileVolley) {
      resolveProjectileDamage(event, primary, engaged);
      flash(event.skillDefinitionId);
      return;
    }
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
    if (event.stateId === "aura_blade_overclock") {
      overclockStacks = event.stackCount ?? 1;
      overclockExpiresAt = event.durationMs === null ? null : event.at + event.durationMs;
    }
    addLog(event, "状态获得", `${event.stateId} · ${event.statusKind ?? "neutral"}`, "自身", `${event.stackCount ?? 1}层 · ${event.durationMs === null ? "持续" : `${event.durationMs / 1000}s`}`, "state");
    spawnFloat(event.stateId, "state");
  } else if (event.type === "state_refreshed") {
    if (event.stateId === "aura_blade_overclock") {
      overclock = true;
      overclockStacks = event.stackCount ?? 1;
      overclockExpiresAt = event.durationMs === null ? null : event.at + event.durationMs;
    }
    addLog(event, "状态刷新", `${event.stateId} · ${event.durationPolicy}`, "自身", `${event.previousStackCount}→${event.stackCount}层`, "state");
  } else if (event.type === "state_expired") {
    if (event.stateId === "aura_blade_overclock") {
      overclock = false;
      overclockStacks = 0;
      overclockExpiresAt = null;
    }
    addLog(event, "状态结束", event.stateId, "自身", event.reason ?? "duration_expired", "state");
  } else if (event.type === "state_removed") {
    if (event.stateId === "aura_blade_overclock") {
      overclock = false;
      overclockStacks = 0;
      overclockExpiresAt = null;
    }
    addLog(event, "状态移除", event.stateId, "自身", event.reason, "state");
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
  if (timestamp - lastRadarRenderAt >= RUNTIME_RETENTION.radarRenderIntervalMs) {
    renderMonsterPositions();
    lastRadarRenderAt = timestamp;
  }
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
  const latest = currentLoadoutSnapshot();
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
  if (!synchronizeCombatBuild()) return;
  if (running) {
    running = false;
    pausedByUser = true;
    pausedByVisibility = false;
    frameLoop.stop();
  } else {
    running = true;
    pausedByUser = false;
    lastFrame = 0;
    frameLoop.start();
  }
  $("startBtn").textContent = running ? "暂停战斗" : "继续战斗";
  $("logSummary").textContent = running ? `${visibleLogCount} 条事件 · 实时滚动` : `${visibleLogCount} 条事件 · 已暂停`;
  updateRuntimeHealth();
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
  if (document.hidden) {
    pausedByVisibility = running;
    frameLoop.stop();
    runRuntimeCleanup();
    return;
  }
  if (pausedByVisibility && running) {
    lastFrame = 0;
    frameLoop.start();
  } else if (!running && !pausedByUser && compiledBuild) {
    startAutomatically();
  }
  pausedByVisibility = false;
});
window.addEventListener("pageshow", () => {
  if (!running && !pausedByUser && compiledBuild) startAutomatically();
});
document.querySelectorAll("[data-speed]").forEach((button) => button.addEventListener("click", () => {
  speed = Number(button.dataset.speed);
  globalThis.__INF_IDLE_BATTLE_SPEED__ = speed;
  window.dispatchEvent(new CustomEvent("inf-idle:battle-speed-changed", { detail: { speed } }));
  document.querySelectorAll("[data-speed]").forEach((item) => item.classList.toggle("active", item === button));
}));

document.querySelectorAll("[data-encounter-setting]").forEach((button) => button.addEventListener("click", () => {
  const key = button.dataset.encounterSetting;
  const settingValue = Number(button.dataset.encounterValue);
  const changed = configureEncounterWorld({ state: encounterState, changes: { [key]: settingValue } });
  encounterState = changed.state;
  document.querySelectorAll(`[data-encounter-setting="${key}"]`).forEach((item) => item.classList.toggle("active", item === button));
  const interval = encounterIntervalMs(encounterState);
  $("encounterIntervalReadout").textContent = `${(interval / 1000).toFixed(2)}s / 怪`;
  $("encounterAuthorityReadout").textContent = "中心 0,0 · 硬保护 64";
  $("encounterFrequencyCapacityReadout").textContent = `移速理论 ${encounterFrequencyCapacity(encounterState)} 怪`;
  $("encounterCapacityReadout").textContent = `当前容量 ${encounterLivingCapacity(encounterState)} 怪`;
  $("encounterKillRateReadout").textContent = `击杀频率 ${encounterKillRatePerSecond(encounterState).toFixed(2)} / 秒`;
  addLog({ at: simTime }, "遭遇参数变更", `${key}由服务器规则重新计算`, "探索系统", key === "movementSpeedMultiplier" ? `${Math.round(settingValue * 100)}%` : String(settingValue), "system");
  updateReadout();
}));

function applyAuthoritativeSnapshot(snapshot) {
  const changed = snapshot.loadoutVersion !== authoritySnapshot.loadoutVersion ||
    (snapshot.compiledBuild?.buildHash ?? null) !== (compiledBuild?.buildHash ?? null);
  if (!changed) return;
  const previousHash = compiledBuild?.buildHash ?? null;
  const previousMaxHp = playerMaxHp;
  const previousHpRatio = previousMaxHp > 0 ? playerHp / previousMaxHp : 1;
  authoritySnapshot = snapshot;
  compiledBuild = snapshot.compiledBuild;

  // Drop only future actions from the old build. Encounter state, monsters,
  // player life, battle clock and the running loop remain untouched.
  simulation.log = simulation.log.slice(0, eventIndex);
  if (compiledBuild) {
    const initial = structuredClone(createCompiledCombatState(compiledBuild));
    if (Object.hasOwn(initial.resources, "a_fighting_spirit")) initial.resources.a_fighting_spirit = spirit;
    const segment = advanceCompiledCombat({
      state: initial,
      compiledBuild,
      untilMs: COMBAT_CYCLE_MS,
      controlEvents: DEMO_CONTROL_EVENTS,
    });
    combatRuntimeState = segment.state;
    combatTemplate = segment.events;
    combatTimelineOffsetMs = simTime + BUILD_HOT_SWAP_GCD_MS;
    simulation.log.push(...segment.events.map((event) => ({ ...event, at: event.at + combatTimelineOffsetMs })));
    simulation.log.sort((left, right) => left.at - right.at);
    nextCombatCycleAt = combatTimelineOffsetMs + combatRuntimeState.nowMs;
    playerMaxHp = compiledBuild.characterStats?.derived?.final?.maxHp ?? previousMaxHp;
    if (playerState !== "dead") playerHp = Math.min(playerMaxHp, Math.max(1, playerMaxHp * previousHpRatio));
  } else {
    combatRuntimeState = null;
    combatTemplate = [];
    nextCombatCycleAt = Number.POSITIVE_INFINITY;
  }
  renderBuild();
  const detail = compiledBuild
    ? `新构筑将在下一次 ${BUILD_HOT_SWAP_GCD_MS}ms 执行窗口生效`
    : "武器或技能已卸下，保留当前遭遇并暂停玩家技能释放";
  addLog({ at: simTime }, "构筑热更新", detail, "服务器快照", compiledBuild ? snapshot.compiledBuild.buildHash.slice(0, 8) : "无可用技能", "system");
  $("logSummary").textContent = running
    ? `战斗持续中 · Loadout v${snapshot.loadoutVersion} 已热更新`
    : `Loadout v${snapshot.loadoutVersion} 已更新 · 战斗当前暂停`;
  updateReadout();
}

window.addEventListener("authoritative-loadout-change", (event) => {
  applyAuthoritativeSnapshot(event.detail.snapshot);
});window.addEventListener("mastery-combat-run", (event) => {
  if (!synchronizeCombatBuild()) return;
  reset();
  if (!running) $("startBtn").click();
  $("logSummary").textContent = `精通构筑已进入战斗 · ${event.detail.buildHash.slice(0, 8)} · Loadout v${event.detail.loadoutVersion}`;
});
function startAutomatically() {
  if (!compiledBuild) return;
  if (document.hidden) return;
  if (autoStartTimer !== null) clearTimeout(autoStartTimer);
  autoStartTimer = setTimeout(() => {
    autoStartTimer = null;
    if (!running && !pausedByUser && simTime === 0) $("startBtn").click();
  }, 420);
}

compile(currentLoadoutSnapshot());
renderBuild();
reset();
subscribeLoadoutSnapshot(applyAuthoritativeSnapshot);
startAutomatically();
