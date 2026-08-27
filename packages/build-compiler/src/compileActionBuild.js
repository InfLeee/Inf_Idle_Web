import {
  ACTION_SCHEMA_VERSION,
  MODIFIER_OPERATION,
  MODIFIER_PHASE_ORDER,
  assertValidActionProtocol,
  matchesTagSelector,
} from "../../combat-protocol/src/action-schema.js";
import { sha256 } from "./sha256.js";
import { applySupportScriptBindings } from "./applySupportScripts.js";

export const COMPILED_BUILD_SCHEMA_VERSION = "compiled-build-v1";

export const DEFAULT_COMPILE_BUDGET = Object.freeze({
  maxSkills: 10,
  maxActions: 64,
  maxModifierBindings: 128,
  maxModifierOperations: 512,
  maxDiagnostics: 512,
  maxWorkUnits: 50_000,
  maxInputBytes: 512 * 1024,
});

const COMBAT_SESSION_FIELDS = Object.freeze(["combatSessionId", "encounterId", "rngSeed", "startedAt"]);

export class CompileBudgetExceededError extends Error {
  constructor(limit, actual, maximum) {
    super(`Compile budget exceeded: ${limit} is ${actual}, maximum is ${maximum}`);
    this.name = "CompileBudgetExceededError";
    this.code = "COMPILE_BUDGET_EXCEEDED";
    this.limit = limit;
    this.actual = actual;
    this.maximum = maximum;
  }
}

export class CompileConflictError extends Error {
  constructor(path, modifierIds) {
    super(`Ambiguous modifier write at ${path}: ${modifierIds.join(", ")}`);
    this.name = "CompileConflictError";
    this.code = "AMBIGUOUS_MODIFIER_WRITE";
    this.path = path;
    this.modifierIds = Object.freeze([...modifierIds]);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertUniqueIds(items, name) {
  const ids = items.map((item) => item.entryId ?? item.id);
  ids.forEach((id, index) => assertId(id, `${name}[${index}].id`));
  if (new Set(ids).size !== ids.length) throw new Error(`${name} cannot contain duplicate ids`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function stableHash(value) {
  const text = typeof value === "string" ? value : canonicalStringify(value);
  return sha256(text);
}

function mergeBudget(overrides = {}) {
  assertRecord(overrides, "CompileBudget");
  const budget = { ...DEFAULT_COMPILE_BUDGET, ...overrides };
  for (const [key, value] of Object.entries(budget)) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`CompileBudget.${key} must be a positive integer`);
  }
  return Object.freeze(budget);
}

function enforceLimit(limit, actual, maximum) {
  if (actual > maximum) throw new CompileBudgetExceededError(limit, actual, maximum);
}

function createWorkMeter(budget) {
  let workUnits = 0;
  return {
    add(units = 1) {
      workUnits += units;
      enforceLimit("maxWorkUnits", workUnits, budget.maxWorkUnits);
    },
    value() {
      return workUnits;
    },
  };
}

function normalizeSkillEntry(entry) {
  assertRecord(entry, "SkillEntry");
  assertId(entry.entryId, "SkillEntry.entryId");
  assertId(entry.definitionId, "SkillEntry.definitionId");
  if (!Array.isArray(entry.skillTags)) throw new TypeError("SkillEntry.skillTags must be an array");
  if (!Array.isArray(entry.actions) || entry.actions.length === 0) throw new Error("SkillEntry.actions must contain at least one action");
  return {
    entryId: entry.entryId,
    definitionId: entry.definitionId,
    sourceType: entry.sourceType,
    sourceInstanceId: entry.sourceInstanceId ?? null,
    socketIndex: entry.socketIndex ?? null,
    runtime: clone(entry.runtime ?? {}),
    skillTags: [...entry.skillTags],
    actions: clone(entry.actions),
  };
}

function normalizeBinding(binding, index) {
  assertRecord(binding, `ModifierBinding[${index}]`);
  assertRecord(binding.modifier, `ModifierBinding[${index}].modifier`);
  if (!Number.isInteger(binding.insertionOrder ?? index) || (binding.insertionOrder ?? index) < 0) {
    throw new RangeError(`ModifierBinding[${index}].insertionOrder must be a non-negative integer`);
  }
  return {
    modifier: binding.modifier,
    sourceInstanceId: binding.sourceInstanceId ?? null,
    attachedSkillEntryId: binding.attachedSkillEntryId ?? null,
    insertionOrder: binding.insertionOrder ?? index,
  };
}

function bindingSort(left, right) {
  return left.modifier.priority - right.modifier.priority ||
    left.insertionOrder - right.insertionOrder ||
    left.modifier.id.localeCompare(right.modifier.id);
}

function resolvePath(root, path) {
  const segments = path.split(".");
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === "effects" && Array.isArray(cursor.effects)) {
      const effectId = segments[index + 1];
      cursor = cursor.effects.find((effect) => effect.id === effectId);
      index += 1;
    } else {
      cursor = cursor?.[segment];
    }
    if (!cursor || typeof cursor !== "object") throw new Error(`Modifier path cannot be resolved: ${path}`);
  }
  return { target: cursor, key: segments.at(-1) };
}

