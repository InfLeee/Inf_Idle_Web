export const DOMAIN_SCHEMA_VERSION = "domain-v2";
export const WEAPON_SKILL_SOCKET_COUNT = 5;
export const MAX_ROLLED_WEAPON_SKILLS = 5;
export const SKILL_SOURCE_TYPE = Object.freeze({
  SKILL_CARD: "skill_card",
  WEAPON_SKILL: "weapon_skill",
});

const INSTANCE_RELATION_FIELDS = Object.freeze([
  "weaponInstanceId",
  "loadoutId",
  "socketIndex",
  "skillSockets",
  "supportConnections",
  "supportSlots",
  "supportInsertionOrder",
  "supportCardInstanceIds",
  "masteryAllocation",
  "equipped",
]);

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(name + " must be an object");
  }
}

function assertId(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(name + " must be a non-empty string");
}

function assertInteger(value, name, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(name + " must be an integer greater than or equal to " + minimum);
  }
}

function assertFiniteNumber(value, name, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(name + " must be a finite number greater than or equal to " + minimum);
  }
}

function assertUniqueStrings(values, name, maximum = Infinity) {
  if (!Array.isArray(values)) throw new TypeError(name + " must be an array");
  if (values.length > maximum) throw new RangeError(name + " cannot contain more than " + maximum + " values");
  values.forEach((value, index) => assertId(value, name + "[" + index + "]"));
  if (new Set(values).size !== values.length) throw new Error(name + " cannot contain duplicate values");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function rejectInstanceRelations(input, kind) {
  for (const field of INSTANCE_RELATION_FIELDS) {
    if (Object.hasOwn(input, field)) {
      throw new Error(kind + " cannot own relation field " + field + "; WeaponLoadout is the relation source");
    }
  }
}

function indexById(definitions, kind) {
  if (!Array.isArray(definitions)) throw new TypeError(kind + " definitions must be an array");
  const entries = definitions.map((definition) => {
    assertId(definition.id, kind + ".id");
    return [definition.id, definition];
  });
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    throw new Error(kind + " definitions cannot contain duplicate ids");
  }
  return Object.freeze(Object.fromEntries(entries));
}

export function createWeaponDefinition(input) {
  assertRecord(input, "WeaponDefinition");
  assertId(input.id, "WeaponDefinition.id");
  assertId(input.name, "WeaponDefinition.name");
  assertId(input.weaponType, "WeaponDefinition.weaponType");
  assertId(input.masteryBoardDefinitionId, "WeaponDefinition.masteryBoardDefinitionId");
  assertFiniteNumber(input.baseAttackRangeM, "WeaponDefinition.baseAttackRangeM", 0);
  assertFiniteNumber(input.baseAttackIntervalMs, "WeaponDefinition.baseAttackIntervalMs", 1);
  const allowedSkillCardDefinitionIds = input.allowedSkillCardDefinitionIds ?? [];
  const weaponSkillPoolDefinitionIds = input.weaponSkillPoolDefinitionIds ?? [];
  assertUniqueStrings(allowedSkillCardDefinitionIds, "WeaponDefinition.allowedSkillCardDefinitionIds");
  assertUniqueStrings(weaponSkillPoolDefinitionIds, "WeaponDefinition.weaponSkillPoolDefinitionIds");
  return deepFreeze({
    kind: "WeaponDefinition",
    id: input.id,
    name: input.name,
    weaponType: input.weaponType,
    masteryBoardDefinitionId: input.masteryBoardDefinitionId,
    baseAttackRangeM: input.baseAttackRangeM,
    baseAttackIntervalMs: input.baseAttackIntervalMs,
    allowedSkillCardDefinitionIds: [...allowedSkillCardDefinitionIds],
    weaponSkillPoolDefinitionIds: [...weaponSkillPoolDefinitionIds],
  });
}

export function createSkillDefinition(input) {
  assertRecord(input, "SkillDefinition");
  assertId(input.id, "SkillDefinition.id");
  assertId(input.name, "SkillDefinition.name");
  if (!Object.values(SKILL_SOURCE_TYPE).includes(input.sourceType)) {
    throw new Error("SkillDefinition.sourceType must be skill_card or weapon_skill");
  }
  const allowedWeaponTypes = input.allowedWeaponTypes ?? [];
  const skillTags = input.skillTags ?? [];
  assertUniqueStrings(allowedWeaponTypes, "SkillDefinition.allowedWeaponTypes");
  assertUniqueStrings(skillTags, "SkillDefinition.skillTags");
  return deepFreeze({
    kind: "SkillDefinition",
    id: input.id,
    name: input.name,
    sourceType: input.sourceType,
    allowedWeaponTypes: [...allowedWeaponTypes],
    skillTags: [...skillTags],
  });
}

