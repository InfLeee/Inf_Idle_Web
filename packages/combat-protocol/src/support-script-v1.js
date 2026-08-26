import { MODIFIER_OPERATION, createModifierOperation } from "./action-schema.js";

export const SUPPORT_SCRIPT_VERSION = "support-script-v1";
export const SUPPORT_OBJECT_TYPE = Object.freeze({ ACTION: "action", SELECTOR: "selector" });
export const SUPPORT_TARGET_MODE = Object.freeze({ ALL: "all", UNIQUE: "unique" });
export const SUPPORT_OPERATION_KIND = Object.freeze({
  REPLACE: "replace",
  MODIFY: "modify",
  APPEND: "append",
  EVENT: "event",
  IDENTITY: "identity",
});
export const SUPPORT_OPERATION_PHASE = Object.freeze({
  IDENTITY: "identity",
  STRUCTURE_REPLACE: "structure_replace",
  MODIFY: "modify",
  APPEND: "append",
  EVENT: "event",
});
export const SUPPORT_OPERATION_PHASE_ORDER = Object.freeze([
  SUPPORT_OPERATION_PHASE.IDENTITY,
  SUPPORT_OPERATION_PHASE.STRUCTURE_REPLACE,
  SUPPORT_OPERATION_PHASE.MODIFY,
  SUPPORT_OPERATION_PHASE.APPEND,
  SUPPORT_OPERATION_PHASE.EVENT,
]);
export const SUPPORT_CARD_STATUS = Object.freeze({
  ACTIVE: "active",
  PARTIAL: "partial",
  INCOMPATIBLE: "incompatible",
  MUTUAL_EXCLUSION: "mutual_exclusion",
  EFFECT_INVALID: "effect_invalid",
  CONFIG_ERROR: "config_error",
});

const IMPLEMENTED_KINDS = new Set([SUPPORT_OPERATION_KIND.REPLACE, SUPPORT_OPERATION_KIND.MODIFY]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(name + " must be an object");
}
function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(name + " must be a non-empty string");
}
function assertUniqueIds(values, name) {
  if (!Array.isArray(values)) throw new TypeError(name + " must be an array");
  values.forEach((value, index) => assertId(value, name + "[" + index + "]"));
  if (new Set(values).size !== values.length) throw new Error(name + " cannot contain duplicate values");
}
function assertEnum(value, enumeration, name) {
  if (!Object.values(enumeration).includes(value)) throw new Error(name + " has unsupported value " + value);
}

export function createSupportTarget(input) {
  assertRecord(input, "SupportTarget");
  assertEnum(input.objectType, SUPPORT_OBJECT_TYPE, "SupportTarget.objectType");
  assertId(input.supportSlotTag, "SupportTarget.supportSlotTag");
  if (input.objectId !== undefined && input.objectId !== null) assertId(input.objectId, "SupportTarget.objectId");
  assertEnum(input.targetMode, SUPPORT_TARGET_MODE, "SupportTarget.targetMode");
  return deepFreeze({
    objectType: input.objectType,
    supportSlotTag: input.supportSlotTag,
    objectId: input.objectId ?? null,
    targetMode: input.targetMode,
  });
}

export function createSupportScriptOperation(input) {
  assertRecord(input, "SupportScriptOperation");
  assertId(input.id, "SupportScriptOperation.id");
  assertEnum(input.kind, SUPPORT_OPERATION_KIND, "SupportScriptOperation.kind");
  assertEnum(input.phase, SUPPORT_OPERATION_PHASE, "SupportScriptOperation.phase");
  if (!IMPLEMENTED_KINDS.has(input.kind)) throw new Error("SupportScriptOperation kind " + input.kind + " is reserved but not implemented");
  if (input.kind === SUPPORT_OPERATION_KIND.REPLACE && input.phase !== SUPPORT_OPERATION_PHASE.STRUCTURE_REPLACE) {
    throw new Error("replace operation must run in structure_replace phase");
  }
  if (input.kind === SUPPORT_OPERATION_KIND.MODIFY && input.phase !== SUPPORT_OPERATION_PHASE.MODIFY) {
    throw new Error("modify operation must run in modify phase");
  }
  const target = createSupportTarget(input.target);
  if (input.kind === SUPPORT_OPERATION_KIND.REPLACE) {
    assertRecord(input.replaceWith, "SupportScriptOperation.replaceWith");
    return deepFreeze({ id: input.id, kind: input.kind, phase: input.phase, target, replaceWith: structuredClone(input.replaceWith) });
  }
  const changes = (input.changes ?? []).map(createModifierOperation);
  if (changes.length === 0) throw new Error("modify operation must contain at least one change");
  if (changes.some((change) => ![MODIFIER_OPERATION.SET, MODIFIER_OPERATION.ADD, MODIFIER_OPERATION.MULTIPLY].includes(change.operator))) {
    throw new Error("support modify allows only set, add and multiply");
  }
  return deepFreeze({ id: input.id, kind: input.kind, phase: input.phase, target, changes });
}

export function createSupportScriptDefinition(input) {
  assertRecord(input, "SupportScriptDefinition");
  if (input.version !== SUPPORT_SCRIPT_VERSION) throw new Error("support script version must be " + SUPPORT_SCRIPT_VERSION);
  assertId(input.id, "SupportScriptDefinition.id");
  const compatibility = input.compatibility ?? {};
  assertRecord(compatibility, "SupportScriptDefinition.compatibility");
  const skillAll = compatibility.skillAll ?? [];
  const skillAny = compatibility.skillAny ?? [];
  const skillNone = compatibility.skillNone ?? [];
  assertUniqueIds(skillAll, "SupportScriptDefinition.compatibility.skillAll");
  assertUniqueIds(skillAny, "SupportScriptDefinition.compatibility.skillAny");
  assertUniqueIds(skillNone, "SupportScriptDefinition.compatibility.skillNone");
  const operations = (input.operations ?? []).map(createSupportScriptOperation);
  if (operations.length === 0) throw new Error("SupportScriptDefinition must contain at least one operation");
  if (new Set(operations.map((operation) => operation.id)).size !== operations.length) throw new Error("SupportScriptDefinition operation ids must be unique");
  if (input.conflictGroup !== undefined && input.conflictGroup !== null) {
    assertId(input.conflictGroup, "SupportScriptDefinition.conflictGroup");
    throw new Error("Support Script V1 conflictGroup is reserved but not implemented; use Modifier conflict groups until enabled");
  }
  return deepFreeze({
    kind: "SupportScriptDefinition",
    version: SUPPORT_SCRIPT_VERSION,
    id: input.id,
    compatibility: { skillAll: [...skillAll], skillAny: [...skillAny], skillNone: [...skillNone] },
    conflictGroup: input.conflictGroup ?? null,
    operations,
  });
}