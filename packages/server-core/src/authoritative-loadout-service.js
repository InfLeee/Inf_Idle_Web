import { compileActionBuild, stableHash } from "../../build-compiler/src/compileActionBuild.js";
import {
  assertValidWeaponLoadoutOwnership,
  createCharacterBuild,
  createMasteryAllocation,
  createWeaponLoadout,
} from "../../game-domain/src/model.js";
import { assembleTwoHandedSwordA1CompileInput } from "./two-handed-sword-authority-assembler.js";

export class LoadoutCommandError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "LoadoutCommandError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = Object.freeze(structuredClone(options.details ?? {}));
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function validateCommand(command, allowedFields) {
  assertRecord(command, "LoadoutCommand");
  const allowed = new Set(["requestId", "expectedVersion", ...allowedFields]);
  for (const field of Object.keys(command)) {
    if (!allowed.has(field)) throw new LoadoutCommandError("UNEXPECTED_COMMAND_FIELD", `unexpected loadout command field ${field}`);
  }
  if (typeof command.requestId !== "string" || command.requestId.trim() === "") {
    throw new LoadoutCommandError("INVALID_REQUEST_ID", "requestId must be a non-empty string");
  }
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
    throw new LoadoutCommandError("INVALID_EXPECTED_VERSION", "expectedVersion must be a positive integer");
  }
}

function cloneOwnership(base, loadout) {
  return {
    registry: base.registry,
    weaponInstances: base.weaponInstances,
    skillCardInstances: base.skillCardInstances,
    supportCardInstances: base.supportCardInstances,
    loadout,
  };
}

