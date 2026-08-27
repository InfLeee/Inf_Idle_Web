import {
  ACTION_SCHEMA_VERSION,
  ACTION_TIMING_KIND,
  EFFECT_KIND,
  MODIFIER_OPERATION,
  MODIFIER_PHASE,
  MODIFIER_SOURCE_KIND,
  TARGET_SELECTOR_KIND,
  createActionDefinition,
  createModifierDefinition,
  createTagRegistry,
} from "../../combat-protocol/src/action-schema.js";

import {
  SUPPORT_OBJECT_TYPE,
  SUPPORT_OPERATION_KIND,
  SUPPORT_OPERATION_PHASE,
  SUPPORT_SCRIPT_VERSION,
  SUPPORT_TARGET_MODE,
  createSupportScriptDefinition,
} from "../../combat-protocol/src/support-script-v1.js";
const ACTION_TAGS = new Set([
  "HIT",
  "DIRECT",
  "AREA",
  "SINGLE_TARGET",
  "MULTI_HIT",
  "RESOURCE_GENERATE",
  "EXECUTE",
]);
const SUPPORT_SLOT_TAGS = Object.freeze([
  "MAIN_DAMAGE",
  "MAIN_UTILITY",
  "MAIN_TARGET_SELECTOR",
  "MAIN_AREA_SELECTOR",
  "SELF_SELECTOR",
]);

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function mapPath(path) {
  const paths = {
    actionTimeMs: "timing.castTimeMs",
    minActionTimeMs: "timing.minimumCastTimeMs",
    "stats.damageMultiplier": "effects.damage.params.multiplier",
  };
  const mapped = paths[path];
  if (!mapped) throw new Error(`Unsupported legacy modifier path: ${path}`);
  return mapped;
}

function createIdentityTagChanges(definition) {
  const identity = definition.identityChanges ?? {};
  return [
    ...(identity.removeSkillTags ?? []).map((tag) => ({ operator: MODIFIER_OPERATION.REMOVE_TAG, tagScope: "skill", tag })),
    ...(identity.addSkillTags ?? []).map((tag) => ({ operator: MODIFIER_OPERATION.ADD_TAG, tagScope: "skill", tag })),
    ...(identity.removeActionTags ?? []).map((tag) => ({ operator: MODIFIER_OPERATION.REMOVE_TAG, tagScope: "action", tag })),
    ...(identity.addActionTags ?? []).map((tag) => ({ operator: MODIFIER_OPERATION.ADD_TAG, tagScope: "action", tag })),
  ];
}

function createRegistry(config) {
  const skillTags = new Set();
  const actionTags = new Set(ACTION_TAGS);
  for (const skill of config.skills) {
    for (const tag of skill.tags ?? []) {
      (ACTION_TAGS.has(tag) ? actionTags : skillTags).add(tag);
    }
  }
  for (const support of config.supports) {
    for (const change of createIdentityTagChanges(support)) {
      (change.tagScope === "action" ? actionTags : skillTags).add(change.tag);
    }
  }
  return createTagRegistry({ skillTags: [...skillTags].sort(), actionTags: [...actionTags].sort(), supportSlotTags: SUPPORT_SLOT_TAGS });
}

