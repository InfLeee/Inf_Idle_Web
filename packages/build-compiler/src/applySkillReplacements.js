import { matchesTagSelector } from "../../combat-protocol/src/action-schema.js";
import {
  SKILL_REPLACEMENT_STATUS,
  createSkillReplacementDefinition,
} from "../../combat-protocol/src/skill-replacement-v1.js";

const clone = (value) => structuredClone(value);

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function normalizeBinding(binding, index) {
  assertRecord(binding, `SkillReplacementBinding[${index}]`);
  assertId(binding.sourceDefinitionId, `SkillReplacementBinding[${index}].sourceDefinitionId`);
  assertId(binding.sourceInstanceId, `SkillReplacementBinding[${index}].sourceInstanceId`);
  assertId(binding.attachedSkillEntryId, `SkillReplacementBinding[${index}].attachedSkillEntryId`);
  if (!Number.isInteger(binding.insertionOrder) || binding.insertionOrder < 0) {
    throw new RangeError(`SkillReplacementBinding[${index}].insertionOrder must be a non-negative integer`);
  }
  return {
    sourceKind: binding.sourceKind ?? "support_card",
    sourceDefinitionId: binding.sourceDefinitionId,
    sourceInstanceId: binding.sourceInstanceId,
    attachedSkillEntryId: binding.attachedSkillEntryId,
    insertionOrder: binding.insertionOrder,
    replacement: createSkillReplacementDefinition(binding.replacement),
  };
}

function diagnostic(binding, status, skill, extra = {}) {
  return {
    type: "skill_replacement",
    sourceKind: binding.sourceKind,
    sourceDefinitionId: binding.sourceDefinitionId,
    sourceInstanceId: binding.sourceInstanceId,
    insertionOrder: binding.insertionOrder,
    phase: "skill_replace",
    status: status === SKILL_REPLACEMENT_STATUS.ACTIVE ? "applied" : status,
    skillEntryId: skill.entryId,
    actionId: null,
    operations: [],
    replacementDefinitionId: binding.replacement.id,
    effectiveDefinitionId: binding.replacement.effectiveDefinitionId,
    ...extra,
  };
}

function supportStatus(binding, status, skill, extra = {}) {
  return {
    sourceKind: binding.sourceKind,
    sourceDefinitionId: binding.sourceDefinitionId,
    sourceInstanceId: binding.sourceInstanceId,
    attachedSkillEntryId: skill.entryId,
    insertionOrder: binding.insertionOrder,
    status,
    phase: "skill_replace",
    replacementDefinitionId: binding.replacement.id,
    effectiveDefinitionId: binding.replacement.effectiveDefinitionId,
    ...extra,
  };
}

function assertKnownReplacementTags(binding, tagRegistry) {
  if (!tagRegistry) return;
  const known = new Set(tagRegistry.skillTags ?? []);
  const tags = [
    ...binding.replacement.compatibility.skillAll,
    ...binding.replacement.compatibility.skillAny,
    ...binding.replacement.compatibility.skillNone,
    ...binding.replacement.removeSkillTags,
    ...binding.replacement.addSkillTags,
  ];
  for (const tag of tags) {
    if (!known.has(tag)) throw new Error(`Unknown skill replacement tag ${tag} on ${binding.replacement.id}`);
  }
}
export function applySkillReplacementBindings(skills, bindingsInput = [], options = {}) {
  if (!Array.isArray(skills)) throw new TypeError("skills must be an array");
  if (!Array.isArray(bindingsInput)) throw new TypeError("skillReplacementBindings must be an array");
  const bindings = bindingsInput.map(normalizeBinding);
  for (const binding of bindings) assertKnownReplacementTags(binding, options.tagRegistry);
  const instanceIds = new Set();
  const insertionOrders = new Set();
  for (const binding of bindings) {
    if (instanceIds.has(binding.sourceInstanceId)) throw new Error(`Duplicate skill replacement source instance ${binding.sourceInstanceId}`);
    if (insertionOrders.has(binding.insertionOrder)) throw new Error(`Duplicate skill replacement insertion order ${binding.insertionOrder}`);
    instanceIds.add(binding.sourceInstanceId);
    insertionOrders.add(binding.insertionOrder);
  }
  const skillMap = new Map(skills.map((skill) => [skill.entryId, skill]));
  const byTarget = new Map();
  for (const binding of bindings) {
    const skill = skillMap.get(binding.attachedSkillEntryId);
    if (!skill) throw new Error(`Skill replacement references unknown skill entry ${binding.attachedSkillEntryId}`);
    const list = byTarget.get(skill.entryId) ?? [];
    list.push(binding);
    byTarget.set(skill.entryId, list);
  }

  const diagnostics = [];
  const supportStatuses = [];
  for (const [entryId, targetBindings] of byTarget) {
    const skill = skillMap.get(entryId);
    const baseTags = [...skill.skillTags];
    const compatible = [];
    for (const binding of targetBindings.sort((a, b) => a.insertionOrder - b.insertionOrder)) {
      options.onWork?.();
      if (!matchesTagSelector({ skillTags: baseTags, actionTags: [] }, binding.replacement.compatibility)) {
        diagnostics.push(diagnostic(binding, SKILL_REPLACEMENT_STATUS.INCOMPATIBLE, skill, { inputSkillTags: baseTags }));
        supportStatuses.push(supportStatus(binding, SKILL_REPLACEMENT_STATUS.INCOMPATIBLE, skill));
      } else compatible.push(binding);
    }
    if (compatible.length === 0) continue;
    const winner = compatible[0];
    const before = {
      effectiveDefinitionId: skill.effectiveDefinitionId,
      skillTags: [...skill.skillTags],
      runtime: clone(skill.runtime),
      actions: clone(skill.actions),
    };
    const remove = new Set(winner.replacement.removeSkillTags);
    skill.effectiveDefinitionId = winner.replacement.effectiveDefinitionId;
    skill.skillTags = [...new Set([...baseTags.filter((tag) => !remove.has(tag)), ...winner.replacement.addSkillTags])];
    skill.runtime = clone(winner.replacement.runtime);
    skill.actions = clone(winner.replacement.actions);
    const after = {
      effectiveDefinitionId: skill.effectiveDefinitionId,
      skillTags: [...skill.skillTags],
      runtime: clone(skill.runtime),
      actions: clone(skill.actions),
    };
    diagnostics.push(diagnostic(winner, SKILL_REPLACEMENT_STATUS.ACTIVE, skill, { before, after }));
    supportStatuses.push(supportStatus(winner, SKILL_REPLACEMENT_STATUS.ACTIVE, skill));
    for (const loser of compatible.slice(1)) {
      const winnerEvidence = {
        winnerSourceDefinitionId: winner.sourceDefinitionId,
        winnerSourceInstanceId: winner.sourceInstanceId,
        winnerInsertionOrder: winner.insertionOrder,
      };
      diagnostics.push(diagnostic(loser, SKILL_REPLACEMENT_STATUS.MUTUAL_EXCLUSION, skill, winnerEvidence));
      supportStatuses.push(supportStatus(loser, SKILL_REPLACEMENT_STATUS.MUTUAL_EXCLUSION, skill, winnerEvidence));
    }
  }
  diagnostics.sort((a, b) => a.insertionOrder - b.insertionOrder);
  supportStatuses.sort((a, b) => a.insertionOrder - b.insertionOrder);
  return { diagnostics, supportStatuses };
}
