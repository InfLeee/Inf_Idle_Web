import { twoHandedSwordA1Config as config } from "../../packages/game-config/two-handed-sword-a1.js";
import { compileWeaponBuild } from "../../packages/build-compiler/src/compileWeaponBuild.js";
import { simulateTwoHandedSwordA1 } from "../../tools/simulator/twoHandedSwordA1.js";

const $ = (id) => document.getElementById(id);
const COMBAT_START_MS = 4_000;
const RUN_END_MS = 64_000;
// 演示参数：低血量用于在一分钟内清楚观察多波刷新、击杀和再生跳字。
const WAVE_TEMPLATES = [
  { name: "轻型构装体", hp: 1_600, heal: 0 },
  { name: "再生构装体", hp: 2_200, heal: 160 },
  { name: "重型构装体", hp: 2_800, heal: 220 },
];
const enabledSupports = new Map(config.supports.map((support) => [support.id, false]));
let build;
let simulation;
let speed = 1;
let running = false;
let simTime = 0;
let lastFrame = 0;
let eventIndex = 0;
let enemyHp = WAVE_TEMPLATES[0].hp;
let enemyMaxHp = WAVE_TEMPLATES[0].hp;
let enemyName = WAVE_TEMPLATES[0].name;
let waveNumber = 1;
let killCount = 0;
let waveState = "scanning";
let approachStartMs = 1_200;
let engageAtMs = COMBAT_START_MS;
let nextSpawnAtMs = Infinity;
let nextHealAtMs = Infinity;
let spirit = 0;
let overclock = false;
let damageValues = [];
let slashCount = 0;
let auraCount = 0;

function supportAssignments() {
  return config.supports.filter((support) => enabledSupports.get(support.id)).map((support, index) => ({
    supportId: support.id,
    skillId: "two_handed_sword_slash",
    insertionOrder: index + 1,
  }));
}

function compile() {
  build = compileWeaponBuild(config, { weaponId: "two_handed_sword", supportAssignments: supportAssignments() });
  const combat = simulateTwoHandedSwordA1(build, { durationMs: 60_000 });
  const encounter = [
    { at: 0, type: "radar", label: "开始扫描", detail: "搜索 12m 战斗视域", value: "扫描中" },
    { at: 1_200, type: "radar", label: "发现目标", detail: "轻型构装体进入雷达", value: "12.0m" },
    { at: COMBAT_START_MS, type: "radar", label: "进入攻击范围", detail: "自动战斗序列接管", value: "3.4m" },
  ];
  simulation = {
    ...combat,
    log: [...encounter, ...combat.log.map((event) => ({ ...event, at: event.at + COMBAT_START_MS }))]
      .sort((left, right) => left.at - right.at),
  };
}

function skillById(id) {
  return build.compiledSkills.find((skill) => skill.id === id);
}

function renderBuild() {
  const glyphs = ["斩", "狂", "风", "撞", "增"];
  $("skillBar").innerHTML = build.skillSlots.map((skill, index) => `<article class="skill-slot" data-skill-id="${skill.id}">
    <span>${glyphs[index]}</span><div><strong>${skill.name}</strong><small>${skill.backgroundAction ? "独立时钟" : `${skill.cooldownMs / 1000}s 冷却`}</small></div>
  </article>`).join("");
  $("supportCards").innerHTML = config.supports.map((support) => `<button type="button" class="support-card ${enabledSupports.get(support.id) ? "active" : ""}" data-support="${support.id}">${support.name}</button>`).join("");
  $("supportCards").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    enabledSupports.set(button.dataset.support, !enabledSupports.get(button.dataset.support));
    compile();
    renderBuild();
    reset();
  }));
  const slash = build.skillSlots[0];
  $("compiledSlash").textContent = `最终斩击：${Math.round(slash.actionTimeMs)}ms · ${slash.stats.damageMultiplier.toFixed(2)}×`;
  $("compileStatus").textContent = `基础技能 · ${supportAssignments().length}/2 辅助卡生效`;
}