function createSkillEntry(skill, identity = {}) {
  if (!skill) throw new Error("Skill definition is missing from A1 config");
  const socketIndex = identity.socketIndex ?? null;
  const skillTags = (skill.tags ?? []).filter((tag) => !ACTION_TAGS.has(tag));
  const actionTags = (skill.tags ?? []).filter((tag) => ACTION_TAGS.has(tag));
  const hasDamage = Number.isFinite(skill.stats?.damageMultiplier);
  if (hasDamage && !actionTags.includes("HIT")) actionTags.push("HIT");
  if (hasDamage && !actionTags.includes("DIRECT") && !actionTags.includes("MULTI_HIT")) actionTags.push("DIRECT");
  const isUtility = skillTags.includes("UTILITY");
  const isArea = actionTags.includes("AREA");
  const effects = [];
  if (hasDamage) {
    effects.push({
      id: "damage",
      kind: EFFECT_KIND.DIRECT_DAMAGE,
      params: {
        multiplier: skill.stats.damageMultiplier,
        hitCount: skill.stats.hitCount ?? 1,
        executeThreshold: skill.stats.executeThreshold ?? null,
      },
    });
  }
  if (skill.resourceGain) {
    effects.push({
      id: "resource_gain",
      kind: EFFECT_KIND.RESOURCE_DELTA,
      params: { resourceId: "a_fighting_spirit", amount: skill.resourceGain },
    });
  }
  if (effects.length === 0) {
    effects.push({
      id: "utility_state",
      kind: EFFECT_KIND.APPLY_STATE,
      params: { stateId: skill.id === "mount" ? "mounted" : `${skill.id}_active`, durationMs: null },
    });
  }
  const instant = (skill.actionTimeMs ?? 0) === 0;
  const timing = instant
    ? { kind: ACTION_TIMING_KIND.INSTANT, gcdMs: 0, cooldownMs: skill.cooldownMs ?? 0 }
    : {
      kind: ACTION_TIMING_KIND.CAST,
      castTimeMs: skill.actionTimeMs,
      minimumCastTimeMs: skill.minActionTimeMs ?? 1,
      gcdMs: skill.backgroundAction ? 0 : 500,
      cooldownMs: skill.cooldownMs ?? 0,
    };
  return {
    entryId: identity.entryId ?? skill.id,
    definitionId: skill.id,
    sourceType: skillTags.includes("WEAPON_SKILL") ? "weapon_skill" : "skill_card",
    sourceInstanceId: identity.sourceInstanceId ?? `prototype:${skill.id}`,
    socketIndex,
    runtime: {
      enabled: skill.enabled ?? true,
      role: skill.role ?? "normal",
      priorityOnly: skill.priorityOnly ?? false,
      backgroundAction: skill.backgroundAction ?? false,
      activationResource: skill.activationResource ?? null,
      prototypeValue: skill.prototypeValue ?? false,
      originalTags: [...(skill.tags ?? [])],
    },
    skillTags,
    actions: [createActionDefinition({
      id: `${skill.id}.main`,
      name: skill.name,
      supportSlotTag: hasDamage ? "MAIN_DAMAGE" : "MAIN_UTILITY",
      actionTags,
      targeting: isUtility
        ? { id: skill.id + ".selector.main", supportSlotTag: "SELF_SELECTOR", kind: TARGET_SELECTOR_KIND.SELF }
        : isArea
          ? { id: skill.id + ".selector.main", supportSlotTag: "MAIN_AREA_SELECTOR", kind: TARGET_SELECTOR_KIND.ENEMIES_IN_RADIUS, radiusM: 3.5, maxTargets: 8 }
          : { id: skill.id + ".selector.main", supportSlotTag: "MAIN_TARGET_SELECTOR", kind: TARGET_SELECTOR_KIND.CURRENT_TARGET },
      timing,
      costs: skill.resourceCost
        ? [{ resourceId: "a_fighting_spirit", amount: skill.resourceCost, timing: "on_start" }]
        : [],
      conditions: skill.activationResource
        ? [{ type: "resource_at_least", params: { resourceId: "a_fighting_spirit", amount: skill.activationResource } }]
        : [],
      effects,
    })],
  };
}

