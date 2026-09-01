import {
  assertValidWeaponLoadoutOwnership,
  createCharacterBuild,
  createMasteryAllocation,
  createSkillCardInstance,
  createSupportCardInstance,
  createWeaponInstance,
  createWeaponLoadout,
} from "../../game-domain/src/model.js";

export const LOCAL_SAVE_KIND = "InfIdleLocalSaveV0";
export const LOCAL_SAVE_VERSION = 2;

const TOP_LEVEL_FIELDS = Object.freeze([
  "kind", "saveVersion", "configVersion", "inventory", "equippedWeaponInstanceId",
  "weaponInstances", "skillCardInstances", "supportCardInstances", "weaponLoadouts", "autoPolicy",
]);

export class LocalSaveError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LocalSaveError";
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function fail(code, message, details) {
  throw new LocalSaveError(code, message, details);
}

function assertRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SAVE_SHAPE", path + " must be an object", { path });
  }
}

function assertExactFields(value, fields, path) {
  assertRecord(value, path);
  const allowed = new Set(fields);
  const unexpected = Object.keys(value).filter((field) => !allowed.has(field));
  if (unexpected.length) fail("UNEXPECTED_SAVE_FIELD", path + " contains unexpected fields", { path, fields: unexpected });
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (missing.length) fail("MISSING_SAVE_FIELD", path + " is missing required fields", { path, fields: missing });
}

function assertArray(value, path) {
  if (!Array.isArray(value)) fail("INVALID_SAVE_SHAPE", path + " must be an array", { path });
}

function assertUniqueStrings(value, path) {
  assertArray(value, path);
  if (value.some((item) => typeof item !== "string" || item.length === 0) || new Set(value).size !== value.length) {
    fail("INVALID_INVENTORY_INDEX", path + " must contain unique non-empty strings", { path });
  }
}

function assertSameIds(indexedIds, instances, path) {
  const indexed = [...indexedIds].sort();
  const actual = instances.map((item) => item.instanceId).sort();
  if (indexed.length !== actual.length || indexed.some((id, index) => id !== actual[index])) {
    fail("INVENTORY_INDEX_MISMATCH", path + " does not match stored instances", { path });
  }
}

function normalizeInventory(value) {
  assertExactFields(value, ["weaponInstanceIds", "skillCardInstanceIds", "supportCardInstanceIds"], "inventory");
  assertUniqueStrings(value.weaponInstanceIds, "inventory.weaponInstanceIds");
  assertUniqueStrings(value.skillCardInstanceIds, "inventory.skillCardInstanceIds");
  assertUniqueStrings(value.supportCardInstanceIds, "inventory.supportCardInstanceIds");
  return deepFreeze({
    weaponInstanceIds: [...value.weaponInstanceIds],
    skillCardInstanceIds: [...value.skillCardInstanceIds],
    supportCardInstanceIds: [...value.supportCardInstanceIds],
  });
}

function normalizeAutoPolicy(value) {
  assertExactFields(value, ["priorityLayers", "description"], "autoPolicy");
  assertUniqueStrings(value.priorityLayers, "autoPolicy.priorityLayers");
  if (typeof value.description !== "string") fail("INVALID_AUTO_POLICY", "autoPolicy.description must be a string");
  return deepFreeze({ priorityLayers: [...value.priorityLayers], description: value.description });
}

function normalizeWeaponInstance(value, index) {
  assertExactFields(value, ["kind", "instanceId", "definitionId", "rolledAffixes", "rolledWeaponSkillDefinitionIds", "skillCardSocketCount", "supportSocketsPerSkill"], "weaponInstances[" + index + "]");
  if (value.kind !== "WeaponInstance") fail("INSTANCE_KIND_MISMATCH", "weapon instance kind is invalid", { index });
  return createWeaponInstance(value);
}

function normalizeSkillInstance(value, index) {
  assertExactFields(value, ["kind", "instanceId", "definitionId", "level", "quality"], "skillCardInstances[" + index + "]");
  if (value.kind !== "SkillCardInstance") fail("INSTANCE_KIND_MISMATCH", "skill instance kind is invalid", { index });
  return createSkillCardInstance(value);
}

function normalizeSupportInstance(value, index) {
  assertExactFields(value, ["kind", "instanceId", "definitionId", "level", "quality"], "supportCardInstances[" + index + "]");
  if (value.kind !== "SupportCardInstance") fail("INSTANCE_KIND_MISMATCH", "support instance kind is invalid", { index });
  return createSupportCardInstance(value);
}

function normalizeLoadout(value, index) {
  assertExactFields(value, [
    "kind", "weaponInstanceId", "skillSockets", "supportSlots", "supportConnections",
    "supportInsertionOrder", "masteryAllocation",
  ], "weaponLoadouts[" + index + "]");
  if (value.kind !== "WeaponLoadout") fail("INSTANCE_KIND_MISMATCH", "loadout kind is invalid", { index });
  return createWeaponLoadout({ ...value, masteryAllocation: createMasteryAllocation(value.masteryAllocation) });
}

