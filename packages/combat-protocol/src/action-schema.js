export const ACTION_SCHEMA_VERSION = "action-v1";

export const ACTION_TIMING_KIND = Object.freeze({
  INSTANT: "instant",
  CAST: "cast",
  CHANNEL: "channel",
});

export const TARGET_SELECTOR_KIND = Object.freeze({
  SELF: "self",
  CURRENT_TARGET: "current_target",
  ENEMIES_IN_RADIUS: "enemies_in_radius",
});

export const EFFECT_KIND = Object.freeze({
  DIRECT_DAMAGE: "direct_damage",
  RESOURCE_DELTA: "resource_delta",
  APPLY_STATE: "apply_state",
});

export const MODIFIER_SOURCE_KIND = Object.freeze({
  SUPPORT_CARD: "support_card",
  MASTERY_NODE: "mastery_node",
  WEAPON_AFFIX: "weapon_affix",
});

export const MODIFIER_PHASE = Object.freeze({
  IDENTITY: "identity",
  PRE_SUPPORT: "pre_support",
  SUPPORT: "support",
  POST_SUPPORT: "post_support",
  FINALIZE: "finalize",
});

export const MODIFIER_PHASE_ORDER = Object.freeze([
  MODIFIER_PHASE.IDENTITY,
  MODIFIER_PHASE.PRE_SUPPORT,
  MODIFIER_PHASE.SUPPORT,
  MODIFIER_PHASE.POST_SUPPORT,
  MODIFIER_PHASE.FINALIZE,
]);

export const MODIFIER_OPERATION = Object.freeze({
  ADD_TAG: "add_tag",
  REMOVE_TAG: "remove_tag",
  SET: "set",
  ADD: "add",
  MULTIPLY: "multiply",
});

