import {
  MODIFIER_OPERATION,
  MODIFIER_SOURCE_KIND,
  createActionDefinition,
  createTargetSelector,
} from "../../combat-protocol/src/action-schema.js";
import {
  SUPPORT_CARD_STATUS,
  SUPPORT_OBJECT_TYPE,
  SUPPORT_OPERATION_KIND,
  SUPPORT_OPERATION_PHASE,
  SUPPORT_OPERATION_PHASE_ORDER,
  SUPPORT_TARGET_MODE,
  createSupportScriptDefinition,
} from "../../combat-protocol/src/support-script-v1.js";

function clone(value) {
  return structuredClone(value);
}
function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(name + " must be an object");
}
function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(name + " must be a non-empty string");
}
function hasAll(tags, required) {
  const values = new Set(tags);
  return required.every((tag) => values.has(tag));
}
function hasAny(tags, required) {
  if (required.length === 0) return true;
  const values = new Set(tags);
  return required.some((tag) => values.has(tag));
}
function hasNone(tags, excluded) {
  const values = new Set(tags);
  return excluded.every((tag) => !values.has(tag));
}
function isCompatible(skill, compatibility) {
  return hasAll(skill.skillTags, compatibility.skillAll) &&
    hasAny(skill.skillTags, compatibility.skillAny) &&
    hasNone(skill.skillTags, compatibility.skillNone);
}
function bindingSort(left, right) {
  return left.insertionOrder - right.insertionOrder ||
    left.script.id.localeCompare(right.script.id) ||
    String(left.sourceInstanceId).localeCompare(String(right.sourceInstanceId));
}
function normalizeBinding(binding, index) {
  assertRecord(binding, "SupportScriptBinding[" + index + "]");
  assertId(binding.sourceDefinitionId, "SupportScriptBinding.sourceDefinitionId");
  assertId(binding.sourceInstanceId, "SupportScriptBinding.sourceInstanceId");
  assertId(binding.attachedSkillEntryId, "SupportScriptBinding.attachedSkillEntryId");
  if (!Number.isInteger(binding.insertionOrder ?? index) || (binding.insertionOrder ?? index) < 0) {
    throw new RangeError("SupportScriptBinding insertionOrder must be a non-negative integer");
  }
  return {
    script: createSupportScriptDefinition(binding.script),
    sourceDefinitionId: binding.sourceDefinitionId,
    sourceInstanceId: binding.sourceInstanceId,
    attachedSkillEntryId: binding.attachedSkillEntryId,
    insertionOrder: binding.insertionOrder ?? index,
  };
}
function resolvePath(root, path) {
  const segments = path.split(".");
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === "effects" && Array.isArray(cursor.effects)) {
      cursor = cursor.effects.find((effect) => effect.id === segments[index + 1]);
      index += 1;
    } else {
      cursor = cursor?.[segment];
    }
    if (!cursor || typeof cursor !== "object") throw new Error("support change path cannot be resolved: " + path);
  }
  return { target: cursor, key: segments.at(-1) };
}
function applyChange(root, change) {
  const resolved = resolvePath(root, change.path);
  const current = resolved.target[resolved.key];
  if (change.operator === MODIFIER_OPERATION.SET) resolved.target[resolved.key] = clone(change.value);
  else if (change.operator === MODIFIER_OPERATION.ADD) {
    if (!Number.isFinite(current)) throw new TypeError("support add target must be numeric: " + change.path);
    resolved.target[resolved.key] = current + change.value;
  } else if (change.operator === MODIFIER_OPERATION.MULTIPLY) {
    if (!Number.isFinite(current)) throw new TypeError("support multiply target must be numeric: " + change.path);
    resolved.target[resolved.key] = current * change.value;
  }
}
function targetsFor(skill, target, onWork) {
  const targets = [];
  for (let actionIndex = 0; actionIndex < skill.actions.length; actionIndex += 1) {
    onWork();
    const action = skill.actions[actionIndex];
    if (target.objectType === SUPPORT_OBJECT_TYPE.ACTION) {
      if (action.supportSlotTag !== target.supportSlotTag) continue;
      if (target.objectId && action.id !== target.objectId) continue;
      targets.push({
        object: action,
        replace(value) {
          skill.actions[actionIndex] = value;
        },
      });
    } else {
      const selector = action.targeting;
      if (selector.supportSlotTag !== target.supportSlotTag) continue;
      if (target.objectId && selector.id !== target.objectId) continue;
      targets.push({
        object: selector,
        replace(value) {
          action.targeting = value;
        },
      });
    }
  }
  return targets;
}
function assertUniqueObjectIds(skill) {
  const actionIds = skill.actions.map((action) => action.id);
  const selectorIds = skill.actions.map((action) => action.targeting.id).filter(Boolean);
  if (new Set(actionIds).size !== actionIds.length) throw new Error("support replacement created duplicate Action id");
  if (new Set(selectorIds).size !== selectorIds.length) throw new Error("support replacement created duplicate Selector id");
}
function normalizeObject(objectType, value) {
  return objectType === SUPPORT_OBJECT_TYPE.ACTION
    ? clone(createActionDefinition(value))
    : clone(createTargetSelector(value));
}
function trace(binding, operation, skill, status, details = {}) {
  return {
    type: "support_script_operation",
    scriptId: binding.script.id,
    sourceKind: MODIFIER_SOURCE_KIND.SUPPORT_CARD,
    sourceDefinitionId: binding.sourceDefinitionId,
    sourceInstanceId: binding.sourceInstanceId,
    conflictGroup: binding.script.conflictGroup,
    phase: operation?.phase ?? null,
    status,
    operationId: operation?.id ?? null,
    skillEntryId: skill?.entryId ?? null,
    objectType: operation?.target.objectType ?? null,
    supportSlotTag: operation?.target.supportSlotTag ?? null,
    objectId: operation?.target.objectId ?? null,
    operations: operation?.changes ? clone(operation.changes) : [],
    ...details,
  };
}
function resolveSelectedTargets(skill, operation, onWork) {
  const targets = targetsFor(skill, operation.target, onWork);
  if (targets.length === 0) return { error: SUPPORT_CARD_STATUS.EFFECT_INVALID, targets: [], matchedCount: 0 };
  if (operation.target.targetMode === SUPPORT_TARGET_MODE.UNIQUE && targets.length !== 1) {
    return { error: SUPPORT_CARD_STATUS.CONFIG_ERROR, targets: [], matchedCount: targets.length };
  }
  return { error: null, targets, matchedCount: targets.length };
}
function applyTagChange(skill, action, change) {
  const target = change.tagScope === "skill" ? skill : action;
  const field = change.tagScope === "skill" ? "skillTags" : "actionTags";
  const tags = new Set(target[field]);
  if (change.operator === MODIFIER_OPERATION.ADD_TAG) tags.add(change.tag);
  else tags.delete(change.tag);
  target[field] = [...tags];
}
function applyIdentityOperationAtomic(skill, operation, selected, onWork) {
  const skillTagsBefore = clone(skill.skillTags);
  const actionsBefore = clone(skill.actions);
  const changes = [];
  try {
    for (const target of selected) {
      onWork();
      const before = { skillTags: clone(skill.skillTags), action: clone(target.object) };
      const actionAfter = clone(target.object);
      for (const change of operation.changes) {
        onWork();
        applyTagChange(skill, actionAfter, change);
      }
      const normalizedAction = normalizeObject(SUPPORT_OBJECT_TYPE.ACTION, actionAfter);
      target.replace(normalizedAction);
      changes.push({ before, after: { skillTags: clone(skill.skillTags), action: clone(normalizedAction) } });
    }
    assertUniqueObjectIds(skill);
    return changes;
  } catch (error) {
    skill.skillTags = skillTagsBefore;
    skill.actions = actionsBefore;
    throw error;
  }
}
function applyOperationAtomic(skill, operation, selected, onWork) {
  if (operation.kind === SUPPORT_OPERATION_KIND.IDENTITY) {
    return applyIdentityOperationAtomic(skill, operation, selected, onWork);
  }
  const changes = [];
  for (const target of selected) {
    onWork();
    const before = clone(target.object);
    let after;
    if (operation.kind === SUPPORT_OPERATION_KIND.REPLACE) {
      after = normalizeObject(operation.target.objectType, operation.replaceWith);
    } else {
      after = clone(target.object);
      for (const change of operation.changes) {
        onWork();
        applyChange(after, change);
      }
      after = normalizeObject(operation.target.objectType, after);
    }
    changes.push({ target, before, after });
  }
  const skillBefore = clone(skill.actions);
  try {
    for (const change of changes) change.target.replace(change.after);
    assertUniqueObjectIds(skill);
  } catch (error) {
    skill.actions = skillBefore;
    throw error;
  }
  return changes;
}
function aggregateStatus(results) {
  if (results.includes(SUPPORT_CARD_STATUS.CONFIG_ERROR)) return SUPPORT_CARD_STATUS.CONFIG_ERROR;
  const applied = results.filter((status) => status === SUPPORT_CARD_STATUS.ACTIVE).length;
  if (applied === results.length) return SUPPORT_CARD_STATUS.ACTIVE;
  if (applied > 0) return SUPPORT_CARD_STATUS.PARTIAL;
  return SUPPORT_CARD_STATUS.EFFECT_INVALID;
}

