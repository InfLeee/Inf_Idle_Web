import {
  createDefinitionRegistry,
  createMasteryAllocation,
  createMasteryBoardDefinition,
  createResourceDefinition,
  createSkillCardDefinition,
  createSkillCardInstance,
  createSupportCardDefinition,
  createSupportCardInstance,
  createWeaponDefinition,
  createWeaponInstance,
  createWeaponLoadout,
  createWeaponSkillDefinition,
} from "../game-domain/src/model.js";

export const TWO_HANDED_SWORD_A1_DEMO_IDS = Object.freeze({
  weaponInstanceId: "weapon-instance-a1-demo",
  skillInstancePrefix: "skill-instance-a1-",
  supportInstancePrefix: "support-instance-a1-",
});

function skillById(config, id) {
  const skill = config.skills.find((item) => item.id === id);
  if (!skill) throw new Error(`A1 config is missing skill definition ${id}`);
  return skill;
}

export function createTwoHandedSwordA1DefinitionRegistry(config) {
  const resources = config.resources.map((resource) => createResourceDefinition({
    id: resource.id,
    name: resource.name,
    weaponType: config.weapon.id,
    unlockMasteryNodeDefinitionId: resource.unlockMasteryNodeId,
    minimum: resource.min,
    maximum: resource.max,
    initial: resource.initial,
  }));
  const masteryBoard = createMasteryBoardDefinition({
    id: config.weapon.masteryBoardId,
    name: `${config.weapon.name}精通盘`,
    weaponType: config.weapon.id,
    nodeDefinitionIds: config.masteryNodes.map((node) => node.id),
    resourceDefinitionIds: resources.map((resource) => resource.id),
  });
  const skillCards = config.build.allowedSkillIds.map((id) => {
    const skill = skillById(config, id);
    return createSkillCardDefinition({
      id: skill.id,
      name: skill.name,
      allowedWeaponTypes: [config.weapon.id],
      skillTags: [...(skill.tags ?? [])],
    });
  });
  const weaponSkills = config.weapon.fixedWeaponSkillIds.map((id) => {
    const skill = skillById(config, id);
    return createWeaponSkillDefinition({
      id: skill.id,
      name: skill.name,
      allowedWeaponTypes: [config.weapon.id],
      skillTags: [...(skill.tags ?? [])],
    });
  });
  const supports = config.supports.map((support) => createSupportCardDefinition({
    id: support.id,
    name: support.name,
  }));
  const weapon = createWeaponDefinition({
    id: config.weapon.id,
    name: config.weapon.name,
    weaponType: config.weapon.id,
    masteryBoardDefinitionId: masteryBoard.id,
    baseAttackRangeM: 3.4,
    baseAttackIntervalMs: skillById(config, config.weapon.fixedActionSkillId).actionTimeMs,
    allowedSkillCardDefinitionIds: skillCards.map((skill) => skill.id),
    weaponSkillPoolDefinitionIds: weaponSkills.map((skill) => skill.id),
  });
  return createDefinitionRegistry({
    weapons: [weapon],
    skills: [...skillCards, ...weaponSkills],
    supports,
    resources,
    masteryBoards: [masteryBoard],
  });
}