function reset() {
  running = false;
  simTime = 0;
  lastFrame = 0;
  eventIndex = 0;
  enemyHp = WAVE_TEMPLATES[0].hp;
  enemyMaxHp = WAVE_TEMPLATES[0].hp;
  enemyName = WAVE_TEMPLATES[0].name;
  waveNumber = 1;
  killCount = 0;
  waveState = "scanning";
  approachStartMs = 1_200;
  engageAtMs = COMBAT_START_MS;
  nextSpawnAtMs = Infinity;
  nextHealAtMs = Infinity;
  spirit = 0;
  overclock = false;
  damageValues = [];
  slashCount = 0;
  auraCount = 0;
  document.body.classList.remove("running");
  $("eventLog").innerHTML = '<div class="empty-log"><strong>尚无战斗事件</strong><span>点击“开始战斗”后，自动释放序列会实时写入这里。</span></div>';
  $("startBtn").textContent = "开始战斗";
  $("logSummary").textContent = "等待战斗开始";
  $("encounterPhase").textContent = "扫描中";
  $("distanceText").textContent = "--";
  $("radarEnemy").classList.remove("visible");
  $("radarEnemy").classList.remove("dead");
  $("enemyActor").classList.add("undiscovered");
  $("radarFloats").replaceChildren();
  $("enemyFloats").replaceChildren();
  $("playerFloats").replaceChildren();
  updateReadout();
}

function totalDamage() {
  return damageValues.reduce((sum, value) => sum + value, 0);
}

function updateReadout() {
  const total = totalDamage();
  const combatSeconds = Math.max(1, (simTime - COMBAT_START_MS) / 1000);
  const average = damageValues.length ? total / damageValues.length : 0;
  const discovered = waveState !== "scanning" && waveState !== "waiting";
  const engaged = waveState === "engaged";
  $("clock").textContent = `${(simTime / 1000).toFixed(1)}s`;
  $("playerStatus").textContent = `HP 100/100 · 斗气 ${Math.round(spirit)}/100`;
  $("enemyName").textContent = discovered ? enemyName : "扫描目标中";
  $("enemyStatus").textContent = discovered ? `${enemyName} · HP ${Math.round(enemyHp).toLocaleString()}/${enemyMaxHp.toLocaleString()}` : `已击杀 ${killCount} · 等待刷新`;
  $("enemyHpText").textContent = discovered ? `${Math.round(enemyHp).toLocaleString()} / ${enemyMaxHp.toLocaleString()}` : "等待下一波";
  $("enemyHpBar").style.width = `${enemyMaxHp ? enemyHp / enemyMaxHp * 100 : 0}%`;
  $("spiritText").textContent = `${Math.round(spirit)} / 100`;
  $("spiritBar").style.width = `${spirit}%`;
  $("dpsMetric").textContent = Math.round(total / combatSeconds).toLocaleString();
  $("totalMetric").textContent = `总伤害 ${Math.round(total).toLocaleString()}`;
  $("hitMetric").textContent = damageValues.length;
  $("avgMetric").textContent = Math.round(average).toLocaleString();
  $("maxMetric").textContent = damageValues.length ? Math.max(...damageValues).toLocaleString() : "0";
  $("minMetric").textContent = damageValues.length ? Math.min(...damageValues).toLocaleString() : "0";
  $("accuracyMetric").textContent = damageValues.length ? "100.0%" : "0.0%";
  $("hitDetail").textContent = damageValues.length;
  $("attemptMetric").textContent = damageValues.length;
  $("slashMetric").textContent = slashCount;
  $("auraMetric").textContent = auraCount;
  $("auraState").textContent = overclock ? "超频生效中" : spirit >= 100 ? "高亮就绪" : "等待斗气满值";
  $("auraChip").textContent = `灵气剑超频 · ${overclock ? "已激活" : "未激活"}`;
  $("auraChip").classList.toggle("active", overclock);
  $("auraChip").classList.toggle("inactive", !overclock);
  $("waveText").textContent = `第 ${waveNumber} 波 · 击杀 ${killCount}`;
  updateEncounter(discovered, engaged);
}

function updateEncounter(discovered, engaged) {
  let distance = null;
  if (waveState === "approaching") distance = 12 - ((simTime - approachStartMs) / (engageAtMs - approachStartMs)) * 8.6;
  if (engaged) distance = 3.4;
  if (waveState === "dead") distance = 3.4;
  $("encounterPhase").textContent = waveState === "scanning" ? "扫描中" : waveState === "waiting" ? "等待刷新" : waveState === "dead" ? "目标击杀" : engaged ? "交战中" : "目标接近";
  $("radarEnemy").classList.toggle("visible", discovered);
  $("radarEnemy").classList.toggle("dead", waveState === "dead");
  $("enemyActor").classList.toggle("undiscovered", !discovered || waveState === "dead");
  if (distance === null) {
    $("distanceText").textContent = "--";
    return;
  }
  $("distanceText").textContent = `${distance.toFixed(1)}m`;
  $("radarEnemy").style.left = `${50 + Math.min(12, distance) / 12 * 42}%`;
}

