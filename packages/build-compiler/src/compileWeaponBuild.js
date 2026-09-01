import { validateMasteryAllocation } from "../../mastery-core/src/index.js";
import { compileActionBuild } from "./compileActionBuild.js";
import {
  createTwoHandedSwordA1ActionInput,
  projectTwoHandedSwordA1Legacy,
} from "./twoHandedSwordA1Adapter.js";

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

export function validateMasterySelection(config, selectedNodeIdsOrAllocation) {
  return validateMasteryAllocation(config, selectedNodeIdsOrAllocation);
}
export function compileWeaponBuild(config, selection = {}) {
  if (selection.weaponId && selection.weaponId !== config.weapon.id) {
    throw new Error(`Weapon mismatch: expected ${config.weapon.id}, received ${selection.weaponId}`);
  }

  const skillIds = selection.skillSlots ?? config.build.defaultSkillSlots;
  if (skillIds.length !== 5) throw new Error("Two-handed sword action bar must contain exactly five skills");
  const occupiedSkillIds = skillIds.filter(Boolean);
  if (occupiedSkillIds.length < 1 || occupiedSkillIds.length > 5) {
    throw new Error("Two-handed sword action bar must contain between one and five equipped skills");
  }
  if (new Set(occupiedSkillIds).size !== occupiedSkillIds.length) {
    throw new Error("Two-handed sword action bar cannot contain duplicate skills");
  }
  for (const skillId of occupiedSkillIds) {
    if (!config.build.allowedSkillIds.includes(skillId)) {
      throw new Error(`Skill is not allowed by this weapon build: ${skillId}`);
    }
  }

  const selectedNodeIds = selection.masteryNodeIds ?? config.build.defaultMasteryNodeIds ?? config.recommendedRoute;
  const masteryAllocation = selection.masteryAllocation ?? {
    nodeRanks: Object.fromEntries(selectedNodeIds.map((nodeId) => [nodeId, 1])),
    nodeChoices: selection.masteryNodeChoices ?? config.build.defaultMasteryNodeChoices ?? {},
  };
  const masteryBudget = validateMasterySelection(config, masteryAllocation);
  const normalizedSelection = {
    skillSlots: [...skillIds],
    masteryNodeIds: [...Object.keys(masteryBudget.nodeRanks)],
    masteryNodeChoices: { ...masteryBudget.nodeChoices },
    supportAssignments: structuredClone(selection.supportAssignments ?? []),
  };
  const actionInput = createTwoHandedSwordA1ActionInput(config, normalizedSelection, masteryBudget);
  const actionBuild = compileActionBuild(actionInput);
  return projectTwoHandedSwordA1Legacy(actionBuild, config, masteryBudget);
}