export function createTwoHandedSwordA1DemoOwnership(config, options = {}) {
  const registry = createTwoHandedSwordA1DefinitionRegistry(config);
  const weapon = createWeaponInstance({
    instanceId: TWO_HANDED_SWORD_A1_DEMO_IDS.weaponInstanceId,
    definitionId: config.weapon.id,
    rolledWeaponSkillDefinitionIds: [...config.weapon.fixedWeaponSkillIds],
  });
  const skillCardInstances = config.build.allowedSkillIds.map((definitionId, index) => createSkillCardInstance({
    instanceId: `${TWO_HANDED_SWORD_A1_DEMO_IDS.skillInstancePrefix}${index + 1}`,
    definitionId,
  }));
  const supportCardInstances = config.supports.map((support, index) => createSupportCardInstance({
    instanceId: `${TWO_HANDED_SWORD_A1_DEMO_IDS.supportInstancePrefix}${index + 1}`,
    definitionId: support.id,
  }));
  const skillInstanceByDefinition = new Map(skillCardInstances.map((instance) => [instance.definitionId, instance]));
  const selectedSkillDefinitionIds = options.skillDefinitionIds ?? config.build.defaultSkillSlots;
  const selectedMasteryNodeIds = options.masteryNodeIds ?? config.build.defaultMasteryNodeIds;
  const skillSockets = Array.from({ length: 5 }, (_, index) => {
    const definitionId = selectedSkillDefinitionIds[index] ?? null;
    return definitionId ? skillInstanceByDefinition.get(definitionId)?.instanceId ?? null : null;
  });
  const loadout = createWeaponLoadout({
    weaponInstanceId: weapon.instanceId,
    skillSockets,
    supportConnections: structuredClone(options.supportConnections ?? {}),
    masteryAllocation: createMasteryAllocation({
      boardDefinitionId: config.weapon.masteryBoardId,
      nodeRanks: Object.fromEntries(selectedMasteryNodeIds.map((nodeId) => [nodeId, 1])),
    }),
  });
  return Object.freeze({
    registry,
    loadout,
    weaponInstances: Object.freeze([weapon]),
    skillCardInstances: Object.freeze(skillCardInstances),
    supportCardInstances: Object.freeze(supportCardInstances),
  });
}
export function createTwoHandedSwordA1InventoryLabOwnership(config) {
  const registry = createTwoHandedSwordA1DefinitionRegistry(config);
  const weaponInstances = [];
  const skillCardInstances = [];
  const supportCardInstances = [];
  const weaponLoadouts = [];

  function addWeapon({ weaponInstanceId, skillDefinitionIds, supportDefinitionSlots, skillPrefix, supportPrefix }) {
    const weapon = createWeaponInstance({
      instanceId: weaponInstanceId,
      definitionId: config.weapon.id,
      rolledWeaponSkillDefinitionIds: [...config.weapon.fixedWeaponSkillIds],
    });
    weaponInstances.push(weapon);
    const skills = skillDefinitionIds.map((definitionId, index) => createSkillCardInstance({
      instanceId: `${skillPrefix}${index + 1}`,
      definitionId,
    }));
    skillCardInstances.push(...skills);
    let supportSerial = 1;
    const supportSlots = supportDefinitionSlots.map((definitionIds) => definitionIds.map((definitionId) => {
      const instance = createSupportCardInstance({
        instanceId: `${supportPrefix}${supportSerial++}`,
        definitionId,
      });
      supportCardInstances.push(instance);
      return instance.instanceId;
    }));
    const loadout = createWeaponLoadout({
      weaponInstanceId,
      skillSockets: Array.from({ length: 5 }, (_, index) => skills[index]?.instanceId ?? null),
      supportSlots,
      masteryAllocation: createMasteryAllocation({
        boardDefinitionId: config.weapon.masteryBoardId,
        nodeRanks: Object.fromEntries(config.build.defaultMasteryNodeIds.map((nodeId) => [nodeId, 1])),
      }),
    });
    weaponLoadouts.push(loadout);
  }

  const supportIds = config.supports.map((support) => support.id);
  addWeapon({
    weaponInstanceId: TWO_HANDED_SWORD_A1_DEMO_IDS.weaponInstanceId,
    skillDefinitionIds: config.build.defaultSkillSlots,
    supportDefinitionSlots: Array.from({ length: 5 }, (_, socketIndex) =>
      Array.from({ length: 3 }, (_, supportIndex) => supportIds[(socketIndex * 3 + supportIndex) % supportIds.length])),
    skillPrefix: TWO_HANDED_SWORD_A1_DEMO_IDS.skillInstancePrefix,
    supportPrefix: TWO_HANDED_SWORD_A1_DEMO_IDS.supportInstancePrefix,
  });
  addWeapon({
    weaponInstanceId: "weapon-instance-a1-test-2",
    skillDefinitionIds: config.build.defaultSkillSlots.slice(0, 2).reverse(),
    supportDefinitionSlots: [[supportIds[0], supportIds[1]], [], [], [], []],
    skillPrefix: "skill-instance-a1-w2-",
    supportPrefix: "support-instance-a1-w2-",
  });
  addWeapon({
    weaponInstanceId: "weapon-instance-a1-test-3",
    skillDefinitionIds: [],
    supportDefinitionSlots: [[], [], [], [], []],
    skillPrefix: "skill-instance-a1-w3-",
    supportPrefix: "support-instance-a1-w3-",
  });

  for (const [index, definitionId] of config.build.allowedSkillIds.entries()) {
    if (skillCardInstances.some((instance) => instance.definitionId === definitionId && instance.instanceId.startsWith(TWO_HANDED_SWORD_A1_DEMO_IDS.skillInstancePrefix))) continue;
    skillCardInstances.push(createSkillCardInstance({
      instanceId: `${TWO_HANDED_SWORD_A1_DEMO_IDS.skillInstancePrefix}free-${index + 1}`,
      definitionId,
    }));
  }
  return Object.freeze({
    registry,
    loadout: weaponLoadouts[0],
    weaponLoadouts: Object.freeze(weaponLoadouts),
    weaponInstances: Object.freeze(weaponInstances),
    skillCardInstances: Object.freeze(skillCardInstances),
    supportCardInstances: Object.freeze(supportCardInstances),
  });
}