export function createSkillCardDefinition(input) {
  return createSkillDefinition({ ...input, sourceType: SKILL_SOURCE_TYPE.SKILL_CARD });
}

export function createWeaponSkillDefinition(input) {
  return createSkillDefinition({ ...input, sourceType: SKILL_SOURCE_TYPE.WEAPON_SKILL });
}

export function createSupportCardDefinition(input) {
  assertRecord(input, "SupportCardDefinition");
  assertId(input.id, "SupportCardDefinition.id");
  assertId(input.name, "SupportCardDefinition.name");
  return deepFreeze({ kind: "SupportCardDefinition", id: input.id, name: input.name });
}

export function createResourceDefinition(input) {
  assertRecord(input, "ResourceDefinition");
  assertId(input.id, "ResourceDefinition.id");
  assertId(input.name, "ResourceDefinition.name");
  assertId(input.weaponType, "ResourceDefinition.weaponType");
  assertId(input.unlockMasteryNodeDefinitionId, "ResourceDefinition.unlockMasteryNodeDefinitionId");
  assertFiniteNumber(input.minimum, "ResourceDefinition.minimum");
  assertFiniteNumber(input.maximum, "ResourceDefinition.maximum", input.minimum);
  assertFiniteNumber(input.initial, "ResourceDefinition.initial", input.minimum);
  if (input.initial > input.maximum) throw new RangeError("ResourceDefinition.initial cannot exceed maximum");
  return deepFreeze({
    kind: "ResourceDefinition",
    id: input.id,
    name: input.name,
    weaponType: input.weaponType,
    unlockMasteryNodeDefinitionId: input.unlockMasteryNodeDefinitionId,
    minimum: input.minimum,
    maximum: input.maximum,
    initial: input.initial,
  });
}
export function createMasteryBoardDefinition(input) {
  assertRecord(input, "MasteryBoardDefinition");
  assertId(input.id, "MasteryBoardDefinition.id");
  assertId(input.name, "MasteryBoardDefinition.name");
  assertId(input.weaponType, "MasteryBoardDefinition.weaponType");
  const nodeDefinitionIds = input.nodeDefinitionIds ?? [];
  const resourceDefinitionIds = input.resourceDefinitionIds ?? [];
  assertUniqueStrings(nodeDefinitionIds, "MasteryBoardDefinition.nodeDefinitionIds");
  assertUniqueStrings(resourceDefinitionIds, "MasteryBoardDefinition.resourceDefinitionIds");
  return deepFreeze({
    kind: "MasteryBoardDefinition",
    id: input.id,
    name: input.name,
    weaponType: input.weaponType,
    nodeDefinitionIds: [...nodeDefinitionIds],
    resourceDefinitionIds: [...resourceDefinitionIds],
  });
}