export function createAuthoritativeLoadoutService(options) {
  const { config, ownershipInput } = options ?? {};
  if (!config || !ownershipInput) throw new TypeError("config and ownershipInput are required");
  const maxSupportsPerSkill = options.maxSupportsPerSkill ?? config.supports.length;
  const maxCommandResults = options.maxCommandResults ?? 1_024;
  if (!Number.isInteger(maxCommandResults) || maxCommandResults < 1) throw new RangeError("maxCommandResults must be a positive integer");
  if (!Number.isInteger(options.initialVersion ?? 1) || (options.initialVersion ?? 1) < 1) {
    throw new RangeError("initialVersion must be a positive integer");
  }
  const commandResults = new Map();
  let version = options.initialVersion ?? 1;
  let currentOwnership = ownershipInput;
  let equippedWeaponInstanceId = options.equippedWeaponInstanceId ?? ownershipInput.loadout.weaponInstanceId;
  let currentCompileInput;
  let currentBuild;

  function rebuild(nextOwnership) {
    assertValidWeaponLoadoutOwnership(nextOwnership, { maxSupportsPerSkill });
    const combatReady = nextOwnership.loadout.skillSockets.some(Boolean);
    const compileInput = combatReady
      ? assembleTwoHandedSwordA1CompileInput(config, nextOwnership, { maxSupportsPerSkill })
      : null;
    const compiledBuild = compileInput ? compileActionBuild(compileInput) : null;
    return { combatReady, compileInput, compiledBuild };
  }

  function snapshot() {
    const characterBuild = createCharacterBuild({
      equippedWeaponInstanceId,
      weaponLoadouts: [currentOwnership.loadout],
    });
    return deepFreeze({
      kind: "AuthoritativeLoadoutSnapshot",
      loadoutVersion: version,
      combatReady: equippedWeaponInstanceId !== null && currentOwnership.loadout.skillSockets.some(Boolean),
      characterBuild,
      ownershipInput: structuredClone(currentOwnership),
      compileInput: currentCompileInput ? structuredClone(currentCompileInput) : null,
      compiledBuild: currentBuild,
    });
  }

  function execute(kind, command, allowedFields, mutate) {
    validateCommand(command, allowedFields);
    const fingerprint = stableHash({ kind, ...command });
    const previous = commandResults.get(command.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new LoadoutCommandError("LOADOUT_REQUEST_ID_REUSED", "requestId was reused with different command content");
      }
      return previous.result;
    }
    if (command.expectedVersion !== version) {
      throw new LoadoutCommandError("LOADOUT_VERSION_CONFLICT", `loadout version is ${version}, expected ${command.expectedVersion}`, {
        retryable: true,
        details: { actual: version, expected: command.expectedVersion },
      });
    }
    const mutation = mutate(currentOwnership.loadout);
    const nextLoadout = mutation?.loadout ?? mutation;
    const nextEquippedWeaponInstanceId = mutation && Object.hasOwn(mutation, "equippedWeaponInstanceId")
      ? mutation.equippedWeaponInstanceId
      : equippedWeaponInstanceId;
    const nextOwnership = cloneOwnership(currentOwnership, nextLoadout);
    let rebuilt;
    try {
      rebuilt = nextEquippedWeaponInstanceId === null
        ? { combatReady: false, compileInput: null, compiledBuild: null }
        : rebuild(nextOwnership);
    } catch (error) {
      throw new LoadoutCommandError("INVALID_LOADOUT_COMMAND", error.message, {
        details: { issueCodes: error.issues?.map((item) => item.code) ?? [] },
      });
    }
    currentOwnership = nextOwnership;
    equippedWeaponInstanceId = nextEquippedWeaponInstanceId;
    currentCompileInput = rebuilt.compileInput;
    currentBuild = rebuilt.compiledBuild;
    version += 1;
    const result = snapshot();
    commandResults.set(command.requestId, { fingerprint, result });
    while (commandResults.size > maxCommandResults) commandResults.delete(commandResults.keys().next().value);
    return result;
  }

  function loadoutWith(loadout, changes) {
    return createWeaponLoadout({
      weaponInstanceId: loadout.weaponInstanceId,
      skillSockets: changes.skillSockets ?? loadout.skillSockets,
      supportConnections: changes.supportConnections ?? loadout.supportConnections,
      supportInsertionOrder: changes.supportInsertionOrder ?? loadout.supportInsertionOrder,
      masteryAllocation: changes.masteryAllocation ?? loadout.masteryAllocation,
    });
  }

  function equipSkill(command) {
    return execute("equip_skill", command, ["skillInstanceId", "socketIndex"], (loadout) => {
      if (!Number.isInteger(command.socketIndex) || command.socketIndex < 0 || command.socketIndex >= 5) {
        throw new LoadoutCommandError("INVALID_SOCKET_INDEX", "socketIndex must be between 0 and 4");
      }
      if (!currentOwnership.skillCardInstances.some((item) => item.instanceId === command.skillInstanceId)) {
        throw new LoadoutCommandError("SKILL_INSTANCE_NOT_OWNED", "skill card instance is not owned");
      }
      const skillSockets = [...loadout.skillSockets];
      const previousIndex = skillSockets.indexOf(command.skillInstanceId);
      if (previousIndex >= 0) skillSockets[previousIndex] = null;
      const displaced = skillSockets[command.socketIndex];
      skillSockets[command.socketIndex] = command.skillInstanceId;
      const supportConnections = structuredClone(loadout.supportConnections);
      const supportInsertionOrder = structuredClone(loadout.supportInsertionOrder);
      if (displaced && displaced !== command.skillInstanceId) {
        for (const supportId of supportConnections[displaced] ?? []) delete supportInsertionOrder[supportId];
        delete supportConnections[displaced];
      }
      return loadoutWith(loadout, { skillSockets, supportConnections, supportInsertionOrder });
    });
  }

  function unequipSkill(command) {
    return execute("unequip_skill", command, ["socketIndex"], (loadout) => {
      if (!Number.isInteger(command.socketIndex) || command.socketIndex < 0 || command.socketIndex >= 5) {
        throw new LoadoutCommandError("INVALID_SOCKET_INDEX", "socketIndex must be between 0 and 4");
      }
      const skillSockets = [...loadout.skillSockets];
      const removed = skillSockets[command.socketIndex];
      skillSockets[command.socketIndex] = null;
      const supportConnections = structuredClone(loadout.supportConnections);
      const supportInsertionOrder = structuredClone(loadout.supportInsertionOrder);
      if (removed) {
        for (const supportId of supportConnections[removed] ?? []) delete supportInsertionOrder[supportId];
        delete supportConnections[removed];
      }
      return loadoutWith(loadout, { skillSockets, supportConnections, supportInsertionOrder });
    });
  }

  function setSupport(command) {
    return execute("set_support", command, ["skillInstanceId", "supportInstanceId", "enabled"], (loadout) => {
      if (!loadout.skillSockets.includes(command.skillInstanceId)) {
        throw new LoadoutCommandError("SUPPORT_TARGET_NOT_SOCKETED", "support target must be socketed");
      }
      if (!currentOwnership.supportCardInstances.some((item) => item.instanceId === command.supportInstanceId)) {
        throw new LoadoutCommandError("SUPPORT_INSTANCE_NOT_OWNED", "support card instance is not owned");
      }
      if (typeof command.enabled !== "boolean") throw new LoadoutCommandError("INVALID_SUPPORT_STATE", "enabled must be boolean");
      const supportConnections = structuredClone(loadout.supportConnections);
      const supportInsertionOrder = structuredClone(loadout.supportInsertionOrder);
      delete supportInsertionOrder[command.supportInstanceId];
      for (const [skillId, supportIds] of Object.entries(supportConnections)) {
        supportConnections[skillId] = supportIds.filter((id) => id !== command.supportInstanceId);
        if (supportConnections[skillId].length === 0) delete supportConnections[skillId];
      }
      if (command.enabled) {
        const attached = supportConnections[command.skillInstanceId] ?? [];
        if (attached.length >= maxSupportsPerSkill) {
          throw new LoadoutCommandError("SUPPORT_LIMIT_EXCEEDED", `a skill can contain at most ${maxSupportsPerSkill} supports`);
        }
        supportConnections[command.skillInstanceId] = [...attached, command.supportInstanceId];
        const previousOrders = Object.values(supportInsertionOrder);
        supportInsertionOrder[command.supportInstanceId] = previousOrders.length ? Math.max(...previousOrders) + 1 : 0;
      }
      return loadoutWith(loadout, { supportConnections, supportInsertionOrder });
    });
  }

  function setMasterySelection(command) {
    return execute("set_mastery_selection", command, ["nodeIds"], (loadout) => {
      if (!Array.isArray(command.nodeIds) || new Set(command.nodeIds).size !== command.nodeIds.length) {
        throw new LoadoutCommandError("INVALID_MASTERY_SELECTION", "nodeIds must be a unique array");
      }
      const masteryAllocation = createMasteryAllocation({
        boardDefinitionId: loadout.masteryAllocation.boardDefinitionId,
        nodeRanks: Object.fromEntries(command.nodeIds.map((nodeId) => [nodeId, 1])),
      });
      return loadoutWith(loadout, { masteryAllocation });
    });
  }

  function equipWeapon(command) {
    return execute("equip_weapon", command, ["weaponInstanceId"], (loadout) => {
      if (!currentOwnership.weaponInstances.some((item) => item.instanceId === command.weaponInstanceId)) {
        throw new LoadoutCommandError("WEAPON_INSTANCE_NOT_OWNED", "weapon instance is not owned");
      }
      if (command.weaponInstanceId !== loadout.weaponInstanceId) {
        throw new LoadoutCommandError("WEAPON_LOADOUT_NOT_FOUND", "weapon instance has no loadout");
      }
      return { loadout, equippedWeaponInstanceId: command.weaponInstanceId };
    });
  }

  function unequipWeapon(command) {
    return execute("unequip_weapon", command, [], (loadout) => ({
      loadout,
      equippedWeaponInstanceId: null,
    }));
  }

  const initial = equippedWeaponInstanceId === null
    ? { compileInput: null, compiledBuild: null }
    : rebuild(currentOwnership);
  currentCompileInput = initial.compileInput;
  currentBuild = initial.compiledBuild;
  const stats = () => Object.freeze({ idempotencyEntries: commandResults.size, maxCommandResults });
  return Object.freeze({ snapshot, stats, equipWeapon, unequipWeapon, equipSkill, unequipSkill, setSupport, setMasterySelection });
}