function assertKnownSupportScriptTags(bindings, tagRegistry) {
  const knownSkillTags = new Set(tagRegistry?.skillTags ?? []);
  const knownActionTags = new Set(tagRegistry?.actionTags ?? []);
  const knownSupportSlotTags = new Set(tagRegistry?.supportSlotTags ?? []);
  const sourceInstanceIds = new Set();
  const insertionOrders = new Set();
  const scriptsById = new Map();
  const conflictStages = new Map();
  for (const binding of bindings) {
    if (sourceInstanceIds.has(binding.sourceInstanceId)) throw new Error("duplicate SupportScriptBinding sourceInstanceId " + binding.sourceInstanceId);
    if (insertionOrders.has(binding.insertionOrder)) throw new Error("duplicate SupportScriptBinding insertionOrder " + binding.insertionOrder);
    sourceInstanceIds.add(binding.sourceInstanceId);
    insertionOrders.add(binding.insertionOrder);
    const serialized = JSON.stringify(binding.script);
    const previous = scriptsById.get(binding.script.id);
    if (previous && previous !== serialized) throw new Error("Support script id " + binding.script.id + " has inconsistent content");
    scriptsById.set(binding.script.id, serialized);
    const stage = binding.script.operations.some((operation) => operation.kind === SUPPORT_OPERATION_KIND.IDENTITY) ? "identity" : "normal";
    if (binding.script.conflictGroup) {
      const conflictKey = binding.attachedSkillEntryId + ":" + binding.script.conflictGroup;
      const previousStage = conflictStages.get(conflictKey);
      if (previousStage && previousStage !== stage) throw new Error("support conflictGroup cannot cross identity and normal stages: " + binding.script.conflictGroup);
      conflictStages.set(conflictKey, stage);
    }
    for (const tag of [...binding.script.compatibility.skillAll, ...binding.script.compatibility.skillAny, ...binding.script.compatibility.skillNone]) {
      if (!knownSkillTags.has(tag)) throw new Error("unknown skill tag in support script " + binding.script.id + ": " + tag);
    }
    for (const operation of binding.script.operations) {
      if (!knownSupportSlotTags.has(operation.target.supportSlotTag)) {
        throw new Error("unknown support slot tag in support script " + binding.script.id + ": " + operation.target.supportSlotTag);
      }
      for (const change of operation.changes ?? []) {
        if (change.operator !== MODIFIER_OPERATION.ADD_TAG && change.operator !== MODIFIER_OPERATION.REMOVE_TAG) continue;
        const known = change.tagScope === "skill" ? knownSkillTags : knownActionTags;
        if (!known.has(change.tag)) throw new Error("unknown " + change.tagScope + " tag in support identity " + binding.script.id + ": " + change.tag);
      }
    }
  }
}

