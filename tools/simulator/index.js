import { chooseNextAction, applyChosenAction } from "../../packages/auto-battle/src/index.js";

export function simulateDecisions(build, initialState, options = {}) {
  const durationMs = options.durationMs ?? 10_000;
  const endAt = initialState.now + durationMs;
  const log = [];
  let state = structuredClone(initialState);

  while (state.now < endAt) {
    const action = chooseNextAction(build, state, options.policy);
    log.push({ at: state.now, type: action.type, skillId: action.skill?.id, reason: action.reason });
    state = applyChosenAction(action, state);
  }

  return { finalState: state, log };
}