function splitCompatibilityTags(tags = []) {
  return {
    skill: tags.filter((tag) => !ACTION_TAGS.has(tag)),
    action: tags.filter((tag) => ACTION_TAGS.has(tag)),
  };
}
function createSupportBindings(config, assignments, equippedEntries) {
  const supportMap = indexById(config.supports);
  return assignments.map((assignment, index) => {
    const definition = supportMap.get(assignment.supportId);
    if (!definition) throw new Error("Unknown support: " + assignment.supportId);
    const target = equippedEntries.find((entry) => (
      assignment.skillEntryId ? entry.entryId === assignment.skillEntryId : entry.definitionId === assignment.skillId
    ));
    if (!target) throw new Error("Support target is not equipped: " + (assignment.skillEntryId ?? assignment.skillId));
    const compatibility = splitCompatibilityTags(definition.compatibility?.requireAll).skill;
    const excluded = splitCompatibilityTags(definition.compatibility?.excludeAny).skill;
    const operations = [];
    const identityChanges = createIdentityTagChanges(definition);
    if (identityChanges.length) {
      operations.push({
        id: "identity-main-action",
        kind: SUPPORT_OPERATION_KIND.IDENTITY,
        phase: SUPPORT_OPERATION_PHASE.IDENTITY,
        target: {
          objectType: SUPPORT_OBJECT_TYPE.ACTION,
          supportSlotTag: "MAIN_DAMAGE",
          targetMode: SUPPORT_TARGET_MODE.UNIQUE,
        },
        changes: identityChanges,
      });
    }
    if ((definition.effects ?? []).length) {
      operations.push({
        id: "modify-main-action",
        kind: SUPPORT_OPERATION_KIND.MODIFY,
        phase: SUPPORT_OPERATION_PHASE.MODIFY,
        target: {
          objectType: SUPPORT_OBJECT_TYPE.ACTION,
          supportSlotTag: "MAIN_DAMAGE",
          targetMode: SUPPORT_TARGET_MODE.UNIQUE,
        },
        changes: definition.effects.map((effect) => ({
          operator: effect.operator,
          path: mapPath(effect.path),
          value: effect.value,
        })),
      });
    }
    return {
      script: createSupportScriptDefinition({
        version: SUPPORT_SCRIPT_VERSION,
        id: "support-script:" + definition.id,
        compatibility: { skillAll: compatibility, skillNone: excluded },
        conflictGroup: definition.conflictGroup ?? null,
        operations,
      }),
      sourceDefinitionId: definition.id,
      sourceInstanceId: assignment.supportInstanceId ?? "prototype:" + definition.id + ":" + index,
      attachedSkillEntryId: target.entryId,
      insertionOrder: assignment.insertionOrder ?? index,
    };
  });
}

function createMasteryBindings(config, selectedNodeIds, compiledEntries) {
  const nodeMap = indexById(config.masteryNodes);
  return selectedNodeIds.flatMap((nodeId, nodeOrder) => {
    const node = nodeMap.get(nodeId);
    return (node.effects ?? []).flatMap((effect, effectIndex) => {
      const targets = compiledEntries.filter((entry) => entry.definitionId === effect.skillId);
      return targets.map((target) => ({
        modifier: createModifierDefinition({
          id: `mastery:${node.id}:${effectIndex}`,
          sourceKind: MODIFIER_SOURCE_KIND.MASTERY_NODE,
          sourceDefinitionId: node.id,
          phase: MODIFIER_PHASE.POST_SUPPORT,
          selector: {},
          operations: [{ operator: effect.operator, path: mapPath(effect.path), value: effect.value }],
        }),
        sourceInstanceId: null,
        attachedSkillEntryId: target.entryId,
        insertionOrder: nodeOrder * 100 + effectIndex,
      }));
    });
  });
}

