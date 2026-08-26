import { validateMasterySelection } from "../../build-compiler/src/compileWeaponBuild.js";
import { createTwoHandedSwordA1ActionInput } from "../../build-compiler/src/twoHandedSwordA1Adapter.js";
import { assertValidWeaponLoadoutOwnership } from "../../game-domain/src/model.js";
import { assertCompileInputMatchesOwnership } from "./compile-input-ownership.js";

function indexBy(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

function assertConfigMatchesAuthority(config, ownershipInput) {
  const weapon = ownershipInput.weaponInstances.find((item) => item.instanceId === ownershipInput.loadout.weaponInstanceId);
  if (!weapon || weapon.definitionId !== config.weapon.id) {
    throw new Error("A1 authority weapon does not match config weapon");
  }
  if (ownershipInput.loadout.masteryAllocation.boardDefinitionId !== config.weapon.masteryBoardId) {
    throw new Error("A1 authority mastery board does not match config mastery board");
  }
  return weapon;
}

export function assembleTwoHandedSwordA1CompileInput(config, ownershipInput, options = {}) {
  assertValidWeaponLoadoutOwnership(ownershipInput, {
    requireCombatReady: true,
    maxSupportsPerSkill: options.maxSupportsPerSkill ?? config.supports.length,
  });
  const weapon = assertConfigMatchesAuthority(config, ownershipInput);
  const skillInstances = indexBy(ownershipInput.skillCardInstances, "instanceId");
  const supportInstances = indexBy(ownershipInput.supportCardInstances, "instanceId");
  const selectedMasteryNodeIds = config.masteryNodes
    .map((node) => node.id)
    .filter((nodeId) => Object.hasOwn(ownershipInput.loadout.masteryAllocation.nodeRanks, nodeId));
  for (const rank of Object.values(ownershipInput.loadout.masteryAllocation.nodeRanks)) {
    if (rank !== 1) throw new Error("A1 prototype mastery nodes support rank 1 only");
  }
  const masteryBudget = validateMasterySelection(config, selectedMasteryNodeIds);
  const activeResourceDefinitionIds = Object.values(ownershipInput.registry.resources ?? {})
    .filter((resource) => selectedMasteryNodeIds.includes(resource.unlockMasteryNodeDefinitionId))
    .map((resource) => resource.id);
  const skillSlotEntries = ownershipInput.loadout.skillSockets.map((instanceId, socketIndex) => {
    if (instanceId === null) return null;
    const instance = skillInstances.get(instanceId);
    return {
      entryId: instance.instanceId,
      definitionId: instance.definitionId,
      sourceInstanceId: instance.instanceId,
      socketIndex,
    };
  });
  const weaponSkillEntries = weapon.rolledWeaponSkillDefinitionIds.map((definitionId) => ({
    entryId: `${weapon.instanceId}:weapon-skill:${definitionId}`,
    definitionId,
    sourceInstanceId: weapon.instanceId,
  }));
  const supportAssignments = Object.entries(ownershipInput.loadout.supportConnections).flatMap(
    ([skillInstanceId, supportInstanceIds]) => supportInstanceIds.map((supportInstanceId) => {
      const skillInstance = skillInstances.get(skillInstanceId);
      const supportInstance = supportInstances.get(supportInstanceId);
      return {
        supportId: supportInstance.definitionId,
        supportInstanceId: supportInstance.instanceId,
        skillId: skillInstance.definitionId,
        skillEntryId: skillInstance.instanceId,
        insertionOrder: ownershipInput.loadout.supportInsertionOrder[supportInstanceId],
      };
    }),
  );
  const compileInput = createTwoHandedSwordA1ActionInput(config, {
    skillSlots: ownershipInput.loadout.skillSockets,
    skillSlotEntries,
    weaponSkillEntries,
    supportAssignments,
    masteryNodeIds: selectedMasteryNodeIds,
    buildMetadata: {
      weaponInstanceId: weapon.instanceId,
      activeResourceDefinitionIds,
    },
  }, masteryBudget);
  assertCompileInputMatchesOwnership(compileInput, ownershipInput);
  return compileInput;
}
