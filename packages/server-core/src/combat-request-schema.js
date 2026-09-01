export const COMBAT_COMMAND = Object.freeze({
  START: "start_combat",
  ADVANCE: "advance_combat",
  CLAIM: "claim_combat",
});

export class CombatGatewayError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CombatGatewayError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = Object.freeze(structuredClone(options.details ?? {}));
  }
}

const CLIENT_FORBIDDEN_FIELDS = Object.freeze(new Set([
  "buildHash",
  "compiledBuild",
  "damage",
  "damageEvents",
  "dropIds",
  "drops",
  "enemyHp",
  "encounterState",
  "events",
  "experience",
  "finalState",
  "loot",
  "monsterState",
  "monsterDefinitions",
  "monsters",
  "playerHp",
  "playerState",
  "reward",
  "rewards",
  "rngSeed",
  "reviveAtMs",
  "spawnEvents",
  "targetMonsterIds",
  "rolledWeaponSkillDefinitionIds",
]));

const SCHEMAS = Object.freeze({
  [COMBAT_COMMAND.START]: Object.freeze({
    required: Object.freeze(["requestId", "characterId", "expectedLoadoutVersion", "encounterDefinitionId"]),
    allowed: Object.freeze(new Set(["requestId", "characterId", "expectedLoadoutVersion", "encounterDefinitionId"])),
  }),
  [COMBAT_COMMAND.ADVANCE]: Object.freeze({
    required: Object.freeze(["requestId", "characterId", "combatSessionId", "expectedRevision"]),
    allowed: Object.freeze(new Set(["requestId", "characterId", "combatSessionId", "expectedRevision"])),
  }),
  [COMBAT_COMMAND.CLAIM]: Object.freeze({
    required: Object.freeze(["requestId", "characterId", "combatSessionId", "expectedRevision"]),
    allowed: Object.freeze(new Set(["requestId", "characterId", "combatSessionId", "expectedRevision"])),
  }),
});

function assertRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CombatGatewayError("INVALID_REQUEST", "combat request must be an object");
  }
}

function assertId(value, field) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128) {
    throw new CombatGatewayError("INVALID_REQUEST_FIELD", `${field} must be a non-empty string of at most 128 characters`, { details: { field } });
  }
}

function assertVersion(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new CombatGatewayError("INVALID_REQUEST_FIELD", `${field} must be a non-negative safe integer`, { details: { field } });
  }
}

export function validateCombatCommand(command, request) {
  const schema = SCHEMAS[command];
  if (!schema) throw new CombatGatewayError("UNKNOWN_COMBAT_COMMAND", `unknown combat command ${command}`);
  assertRecord(request);
  for (const field of Object.keys(request)) {
    if (CLIENT_FORBIDDEN_FIELDS.has(field)) {
      throw new CombatGatewayError("CLIENT_AUTHORITY_FIELD_REJECTED", `client cannot submit authoritative field ${field}`, { details: { field } });
    }
    if (!schema.allowed.has(field)) {
      throw new CombatGatewayError("UNEXPECTED_REQUEST_FIELD", `unexpected combat request field ${field}`, { details: { field } });
    }
  }
  for (const field of schema.required) {
    if (!Object.hasOwn(request, field)) {
      throw new CombatGatewayError("MISSING_REQUEST_FIELD", `missing combat request field ${field}`, { details: { field } });
    }
  }
  assertId(request.requestId, "requestId");
  assertId(request.characterId, "characterId");
  if (command === COMBAT_COMMAND.START) {
    assertVersion(request.expectedLoadoutVersion, "expectedLoadoutVersion");
    assertId(request.encounterDefinitionId, "encounterDefinitionId");
  } else {
    assertId(request.combatSessionId, "combatSessionId");
    assertVersion(request.expectedRevision, "expectedRevision");
  }
  return Object.freeze(structuredClone(request));
}