export function createDefinitionRegistry(input) {
  assertRecord(input, "DefinitionRegistry");
  const registry = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    weapons: indexById(input.weapons ?? [], "Weapon"),
    skills: indexById(input.skills ?? [], "SkillCard"),
    supports: indexById(input.supports ?? [], "SupportCard"),
    resources: indexById(input.resources ?? [], "Resource"),
    masteryBoards: indexById(input.masteryBoards ?? [], "MasteryBoard"),
  };
  const resourceOwnerById = new Map();
  for (const board of Object.values(registry.masteryBoards)) {
    for (const resourceId of board.resourceDefinitionIds) {
      const resource = registry.resources[resourceId];
      if (!resource) throw new Error("mastery board " + board.id + " references missing resource " + resourceId);
      if (resource.weaponType !== board.weaponType) throw new Error("resource and mastery board weaponType must match");
      if (!board.nodeDefinitionIds.includes(resource.unlockMasteryNodeDefinitionId)) {
        throw new Error("resource unlock node must belong to the weapon mastery board");
      }
      if (resourceOwnerById.has(resourceId)) throw new Error("resource can belong to only one weapon mastery board: " + resourceId);
      resourceOwnerById.set(resourceId, board.id);
    }
  }
  for (const resourceId of Object.keys(registry.resources)) {
    if (!resourceOwnerById.has(resourceId)) throw new Error("resource must belong to a weapon mastery board: " + resourceId);
  }
  for (const weapon of Object.values(registry.weapons)) {
    const board = registry.masteryBoards[weapon.masteryBoardDefinitionId];
    if (!board) throw new Error("weapon " + weapon.id + " references missing mastery board");
    if (board.weaponType !== weapon.weaponType) throw new Error("weapon and mastery board weaponType must match");
    for (const skillId of weapon.allowedSkillCardDefinitionIds) {
      const skill = registry.skills[skillId];
      if (!skill) throw new Error("weapon " + weapon.id + " references missing skill card " + skillId);
      if (skill.sourceType !== SKILL_SOURCE_TYPE.SKILL_CARD) {
        throw new Error("weapon allowed skill card pool can contain only skill_card definitions");
      }
    }
    for (const skillId of weapon.weaponSkillPoolDefinitionIds) {
      const skill = registry.skills[skillId];
      if (!skill) throw new Error("weapon " + weapon.id + " references missing weapon skill " + skillId);
      if (skill.sourceType !== SKILL_SOURCE_TYPE.WEAPON_SKILL) {
        throw new Error("weapon skill pool can contain only weapon_skill definitions");
      }
    }
  }
  return deepFreeze(registry);
}

export function createWeaponInstance(input) {
  assertRecord(input, "WeaponInstance");
  rejectInstanceRelations(input, "WeaponInstance");
  assertId(input.instanceId, "WeaponInstance.instanceId");
  assertId(input.definitionId, "WeaponInstance.definitionId");
  const rolledWeaponSkillDefinitionIds = input.rolledWeaponSkillDefinitionIds ?? [];
  assertUniqueStrings(
    rolledWeaponSkillDefinitionIds,
    "WeaponInstance.rolledWeaponSkillDefinitionIds",
    MAX_ROLLED_WEAPON_SKILLS,
  );
  return deepFreeze({
    kind: "WeaponInstance",
    instanceId: input.instanceId,
    definitionId: input.definitionId,
    rolledAffixes: clone(input.rolledAffixes ?? []),
    rolledWeaponSkillDefinitionIds: [...rolledWeaponSkillDefinitionIds],
  });
}

export function createSkillCardInstance(input) {
  assertRecord(input, "SkillCardInstance");
  rejectInstanceRelations(input, "SkillCardInstance");
  assertId(input.instanceId, "SkillCardInstance.instanceId");
  assertId(input.definitionId, "SkillCardInstance.definitionId");
  assertInteger(input.level ?? 1, "SkillCardInstance.level", 1);
  assertFiniteNumber(input.quality ?? 0, "SkillCardInstance.quality", 0);
  return deepFreeze({
    kind: "SkillCardInstance",
    instanceId: input.instanceId,
    definitionId: input.definitionId,
    level: input.level ?? 1,
    quality: input.quality ?? 0,
  });
}

export function createSupportCardInstance(input) {
  assertRecord(input, "SupportCardInstance");
  rejectInstanceRelations(input, "SupportCardInstance");
  assertId(input.instanceId, "SupportCardInstance.instanceId");
  assertId(input.definitionId, "SupportCardInstance.definitionId");
  assertInteger(input.level ?? 1, "SupportCardInstance.level", 1);
  assertFiniteNumber(input.quality ?? 0, "SupportCardInstance.quality", 0);
  return deepFreeze({
    kind: "SupportCardInstance",
    instanceId: input.instanceId,
    definitionId: input.definitionId,
    level: input.level ?? 1,
    quality: input.quality ?? 0,
  });
}

export function createMasteryAllocation(input) {
  assertRecord(input, "MasteryAllocation");
  assertId(input.boardDefinitionId, "MasteryAllocation.boardDefinitionId");
  const nodeRanks = input.nodeRanks ?? {};
  assertRecord(nodeRanks, "MasteryAllocation.nodeRanks");
  for (const [nodeId, rank] of Object.entries(nodeRanks)) {
    assertId(nodeId, "MasteryAllocation.nodeId");
    assertInteger(rank, "MasteryAllocation.nodeRanks." + nodeId, 1);
  }
  return deepFreeze({ boardDefinitionId: input.boardDefinitionId, nodeRanks: { ...nodeRanks } });
}

