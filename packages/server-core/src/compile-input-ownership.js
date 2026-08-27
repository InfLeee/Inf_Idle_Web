import { MODIFIER_SOURCE_KIND } from "../../combat-protocol/src/action-schema.js";

function issue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function validateCompileInputOwnership(compileInput, ownershipInput) {
  const issues = [];
  const loadout = ownershipInput.loadout;
  const skillInstances = new Map((ownershipInput.skillCardInstances ?? []).map((item) => [item.instanceId, item]));
  const supportInstances = new Map((ownershipInput.supportCardInstances ?? []).map((item) => [item.instanceId, item]));
  const weaponInstances = new Map((ownershipInput.weaponInstances ?? []).map((item) => [item.instanceId, item]));
  const compiledEntries = new Map((compileInput.skills ?? []).map((item) => [item.entryId, item]));
  const compiledSourceIds = new Set();

  for (const entry of compileInput.skills ?? []) {
    if (entry.sourceInstanceId && compiledSourceIds.has(entry.sourceInstanceId) && entry.sourceType === "skill_card") {
      issues.push(issue("COMPILED_SOURCE_INSTANCE_REUSED", `skills.${entry.entryId}`, entry.sourceInstanceId));
    }
    if (entry.sourceInstanceId) compiledSourceIds.add(entry.sourceInstanceId);
  }

  if (!Array.isArray(compileInput.skillSlots) || compileInput.skillSlots.length !== loadout.skillSockets.length) {
    issues.push(issue("COMPILED_SOCKET_COUNT_MISMATCH", "skillSlots", "compiled sockets must match WeaponLoadout sockets"));
  } else {
    for (let index = 0; index < loadout.skillSockets.length; index += 1) {
      const expectedInstanceId = loadout.skillSockets[index];
      const entryId = compileInput.skillSlots[index];
      if (expectedInstanceId === null && entryId !== null) {
        issues.push(issue("COMPILED_SKILL_IN_EMPTY_SOCKET", `skillSlots[${index}]`, String(entryId)));
        continue;
      }
      if (expectedInstanceId !== null && entryId === null) {
        issues.push(issue("COMPILED_SKILL_MISSING_FROM_SOCKET", `skillSlots[${index}]`, expectedInstanceId));
        continue;
      }
      if (expectedInstanceId === null) continue;
      const entry = compiledEntries.get(entryId);
      const instance = skillInstances.get(expectedInstanceId);
      if (!entry || entry.sourceType !== "skill_card" || entry.sourceInstanceId !== expectedInstanceId) {
        issues.push(issue("COMPILED_SKILL_INSTANCE_MISMATCH", `skillSlots[${index}]`, expectedInstanceId));
      } else if (!instance || entry.definitionId !== instance.definitionId) {
        issues.push(issue("COMPILED_SKILL_DEFINITION_MISMATCH", `skillSlots[${index}]`, expectedInstanceId));
      }
    }
  }

  const socketedInstances = new Set(loadout.skillSockets.filter(Boolean));
  for (const entry of compileInput.skills ?? []) {
    if (entry.sourceType === "skill_card" && !socketedInstances.has(entry.sourceInstanceId)) {
      issues.push(issue("UNSOCKETED_SKILL_COMPILED", `skills.${entry.entryId}`, String(entry.sourceInstanceId)));
    }
  }

  const weapon = weaponInstances.get(loadout.weaponInstanceId);
  const expectedWeaponSkillIds = new Set(weapon?.rolledWeaponSkillDefinitionIds ?? []);
  const actualWeaponSkillIds = new Set();
  for (const entryId of compileInput.weaponSkillEntryIds ?? []) {
    const entry = compiledEntries.get(entryId);
    if (!entry || entry.sourceType !== "weapon_skill" || entry.sourceInstanceId !== loadout.weaponInstanceId) {
      issues.push(issue("COMPILED_WEAPON_SKILL_SOURCE_MISMATCH", `weaponSkillEntryIds.${entryId}`, String(entryId)));
      continue;
    }
    actualWeaponSkillIds.add(entry.definitionId);
  }
  if (!setEquals(actualWeaponSkillIds, expectedWeaponSkillIds)) {
    issues.push(issue("COMPILED_WEAPON_SKILL_SET_MISMATCH", "weaponSkillEntryIds", "compiled weapon skills must match rolled weapon skills"));
  }

  const expectedSupportIds = new Set(Object.values(loadout.supportConnections).flat());
  const compiledSupportIds = new Set();
  for (const binding of compileInput.modifierBindings ?? []) {
    if (binding.modifier.sourceKind === MODIFIER_SOURCE_KIND.SUPPORT_CARD) {
      if (compiledSupportIds.has(binding.sourceInstanceId)) {
        issues.push(issue("COMPILED_SUPPORT_INSTANCE_REUSED", `modifierBindings.${binding.modifier.id}`, String(binding.sourceInstanceId)));
      }
      compiledSupportIds.add(binding.sourceInstanceId);
      const target = compiledEntries.get(binding.attachedSkillEntryId);
      const connected = loadout.supportConnections[target?.sourceInstanceId] ?? [];
      const instance = supportInstances.get(binding.sourceInstanceId);
      if (!target || !connected.includes(binding.sourceInstanceId)) {
        issues.push(issue("COMPILED_SUPPORT_CONNECTION_MISMATCH", `modifierBindings.${binding.modifier.id}`, String(binding.sourceInstanceId)));
      } else if (!instance || instance.definitionId !== binding.modifier.sourceDefinitionId) {
        issues.push(issue("COMPILED_SUPPORT_DEFINITION_MISMATCH", `modifierBindings.${binding.modifier.id}`, String(binding.sourceInstanceId)));
      }
    }
    if (binding.modifier.sourceKind === MODIFIER_SOURCE_KIND.MASTERY_NODE &&
        !Object.hasOwn(loadout.masteryAllocation.nodeRanks, binding.modifier.sourceDefinitionId)) {
      issues.push(issue("UNALLOCATED_MASTERY_MODIFIER", `modifierBindings.${binding.modifier.id}`, binding.modifier.sourceDefinitionId));
    }
  }

  for (const binding of compileInput.skillReplacementBindings ?? []) {
    if (compiledSupportIds.has(binding.sourceInstanceId)) {
      issues.push(issue("COMPILED_SUPPORT_INSTANCE_REUSED", "skillReplacementBindings." + binding.replacement.id, String(binding.sourceInstanceId)));
    }
    compiledSupportIds.add(binding.sourceInstanceId);
    const target = compiledEntries.get(binding.attachedSkillEntryId);
    const connected = loadout.supportConnections[target?.sourceInstanceId] ?? [];
    const instance = supportInstances.get(binding.sourceInstanceId);
    if (!target || !connected.includes(binding.sourceInstanceId)) {
      issues.push(issue("COMPILED_SUPPORT_CONNECTION_MISMATCH", "skillReplacementBindings." + binding.replacement.id, String(binding.sourceInstanceId)));
    } else if (!instance || instance.definitionId !== binding.sourceDefinitionId) {
      issues.push(issue("COMPILED_SUPPORT_DEFINITION_MISMATCH", "skillReplacementBindings." + binding.replacement.id, String(binding.sourceInstanceId)));
    }
  }
  for (const binding of compileInput.supportScriptBindings ?? []) {
    if (compiledSupportIds.has(binding.sourceInstanceId)) {
      issues.push(issue("COMPILED_SUPPORT_INSTANCE_REUSED", "supportScriptBindings." + binding.script.id, String(binding.sourceInstanceId)));
    }
    compiledSupportIds.add(binding.sourceInstanceId);
    const target = compiledEntries.get(binding.attachedSkillEntryId);
    const connected = loadout.supportConnections[target?.sourceInstanceId] ?? [];
    const instance = supportInstances.get(binding.sourceInstanceId);
    if (!target || !connected.includes(binding.sourceInstanceId)) {
      issues.push(issue("COMPILED_SUPPORT_CONNECTION_MISMATCH", "supportScriptBindings." + binding.script.id, String(binding.sourceInstanceId)));
    } else if (!instance || instance.definitionId !== binding.sourceDefinitionId) {
      issues.push(issue("COMPILED_SUPPORT_DEFINITION_MISMATCH", "supportScriptBindings." + binding.script.id, String(binding.sourceInstanceId)));
    }
  }
  if (!setEquals(compiledSupportIds, expectedSupportIds)) {
    issues.push(issue("COMPILED_SUPPORT_SET_MISMATCH", "modifierBindings", "compiled supports must match WeaponLoadout connections"));
  }

  const declaredMasteryIds = compileInput.buildMetadata?.selectedMasteryNodeIds;
  if (declaredMasteryIds) {
    const allocated = new Set(Object.keys(loadout.masteryAllocation.nodeRanks));
    if (!setEquals(new Set(declaredMasteryIds), allocated)) {
      issues.push(issue("COMPILED_MASTERY_SELECTION_MISMATCH", "buildMetadata.selectedMasteryNodeIds", "compiled mastery selection must match allocation"));
    }
  }
  return Object.freeze(issues);
}

export function assertCompileInputMatchesOwnership(compileInput, ownershipInput) {
  const issues = validateCompileInputOwnership(compileInput, ownershipInput);
  if (issues.length) {
    const error = new Error(`Compile input ownership validation failed with ${issues.length} issue(s)`);
    error.issues = issues;
    throw error;
  }
  return compileInput;
}
