import { chooseNextAction, applyChosenAction } from "../../packages/auto-battle/src/index.js";

const AURA_BLADE_ID = "two_handed_sword_aura_blade";
const SLASH_ID = "two_handed_sword_slash";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function runtimeBuild(build, overclockActive, overclockSlashTimeMultiplier) {
  const copy = structuredClone(build);
  copy.skillSlots = copy.skillSlots.filter((skill) => skill && !skill.backgroundAction);
  const slash = build.compiledSkills.find((skill) => skill.id === SLASH_ID);
  return {
    plannerBuild: copy,
    slash: slash ? {
      ...structuredClone(slash),
      actionTimeMs: Math.max(slash.minActionTimeMs ?? 0, slash.actionTimeMs * (overclockActive ? overclockSlashTimeMultiplier : 1)),
    } : null,
  };
}

export function simulateTwoHandedSwordA1(build, options = {}) {
  const durationMs = options.durationMs ?? 30_000;
  const spiritMax = options.spiritMax ?? 100;
  const overclockDrainPerSecond = options.overclockDrainPerSecond ?? 12.5;
  const overclockSlashTimeMultiplier = options.overclockSlashTimeMultiplier ?? 0.7;
  const log = [];
  let nextSlashAt = 0;
  let overclockActive = false;
  let state = {
    now: 0,
    resource: 0,
    cooldowns: {},
    highlightedSkillIds: [],
    burstReadySkillIds: [],
    temporaryReplacementBySlot: {},
  };

  while (state.now < durationMs) {
    const view = runtimeBuild(build, overclockActive, overclockSlashTimeMultiplier);
    state.highlightedSkillIds = !overclockActive && state.resource >= spiritMax ? [AURA_BLADE_ID] : [];
    const action = chooseNextAction(view.plannerBuild, state, build.autoPolicy);
    const windowStart = state.now;
    const nextState = applyChosenAction(action, state);
    const windowEnd = Math.min(nextState.now, durationMs);

    if (action.type === "cast") {
      log.push({ at: windowStart, type: "skill_cast", skillId: action.skill.id, reason: action.reason, spirit: state.resource });
      if (action.skill.id === AURA_BLADE_ID) {
        overclockActive = true;
        nextState.cooldowns[AURA_BLADE_ID] = Number.MAX_SAFE_INTEGER;
        log.push({ at: windowStart, type: "state_enter", stateId: "aura_blade_overclock" });
      }
    }

    while (view.slash && nextSlashAt <= windowEnd) {
      log.push({ at: nextSlashAt, type: "background_attack", skillId: SLASH_ID, overclock: overclockActive });
      nextSlashAt += view.slash.actionTimeMs;
    }

    const elapsedSeconds = Math.max(0, windowEnd - windowStart) / 1000;
    nextState.resource = clamp(nextState.resource, 0, spiritMax);
    if (overclockActive) {
      nextState.resource = clamp(nextState.resource - overclockDrainPerSecond * elapsedSeconds, 0, spiritMax);
      if (nextState.resource === 0) {
        overclockActive = false;
        nextState.cooldowns[AURA_BLADE_ID] = 0;
        log.push({ at: windowEnd, type: "state_exit", stateId: "aura_blade_overclock" });
      }
    }

    state = nextState;
  }

  return {
    finalState: { ...state, overclockActive },
    log: log.sort((a, b) => a.at - b.at),
    summary: {
      slashCount: log.filter((event) => event.type === "background_attack").length,
      auraBladeCount: log.filter((event) => event.type === "skill_cast" && event.skillId === AURA_BLADE_ID).length,
      overclockEntries: log.filter((event) => event.type === "state_enter").length,
    },
  };
}