function resolveScriptConflictGroups(bindings, skillByEntry, statusByInstance, diagnostics) {
  const groups = new Map();
  for (const binding of bindings) {
    if (statusByInstance.has(binding.sourceInstanceId) || !binding.script.conflictGroup) continue;
    const key = binding.attachedSkillEntryId + ":" + binding.script.conflictGroup;
    const entries = groups.get(key) ?? [];
    entries.push(binding);
    groups.set(key, entries);
  }
  for (const entries of groups.values()) {
    entries.sort(bindingSort);
    const winner = entries[0];
    for (const loser of entries.slice(1)) {
      statusByInstance.set(loser.sourceInstanceId, SUPPORT_CARD_STATUS.MUTUAL_EXCLUSION);
      diagnostics.push(trace(loser, null, skillByEntry.get(loser.attachedSkillEntryId), SUPPORT_CARD_STATUS.MUTUAL_EXCLUSION, {
        winnerSourceDefinitionId: winner.sourceDefinitionId,
        winnerSourceInstanceId: winner.sourceInstanceId,
        winnerInsertionOrder: winner.insertionOrder,
      }));
    }
  }
}

function evaluateCompatibility(bindings, skillByEntry, statusByInstance, diagnostics) {
  for (const binding of bindings) {
    const skill = skillByEntry.get(binding.attachedSkillEntryId);
    if (!skill) throw new Error("SupportScriptBinding target skill is missing: " + binding.attachedSkillEntryId);
    if (!isCompatible(skill, binding.script.compatibility)) {
      statusByInstance.set(binding.sourceInstanceId, SUPPORT_CARD_STATUS.INCOMPATIBLE);
      diagnostics.push(trace(binding, null, skill, SUPPORT_CARD_STATUS.INCOMPATIBLE));
    }
  }
}