function applyOperation(skill, action, operation) {
  if (operation.operator === MODIFIER_OPERATION.ADD_TAG || operation.operator === MODIFIER_OPERATION.REMOVE_TAG) {
    const field = operation.tagScope === "skill" ? "skillTags" : "actionTags";
    const target = operation.tagScope === "skill" ? skill : action;
    const tags = new Set(target[field]);
    if (operation.operator === MODIFIER_OPERATION.ADD_TAG) tags.add(operation.tag);
    else tags.delete(operation.tag);
    target[field] = [...tags];
    return;
  }
  const { target, key } = resolvePath(action, operation.path);
  const current = target[key];
  if (operation.operator === MODIFIER_OPERATION.SET) target[key] = clone(operation.value);
  else if (operation.operator === MODIFIER_OPERATION.ADD) {
    if (!Number.isFinite(current)) throw new TypeError(`Modifier add target must be numeric: ${operation.path}`);
    target[key] = current + operation.value;
  } else if (operation.operator === MODIFIER_OPERATION.MULTIPLY) {
    if (!Number.isFinite(current)) throw new TypeError(`Modifier multiply target must be numeric: ${operation.path}`);
    target[key] = current * operation.value;
  }
}

function createTrace(binding, phase, status, skill, action, operations = []) {
  return {
    modifierId: binding.modifier.id,
    sourceKind: binding.modifier.sourceKind,
    sourceDefinitionId: binding.modifier.sourceDefinitionId,
    sourceInstanceId: binding.sourceInstanceId,
    phase,
    status,
    skillEntryId: skill?.entryId ?? null,
    actionId: action?.id ?? null,
    operations: operations.map((operation) => clone(operation)),
  };
}

function pushDiagnostic(diagnostics, diagnostic, budget) {
  enforceLimit("maxDiagnostics", diagnostics.length + 1, budget.maxDiagnostics);
  diagnostics.push(diagnostic);
}

function targetsForBinding(skills, binding, meter) {
  const targets = [];
  for (const skill of skills) {
    if (binding.attachedSkillEntryId && binding.attachedSkillEntryId !== skill.entryId) continue;
    for (const action of skill.actions) {
      meter.add();
      if (matchesTagSelector({ skillTags: skill.skillTags, actionTags: action.actionTags }, binding.modifier.selector)) {
        targets.push({ skill, action });
      }
    }
  }
  return targets;
}

function resolveConflictWinners(candidates) {
  const winners = [];
  const losers = [];
  const groups = new Map();
  for (const candidate of candidates) {
    const group = candidate.binding.modifier.conflictGroup;
    if (!group) winners.push(candidate);
    else {
      const key = `${candidate.skill.entryId}:${candidate.action.id}:${group}`;
      const entries = groups.get(key) ?? [];
      entries.push(candidate);
      groups.set(key, entries);
    }
  }
  for (const entries of groups.values()) {
    entries.sort((left, right) => bindingSort(left.binding, right.binding));
    winners.push(entries[0]);
    losers.push(...entries.slice(1));
  }
  winners.sort((left, right) => bindingSort(left.binding, right.binding));
  return { winners, losers };
}

