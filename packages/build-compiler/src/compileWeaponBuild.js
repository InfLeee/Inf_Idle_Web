import { compileActionBuild } from "./compileActionBuild.js";
import {
  createTwoHandedSwordA1ActionInput,
  projectTwoHandedSwordA1Legacy,
} from "./twoHandedSwordA1Adapter.js";

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

export function validateMasterySelection(config, selectedNodeIds) {
  const nodes = indexById(config.masteryNodes);
  const selected = new Set(selectedNodeIds);
  let spent = 0;

  for (const nodeId of selectedNodeIds) {
    const node = nodes.get(nodeId);
    if (!node) throw new Error(`Unknown mastery node: ${nodeId}`);
    for (const prerequisite of node.prerequisites ?? []) {
      if (!selected.has(prerequisite)) throw new Error(`Mastery prerequisite missing: ${nodeId} requires ${prerequisite}`);
    }
    spent += node.cost;
  }

  if (spent > config.build.pointBudget) {
    throw new Error(`Mastery budget exceeded: ${spent}/${config.build.pointBudget}`);
  }

  return { spent, budget: config.build.pointBudget };
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
  const masteryBudget = validateMasterySelection(config, selectedNodeIds);
  const normalizedSelection = {
    skillSlots: [...skillIds],
    masteryNodeIds: [...selectedNodeIds],
    supportAssignments: structuredClone(selection.supportAssignments ?? []),
  };
  const actionInput = createTwoHandedSwordA1ActionInput(config, normalizedSelection, masteryBudget);
  const actionBuild = compileActionBuild(actionInput);
  return projectTwoHandedSwordA1Legacy(actionBuild, config, masteryBudget);
}