const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertFiniteNumber(value, name, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${name} must be a finite number greater than or equal to ${minimum}`);
  }
}

function assertUniqueStrings(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  values.forEach((value, index) => assertId(value, `${name}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${name} cannot contain duplicate values`);
}

function assertEnum(value, values, name) {
  if (!Object.values(values).includes(value)) throw new Error(`${name} has unsupported value ${value}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function createIssue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function assertSafePath(path, name) {
  assertId(path, name);
  const segments = path.split(".");
  if (segments.some((segment) => !segment || BLOCKED_PATH_SEGMENTS.has(segment))) {
    throw new Error(`${name} contains an unsafe path segment`);
  }
}

export function createTagRegistry(input) {
  assertRecord(input, "TagRegistry");
  const skillTags = input.skillTags ?? [];
  const actionTags = input.actionTags ?? [];
  const supportSlotTags = input.supportSlotTags ?? [];
  assertUniqueStrings(skillTags, "TagRegistry.skillTags");
  assertUniqueStrings(actionTags, "TagRegistry.actionTags");
  assertUniqueStrings(supportSlotTags, "TagRegistry.supportSlotTags");
  return deepFreeze({
    schemaVersion: ACTION_SCHEMA_VERSION,
    skillTags: [...skillTags],
    actionTags: [...actionTags],
    supportSlotTags: [...supportSlotTags],
  });
}

export function createTagSelector(input = {}) {
  assertRecord(input, "TagSelector");
  const skillAll = input.skillAll ?? [];
  const skillAny = input.skillAny ?? [];
  const skillNone = input.skillNone ?? [];
  const actionAll = input.actionAll ?? [];
  const actionAny = input.actionAny ?? [];
  const actionNone = input.actionNone ?? [];
  for (const [name, values] of Object.entries({ skillAll, skillAny, skillNone, actionAll, actionAny, actionNone })) {
    assertUniqueStrings(values, `TagSelector.${name}`);
  }
  return deepFreeze({
    skillAll: [...skillAll],
    skillAny: [...skillAny],
    skillNone: [...skillNone],
    actionAll: [...actionAll],
    actionAny: [...actionAny],
    actionNone: [...actionNone],
  });
}

export function matchesTagSelector({ skillTags = [], actionTags = [] }, selectorInput = {}) {
  const selector = createTagSelector(selectorInput);
  const skill = new Set(skillTags);
  const action = new Set(actionTags);
  const all = (set, values) => values.every((tag) => set.has(tag));
  const any = (set, values) => values.length === 0 || values.some((tag) => set.has(tag));
  const none = (set, values) => values.every((tag) => !set.has(tag));
  return all(skill, selector.skillAll) && any(skill, selector.skillAny) && none(skill, selector.skillNone) &&
    all(action, selector.actionAll) && any(action, selector.actionAny) && none(action, selector.actionNone);
}

export function createTargetSelector(input) {
  assertRecord(input, "TargetSelector");
  if (input.id !== undefined && input.id !== null) assertId(input.id, "TargetSelector.id");
  if (input.supportSlotTag !== undefined && input.supportSlotTag !== null) assertId(input.supportSlotTag, "TargetSelector.supportSlotTag");
  assertEnum(input.kind, TARGET_SELECTOR_KIND, "TargetSelector.kind");
  if (input.kind === TARGET_SELECTOR_KIND.ENEMIES_IN_RADIUS) {
    assertFiniteNumber(input.radiusM, "TargetSelector.radiusM", 0);
    if (input.maxTargets !== undefined && input.maxTargets !== null) {
      if (!Number.isInteger(input.maxTargets) || input.maxTargets < 1) {
        throw new RangeError("TargetSelector.maxTargets must be a positive integer or null");
      }
    }
  }
  return deepFreeze({
    id: input.id ?? null,
    supportSlotTag: input.supportSlotTag ?? null,
    kind: input.kind,
    ...(input.kind === TARGET_SELECTOR_KIND.ENEMIES_IN_RADIUS
      ? { radiusM: input.radiusM, maxTargets: input.maxTargets ?? null }
      : {}),
  });
}

export function createTimingDefinition(input) {
  assertRecord(input, "TimingDefinition");
  assertEnum(input.kind, ACTION_TIMING_KIND, "TimingDefinition.kind");
  assertFiniteNumber(input.gcdMs ?? 500, "TimingDefinition.gcdMs", 0);
  assertFiniteNumber(input.cooldownMs ?? 0, "TimingDefinition.cooldownMs", 0);
  if (input.kind === ACTION_TIMING_KIND.CAST) {
    assertFiniteNumber(input.castTimeMs, "TimingDefinition.castTimeMs", 1);
    assertFiniteNumber(input.minimumCastTimeMs ?? 1, "TimingDefinition.minimumCastTimeMs", 1);
  }
  if (input.kind === ACTION_TIMING_KIND.CHANNEL) {
    assertFiniteNumber(input.tickIntervalMs, "TimingDefinition.tickIntervalMs", 1);
    assertFiniteNumber(input.minimumTickIntervalMs ?? 1, "TimingDefinition.minimumTickIntervalMs", 1);
    if (input.maxDurationMs !== undefined && input.maxDurationMs !== null) {
      assertFiniteNumber(input.maxDurationMs, "TimingDefinition.maxDurationMs", input.tickIntervalMs);
    }
  }
  return deepFreeze({
    kind: input.kind,
    gcdMs: input.gcdMs ?? 500,
    cooldownMs: input.cooldownMs ?? 0,
    ...(input.kind === ACTION_TIMING_KIND.CAST
      ? { castTimeMs: input.castTimeMs, minimumCastTimeMs: input.minimumCastTimeMs ?? 1 }
      : {}),
    ...(input.kind === ACTION_TIMING_KIND.CHANNEL
      ? {
        tickIntervalMs: input.tickIntervalMs,
        minimumTickIntervalMs: input.minimumTickIntervalMs ?? 1,
        maxDurationMs: input.maxDurationMs ?? null,
      }
      : {}),
  });
}

export function createCostDefinition(input) {
  assertRecord(input, "CostDefinition");
  assertId(input.resourceId, "CostDefinition.resourceId");
  assertFiniteNumber(input.amount, "CostDefinition.amount", 0);
  const timing = input.timing ?? "on_start";
  if (!["on_start", "per_tick"].includes(timing)) throw new Error(`CostDefinition.timing has unsupported value ${timing}`);
  return deepFreeze({ resourceId: input.resourceId, amount: input.amount, timing });
}

export function createConditionDefinition(input) {
  assertRecord(input, "ConditionDefinition");
  assertId(input.type, "ConditionDefinition.type");
  return deepFreeze({ type: input.type, params: clone(input.params ?? {}) });
}

export function createEffectDefinition(input) {
  assertRecord(input, "EffectDefinition");
  assertId(input.id, "EffectDefinition.id");
  assertEnum(input.kind, EFFECT_KIND, "EffectDefinition.kind");
  const params = input.params ?? {};
  assertRecord(params, "EffectDefinition.params");
  if (input.kind === EFFECT_KIND.DIRECT_DAMAGE) {
    assertFiniteNumber(params.multiplier, "EffectDefinition.params.multiplier", 0);
  }
  if (input.kind === EFFECT_KIND.RESOURCE_DELTA) {
    assertId(params.resourceId, "EffectDefinition.params.resourceId");
    assertFiniteNumber(params.amount, "EffectDefinition.params.amount");
  }
  if (input.kind === EFFECT_KIND.APPLY_STATE) {
    assertId(params.stateId, "EffectDefinition.params.stateId");
    if (params.durationMs !== undefined && params.durationMs !== null) {
      assertFiniteNumber(params.durationMs, "EffectDefinition.params.durationMs", 0);
    }
  }
  return deepFreeze({ id: input.id, kind: input.kind, params: clone(params) });
}

export function createActionDefinition(input) {
  assertRecord(input, "ActionDefinition");
  assertId(input.id, "ActionDefinition.id");
  assertId(input.name, "ActionDefinition.name");
  const actionTags = input.actionTags ?? [];
  assertUniqueStrings(actionTags, "ActionDefinition.actionTags");
  if (input.supportSlotTag !== undefined && input.supportSlotTag !== null) assertId(input.supportSlotTag, "ActionDefinition.supportSlotTag");
  const effects = (input.effects ?? []).map(createEffectDefinition);
  if (effects.length === 0) throw new Error("ActionDefinition must contain at least one effect");
  if (new Set(effects.map((effect) => effect.id)).size !== effects.length) {
    throw new Error("ActionDefinition effects cannot contain duplicate ids");
  }
  return deepFreeze({
    kind: "ActionDefinition",
    id: input.id,
    name: input.name,
    supportSlotTag: input.supportSlotTag ?? null,
    actionTags: [...actionTags],
    targeting: createTargetSelector(input.targeting),
    timing: createTimingDefinition(input.timing),
    costs: (input.costs ?? []).map(createCostDefinition),
    conditions: (input.conditions ?? []).map(createConditionDefinition),
    effects,
  });
}

export function createModifierOperation(input) {
  assertRecord(input, "ModifierOperation");
  assertEnum(input.operator, MODIFIER_OPERATION, "ModifierOperation.operator");
  if ([MODIFIER_OPERATION.ADD_TAG, MODIFIER_OPERATION.REMOVE_TAG].includes(input.operator)) {
    if (!input.tagScope || !["skill", "action"].includes(input.tagScope)) {
      throw new Error("tag operation requires tagScope skill or action");
    }
    assertId(input.tag, "ModifierOperation.tag");
    return deepFreeze({ operator: input.operator, tagScope: input.tagScope, tag: input.tag });
  }
  assertSafePath(input.path, "ModifierOperation.path");
  if (input.operator === MODIFIER_OPERATION.ADD || input.operator === MODIFIER_OPERATION.MULTIPLY) {
    assertFiniteNumber(input.value, "ModifierOperation.value");
  }
  if (!Object.hasOwn(input, "value")) throw new Error("value operation requires value");
  return deepFreeze({ operator: input.operator, path: input.path, value: clone(input.value) });
}

export function createModifierDefinition(input) {
  assertRecord(input, "ModifierDefinition");
  assertId(input.id, "ModifierDefinition.id");
  assertId(input.sourceDefinitionId, "ModifierDefinition.sourceDefinitionId");
  assertEnum(input.sourceKind, MODIFIER_SOURCE_KIND, "ModifierDefinition.sourceKind");
  assertEnum(input.phase, MODIFIER_PHASE, "ModifierDefinition.phase");
  const operations = (input.operations ?? []).map(createModifierOperation);
  if (operations.length === 0) throw new Error("ModifierDefinition must contain at least one operation");
  if (input.phase !== MODIFIER_PHASE.IDENTITY && operations.some((operation) =>
    operation.operator === MODIFIER_OPERATION.ADD_TAG || operation.operator === MODIFIER_OPERATION.REMOVE_TAG)) {
    throw new Error("tag identity operations are allowed only in the identity phase");
  }
  if (input.conflictGroup !== undefined && input.conflictGroup !== null) {
    assertId(input.conflictGroup, "ModifierDefinition.conflictGroup");
  }
  if (!Number.isInteger(input.priority ?? 0)) throw new TypeError("ModifierDefinition.priority must be an integer");
  return deepFreeze({
    kind: "ModifierDefinition",
    id: input.id,
    sourceKind: input.sourceKind,
    sourceDefinitionId: input.sourceDefinitionId,
    phase: input.phase,
    priority: input.priority ?? 0,
    conflictGroup: input.conflictGroup ?? null,
    selector: createTagSelector(input.selector ?? {}),
    operations,
  });
}

function validateKnownTags(tags, known, path, issues) {
  for (const tag of tags) {
    if (!known.has(tag)) issues.push(createIssue("UNKNOWN_TAG", path, tag));
  }
}

export function validateActionProtocol(input) {
  assertRecord(input, "ActionProtocolValidation");
  const issues = [];
  const registry = input.tagRegistry;
  const skillTags = new Set(registry.skillTags);
  const actionTags = new Set(registry.actionTags);
  const supportSlotTags = new Set(registry.supportSlotTags ?? []);
  const actions = input.actions ?? [];
  const modifiers = input.modifiers ?? [];

  const actionIds = new Set();
  for (const action of actions) {
    if (actionIds.has(action.id)) issues.push(createIssue("DUPLICATE_ACTION_ID", "actions", action.id));
    actionIds.add(action.id);
    validateKnownTags(action.actionTags, actionTags, `actions.${action.id}.actionTags`, issues);
    if (action.supportSlotTag) validateKnownTags([action.supportSlotTag], supportSlotTags, "actions." + action.id + ".supportSlotTag", issues);
    if (action.targeting.supportSlotTag) validateKnownTags([action.targeting.supportSlotTag], supportSlotTags, "actions." + action.id + ".targeting.supportSlotTag", issues);
  }

  const modifierIds = new Set();
  const ambiguousWrites = new Map();
  for (const modifier of modifiers) {
    if (modifierIds.has(modifier.id)) issues.push(createIssue("DUPLICATE_MODIFIER_ID", "modifiers", modifier.id));
    modifierIds.add(modifier.id);
    validateKnownTags([...modifier.selector.skillAll, ...modifier.selector.skillAny, ...modifier.selector.skillNone], skillTags, `modifiers.${modifier.id}.selector.skill`, issues);
    validateKnownTags([...modifier.selector.actionAll, ...modifier.selector.actionAny, ...modifier.selector.actionNone], actionTags, `modifiers.${modifier.id}.selector.action`, issues);
    for (const operation of modifier.operations) {
      if (operation.tagScope === "skill") validateKnownTags([operation.tag], skillTags, `modifiers.${modifier.id}.operations`, issues);
      if (operation.tagScope === "action") validateKnownTags([operation.tag], actionTags, `modifiers.${modifier.id}.operations`, issues);
      if (operation.operator !== MODIFIER_OPERATION.SET || modifier.conflictGroup) continue;
      const selectorKey = JSON.stringify(modifier.selector);
      const key = `${modifier.phase}:${modifier.priority}:${operation.path}:${selectorKey}`;
      const previous = ambiguousWrites.get(key);
      if (previous) issues.push(createIssue("AMBIGUOUS_SET_OPERATION", `modifiers.${modifier.id}.operations`, `${previous} and ${modifier.id} write ${operation.path}`));
      else ambiguousWrites.set(key, modifier.id);
    }
  }
  return Object.freeze(issues);
}

export function assertValidActionProtocol(input) {
  const issues = validateActionProtocol(input);
  if (issues.length) {
    const error = new Error(`Action protocol validation failed with ${issues.length} issue(s)`);
    error.issues = issues;
    throw error;
  }
  return input;
}
