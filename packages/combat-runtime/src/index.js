import {
  ACTION_TIMING_KIND,
  EFFECT_KIND,
  TARGET_SELECTOR_KIND,
} from "../../combat-protocol/src/action-schema.js";

export const COMBAT_RUNTIME_SCHEMA_VERSION = "compiled-combat-runtime-v1";

const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function resourceDefinitions(input = []) {
  return Object.fromEntries(input.map((item) => [item.id, {
    min: item.min ?? 0,
    max: item.max ?? Number.MAX_SAFE_INTEGER,
    initial: item.initial ?? 0,
  }]));
}

function clampResource(definition, value) {
  return Math.max(definition?.min ?? 0, Math.min(definition?.max ?? Number.MAX_SAFE_INTEGER, value));
}

function actionInterval(action, state) {
  const timing = action.timing;
  let interval = timing.kind === ACTION_TIMING_KIND.CHANNEL
    ? timing.tickIntervalMs
    : timing.kind === ACTION_TIMING_KIND.CAST
      ? Math.max(timing.gcdMs, timing.castTimeMs)
      : Math.max(1, timing.gcdMs);
  for (const activeState of Object.values(state.states)) {
    if (activeState.expiresAtMs !== null && activeState.expiresAtMs <= state.nowMs) continue;
    interval *= activeState.backgroundActionIntervalMultiplier ?? 1;
  }
  return Math.max(1, Math.round(interval));
}

function primaryAction(skill) {
  return skill.actions.find((action) => action.effects.length > 0) ?? null;
}

function skillEntries(compiledBuild) {
  const byEntry = new Map(compiledBuild.compiledSkills.map((skill) => [skill.entryId, skill]));
  const slotted = compiledBuild.skillSlots.map((entryId, socketIndex) => ({
    skill: entryId ? byEntry.get(entryId) : null,
    socketIndex,
    weaponSkill: false,
  })).filter((item) => item.skill);
  const weapon = compiledBuild.weaponSkillEntryIds.map((entryId) => ({
    skill: byEntry.get(entryId),
    socketIndex: null,
    weaponSkill: true,
  })).filter((item) => item.skill);
  return [...slotted, ...weapon];
}

function conditionMet(condition, state) {
  if (condition.type === "resource_at_least") {
    return (state.resources[condition.params.resourceId] ?? 0) >= condition.params.amount;
  }
  if (condition.type === "state_active") return Boolean(state.states[condition.params.stateId]);
  if (condition.type === "state_inactive") return !state.states[condition.params.stateId];
  return false;
}

function canPay(costs, timing, state) {
  return costs.filter((cost) => cost.timing === timing)
    .every((cost) => (state.resources[cost.resourceId] ?? 0) >= cost.amount);
}

function usable(item, state) {
  const action = primaryAction(item.skill);
  if (!action || item.skill.runtime.enabled === false || item.skill.runtime.backgroundAction) return false;
  if ((state.cooldownReadyAt[action.id] ?? 0) > state.nowMs) return false;
  return action.conditions.every((condition) => conditionMet(condition, state)) && canPay(action.costs, "on_start", state);
}

function chooseForeground(compiledBuild, state) {
  const entries = skillEntries(compiledBuild).filter((item) => usable(item, state));
  const conditionedWeapon = entries.filter((item) => item.weaponSkill && primaryAction(item.skill).conditions.length > 0);
  if (conditionedWeapon.length) return conditionedWeapon[0];
  const burst = entries.filter((item) => item.skill.runtime.role === "burst");
  if (burst.length) return burst[0];
  return entries.find((item) => !item.weaponSkill && !item.skill.runtime.priorityOnly) ?? null;
}

function emit(state, events, event) {
  events.push({ index: state.eventIndex, at: state.nowMs, ...event });
  state.eventIndex += 1;
}

function changeResource(state, events, definitions, resourceId, delta, source) {
  const before = state.resources[resourceId] ?? definitions[resourceId]?.initial ?? 0;
  const after = clampResource(definitions[resourceId], before + delta);
  state.resources[resourceId] = after;
  emit(state, events, { type: "resource_changed", resourceId, before, after, delta: after - before, ...source });
}