export function createTwoHandedSwordA1ActionInput(config, selection, masteryBudget) {
  const skillMap = indexById(config.skills);
  const slotEntries = selection.skillSlotEntries ?? selection.skillSlots.map((definitionId, socketIndex) => (
    definitionId ? { entryId: definitionId, definitionId, sourceInstanceId: `prototype:${definitionId}`, socketIndex } : null
  ));
  const weaponEntries = selection.weaponSkillEntries ?? config.weapon.fixedWeaponSkillIds.map((definitionId) => ({
    entryId: definitionId,
    definitionId,
    sourceInstanceId: `prototype:${definitionId}`,
  }));
  const equippedEntries = slotEntries.filter(Boolean);
  const compiledEntries = [...equippedEntries, ...weaponEntries];
  const skills = [
    ...equippedEntries.map((entry) => createSkillEntry(skillMap.get(entry.definitionId), entry)),
    ...weaponEntries.map((entry) => createSkillEntry(skillMap.get(entry.definitionId), entry)),
  ];
  const supportScriptBindings = createSupportBindings(config, selection.supportAssignments, equippedEntries);
  const modifierBindings = createMasteryBindings(config, selection.masteryNodeIds, compiledEntries);
  return {
    configVersion: config.configVersion,
    domainSchemaVersion: "weapon-loadout-v1",
    actionSchemaVersion: ACTION_SCHEMA_VERSION,
    tagRegistry: createRegistry(config),
    skills,
    skillSlots: slotEntries.map((entry) => entry?.entryId ?? null),
    weaponSkillEntryIds: weaponEntries.map((entry) => entry.entryId),
    modifierBindings,
    supportScriptBindings,
    autoPolicy: structuredClone(config.build.autoPolicy),
    buildMetadata: {
      weaponId: config.weapon.id,
      masteryBoardId: config.weapon.masteryBoardId,
      buildId: config.build.id,
      selectedMasteryNodeIds: [...selection.masteryNodeIds],
      masteryBudget,
      ...structuredClone(selection.buildMetadata ?? {}),
    },
  };
}

function toLegacySkill(entry, original) {
  const action = entry.actions[0];
  const damage = action.effects.find((effect) => effect.id === "damage");
  const resource = action.effects.find((effect) => effect.id === "resource_gain");
  return {
    ...structuredClone(original),
    stats: {
      ...structuredClone(original.stats ?? {}),
      ...(damage ? {
        damageMultiplier: damage.params.multiplier,
        ...(damage.params.hitCount !== 1 ? { hitCount: damage.params.hitCount } : {}),
        ...(damage.params.executeThreshold != null ? { executeThreshold: damage.params.executeThreshold } : {}),
      } : {}),
    },
    actionTimeMs: action.timing.castTimeMs ?? action.timing.tickIntervalMs ?? 0,
    minActionTimeMs: action.timing.minimumCastTimeMs ?? action.timing.minimumTickIntervalMs ?? original.minActionTimeMs,
    cooldownMs: action.timing.cooldownMs,
    resourceCost: action.costs.find((cost) => cost.resourceId === "a_fighting_spirit")?.amount ?? 0,
    resourceGain: resource?.params.amount ?? original.resourceGain,
  };
}

export function projectTwoHandedSwordA1Legacy(actionBuild, config, masteryBudget) {
  const originalMap = indexById(config.skills);
  const legacySkills = actionBuild.compiledSkills.map((entry) => toLegacySkill(entry, originalMap.get(entry.definitionId)));
  const legacyByEntryId = new Map(actionBuild.compiledSkills.map((entry, index) => [entry.entryId, legacySkills[index]]));
  const diagnostics = actionBuild.diagnostics.map((item) => ({
    ...structuredClone(item),
    type: item.sourceKind === MODIFIER_SOURCE_KIND.SUPPORT_CARD ? "normal_support" : "mastery_applied",
    status: item.status === "applied" ? "active" : item.status,
    supportId: item.sourceKind === MODIFIER_SOURCE_KIND.SUPPORT_CARD ? item.sourceDefinitionId : undefined,
    masteryId: item.sourceKind === MODIFIER_SOURCE_KIND.MASTERY_NODE ? item.sourceDefinitionId : undefined,
  }));
  return {
    configVersion: actionBuild.configVersion,
    buildHash: actionBuild.buildHash,
    compiledSkills: legacySkills,
    skillSlots: actionBuild.skillSlots.map((entryId) => entryId ? structuredClone(legacyByEntryId.get(entryId)) : null),
    weaponSkills: actionBuild.weaponSkillEntryIds.map((entryId) => structuredClone(legacyByEntryId.get(entryId))),
    diagnostics,
    autoPolicy: structuredClone(actionBuild.autoPolicy),
    weaponId: config.weapon.id,
    masteryBoardId: config.weapon.masteryBoardId,
    buildId: config.build.id,
    masteryBudget,
    actionCompiledBuild: actionBuild,
  };
}
