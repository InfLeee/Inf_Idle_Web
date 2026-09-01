import { stableHash } from "../../build-compiler/src/compileActionBuild.js";
import {
  PRIMARY_STAT_IDS,
  compileCharacterStats,
  nextPrimaryPointCost,
} from "../../character-stats/src/index.js";

export class CharacterProgressionCommandError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CharacterProgressionCommandError";
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

function validateCommand(command, allowedFields) {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new TypeError("CharacterProgressionCommand must be an object");
  const allowed = new Set(["requestId", "expectedVersion", ...allowedFields]);
  for (const field of Object.keys(command)) {
    if (!allowed.has(field)) {
      const authorityFields = new Set(["finalPrimary", "derived", "remainingPoints", "pointBudget", "characterStats", "level"]);
      throw new CharacterProgressionCommandError(
        authorityFields.has(field) ? "CLIENT_AUTHORITY_FIELD_REJECTED" : "UNEXPECTED_COMMAND_FIELD",
        `unexpected character progression command field ${field}`,
      );
    }
  }
  if (typeof command.requestId !== "string" || command.requestId.trim() === "") {
    throw new CharacterProgressionCommandError("INVALID_REQUEST_ID", "requestId must be a non-empty string");
  }
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
    throw new CharacterProgressionCommandError("INVALID_EXPECTED_VERSION", "expectedVersion must be a positive integer");
  }
}

export function createAuthoritativeCharacterProgressionService(options = {}) {
  const maxCommandResults = options.maxCommandResults ?? 1_024;
  if (!Number.isInteger(maxCommandResults) || maxCommandResults < 1) throw new RangeError("maxCommandResults must be a positive integer");
  let version = options.initialVersion ?? 1;
  let level = options.level ?? 1;
  let allocations = structuredClone(options.allocations ?? Object.fromEntries(PRIMARY_STAT_IDS.map((id) => [id, 1])));
  let bonuses = structuredClone(options.bonuses ?? {});
  const rules = structuredClone(options.rules ?? {});
  const commandResults = new Map();

  function compile() {
    return compileCharacterStats({
      level,
      allocations,
      rules,
      primaryBonuses: bonuses.primary,
      derivedBonuses: bonuses.derived,
      provenance: bonuses.provenance,
    });
  }

  function snapshot() {
    const characterStats = compile();
    return deepFreeze({
      kind: "AuthoritativeCharacterProgressionSnapshot",
      progressionVersion: version,
      progressionHash: stableHash({ progressionVersion: version, characterStats }),
      characterStats,
    });
  }

  function execute(kind, command, fields, mutate) {
    validateCommand(command, fields);
    const fingerprint = stableHash({ kind, ...command });
    const previous = commandResults.get(command.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new CharacterProgressionCommandError("PROGRESSION_REQUEST_ID_REUSED", "requestId was reused with different command content");
      }
      return previous.result;
    }
    if (command.expectedVersion !== version) {
      throw new CharacterProgressionCommandError("PROGRESSION_VERSION_CONFLICT", `progression version is ${version}, expected ${command.expectedVersion}`, {
        retryable: true,
        details: { actual: version, expected: command.expectedVersion },
      });
    }
    const next = mutate();
    const previousAllocations = allocations;
    allocations = next;
    try {
      compile();
    } catch (error) {
      allocations = previousAllocations;
      throw new CharacterProgressionCommandError("INVALID_STAT_ALLOCATION", error.message);
    }
    version += 1;
    const result = snapshot();
    commandResults.set(command.requestId, { fingerprint, result });
    while (commandResults.size > maxCommandResults) commandResults.delete(commandResults.keys().next().value);
    return result;
  }

  function allocate(command) {
    return execute("allocate", command, ["statId", "amount"], () => {
      if (!PRIMARY_STAT_IDS.includes(command.statId)) throw new CharacterProgressionCommandError("UNKNOWN_PRIMARY_STAT", `unknown primary stat ${command.statId}`);
      const amount = command.amount ?? 1;
      if (!Number.isInteger(amount) || amount < 1 || amount > 99) throw new CharacterProgressionCommandError("INVALID_ALLOCATION_AMOUNT", "amount must be between 1 and 99");
      const next = structuredClone(allocations);
      for (let count = 0; count < amount; count += 1) {
        if (nextPrimaryPointCost(next[command.statId], rules) === null) throw new CharacterProgressionCommandError("PRIMARY_STAT_CAP_REACHED", `${command.statId} reached its cap`);
        next[command.statId] += 1;
      }
      return next;
    });
  }

  function unallocate(command) {
    return execute("unallocate", command, ["statId", "amount"], () => {
      if (!PRIMARY_STAT_IDS.includes(command.statId)) throw new CharacterProgressionCommandError("UNKNOWN_PRIMARY_STAT", `unknown primary stat ${command.statId}`);
      const amount = command.amount ?? 1;
      if (!Number.isInteger(amount) || amount < 1 || amount > 99) throw new CharacterProgressionCommandError("INVALID_ALLOCATION_AMOUNT", "amount must be between 1 and 99");
      const next = structuredClone(allocations);
      if (next[command.statId] - amount < 1) throw new CharacterProgressionCommandError("PRIMARY_STAT_MINIMUM_REACHED", `${command.statId} reached its minimum`);
      next[command.statId] -= amount;
      return next;
    });
  }

  function reset(command) {
    return execute("reset", command, [], () => Object.fromEntries(PRIMARY_STAT_IDS.map((id) => [id, 1])));
  }

  function setAuthorityState(next = {}) {
    const previous = { level, allocations, bonuses };
    level = next.level ?? level;
    allocations = structuredClone(next.allocations ?? allocations);
    bonuses = structuredClone(next.bonuses ?? bonuses);
    try {
      compile();
    } catch (error) {
      ({ level, allocations, bonuses } = previous);
      throw error;
    }
    version += 1;
    return snapshot();
  }

  compile();
  return Object.freeze({ snapshot, allocate, unallocate, reset, setAuthorityState });
}