function payCosts(state, events, definitions, action, timing, source) {
  for (const cost of action.costs.filter((item) => item.timing === timing)) {
    changeResource(state, events, definitions, cost.resourceId, -cost.amount, source);
  }
}

function resolveAction(state, events, definitions, skill, action, source) {
  emit(state, events, {
    type: "action_resolved",
    source,
    skillEntryId: skill.entryId,
    skillDefinitionId: skill.definitionId,
    skillName: skill.actions[0]?.name ?? skill.definitionId,
    actionId: action.id,
    targeting: clone(action.targeting),
    actionTags: [...action.actionTags],
  });
  for (const effect of action.effects) {
    if (effect.kind === EFFECT_KIND.DIRECT_DAMAGE) {
      emit(state, events, {
        type: "damage_intent",
        source,
        skillEntryId: skill.entryId,
        skillDefinitionId: skill.definitionId,
        skillName: action.name,
        actionId: action.id,
        targeting: clone(action.targeting),
        multiplier: effect.params.multiplier,
        hitCount: effect.params.hitCount ?? 1,
        executeThreshold: effect.params.executeThreshold ?? null,
      });
    } else if (effect.kind === EFFECT_KIND.RESOURCE_DELTA) {
      changeResource(state, events, definitions, effect.params.resourceId, effect.params.amount, {
        skillEntryId: skill.entryId,
        actionId: action.id,
      });
    } else if (effect.kind === EFFECT_KIND.APPLY_STATE) {
      const durationMs = effect.params.durationMs ?? null;
      state.states[effect.params.stateId] = {
        stateId: effect.params.stateId,
        appliedAtMs: state.nowMs,
        expiresAtMs: durationMs === null ? null : state.nowMs + durationMs,
        backgroundActionIntervalMultiplier: effect.params.backgroundActionIntervalMultiplier ?? 1,
      };
      emit(state, events, {
        type: "state_applied",
        stateId: effect.params.stateId,
        durationMs,
        skillEntryId: skill.entryId,
        actionId: action.id,
      });
    }
  }
}

function expireStates(state, events) {
  for (const [stateId, active] of Object.entries(state.states)) {
    if (active.expiresAtMs === null || active.expiresAtMs > state.nowMs) continue;
    delete state.states[stateId];
    emit(state, events, { type: "state_expired", stateId });
  }
}

function nextCooldown(state) {
  const future = Object.values(state.cooldownReadyAt).filter((value) => value > state.nowMs);
  return future.length ? Math.min(...future) : Number.POSITIVE_INFINITY;
}

function nextStateExpiry(state) {
  const future = Object.values(state.states).map((item) => item.expiresAtMs)
    .filter((value) => value !== null && value > state.nowMs);
  return future.length ? Math.min(...future) : Number.POSITIVE_INFINITY;
}

function backgroundEntries(compiledBuild) {
  return skillEntries(compiledBuild).filter((item) => item.skill.runtime.enabled !== false && item.skill.runtime.backgroundAction);
}

export function createCompiledCombatState(compiledBuild, options = {}) {
  if (!compiledBuild?.compiledSkills || !compiledBuild?.skillSlots) throw new TypeError("compiledBuild is required");
  const definitions = resourceDefinitions(options.resourceDefinitions ?? compiledBuild.resourceDefinitions);
  const resources = Object.fromEntries(Object.entries(definitions).map(([id, item]) => [id, item.initial]));
  const backgroundNextAt = {};
  for (const item of backgroundEntries(compiledBuild)) {
    const action = primaryAction(item.skill);
    if (action) backgroundNextAt[action.id] = 0;
  }
  return deepFreeze({
    schemaVersion: COMBAT_RUNTIME_SCHEMA_VERSION,
    buildHash: compiledBuild.buildHash,
    nowMs: 0,
    eventIndex: 0,
    gcdReadyAtMs: 0,
    cooldownReadyAt: {},
    backgroundNextAt,
    resources,
    states: {},
    activeAction: null,
    controlIndex: 0,
  });
}