function applyScriptPhase(bindings, phase, skillByEntry, statusByInstance, resultsByInstance, diagnostics, onWork) {
  for (const binding of bindings) {
    if (statusByInstance.has(binding.sourceInstanceId)) continue;
    const skill = skillByEntry.get(binding.attachedSkillEntryId);
    for (const operation of binding.script.operations.filter((item) => item.phase === phase)) {
      const resolved = resolveSelectedTargets(skill, operation, onWork);
      if (resolved.error) {
        resultsByInstance.get(binding.sourceInstanceId).push(resolved.error);
        diagnostics.push(trace(binding, operation, skill, resolved.error, { matchedCount: resolved.matchedCount }));
        continue;
      }
      try {
        const changes = applyOperationAtomic(skill, operation, resolved.targets, onWork);
        resultsByInstance.get(binding.sourceInstanceId).push(SUPPORT_CARD_STATUS.ACTIVE);
        for (const change of changes) {
          diagnostics.push(trace(binding, operation, skill, "applied", {
            matchedCount: resolved.targets.length,
            before: change.before,
            after: change.after,
          }));
        }
      } catch (error) {
        resultsByInstance.get(binding.sourceInstanceId).push(SUPPORT_CARD_STATUS.CONFIG_ERROR);
        diagnostics.push(trace(binding, operation, skill, SUPPORT_CARD_STATUS.CONFIG_ERROR, { error: error.message }));
      }
    }
  }
}

export function applySupportScriptBindings(skills, rawBindings = [], options = {}) {
  const bindings = rawBindings.map(normalizeBinding).sort(bindingSort);
  assertKnownSupportScriptTags(bindings, options.tagRegistry);
  const onWork = options.onWork ?? (() => {});
  const diagnostics = [];
  const statusByInstance = new Map();
  const resultsByInstance = new Map(bindings.map((binding) => [binding.sourceInstanceId, []]));
  const skillByEntry = new Map(skills.map((skill) => [skill.entryId, skill]));
  const identityBindings = bindings.filter((binding) => binding.script.operations.some((operation) => operation.kind === SUPPORT_OPERATION_KIND.IDENTITY));
  const identityInstanceIds = new Set(identityBindings.map((binding) => binding.sourceInstanceId));
  const normalBindings = bindings.filter((binding) => !identityInstanceIds.has(binding.sourceInstanceId));

  // Identity cards are admitted against base tags and mutate identity first.
  evaluateCompatibility(identityBindings, skillByEntry, statusByInstance, diagnostics);
  resolveScriptConflictGroups(identityBindings, skillByEntry, statusByInstance, diagnostics);
  applyScriptPhase(identityBindings, SUPPORT_OPERATION_PHASE.IDENTITY, skillByEntry, statusByInstance, resultsByInstance, diagnostics, onWork);

  // Ordinary cards are admitted only after the final identity is known.
  evaluateCompatibility(normalBindings, skillByEntry, statusByInstance, diagnostics);
  resolveScriptConflictGroups(normalBindings, skillByEntry, statusByInstance, diagnostics);
  for (const phase of SUPPORT_OPERATION_PHASE_ORDER.filter((item) => item !== SUPPORT_OPERATION_PHASE.IDENTITY)) {
    applyScriptPhase(bindings, phase, skillByEntry, statusByInstance, resultsByInstance, diagnostics, onWork);
  }

  for (const binding of bindings) {
    if (statusByInstance.has(binding.sourceInstanceId)) continue;
    statusByInstance.set(binding.sourceInstanceId, aggregateStatus(resultsByInstance.get(binding.sourceInstanceId)));
  }
  const supportStatuses = bindings.map((binding) => ({
    sourceDefinitionId: binding.sourceDefinitionId,
    sourceInstanceId: binding.sourceInstanceId,
    attachedSkillEntryId: binding.attachedSkillEntryId,
    insertionOrder: binding.insertionOrder,
    conflictGroup: binding.script.conflictGroup,
    status: statusByInstance.get(binding.sourceInstanceId),
  }));
  return { diagnostics, supportStatuses };
}