import { createActionDefinition, createTagSelector } from "./action-schema.js";

export const SKILL_REPLACEMENT_VERSION = "skill-replacement-v1";

export const SKILL_REPLACEMENT_STATUS = Object.freeze({
  ACTIVE: "active",
  INCOMPATIBLE: "incompatible",
  MUTUAL_EXCLUSION: "mutual_exclusion",
});

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertUniqueStrings(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  values.forEach((value, index) => assertId(value, `${name}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${name} cannot contain duplicate values`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function createSkillReplacementDefinition(input) {
  assertRecord(input, "SkillReplacementDefinition");
  assertId(input.id, "SkillReplacementDefinition.id");
  assertId(input.effectiveDefinitionId, "SkillReplacementDefinition.effectiveDefinitionId");
  const removeSkillTags = input.removeSkillTags ?? [];
  const addSkillTags = input.addSkillTags ?? [];
  assertUniqueStrings(removeSkillTags, "SkillReplacementDefinition.removeSkillTags");
  assertUniqueStrings(addSkillTags, "SkillReplacementDefinition.addSkillTags");
  if (removeSkillTags.some((tag) => addSkillTags.includes(tag))) {
    throw new Error("SkillReplacementDefinition cannot remove and add the same skill tag");
  }
  const compatibility = createTagSelector(input.compatibility ?? {});
  if (compatibility.actionAll.length || compatibility.actionAny.length || compatibility.actionNone.length) {
    throw new Error("SkillReplacementDefinition compatibility can target skill tags only");
  }
  const actions = (input.actions ?? []).map(createActionDefinition);
  if (actions.length === 0) throw new Error("SkillReplacementDefinition.actions must contain at least one action");
  if (new Set(actions.map((action) => action.id)).size !== actions.length) {
    throw new Error("SkillReplacementDefinition actions cannot contain duplicate ids");
  }
  return deepFreeze({
    version: SKILL_REPLACEMENT_VERSION,
    id: input.id,
    effectiveDefinitionId: input.effectiveDefinitionId,
    compatibility,
    removeSkillTags: [...removeSkillTags],
    addSkillTags: [...addSkillTags],
    runtime: structuredClone(input.runtime ?? {}),
    actions,
  });
}