export function advanceCompiledCombat(input) {
  const { compiledBuild } = input;
  const untilMs = input.untilMs;
  const maxEvents = input.maxEvents ?? 4_096;
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new RangeError("maxEvents must be a positive integer");
  if (!Number.isFinite(untilMs) || untilMs < input.state.nowMs) throw new RangeError("untilMs must not move backwards");
  if (input.state.buildHash !== compiledBuild.buildHash) throw new Error("runtime state buildHash does not match compiledBuild");
  const state = clone(input.state);
  const events = [];
  const definitions = resourceDefinitions(input.resourceDefinitions ?? compiledBuild.resourceDefinitions);
  const controls = input.controlEvents ?? [];
  if (!Array.isArray(controls)) throw new TypeError("controlEvents must be an array");
  for (let index = 0; index < controls.length; index += 1) {
    if (!Number.isFinite(controls[index]?.atMs) || controls[index].atMs < 0) {
      throw new RangeError(`controlEvents[${index}].atMs must be a non-negative finite number`);
    }
    if (index > 0 && controls[index].atMs < controls[index - 1].atMs) {
      throw new RangeError("controlEvents must be sorted by atMs");
    }
  }
  const byAction = new Map(compiledBuild.compiledSkills.flatMap((skill) => skill.actions.map((action) => [action.id, { skill, action }])));

  while (state.nowMs <= untilMs && events.length < maxEvents) {
    expireStates(state, events);
    if (events.length >= maxEvents) break;
    const nextControl = controls[state.controlIndex];
    const backgroundDue = Object.entries(state.backgroundNextAt)
      .map(([actionId, at]) => ({ actionId, at }))
      .sort((a, b) => a.at - b.at)[0] ?? { at: Number.POSITIVE_INFINITY };
    const activeDue = state.activeAction
      ? state.activeAction.kind === ACTION_TIMING_KIND.CHANNEL ? state.activeAction.nextTickAtMs : state.activeAction.resolveAtMs
      : Number.POSITIVE_INFINITY;
    const controlDue = nextControl?.atMs ?? Number.POSITIVE_INFINITY;
    const foregroundDue = state.activeAction
      ? Number.POSITIVE_INFINITY
      : Math.max(state.nowMs, state.gcdReadyAtMs);

    if (nextControl && controlDue <= Math.min(backgroundDue.at, activeDue, foregroundDue, untilMs)) {
      state.nowMs = controlDue;
      state.controlIndex += 1;
      if (state.activeAction && nextControl.interrupts !== false) {
        emit(state, events, {
          type: "action_interrupted",
          skillEntryId: state.activeAction.skillEntryId,
          actionId: state.activeAction.actionId,
          controlKind: nextControl.kind ?? "stun",
        });
        state.activeAction = null;
      } else emit(state, events, { type: "control_ignored", controlKind: nextControl.kind ?? "stun" });
      continue;
    }

    if (backgroundDue.at <= Math.min(activeDue, foregroundDue, untilMs)) {
      state.nowMs = Math.max(state.nowMs, backgroundDue.at);
      const entry = byAction.get(backgroundDue.actionId);
      if (!entry) throw new Error(`background action ${backgroundDue.actionId} is missing`);
      resolveAction(state, events, definitions, entry.skill, entry.action, "background");
      state.backgroundNextAt[entry.action.id] = state.nowMs + actionInterval(entry.action, state);
      continue;
    }

    if (state.activeAction && activeDue <= untilMs) {
      state.nowMs = activeDue;
      const entry = byAction.get(state.activeAction.actionId);
      if (state.activeAction.kind === ACTION_TIMING_KIND.CHANNEL) {
        if (!canPay(entry.action.costs, "per_tick", state)) {
          emit(state, events, { type: "channel_ended", skillEntryId: entry.skill.entryId, actionId: entry.action.id, reason: "resource_empty" });
          state.activeAction = null;
          continue;
        }
        payCosts(state, events, definitions, entry.action, "per_tick", { skillEntryId: entry.skill.entryId, actionId: entry.action.id });
        emit(state, events, { type: "channel_tick", skillEntryId: entry.skill.entryId, skillDefinitionId: entry.skill.definitionId, actionId: entry.action.id });
        resolveAction(state, events, definitions, entry.skill, entry.action, "channel_tick");
        const nextTickAtMs = state.nowMs + entry.action.timing.tickIntervalMs;
        if (state.activeAction.endAtMs !== null && nextTickAtMs > state.activeAction.endAtMs) {
          emit(state, events, { type: "channel_ended", skillEntryId: entry.skill.entryId, actionId: entry.action.id, reason: "duration_complete" });
          state.activeAction = null;
        } else state.activeAction.nextTickAtMs = nextTickAtMs;
      } else {
        resolveAction(state, events, definitions, entry.skill, entry.action, "foreground");
        state.activeAction = null;
      }
      continue;
    }

    if (!state.activeAction && state.gcdReadyAtMs <= untilMs) {
      state.nowMs = Math.max(state.nowMs, state.gcdReadyAtMs);
      const selected = chooseForeground(compiledBuild, state);
      if (selected) {
        const action = primaryAction(selected.skill);
        payCosts(state, events, definitions, action, "on_start", { skillEntryId: selected.skill.entryId, actionId: action.id });
        state.cooldownReadyAt[action.id] = state.nowMs + action.timing.cooldownMs;
        state.gcdReadyAtMs = state.nowMs + action.timing.gcdMs;
        emit(state, events, {
          type: action.timing.kind === ACTION_TIMING_KIND.CHANNEL ? "channel_started" : "action_started",
          skillEntryId: selected.skill.entryId,
          skillDefinitionId: selected.skill.definitionId,
          skillName: action.name,
          actionId: action.id,
          timingKind: action.timing.kind,
          reason: selected.weaponSkill ? "weapon_priority" : "slot_order",
        });
        if (action.timing.kind === ACTION_TIMING_KIND.INSTANT) {
          resolveAction(state, events, definitions, selected.skill, action, "foreground");
          state.nowMs += 1;
        } else if (action.timing.kind === ACTION_TIMING_KIND.CHANNEL) {
          state.activeAction = {
            kind: action.timing.kind,
            skillEntryId: selected.skill.entryId,
            actionId: action.id,
            nextTickAtMs: state.nowMs + action.timing.tickIntervalMs,
            endAtMs: action.timing.maxDurationMs === null ? null : state.nowMs + action.timing.maxDurationMs,
          };
        } else {
          state.activeAction = {
            kind: action.timing.kind,
            skillEntryId: selected.skill.entryId,
            actionId: action.id,
            resolveAtMs: state.nowMs + action.timing.castTimeMs,
          };
        }
        continue;
      }
    }

    const nextAt = Math.min(
      untilMs,
      nextCooldown(state),
      nextStateExpiry(state),
      backgroundDue.at,
      activeDue,
      controlDue,
    );
    if (!Number.isFinite(nextAt) || nextAt <= state.nowMs) {
      state.nowMs = untilMs;
      break;
    }
    state.nowMs = nextAt;
    if (state.nowMs === untilMs && !state.activeAction && backgroundDue.at > untilMs) break;
  }

  state.nowMs = Math.min(untilMs, Math.max(state.nowMs, input.state.nowMs));
  return deepFreeze({ state, events });
}

export function simulateCompiledCombat(compiledBuild, options = {}) {
  const state = createCompiledCombatState(compiledBuild, options);
  return advanceCompiledCombat({
    state,
    compiledBuild,
    untilMs: options.durationMs ?? 30_000,
    maxEvents: options.maxEvents ?? 16_384,
    resourceDefinitions: options.resourceDefinitions,
    controlEvents: options.controlEvents,
  });
}

export { ACTION_TIMING_KIND, EFFECT_KIND, TARGET_SELECTOR_KIND };