function timeLabel(ms) {
  const seconds = ms / 1000;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${Math.floor(seconds % 1 * 10)}`;
}

function flash(skillId) {
  const slot = document.querySelector(`[data-skill-id="${skillId}"]`);
  if (slot) {
    slot.classList.add("active");
    setTimeout(() => slot.classList.remove("active"), 160);
  }
  $("strikeLine").classList.remove("hit");
  void $("strikeLine").offsetWidth;
  $("strikeLine").classList.add("hit");
}

function addLog(event, label, detail, target, value, kind = "hit") {
  const empty = $("eventLog").querySelector(".empty-log");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "event-row";
  const system = kind === "system";
  row.innerHTML = `<time>${timeLabel(event.at)}</time><span class="source"><i>${system ? "⌖" : kind === "state" ? "◇" : "Ⅱ"}</i>${system ? "战斗雷达" : "双手剑持有者"}</span><span class="event-name ${kind}">${label} · ${detail}</span><span class="target">${target}</span><strong class="value">${value}</strong>`;
  $("eventLog").append(row);
  if ($("autoScroll").checked) $("eventLog").scrollTop = $("eventLog").scrollHeight;
}

function spawnFloat(layerId, text, kind = "damage") {
  const node = document.createElement("span");
  node.className = `float-number ${kind}`;
  node.textContent = text;
  node.style.left = `${44 + Math.random() * 16}%`;
  $(layerId).append(node);
  node.addEventListener("animationend", () => node.remove(), { once: true });
}

function spawnRadarFloat(text, kind = "damage") {
  const node = document.createElement("span");
  node.className = `radar-float ${kind}`;
  node.textContent = text;
  node.style.left = $("radarEnemy").style.left || "92%";
  node.style.top = `${42 + Math.random() * 7}%`;
  $("radarFloats").append(node);
  node.addEventListener("animationend", () => node.remove(), { once: true });
}

function currentWaveTemplate() {
  return WAVE_TEMPLATES[(waveNumber - 1) % WAVE_TEMPLATES.length];
}

function spawnNextWave() {
  waveNumber += 1;
  const template = currentWaveTemplate();
  enemyName = template.name;
  enemyMaxHp = template.hp + Math.floor((waveNumber - 1) / WAVE_TEMPLATES.length) * 400;
  enemyHp = enemyMaxHp;
  waveState = "approaching";
  approachStartMs = simTime;
  engageAtMs = simTime + 1_800;
  nextSpawnAtMs = Infinity;
  nextHealAtMs = engageAtMs + 2_200;
  $("radarEnemy").classList.remove("dead");
  addLog({ at: simTime }, "怪物刷新", `${enemyName}从视域边缘接近`, "第 " + waveNumber + " 波", "12.0m", "system");
  spawnRadarFloat("刷新", "heal");
}

function defeatEnemy(event) {
  killCount += 1;
  waveState = "dead";
  nextSpawnAtMs = simTime + 1_350;
  nextHealAtMs = Infinity;
  addLog(event, "目标击杀", `${enemyName}生命归零`, enemyName, `第 ${killCount} 杀`, "system");
  spawnFloat("enemyFloats", "击杀", "state");
  spawnRadarFloat("击杀", "kill");
}

function updateWaveState() {
  if (waveState === "scanning" && simTime >= approachStartMs) waveState = "approaching";
  if (waveState === "approaching" && simTime >= engageAtMs) {
    waveState = "engaged";
    nextHealAtMs = simTime + 2_200;
  }
  if (waveState === "dead" && simTime >= nextSpawnAtMs) {
    waveState = "waiting";
    spawnNextWave();
  }
  const template = currentWaveTemplate();
  if (waveState === "engaged" && template.heal > 0 && simTime >= nextHealAtMs) {
    const healed = Math.min(template.heal, enemyMaxHp - enemyHp);
    nextHealAtMs += 2_400;
    if (healed > 0) {
      enemyHp += healed;
      const event = { at: simTime };
      addLog(event, "生命回复", `${enemyName}触发再生`, enemyName, `+${healed}`, "state");
      spawnFloat("enemyFloats", `+${healed}`, "resource");
      spawnRadarFloat(`+${healed}`, "heal");
    }
  }
}

function applyDamage(event, skillId, label, detail) {
  if (waveState !== "engaged") return;
  const skill = skillById(skillId);
  const value = Math.round((skill?.stats?.damageMultiplier ?? 0) * 100);
  damageValues.push(value);
  enemyHp = Math.max(0, enemyHp - value);
  addLog(event, label, detail, enemyName, value.toLocaleString());
  spawnFloat("enemyFloats", `-${value.toLocaleString()}`);
  spawnRadarFloat(`-${value.toLocaleString()}`);
  flash(skillId);
  if (enemyHp <= 0) defeatEnemy(event);
}

function processEvent(event) {
  if ((event.type === "background_attack" || event.type === "skill_cast") && waveState !== "engaged") return;
  if (event.type === "radar") {
    addLog(event, event.label, event.detail, event.at < COMBAT_START_MS ? "视域" : enemyName, event.value, "system");
    if (event.at === 1_200) spawnFloat("enemyFloats", "发现目标", "state");
  } else if (event.type === "background_attack") {
    slashCount += 1;
    applyDamage(event, event.skillId, "斩击命中", event.overclock ? "超频斩击" : "自动攻击");
  } else if (event.type === "skill_cast") {
    const skill = skillById(event.skillId);
    spirit = Math.min(100, event.spirit + (skill?.resourceGain ?? 0));
    if (event.skillId === "two_handed_sword_aura_blade") auraCount += 1;
    applyDamage(event, event.skillId, `${skill?.name ?? event.skillId}命中`, event.reason === "highlight" ? "高亮优先释放" : "左→右序列");
    if (skill?.resourceGain) spawnFloat("playerFloats", `+${skill.resourceGain} 斗气`, "resource");
  } else if (event.type === "state_enter") {
    overclock = true;
    addLog(event, "状态获得", "灵气剑超频", "自身", "启动", "state");
    spawnFloat("playerFloats", "灵气剑超频", "state");
  } else if (event.type === "state_exit") {
    overclock = false;
    spirit = 0;
    addLog(event, "状态结束", "斗气耗尽", "自身", "结束", "state");
  }
  $("logSummary").textContent = `${eventIndex + 1} 条事件 · ${running ? "实时滚动" : "已暂停"}`;
}

function frame(timestamp) {
  if (!running) return;
  if (!lastFrame) lastFrame = timestamp;
  const elapsed = Math.min(80, timestamp - lastFrame) * speed;
  lastFrame = timestamp;
  simTime = Math.min(RUN_END_MS, simTime + elapsed);
  updateWaveState();
  if (overclock) spirit = Math.max(0, spirit - 12.5 * elapsed / 1000);
  while (eventIndex < simulation.log.length && simulation.log[eventIndex].at <= simTime) {
    processEvent(simulation.log[eventIndex]);
    eventIndex += 1;
  }
  updateReadout();
  if (simTime >= RUN_END_MS) {
    running = false;
    $("startBtn").textContent = "重新战斗";
    $("logSummary").textContent = `${eventIndex} 条事件 · 战斗结束`;
    return;
  }
  requestAnimationFrame(frame);
}

$("startBtn").addEventListener("click", () => {
  if (simTime >= RUN_END_MS) reset();
  running = !running;
  $("startBtn").textContent = running ? "暂停战斗" : "继续战斗";
  $("logSummary").textContent = running ? `${eventIndex} 条事件 · 实时滚动` : `${eventIndex} 条事件 · 已暂停`;
  lastFrame = 0;
  if (running) requestAnimationFrame(frame);
});
$("resetBtn").addEventListener("click", reset);
document.querySelectorAll("[data-speed]").forEach((button) => button.addEventListener("click", () => {
  speed = Number(button.dataset.speed);
  document.querySelectorAll("[data-speed]").forEach((item) => item.classList.toggle("active", item === button));
}));

compile();
renderBuild();
reset();

// 演示页打开后自动运行；用户仍可通过同一按钮暂停、继续或重新战斗。
setTimeout(() => {
  if (!running && simTime === 0) $("startBtn").click();
}, 450);
