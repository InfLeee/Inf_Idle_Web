import {
  INTERRUPTING_CONTROL_TAG,
  calculateCastTimeMs,
  calculateChannelTickIntervalMs,
  calculateChannelTickTimeMs,
  calculateGlobalCooldownMs,
  resolveEnemyControlInterruption,
} from "../../packages/combat-protocol/src/settlement.js";

const lab = (id) => document.getElementById(id);
const DEFAULT_RESOURCE = 100;
const baseGcd = calculateGlobalCooldownMs();
const acceleratedGcd = calculateGlobalCooldownMs({ skillDescriptionAcceleration: 0.25 });
const castTiming = calculateCastTimeMs({ baseCastTimeMs: 1_500 });
const channelTiming = calculateChannelTickIntervalMs({ baseTickIntervalMs: 500 });

function gcdEvent(at, label, timing = baseGcd) {
  return {
    at,
    type: "gcd",
    label,
    detail: timing.source === "skill_description"
      ? "技能描述提供 25% GCD 加速"
      : "默认 GCD，不读取常规属性",
    value: timing.value + "ms",
    duration: timing.value,
  };
}

const scenarios = {
  gcd: {
    label: "GCD 测试",
    icon: "Ⅰ",
    title: "500ms 公共释放锁",
    description: "普通属性不会改变 GCD；只有技能描述明确提供的加速能够缩短它。",
    duration: 2_300,
    events: [
      gcdEvent(0, "斩击启动"),
      { at: 300, type: "blocked", label: "横扫被 GCD 拦截", detail: "距解锁仍差 200ms", value: "拒绝" },
      gcdEvent(500, "横扫启动"),
      gcdEvent(1_200, "疾风突进启动", acceleratedGcd),
      { at: 1_450, type: "blocked", label: "追击被 GCD 拦截", detail: "加速后仍需等待到 1600ms", value: "拒绝" },
      gcdEvent(1_600, "追击启动"),
    ],
  },
  resource: {
    label: "资源测试",
    icon: "◆",
    title: "资源不足会阻止技能启动",
    description: "技能在启动时支付资源；资源不足时不会进入 GCD，也不会产生技能事件。",
    duration: 3_000,
    events: [
      { at: 0, type: "cost", amount: 35, label: "重斩启动", detail: "消耗 35 点斗气", value: "-35" },
      gcdEvent(0, "重斩触发 GCD"),
      { at: 500, type: "cost", amount: 35, label: "重斩启动", detail: "消耗 35 点斗气", value: "-35" },
      gcdEvent(500, "重斩触发 GCD"),
      { at: 1_000, type: "blocked", label: "重斩资源不足", detail: "需要 35，当前只有 30", value: "拒绝" },
      { at: 1_500, type: "gain", amount: 20, label: "自然回复", detail: "斗气恢复到 50", value: "+20" },
      { at: 2_000, type: "cost", amount: 35, label: "重斩重新启动", detail: "资源验证通过", value: "-35" },
      gcdEvent(2_000, "重斩触发 GCD"),
    ],
  },
  cast: {
    label: "吟唱测试",
    icon: "◒",
    title: "1.5 秒吟唱后一次结算",
    description: "GCD 在技能启动时计算；吟唱条独立推进，完成前不会提前产生伤害。",
    duration: 2_700,
    events: [
      { at: 0, type: "cast-start", label: "蓄力剑气开始吟唱", detail: "基础吟唱 1500ms", value: "开始", duration: castTiming.value },
      gcdEvent(0, "蓄力剑气触发 GCD"),
      { at: 500, type: "notice", label: "GCD 已结束", detail: "技能仍处于吟唱中", value: "可观察" },
      { at: 1_500, type: "cast-complete", label: "蓄力剑气释放", detail: "吟唱完成后产生单次伤害", value: "-180" },
    ],
  },
  channel: {
    label: "持续施法",
    icon: "∞",
    title: "持续引导与周期 Tick",
    description: "引导技能只在启动时触发一次 GCD，之后每 500ms 独立结算并支付资源。",
    duration: 3_700,
    events: [
      { at: 0, type: "channel-start", label: "旋风剑阵开始引导", detail: "最大持续 3000ms", value: "开始", duration: 3_000 },
      gcdEvent(0, "旋风剑阵触发 GCD"),
      ...Array.from({ length: 6 }, (_, index) => ({
        at: calculateChannelTickTimeMs({
          startedAtMs: 0,
          tickIntervalMs: channelTiming.value,
          tickIndex: index,
        }),
        type: "channel-tick",
        amount: 12,
        label: "引导周期结算 #" + (index + 1),
        detail: "造成 45 伤害并消耗 12 点斗气",
        value: "-45",
      })),
      { at: 3_001, type: "channel-end", label: "旋风剑阵自然结束", detail: "达到最大持续时间", value: "6 Tick" },
    ],
  },
  interrupt: {
    label: "眩晕打断",
    icon: "✦",
    title: "敌方控制打断持续引导",
    description: "眩晕蘑菇会在引导期间释放眩晕；玩家与自动策略均没有主动取消入口。",
    duration: 3_600,
    events: [
      { at: 0, type: "channel-start", label: "旋风剑阵开始引导", detail: "等待敌方控制测试", value: "开始", duration: 3_000 },
      gcdEvent(0, "旋风剑阵触发 GCD"),
      { at: 500, type: "channel-tick", amount: 12, label: "引导周期结算 #1", detail: "第一次周期伤害", value: "-45" },
      { at: 900, type: "enemy-windup", label: "眩晕蘑菇开始施法", detail: "眩晕孢子将在 300ms 后命中", value: "预警" },
      { at: 1_000, type: "channel-tick", amount: 12, label: "引导周期结算 #2", detail: "控制命中前最后一次 Tick", value: "-45" },
      { at: 1_200, type: "interrupt", label: "眩晕命中并打断", detail: "后续引导 Tick 全部取消", value: "Stun", duration: 1_000 },
      { at: 2_200, type: "stun-end", label: "眩晕结束", detail: "重新允许自动序列选择技能", value: "恢复" },
      { at: 2_300, type: "channel-start", label: "旋风剑阵重新引导", detail: "控制结束后由自动序列重新选择", value: "重启", duration: 1_000 },
      gcdEvent(2_300, "旋风剑阵重新触发 GCD"),
      { at: 2_800, type: "channel-tick", amount: 12, label: "重新引导周期 #1", detail: "引导恢复正常", value: "-45" },
      { at: 3_300, type: "channel-end", label: "演示结束", detail: "测试窗口结束", value: "完成" },
    ],
  },
};