export function createWeaponLoadout(input) {
  assertRecord(input, "WeaponLoadout");
  assertId(input.weaponInstanceId, "WeaponLoadout.weaponInstanceId");
  const skillSockets = input.skillSockets ?? Array(WEAPON_SKILL_SOCKET_COUNT).fill(null);
  if (!Array.isArray(skillSockets) || skillSockets.length !== WEAPON_SKILL_SOCKET_COUNT) {
    throw new Error("WeaponLoadout.skillSockets must contain exactly " + WEAPON_SKILL_SOCKET_COUNT + " physical sockets");
  }
  skillSockets.forEach((instanceId, index) => {
    if (instanceId !== null) assertId(instanceId, "WeaponLoadout.skillSockets[" + index + "]");
  });
  const occupied = skillSockets.filter(Boolean);
  if (new Set(occupied).size !== occupied.length) throw new Error("a SkillCardInstance cannot occupy multiple sockets");

  let supportSlots;
  if (input.supportSlots !== undefined) {
    if (!Array.isArray(input.supportSlots) || input.supportSlots.length !== WEAPON_SKILL_SOCKET_COUNT) {
      throw new Error("WeaponLoadout.supportSlots must contain exactly " + WEAPON_SKILL_SOCKET_COUNT + " physical socket groups");
    }
    supportSlots = input.supportSlots.map((supportIds, index) => {
      assertUniqueStrings(supportIds, "WeaponLoadout.supportSlots[" + index + "]");
      return [...supportIds];
    });
  } else {
    const legacyConnections = input.supportConnections ?? {};
    assertRecord(legacyConnections, "WeaponLoadout.supportConnections");
    supportSlots = Array.from({ length: WEAPON_SKILL_SOCKET_COUNT }, () => []);
    for (const [skillCardInstanceId, supportIds] of Object.entries(legacyConnections)) {
      assertId(skillCardInstanceId, "WeaponLoadout.supportConnections key");
      assertUniqueStrings(supportIds, "WeaponLoadout.supportConnections." + skillCardInstanceId);
      const socketIndex = skillSockets.indexOf(skillCardInstanceId);
      if (socketIndex < 0) throw new Error("legacy support target must occupy a physical skill socket");
      supportSlots[socketIndex] = [...supportIds];
    }
  }

  const slottedSupportIds = supportSlots.flat();
  if (new Set(slottedSupportIds).size !== slottedSupportIds.length) {
    throw new Error("a SupportCardInstance cannot occupy multiple weapon support slots");
  }
  const supportInsertionOrder = input.supportInsertionOrder === undefined
    ? Object.fromEntries(slottedSupportIds.map((instanceId, index) => [instanceId, index]))
    : input.supportInsertionOrder;
  assertRecord(supportInsertionOrder, "WeaponLoadout.supportInsertionOrder");
  const insertionIds = Object.keys(supportInsertionOrder);
  if (new Set(Object.values(supportInsertionOrder)).size !== insertionIds.length) throw new Error("support insertion order values must be unique");
  for (const [instanceId, insertionOrder] of Object.entries(supportInsertionOrder)) {
    assertId(instanceId, "WeaponLoadout.supportInsertionOrder key");
    assertInteger(insertionOrder, "WeaponLoadout.supportInsertionOrder." + instanceId, 0);
  }
  if (slottedSupportIds.length !== insertionIds.length ||
      slottedSupportIds.some((instanceId) => !Object.hasOwn(supportInsertionOrder, instanceId))) {
    throw new Error("supportInsertionOrder must contain exactly the slotted support instances");
  }

  const supportConnections = {};
  supportSlots.forEach((supportIds, socketIndex) => {
    const skillInstanceId = skillSockets[socketIndex];
    if (skillInstanceId && supportIds.length) supportConnections[skillInstanceId] = [...supportIds];
  });
  return deepFreeze({
    kind: "WeaponLoadout",
    weaponInstanceId: input.weaponInstanceId,
    skillSockets: [...skillSockets],
    supportSlots: clone(supportSlots),
    supportConnections,
    supportInsertionOrder: { ...supportInsertionOrder },
    masteryAllocation: createMasteryAllocation(input.masteryAllocation),
  });
}
function issue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function mapInstances(instances, kind, issues, globalIds) {
  const map = {};
  for (const instance of instances ?? []) {
    if (map[instance.instanceId]) issues.push(issue("DUPLICATE_INSTANCE_ID", kind, instance.instanceId));
    if (globalIds.has(instance.instanceId)) {
      issues.push(issue("INSTANCE_ID_NOT_GLOBAL", kind, instance.instanceId));
    }
    globalIds.add(instance.instanceId);
    map[instance.instanceId] = instance;
  }
  return map;
}

