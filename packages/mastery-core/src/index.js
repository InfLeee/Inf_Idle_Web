export const MASTERY_EFFECT_KIND = Object.freeze({
  MODIFIER: "modifier",
  SKILL_REPLACEMENT: "skill_replacement",
  RESOURCE_UNLOCK: "resource_unlock",
  PRIMARY_STAT_BONUS: "primary_stat_bonus",
  DERIVED_STAT_BONUS: "derived_stat_bonus",
  ACTION_SCRIPT: "action_script",
  EVENT_RULE: "event_rule",
  AUTO_POLICY: "auto_policy",
  SKILL_GRANT: "skill_grant",
});

const IMPLEMENTED_EFFECT_KINDS = new Set([
  MASTERY_EFFECT_KIND.MODIFIER,
  MASTERY_EFFECT_KIND.SKILL_REPLACEMENT,
  MASTERY_EFFECT_KIND.RESOURCE_UNLOCK,
  MASTERY_EFFECT_KIND.PRIMARY_STAT_BONUS,
  MASTERY_EFFECT_KIND.DERIVED_STAT_BONUS,
]);

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}
function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}
function assertUniqueIds(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  values.forEach((value, index) => assertId(value, `${name}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${name} cannot contain duplicate ids`);
}
function nodePrerequisites(node) {
  if (Array.isArray(node.prerequisites)) return { allOf: [...node.prerequisites], anyOf: [] };
  const input = node.prerequisites ?? {};
  return { allOf: [...(input.allOf ?? [])], anyOf: [...(input.anyOf ?? [])] };
}
function scopeRequirement(config, scope) {
  const requirement = config.masteryScopeRequirements?.[scope];
  if (!requirement) return { allOf: [], anyOf: [], choices: {} };
  return { allOf: [...(requirement.allOf ?? [])], anyOf: [...(requirement.anyOf ?? [])], choices: { ...(requirement.choices ?? {}) } };
}
function requirementSatisfied(requirement, selected, nodeChoices = {}) {
  return requirement.allOf.every((id) => selected.has(id)) &&
    (requirement.anyOf.length === 0 || requirement.anyOf.some((id) => selected.has(id))) &&
    Object.entries(requirement.choices ?? {}).every(([nodeId, choiceId]) => nodeChoices[nodeId] === choiceId);
}
function assertEffect(effect, name) {
  assertRecord(effect, name);
  if (!Object.values(MASTERY_EFFECT_KIND).includes(effect.kind)) throw new Error(`${name}.kind is unsupported: ${effect.kind}`);
  if (effect.kind === MASTERY_EFFECT_KIND.MODIFIER && (!Array.isArray(effect.operations) || effect.operations.length === 0)) {
    throw new Error(`${name}.operations must not be empty`);
  }
  if (effect.kind === MASTERY_EFFECT_KIND.SKILL_REPLACEMENT) {
    assertId(effect.skillId, `${name}.skillId`);
    assertId(effect.replacementSkillDefinitionId, `${name}.replacementSkillDefinitionId`);
  }
  if (effect.kind === MASTERY_EFFECT_KIND.RESOURCE_UNLOCK) assertId(effect.resourceId, `${name}.resourceId`);
  if (effect.kind === MASTERY_EFFECT_KIND.PRIMARY_STAT_BONUS) {
    assertId(effect.statId, `${name}.statId`);
    if (!Number.isFinite(effect.amount)) throw new TypeError(`${name}.amount must be finite`);
  }
  if (effect.kind === MASTERY_EFFECT_KIND.DERIVED_STAT_BONUS) {
    assertId(effect.statId, `${name}.statId`);
    if (!Number.isFinite(effect.amount)) throw new TypeError(`${name}.amount must be finite`);
    if (!["equipmentBase", "basePercent", "extra"].includes(effect.bucket)) throw new Error(`${name}.bucket is unsupported: ${effect.bucket}`);
  }
}
function normalizeAllocation(input) {
  if (Array.isArray(input)) return { nodeRanks: Object.fromEntries(input.map((id) => [id, 1])), nodeChoices: {} };
  assertRecord(input, "MasteryAllocationInput");
  return { nodeRanks: { ...(input.nodeRanks ?? {}) }, nodeChoices: { ...(input.nodeChoices ?? {}) } };
}
function activeNodeEffects(node, nodeChoices) {
  const effects = [...(node.effects ?? [])];
  const choice = (node.choiceOptions ?? []).find((item) => item.id === nodeChoices[node.id]);
  if (choice) effects.push(...(choice.effects ?? []));
  return effects;
}

export function isMasteryEffectImplemented(kind) {
  return IMPLEMENTED_EFFECT_KINDS.has(kind);
}

export function validateMasteryConfig(config) {
  assertRecord(config, "MasteryConfig");
  if (!Number.isInteger(config.build?.pointBudget) || config.build.pointBudget < 1) {
    throw new RangeError("MasteryConfig.build.pointBudget must be a positive integer");
  }
  if (!Array.isArray(config.masteryNodes)) throw new TypeError("MasteryConfig.masteryNodes must be an array");
  const ids = config.masteryNodes.map((node) => node.id);
  assertUniqueIds(ids, "MasteryConfig.masteryNodes.ids");
  const known = new Set(ids);
  for (const [index, node] of config.masteryNodes.entries()) {
    assertId(node.name, `MasteryConfig.masteryNodes[${index}].name`);
    if (!Number.isInteger(node.cost) || node.cost < 1) throw new RangeError(`Mastery node ${node.id} cost must be positive`);
    if (!Number.isInteger(node.maxRank ?? 1) || (node.maxRank ?? 1) < 1) throw new RangeError(`Mastery node ${node.id} maxRank must be positive`);
    if (!Number.isInteger(node.minSpent ?? 0) || (node.minSpent ?? 0) < 0) throw new RangeError(`Mastery node ${node.id} minSpent must be non-negative`);
    const prerequisites = nodePrerequisites(node);
    assertUniqueIds(prerequisites.allOf, `Mastery node ${node.id} prerequisites.allOf`);
    assertUniqueIds(prerequisites.anyOf, `Mastery node ${node.id} prerequisites.anyOf`);
    for (const prerequisite of [...prerequisites.allOf, ...prerequisites.anyOf]) {
      if (!known.has(prerequisite)) throw new Error(`Mastery node ${node.id} references unknown prerequisite ${prerequisite}`);
      if (prerequisite === node.id) throw new Error(`Mastery node ${node.id} cannot require itself`);
    }
    for (const [effectIndex, effect] of (node.effects ?? []).entries()) assertEffect(effect, `Mastery node ${node.id} effect ${effectIndex}`);
    const choices = node.choiceOptions ?? [];
    assertUniqueIds(choices.map((choice) => choice.id), `Mastery node ${node.id} choice ids`);
    for (const choice of choices) {
      assertId(choice.name, `Mastery node ${node.id} choice ${choice.id}.name`);
      for (const [effectIndex, effect] of (choice.effects ?? []).entries()) assertEffect(effect, `Mastery node ${node.id} choice ${choice.id} effect ${effectIndex}`);
    }
  }
  for (const [scope, requirement] of Object.entries(config.masteryScopeRequirements ?? {})) {
    const normalized = scopeRequirement(config, scope);
    for (const id of [...normalized.allOf, ...normalized.anyOf]) {
      if (!known.has(id)) throw new Error(`Mastery scope ${scope} references unknown node ${id}`);
    }
    for (const [nodeId, choiceId] of Object.entries(normalized.choices)) {
      const choiceNode = config.masteryNodes.find((node) => node.id === nodeId);
      if (!choiceNode) throw new Error(`Mastery scope ${scope} references unknown choice node ${nodeId}`);
      if (!(choiceNode.choiceOptions ?? []).some((choice) => choice.id === choiceId)) {
        throw new Error(`Mastery scope ${scope} references unknown choice ${nodeId}:${choiceId}`);
      }
    }
  }
  return config;
}

export function validateMasteryAllocation(config, allocationInput) {
  validateMasteryConfig(config);
  const allocation = normalizeAllocation(allocationInput);
  const nodeMap = new Map(config.masteryNodes.map((node) => [node.id, node]));
  const selected = new Set(Object.keys(allocation.nodeRanks));
  let spent = 0;
  for (const [nodeId, rank] of Object.entries(allocation.nodeRanks)) {
    const node = nodeMap.get(nodeId);
    if (!node) throw new Error(`Unknown mastery node: ${nodeId}`);
    if (!Number.isInteger(rank) || rank < 1 || rank > (node.maxRank ?? 1)) throw new Error(`Mastery rank invalid: ${nodeId}`);
    spent += node.cost * rank;
  }
  if (spent > config.build.pointBudget) throw new Error(`Mastery budget exceeded: ${spent}/${config.build.pointBudget}`);
  for (const nodeId of selected) {
    const node = nodeMap.get(nodeId);
    if (!requirementSatisfied(nodePrerequisites(node), selected)) throw new Error(`Mastery prerequisite missing: ${nodeId}`);
    if (!requirementSatisfied(scopeRequirement(config, node.purchaseScope ?? node.scope ?? "ALL"), selected, allocation.nodeChoices)) {
      throw new Error(`Mastery purchase scope is inactive: ${nodeId}`);
    }
    const pointsOutsideNode = spent - node.cost * allocation.nodeRanks[nodeId];
    if (pointsOutsideNode < (node.minSpent ?? 0)) throw new Error(`Mastery tier locked: ${nodeId} requires ${node.minSpent} prior points`);
    const choices = node.choiceOptions ?? [];
    const choiceId = allocation.nodeChoices[nodeId];
    if (choices.length && !choices.some((choice) => choice.id === choiceId)) throw new Error(`Mastery choice missing: ${nodeId}`);
    if (!choices.length && choiceId !== undefined) throw new Error(`Mastery node does not accept a choice: ${nodeId}`);
  }
  for (const nodeId of Object.keys(allocation.nodeChoices)) {
    if (!selected.has(nodeId)) throw new Error(`Mastery choice belongs to an unselected node: ${nodeId}`);
  }
  const activeEffects = [];
  for (const nodeId of selected) {
    const node = nodeMap.get(nodeId);
    const active = requirementSatisfied(scopeRequirement(config, node.effectScope ?? node.scope ?? "ALL"), selected, allocation.nodeChoices);
    for (const effect of activeNodeEffects(node, allocation.nodeChoices)) {
      activeEffects.push({ nodeId, rank: allocation.nodeRanks[nodeId], active, effect: structuredClone(effect) });
    }
  }
  return Object.freeze({
    spent,
    budget: config.build.pointBudget,
    nodeRanks: Object.freeze({ ...allocation.nodeRanks }),
    nodeChoices: Object.freeze({ ...allocation.nodeChoices }),
    activeEffects: Object.freeze(activeEffects.map(Object.freeze)),
  });
}

export function masteryNodeState(config, allocationInput, nodeId) {
  validateMasteryConfig(config);
  const allocation = normalizeAllocation(allocationInput);
  const node = config.masteryNodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Unknown mastery node: ${nodeId}`);
  const selected = new Set(Object.keys(allocation.nodeRanks));
  const spent = Object.entries(allocation.nodeRanks).reduce((total, [id, rank]) => {
    const selectedNode = config.masteryNodes.find((item) => item.id === id);
    return total + (selectedNode?.cost ?? 0) * rank;
  }, 0);
  const reasons = [];
  if (!requirementSatisfied(nodePrerequisites(node), selected)) reasons.push("前置节点未满足");
  if (!requirementSatisfied(scopeRequirement(config, node.purchaseScope ?? node.scope ?? "ALL"), selected, allocation.nodeChoices)) reasons.push("当前分支不可购买");
  if (spent < (node.minSpent ?? 0)) reasons.push(`需要先投入 ${node.minSpent} 点`);
  const rank = allocation.nodeRanks[nodeId] ?? 0;
  if (rank < (node.maxRank ?? 1) && spent + node.cost > config.build.pointBudget) reasons.push("精通点不足");
  return Object.freeze({ rank, purchased: rank > 0, available: rank < (node.maxRank ?? 1) && reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function cascadeRefundMastery(config, allocationInput, nodeId) {
  const allocation = normalizeAllocation(allocationInput);
  delete allocation.nodeRanks[nodeId];
  delete allocation.nodeChoices[nodeId];
  let changed = true;
  while (changed) {
    changed = false;
    const selected = new Set(Object.keys(allocation.nodeRanks));
    for (const selectedId of [...selected]) {
      const node = config.masteryNodes.find((item) => item.id === selectedId);
      if (!requirementSatisfied(nodePrerequisites(node), selected) || !requirementSatisfied(scopeRequirement(config, node.purchaseScope ?? node.scope ?? "ALL"), selected, allocation.nodeChoices)) {
        delete allocation.nodeRanks[selectedId];
        delete allocation.nodeChoices[selectedId];
        changed = true;
      }
    }
  }
  return allocation;
}