function assertNoAmbiguousWrites(candidates, phase) {
  const writes = new Map();
  for (const candidate of candidates) {
    if (candidate.binding.modifier.conflictGroup) continue;
    for (const operation of candidate.binding.modifier.operations) {
      if (operation.operator !== MODIFIER_OPERATION.SET) continue;
      const key = `${candidate.skill.entryId}:${candidate.action.id}:${operation.path}:${candidate.binding.modifier.priority}`;
      const ids = writes.get(key) ?? [];
      ids.push(candidate.binding.modifier.id);
      writes.set(key, ids);
      if (ids.length > 1) throw new CompileConflictError(`${phase}:${key}`, ids);
    }
  }
}

function applyPhase(skills, bindings, phase, diagnostics, budget, meter) {
  const phaseBindings = bindings.filter((binding) => binding.modifier.phase === phase);
  if (phaseBindings.length === 0) return;
  const candidates = [];
  for (const binding of phaseBindings) {
    const targets = targetsForBinding(skills, binding, meter);
    if (targets.length === 0) {
      pushDiagnostic(diagnostics, createTrace(binding, phase, "unmatched", null, null), budget);
      continue;
    }
    for (const target of targets) candidates.push({ binding, ...target });
  }
  assertNoAmbiguousWrites(candidates, phase);
  const { winners, losers } = resolveConflictWinners(candidates);
  for (const candidate of losers) {
    pushDiagnostic(diagnostics, createTrace(candidate.binding, phase, "mutual_exclusion", candidate.skill, candidate.action), budget);
  }
  for (const candidate of winners) {
    for (const operation of candidate.binding.modifier.operations) {
      meter.add();
      applyOperation(candidate.skill, candidate.action, operation);
    }
    pushDiagnostic(
      diagnostics,
      createTrace(candidate.binding, phase, "applied", candidate.skill, candidate.action, candidate.binding.modifier.operations),
      budget,
    );
  }
}

function validateInputTags(skills, tagRegistry) {
  const knownSkillTags = new Set(tagRegistry.skillTags);
  for (const skill of skills) {
    for (const tag of skill.skillTags) {
      if (!knownSkillTags.has(tag)) throw new Error(`Unknown skill tag ${tag} on ${skill.entryId}`);
    }
  }
}

function validateActiveResources(skills, buildMetadata) {
  if (!Array.isArray(buildMetadata?.activeResourceDefinitionIds)) return;
  const active = new Set(buildMetadata.activeResourceDefinitionIds);
  for (const skill of skills) {
    for (const action of skill.actions) {
      for (const cost of action.costs) {
        if (!active.has(cost.resourceId)) throw new Error("inactive weapon mastery resource referenced by cost: " + cost.resourceId);
      }
      for (const effect of action.effects) {
        const resourceId = effect.kind === "resource_delta" ? effect.params.resourceId : null;
        if (resourceId && !active.has(resourceId)) throw new Error("inactive weapon mastery resource referenced by effect: " + resourceId);
      }
      for (const condition of action.conditions) {
        const resourceId = condition.params?.resourceId;
        if (resourceId && !active.has(resourceId)) throw new Error("inactive weapon mastery resource referenced by condition: " + resourceId);
      }
    }
  }
}
function finalizeTiming(skills) {
  for (const skill of skills) {
    for (const action of skill.actions) {
      if (action.timing.kind === "cast") {
        const minimum = action.timing.minimumCastTimeMs ?? 1;
        if (!Number.isFinite(minimum) || minimum < 1 || !Number.isFinite(action.timing.castTimeMs)) {
          throw new RangeError(`Invalid finalized cast timing on ${action.id}`);
        }
        action.timing.castTimeMs = Math.round(Math.max(minimum, action.timing.castTimeMs));
      }
      if (action.timing.kind === "channel") {
        const minimum = action.timing.minimumTickIntervalMs ?? 1;
        if (!Number.isFinite(minimum) || minimum < 1 || !Number.isFinite(action.timing.tickIntervalMs)) {
          throw new RangeError(`Invalid finalized channel timing on ${action.id}`);
        }
        action.timing.tickIntervalMs = Math.round(Math.max(minimum, action.timing.tickIntervalMs));
      }
    }
  }
}