export function validateWeaponLoadoutOwnership(input, options = {}) {
  assertRecord(input, "WeaponLoadoutOwnership");
  const issues = [];
  const globalIds = new Set();
  const weapons = mapInstances(input.weaponInstances, "weaponInstances", issues, globalIds);
  const skills = mapInstances(input.skillCardInstances, "skillCardInstances", issues, globalIds);
  const supports = mapInstances(input.supportCardInstances, "supportCardInstances", issues, globalIds);
  const loadout = input.loadout;
  const registry = input.registry;
  const weapon = weapons[loadout.weaponInstanceId];

  if (!weapon) {
    issues.push(issue("MISSING_WEAPON_INSTANCE", "weaponInstanceId", loadout.weaponInstanceId));
    return Object.freeze(issues);
  }
  const weaponDefinition = registry.weapons[weapon.definitionId];
  if (!weaponDefinition) issues.push(issue("MISSING_WEAPON_DEFINITION", "weapon.definitionId", weapon.definitionId));

  const occupiedSkillIds = loadout.skillSockets.filter(Boolean);
  if ((options.requireCombatReady ?? false) && occupiedSkillIds.length === 0) {
    issues.push(issue("NO_ACTIVE_SKILL_CARD", "skillSockets", "combat-ready loadout requires 1 to 5 skill cards"));
  }

  for (const [socketIndex, instanceId] of loadout.skillSockets.entries()) {
    if (instanceId === null) continue;
    const skill = skills[instanceId];
    if (!skill) {
      issues.push(issue("MISSING_SKILL_CARD_INSTANCE", "skillSockets[" + socketIndex + "]", instanceId));
      continue;
    }
    const definition = registry.skills[skill.definitionId];
    if (!definition) {
      issues.push(issue("MISSING_SKILL_DEFINITION", "skillSockets[" + socketIndex + "]", skill.definitionId));
      continue;
    }
    if (definition.sourceType !== SKILL_SOURCE_TYPE.SKILL_CARD) {
      issues.push(issue("SKILL_SOURCE_TYPE_MISMATCH", "skillSockets[" + socketIndex + "]", definition.id));
    }
    if (weaponDefinition && !weaponDefinition.allowedSkillCardDefinitionIds.includes(definition.id)) {
      issues.push(issue("SKILL_NOT_ALLOWED_BY_WEAPON", "skillSockets[" + socketIndex + "]", definition.id));
    }
    if (weaponDefinition && definition.allowedWeaponTypes.length &&
        !definition.allowedWeaponTypes.includes(weaponDefinition.weaponType)) {
      issues.push(issue("SKILL_WEAPON_TYPE_MISMATCH", "skillSockets[" + socketIndex + "]", definition.id));
    }
  }

  const slottedSupportIds = new Set();
  for (const [socketIndex, supportIds] of loadout.supportSlots.entries()) {
    if (Number.isInteger(options.maxSupportsPerSkill) && supportIds.length > options.maxSupportsPerSkill) {
      issues.push(issue("SUPPORT_LIMIT_EXCEEDED", "supportSlots[" + socketIndex + "]", String(supportIds.length)));
    }
    for (const supportId of supportIds) {
      if (!supports[supportId]) {
        issues.push(issue("MISSING_SUPPORT_CARD_INSTANCE", "supportSlots[" + socketIndex + "]", supportId));
      } else if (!registry.supports[supports[supportId].definitionId]) {
        issues.push(issue("MISSING_SUPPORT_DEFINITION", "supportSlots[" + socketIndex + "]", supports[supportId].definitionId));
      }
      if (slottedSupportIds.has(supportId)) {
        issues.push(issue("SUPPORT_INSTANCE_CONNECTED_TWICE", "supportSlots[" + socketIndex + "]", supportId));
      }
      slottedSupportIds.add(supportId);
    }
  }

  const supportInsertionOrder = loadout.supportInsertionOrder;
  if (!supportInsertionOrder || typeof supportInsertionOrder !== "object" || Array.isArray(supportInsertionOrder)) {
    issues.push(issue("MISSING_SUPPORT_INSERTION_ORDER", "supportInsertionOrder", "support insertion order is required"));
  } else {
    const insertionIds = Object.keys(supportInsertionOrder);
    const values = Object.values(supportInsertionOrder);
    if (new Set(values).size !== values.length || values.some((value) => !Number.isInteger(value) || value < 0)) {
      issues.push(issue("INVALID_SUPPORT_INSERTION_ORDER", "supportInsertionOrder", "orders must be unique non-negative integers"));
    }
    if (slottedSupportIds.size !== insertionIds.length ||
        [...slottedSupportIds].some((instanceId) => !Object.hasOwn(supportInsertionOrder, instanceId))) {
      issues.push(issue("SUPPORT_INSERTION_SET_MISMATCH", "supportInsertionOrder", "orders must match slotted support instances"));
    }
  }  if (weaponDefinition) {
    const allocation = loadout.masteryAllocation;
    if (allocation.boardDefinitionId !== weaponDefinition.masteryBoardDefinitionId) {
      issues.push(issue("MASTERY_BOARD_MISMATCH", "masteryAllocation.boardDefinitionId", allocation.boardDefinitionId));
    }
    const board = registry.masteryBoards[allocation.boardDefinitionId];
    for (const nodeId of Object.keys(allocation.nodeRanks)) {
      if (!board?.nodeDefinitionIds.includes(nodeId)) {
        issues.push(issue("UNKNOWN_MASTERY_NODE", "masteryAllocation.nodeRanks." + nodeId, nodeId));
      }
    }
  }

  for (const skillDefinitionId of weapon.rolledWeaponSkillDefinitionIds) {
    const definition = registry.skills[skillDefinitionId];
    if (!definition) {
      issues.push(issue("MISSING_ROLLED_WEAPON_SKILL", "weapon.rolledWeaponSkillDefinitionIds", skillDefinitionId));
      continue;
    }
    if (definition.sourceType !== SKILL_SOURCE_TYPE.WEAPON_SKILL) {
      issues.push(issue("ROLLED_SKILL_SOURCE_TYPE_MISMATCH", "weapon.rolledWeaponSkillDefinitionIds", skillDefinitionId));
    }
    if (weaponDefinition && !weaponDefinition.weaponSkillPoolDefinitionIds.includes(skillDefinitionId)) {
      issues.push(issue("ROLLED_SKILL_NOT_IN_WEAPON_POOL", "weapon.rolledWeaponSkillDefinitionIds", skillDefinitionId));
    }
  }
  return Object.freeze(issues);
}