let selectedKey = "gcd";
let state;
let running = false;
let startedAt = 0;
let rafId = 0;

function initialState() {
  return {
    elapsed: 0,
    eventIndex: 0,
    resource: DEFAULT_RESOURCE,
    gcdStart: 0,
    gcdEnd: 0,
    gcdDuration: baseGcd.value,
    cast: null,
    channel: null,
    playerState: "ready",
    stunUntil: 0,
    enemyState: "待机",
    enemySkill: "眩晕孢子 · 1.0s 眩晕",
    ticks: 0,
  };
}

function timeLabel(ms) {
  return (ms / 1_000).toFixed(2) + "s";
}

function addEventRow(event, kind) {
  const row = document.createElement("div");
  row.className = "timing-event " + kind;
  row.innerHTML =
    "<time>" + timeLabel(event.at) + "</time>" +
    "<span><strong>" + event.label + "</strong><small>" + event.detail + "</small></span>" +
    "<b>" + event.value + "</b>";
  lab("timingEventLog").append(row);
  lab("timingEventLog").scrollTop = lab("timingEventLog").scrollHeight;
}

function applyEvent(event) {
  let kind = event.type;
  if (event.type === "gcd") {
    state.gcdStart = event.at;
    state.gcdEnd = event.at + event.duration;
    state.gcdDuration = event.duration;
  } else if (event.type === "cost") {
    state.resource = Math.max(0, state.resource - event.amount);
  } else if (event.type === "gain") {
    state.resource = Math.min(DEFAULT_RESOURCE, state.resource + event.amount);
  } else if (event.type === "cast-start") {
    state.cast = { start: event.at, end: event.at + event.duration, label: "蓄力剑气" };
    state.playerState = "casting";
  } else if (event.type === "cast-complete") {
    state.cast = null;
    state.playerState = "ready";
  } else if (event.type === "channel-start") {
    state.channel = { start: event.at, end: event.at + event.duration, label: "旋风剑阵" };
    state.playerState = "channeling";
  } else if (event.type === "channel-tick") {
    if (!state.channel) return;
    state.ticks += 1;
    state.resource = Math.max(0, state.resource - event.amount);
  } else if (event.type === "channel-end") {
    state.channel = null;
    state.playerState = "ready";
  } else if (event.type === "enemy-windup") {
    state.enemyState = "施放眩晕孢子";
  } else if (event.type === "interrupt") {
    const resolution = resolveEnemyControlInterruption({
      controlTags: [INTERRUPTING_CONTROL_TAG.STUN],
      skillTags: ["Attack", "Channel"],
    });
    if (!resolution.interrupted) return;
    state.channel = null;
    state.playerState = "stunned";
    state.stunUntil = event.at + event.duration;
    state.enemyState = "眩晕命中";
  } else if (event.type === "stun-end") {
    state.playerState = "ready";
    state.enemyState = "技能冷却";
  }
  addEventRow(event, kind);
}