function hashPayload(snapshot) {
  return {
    compiledBuildSchemaVersion: snapshot.compiledBuildSchemaVersion,
    domainSchemaVersion: snapshot.domainSchemaVersion,
    actionSchemaVersion: snapshot.actionSchemaVersion,
    configVersion: snapshot.configVersion,
    skillSlots: snapshot.skillSlots,
    weaponSkillEntryIds: snapshot.weaponSkillEntryIds,
    compiledSkills: snapshot.compiledSkills,
    autoPolicy: snapshot.autoPolicy,
    buildMetadata: snapshot.buildMetadata,
    supportStatuses: snapshot.supportStatuses,
  };
}

export function compileActionBuild(input, options = {}) {
  assertRecord(input, "ActionBuildInput");
  for (const field of COMBAT_SESSION_FIELDS) {
    if (Object.hasOwn(input, field)) throw new Error(`ActionBuildInput cannot contain CombatSession field ${field}`);
  }
  const budget = mergeBudget(options.budget ?? {});
  const rawSkills = input.skills ?? [];
  const rawBindings = input.modifierBindings ?? [];
  const rawSupportScriptBindings = input.supportScriptBindings ?? [];
  if (!Array.isArray(rawSkills)) throw new TypeError("ActionBuildInput.skills must be an array");
  if (!Array.isArray(rawBindings)) throw new TypeError("ActionBuildInput.modifierBindings must be an array");
  if (!Array.isArray(rawSupportScriptBindings)) throw new TypeError("ActionBuildInput.supportScriptBindings must be an array");
  enforceLimit("maxSkills", rawSkills.length, budget.maxSkills);
  enforceLimit("maxActions", rawSkills.reduce((total, skill) => total + (Array.isArray(skill?.actions) ? skill.actions.length : 0), 0), budget.maxActions);
  enforceLimit("maxModifierBindings", rawBindings.length + rawSupportScriptBindings.length, budget.maxModifierBindings);
  const countSupportWork = (bindingsToCount) => bindingsToCount.reduce((total, binding) => total +
    (Array.isArray(binding?.script?.operations) ? binding.script.operations.reduce((operationTotal, operation) => operationTotal +
      (Array.isArray(operation?.changes) ? Math.max(1, operation.changes.length) : 1), 0) : 0), 0);
  const rawOperationCount = rawBindings.reduce((total, binding) => total + (Array.isArray(binding?.modifier?.operations) ? binding.modifier.operations.length : 0), 0) +
    countSupportWork(rawSupportScriptBindings);
  enforceLimit("maxModifierOperations", rawOperationCount, budget.maxModifierOperations);
  const inputBytes = new TextEncoder().encode(canonicalStringify(input)).byteLength;
  enforceLimit("maxInputBytes", inputBytes, budget.maxInputBytes);
  assertId(input.configVersion, "ActionBuildInput.configVersion");
  assertId(input.domainSchemaVersion, "ActionBuildInput.domainSchemaVersion");
  if (input.actionSchemaVersion !== ACTION_SCHEMA_VERSION) {
    throw new Error(`Action schema mismatch: expected ${ACTION_SCHEMA_VERSION}, received ${input.actionSchemaVersion}`);
  }
  const skills = (input.skills ?? []).map(normalizeSkillEntry);
  assertUniqueIds(skills, "ActionBuildInput.skills");
  enforceLimit("maxSkills", skills.length, budget.maxSkills);
  const totalActions = skills.reduce((total, skill) => total + skill.actions.length, 0);
  enforceLimit("maxActions", totalActions, budget.maxActions);
  const bindings = (input.modifierBindings ?? []).map(normalizeBinding);
  enforceLimit("maxModifierBindings", bindings.length + rawSupportScriptBindings.length, budget.maxModifierBindings);
  const totalOperations = bindings.reduce((total, binding) => total + binding.modifier.operations.length, 0) +
    countSupportWork(rawSupportScriptBindings);
  enforceLimit("maxModifierOperations", totalOperations, budget.maxModifierOperations);
  const entryIds = new Set(skills.map((skill) => skill.entryId));
  const skillSlots = input.skillSlots ?? [];
  if (!Array.isArray(skillSlots)) throw new TypeError("ActionBuildInput.skillSlots must be an array");
  for (const entryId of skillSlots) {
    if (entryId !== null && !entryIds.has(entryId)) throw new Error(`Skill slot references unknown entry ${entryId}`);
  }
  const weaponSkillEntryIds = input.weaponSkillEntryIds ?? [];
  if (!Array.isArray(weaponSkillEntryIds)) throw new TypeError("ActionBuildInput.weaponSkillEntryIds must be an array");
  for (const entryId of weaponSkillEntryIds) {
    if (!entryIds.has(entryId)) throw new Error(`Weapon skill references unknown entry ${entryId}`);
  }
  for (const binding of bindings) {
    if (binding.attachedSkillEntryId && !entryIds.has(binding.attachedSkillEntryId)) {
      throw new Error(`Modifier binding references unknown skill entry ${binding.attachedSkillEntryId}`);
    }
  }
  validateInputTags(skills, input.tagRegistry);
  validateActiveResources(skills, input.buildMetadata);
  for (const skill of skills) {
    assertValidActionProtocol({ tagRegistry: input.tagRegistry, actions: skill.actions, modifiers: [] });
  }
  const uniqueModifiers = new Map();
  for (const binding of bindings) {
    const previous = uniqueModifiers.get(binding.modifier.id);
    if (previous && canonicalStringify(previous) !== canonicalStringify(binding.modifier)) {
      throw new Error(`Modifier definition id ${binding.modifier.id} has inconsistent content`);
    }
    uniqueModifiers.set(binding.modifier.id, binding.modifier);
  }
  assertValidActionProtocol({ tagRegistry: input.tagRegistry, actions: [], modifiers: [...uniqueModifiers.values()] });

  const diagnostics = [];
  const meter = createWorkMeter(budget);
  for (const phase of MODIFIER_PHASE_ORDER.slice(0, 2)) applyPhase(skills, bindings, phase, diagnostics, budget, meter);
  const supportScriptResult = applySupportScriptBindings(skills, rawSupportScriptBindings, {
    onWork: () => meter.add(),
    tagRegistry: input.tagRegistry,
  });
  for (const item of supportScriptResult.diagnostics) pushDiagnostic(diagnostics, item, budget);
  for (const phase of MODIFIER_PHASE_ORDER.slice(2)) applyPhase(skills, bindings, phase, diagnostics, budget, meter);
  validateInputTags(skills, input.tagRegistry);
  for (const skill of skills) {
    assertValidActionProtocol({ tagRegistry: input.tagRegistry, actions: skill.actions, modifiers: [] });
  }
  finalizeTiming(skills);
  const compiledSkills = skills.map((skill) => deepFreeze(clone(skill)));
  const snapshot = {
    kind: "CompiledBuild",
    compiledBuildSchemaVersion: COMPILED_BUILD_SCHEMA_VERSION,
    domainSchemaVersion: input.domainSchemaVersion,
    actionSchemaVersion: input.actionSchemaVersion,
    configVersion: input.configVersion,
    buildHash: null,
    skillSlots: [...skillSlots],
    weaponSkillEntryIds: [...weaponSkillEntryIds],
    compiledSkills,
    autoPolicy: clone(input.autoPolicy ?? {}),
    buildMetadata: clone(input.buildMetadata ?? {}),
    supportStatuses: supportScriptResult.supportStatuses.map((item) => deepFreeze(clone(item))),
    diagnostics: diagnostics.map((item) => deepFreeze(clone(item))),
    compileMetrics: {
      inputBytes,
      skills: skills.length,
      actions: totalActions,
      modifierBindings: bindings.length,
      supportScriptBindings: rawSupportScriptBindings.length,
      modifierOperations: totalOperations,
      diagnostics: diagnostics.length,
      workUnits: meter.value(),
    },
  };
  snapshot.buildHash = stableHash(hashPayload(snapshot));
  return deepFreeze(snapshot);
}