export function assertValidWeaponLoadoutOwnership(input, options = {}) {
  const issues = validateWeaponLoadoutOwnership(input, options);
  if (issues.length) {
    const error = new Error("WeaponLoadout ownership validation failed with " + issues.length + " issue(s)");
    error.issues = issues;
    throw error;
  }
  return input.loadout;
}

export function createCharacterBuild(input) {
  assertRecord(input, "CharacterBuild");
  if (input.equippedWeaponInstanceId !== null) {
    assertId(input.equippedWeaponInstanceId, "CharacterBuild.equippedWeaponInstanceId");
  }
  const weaponLoadouts = input.weaponLoadouts ?? [];
  if (!Array.isArray(weaponLoadouts)) throw new TypeError("CharacterBuild.weaponLoadouts must be an array");
  const weaponIds = weaponLoadouts.map((loadout) => loadout.weaponInstanceId);
  if (new Set(weaponIds).size !== weaponIds.length) throw new Error("each WeaponInstance can own only one WeaponLoadout");
  if (input.equippedWeaponInstanceId !== null && !weaponIds.includes(input.equippedWeaponInstanceId)) {
    throw new Error("equipped weapon must have a WeaponLoadout");
  }
  return deepFreeze({
    kind: "CharacterBuild",
    equippedWeaponInstanceId: input.equippedWeaponInstanceId,
    weaponLoadouts: [...weaponLoadouts],
  });
}