function parseRawSave(serializedOrObject) {
  if (typeof serializedOrObject !== "string") return structuredClone(serializedOrObject);
  try {
    return JSON.parse(serializedOrObject);
  } catch (error) {
    fail("INVALID_SAVE_JSON", "local save is not valid JSON", { message: error.message });
  }
}

export function createLocalSaveV0({ configVersion, snapshot, autoPolicy }) {
  if (typeof configVersion !== "string" || configVersion.length === 0) throw new TypeError("configVersion must be a non-empty string");
  assertRecord(snapshot, "snapshot");
  const ownership = snapshot.ownershipInput;
  assertRecord(ownership, "snapshot.ownershipInput");
  const weaponLoadouts = snapshot.characterBuild?.weaponLoadouts ?? [ownership.loadout];
  return deepFreeze({
    kind: LOCAL_SAVE_KIND,
    saveVersion: LOCAL_SAVE_VERSION,
    configVersion,
    inventory: {
      weaponInstanceIds: ownership.weaponInstances.map((item) => item.instanceId),
      skillCardInstanceIds: ownership.skillCardInstances.map((item) => item.instanceId),
      supportCardInstanceIds: ownership.supportCardInstances.map((item) => item.instanceId),
    },
    equippedWeaponInstanceId: snapshot.characterBuild?.equippedWeaponInstanceId ?? null,
    weaponInstances: structuredClone(ownership.weaponInstances),
    skillCardInstances: structuredClone(ownership.skillCardInstances),
    supportCardInstances: structuredClone(ownership.supportCardInstances),
    weaponLoadouts: structuredClone(weaponLoadouts),
    autoPolicy: structuredClone(autoPolicy),
  });
}

export function serializeLocalSaveV0(input) {
  return JSON.stringify(input);
}

export function restoreLocalSaveV0(serializedOrObject, options) {
  const { configVersion, registry, maxSupportsPerSkill } = options ?? {};
  if (typeof configVersion !== "string" || !registry) throw new TypeError("configVersion and registry are required");
  const raw = parseRawSave(serializedOrObject);
  assertExactFields(raw, TOP_LEVEL_FIELDS, "save");
  if (raw.kind !== LOCAL_SAVE_KIND) fail("SAVE_KIND_MISMATCH", "local save kind is not supported");
  if (raw.saveVersion !== LOCAL_SAVE_VERSION) {
    fail("SAVE_VERSION_UNSUPPORTED", "local save version is not supported", { actual: raw.saveVersion, expected: LOCAL_SAVE_VERSION });
  }
  if (raw.configVersion !== configVersion) {
    fail("CONFIG_VERSION_MISMATCH", "local save was created for another config version", { actual: raw.configVersion, expected: configVersion });
  }

  const inventory = normalizeInventory(raw.inventory);
  assertArray(raw.weaponInstances, "weaponInstances");
  assertArray(raw.skillCardInstances, "skillCardInstances");
  assertArray(raw.supportCardInstances, "supportCardInstances");
  assertArray(raw.weaponLoadouts, "weaponLoadouts");
  const weaponInstances = raw.weaponInstances.map(normalizeWeaponInstance);
  const skillCardInstances = raw.skillCardInstances.map(normalizeSkillInstance);
  const supportCardInstances = raw.supportCardInstances.map(normalizeSupportInstance);
  const weaponLoadouts = raw.weaponLoadouts.map(normalizeLoadout);
  assertSameIds(inventory.weaponInstanceIds, weaponInstances, "inventory.weaponInstanceIds");
  assertSameIds(inventory.skillCardInstanceIds, skillCardInstances, "inventory.skillCardInstanceIds");
  assertSameIds(inventory.supportCardInstanceIds, supportCardInstances, "inventory.supportCardInstanceIds");

  let characterBuild;
  try {
    characterBuild = createCharacterBuild({ equippedWeaponInstanceId: raw.equippedWeaponInstanceId, weaponLoadouts });
  } catch (error) {
    fail("INVALID_CHARACTER_BUILD", error.message);
  }
  if (weaponLoadouts.length !== weaponInstances.length ||
      weaponInstances.some((weapon) => !weaponLoadouts.some((loadout) => loadout.weaponInstanceId === weapon.instanceId))) {
    fail("WEAPON_LOADOUT_SET_MISMATCH", "every stored weapon must own exactly one loadout");
  }

  const ownershipInputs = weaponLoadouts.map((loadout) => {
    const ownershipInput = { registry, weaponInstances, skillCardInstances, supportCardInstances, loadout };
    try {
      assertValidWeaponLoadoutOwnership(ownershipInput, { maxSupportsPerSkill });
    } catch (error) {
      fail("INVALID_SAVED_OWNERSHIP", error.message, { issues: error.issues ?? [] });
    }
    return deepFreeze(ownershipInput);
  });
  const primaryOwnershipInput = ownershipInputs.find((item) => item.loadout.weaponInstanceId === raw.equippedWeaponInstanceId) ?? ownershipInputs[0];
  if (!primaryOwnershipInput) fail("EMPTY_WEAPON_LOADOUTS", "local save must contain at least one weapon loadout");
  return deepFreeze({
    inventory,
    characterBuild,
    ownershipInputs,
    primaryOwnershipInput,
    autoPolicy: normalizeAutoPolicy(raw.autoPolicy),
  });
}