function render() {
  const scenario = scenarios[selectedKey];
  const now = state.elapsed;
  const gcdActive = now < state.gcdEnd;
  const gcdProgress = gcdActive
    ? Math.max(0, Math.min(1, (now - state.gcdStart) / state.gcdDuration))
    : 1;
  lab("timingGcdFill").style.width = (gcdProgress * 100) + "%";
  lab("timingGcdValue").textContent = gcdActive
    ? Math.max(0, Math.ceil(state.gcdEnd - now)) + "ms"
    : "READY";

  const activeTiming = state.cast || state.channel;
  let timingProgress = 0;
  if (activeTiming) {
    timingProgress = Math.max(0, Math.min(1, (now - activeTiming.start) / (activeTiming.end - activeTiming.start)));
  } else if (state.playerState === "ready" && state.eventIndex > 0) {
    timingProgress = 1;
  }
  lab("timingCastFill").style.width = (timingProgress * 100) + "%";
  lab("timingCastLabel").textContent = state.cast
    ? "吟唱 · " + state.cast.label
    : state.channel
      ? "引导 · " + state.channel.label + " · Tick " + state.ticks
      : state.playerState === "stunned"
        ? "被眩晕 · " + Math.max(0, Math.ceil(state.stunUntil - now)) + "ms"
        : "等待技能";

  lab("timingResourceFill").style.width = state.resource + "%";
  lab("timingResourceValue").textContent = state.resource + " / " + DEFAULT_RESOURCE;
  lab("timingPlayer").className = "timing-actor player " + state.playerState;
  lab("timingPlayerState").textContent =
    state.playerState === "casting" ? "吟唱中" :
    state.playerState === "channeling" ? "持续引导中" :
    state.playerState === "stunned" ? "眩晕 · 无法施放" : "准备就绪";
  lab("timingEnemyState").textContent = state.enemyState;
  lab("timingCaseState").textContent = running ? "运行中 " + timeLabel(now) : "已完成";
  lab("timingCaseState").classList.toggle("running", running);
}

function frame(timestamp) {
  if (!running) return;
  if (!startedAt) startedAt = timestamp - state.elapsed;
  state.elapsed = Math.min(scenarios[selectedKey].duration, timestamp - startedAt);
  const events = scenarios[selectedKey].events;
  while (state.eventIndex < events.length && events[state.eventIndex].at <= state.elapsed) {
    applyEvent(events[state.eventIndex]);
    state.eventIndex += 1;
  }
  if (state.elapsed >= scenarios[selectedKey].duration) {
    running = false;
    lab("runTimingCase").textContent = "重新运行";
  }
  render();
  if (running) rafId = requestAnimationFrame(frame);
}

function resetScenario() {
  cancelAnimationFrame(rafId);
  running = false;
  startedAt = 0;
  state = initialState();
  lab("timingEventLog").replaceChildren();
  const scenario = scenarios[selectedKey];
  lab("timingCaseTitle").textContent = scenario.title;
  lab("timingCaseDescription").textContent = scenario.description;
  lab("runTimingCase").textContent = "运行测试";
  lab("timingEnemySkill").textContent = scenario === scenarios.interrupt
    ? "眩晕孢子 · 1.0s 眩晕 · 可打断"
    : "眩晕孢子 · 本用例不释放";
  render();
}

function runScenario() {
  resetScenario();
  running = true;
  lab("runTimingCase").textContent = "运行中";
  render();
  rafId = requestAnimationFrame(frame);
}

lab("timingCaseTabs").innerHTML = Object.entries(scenarios).map(function (entry) {
  const key = entry[0];
  const scenario = entry[1];
  return "<button type='button' data-case='" + key + "' class='" + (key === selectedKey ? "active" : "") + "'>" +
    "<i>" + scenario.icon + "</i><span>" + scenario.label + "</span></button>";
}).join("");

lab("timingCaseTabs").querySelectorAll("button").forEach(function (button) {
  button.addEventListener("click", function () {
    selectedKey = button.dataset.case;
    lab("timingCaseTabs").querySelectorAll("button").forEach(function (item) {
      item.classList.toggle("active", item === button);
    });
    runScenario();
  });
});

lab("runTimingCase").addEventListener("click", runScenario);
resetScenario();
setTimeout(runScenario, 650);
