import { stableHash } from "../../build-compiler/src/compileActionBuild.js";

export const PARTY_V0 = "PartySnapshotV0";
export const PARTY_MAX_MEMBERS = 4;
export const PARTY_ROLES = Object.freeze(["TANK", "HEALER", "DPS"]);

export class PartyCommandError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "PartyCommandError";
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
function normalizeBuildRef(buildRef) {
  if (!buildRef) return null;
  if (typeof buildRef !== "object" || Array.isArray(buildRef)) throw new TypeError("buildRef must be an object");
  if (!Number.isInteger(buildRef.loadoutVersion) || buildRef.loadoutVersion < 1) throw new TypeError("buildRef.loadoutVersion must be positive");
  if (typeof buildRef.buildHash !== "string" || buildRef.buildHash.length < 8) throw new TypeError("buildRef.buildHash is invalid");
  return { loadoutVersion: buildRef.loadoutVersion, buildHash: buildRef.buildHash };
}
function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") throw new TypeError("party profile must be an object");
  for (const field of ["characterId", "accountId", "displayName"]) {
    if (typeof profile[field] !== "string" || !profile[field]) throw new TypeError(`${field} must be a non-empty string`);
  }
  return {
    characterId: profile.characterId,
    accountId: profile.accountId,
    displayName: profile.displayName,
    level: Number.isInteger(profile.level) && profile.level > 0 ? profile.level : 1,
    buildRef: normalizeBuildRef(profile.buildRef),
  };
}
function validateCommand(command, allowedFields) {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new TypeError("PartyCommand must be an object");
  const allowed = new Set(["requestId", "expectedVersion", "actorCharacterId", ...allowedFields]);
  for (const field of Object.keys(command)) {
    if (!allowed.has(field)) {
      const authorityFields = new Set(["members", "partyHash", "buildRef", "buildHash", "loadoutVersion", "leaderCharacterId"]);
      throw new PartyCommandError(authorityFields.has(field) ? "CLIENT_AUTHORITY_FIELD_REJECTED" : "UNEXPECTED_COMMAND_FIELD", `unexpected party command field ${field}`);
    }
  }
  if (typeof command.requestId !== "string" || !command.requestId) throw new PartyCommandError("INVALID_REQUEST_ID", "requestId must be a non-empty string");
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) throw new PartyCommandError("INVALID_EXPECTED_VERSION", "expectedVersion must be positive");
  if (typeof command.actorCharacterId !== "string" || !command.actorCharacterId) throw new PartyCommandError("INVALID_ACTOR", "actorCharacterId must be a non-empty string");
}

export function createAuthoritativePartyService(options = {}) {
  const profiles = new Map((options.profiles ?? []).map((profile) => {
    const normalized = normalizeProfile(profile);
    return [normalized.characterId, normalized];
  }));
  const leaderCharacterId = options.leaderCharacterId;
  if (!profiles.has(leaderCharacterId)) throw new TypeError("leaderCharacterId must resolve to a server profile");
  const maxCommandResults = options.maxCommandResults ?? 256;
  let version = options.initialVersion ?? 1;
  let members = [{ characterId: leaderCharacterId, role: options.leaderRole ?? "DPS", ready: false }];
  const commandResults = new Map();

  function assertRole(role) {
    if (!PARTY_ROLES.includes(role)) throw new PartyCommandError("UNKNOWN_PARTY_ROLE", `unknown party role ${role}`);
  }
  assertRole(members[0].role);

  function snapshot() {
    const projectedMembers = members.map((member, index) => {
      const profile = profiles.get(member.characterId);
      return {
        slot: index + 1,
        characterId: member.characterId,
        displayName: profile.displayName,
        level: profile.level,
        role: member.role,
        ready: member.ready,
        isLeader: member.characterId === leaderCharacterId,
        buildRef: profile.buildRef,
      };
    });
    const core = { kind: PARTY_V0, partyVersion: version, capacity: PARTY_MAX_MEMBERS, leaderCharacterId, members: projectedMembers };
    return deepFreeze({ ...core, partyHash: stableHash(core) });
  }
  function execute(kind, command, fields, mutate) {
    validateCommand(command, fields);
    const fingerprint = stableHash({ kind, ...command });
    const cached = commandResults.get(command.requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) throw new PartyCommandError("PARTY_REQUEST_ID_REUSED", "requestId was reused with different command content");
      return cached.result;
    }
    if (command.expectedVersion !== version) throw new PartyCommandError("PARTY_VERSION_CONFLICT", `party version is ${version}`, { retryable: true, details: { actual: version } });
    if (!members.some((member) => member.characterId === command.actorCharacterId)) throw new PartyCommandError("ACTOR_NOT_IN_PARTY", "actor is not a party member");
    mutate();
    version += 1;
    const result = snapshot();
    commandResults.set(command.requestId, { fingerprint, result });
    while (commandResults.size > maxCommandResults) commandResults.delete(commandResults.keys().next().value);
    return result;
  }
  function addMember(command) {
    return execute("addMember", command, ["characterId", "role"], () => {
      if (command.actorCharacterId !== leaderCharacterId) throw new PartyCommandError("LEADER_ONLY", "only the leader can add members");
      if (members.length >= PARTY_MAX_MEMBERS) throw new PartyCommandError("PARTY_FULL", "party already has four members");
      if (!profiles.has(command.characterId)) throw new PartyCommandError("UNKNOWN_CHARACTER", "character is not available to the party server");
      if (members.some((member) => member.characterId === command.characterId)) throw new PartyCommandError("MEMBER_ALREADY_JOINED", "character already joined");
      assertRole(command.role);
      members.push({ characterId: command.characterId, role: command.role, ready: false });
    });
  }
  function removeMember(command) {
    return execute("removeMember", command, ["characterId"], () => {
      if (command.actorCharacterId !== leaderCharacterId && command.actorCharacterId !== command.characterId) throw new PartyCommandError("REMOVE_NOT_ALLOWED", "only leader or self can remove this member");
      if (command.characterId === leaderCharacterId) throw new PartyCommandError("LEADER_CANNOT_BE_REMOVED", "Party V0 does not transfer leadership");
      if (!members.some((member) => member.characterId === command.characterId)) throw new PartyCommandError("MEMBER_NOT_FOUND", "member is not in party");
      members = members.filter((member) => member.characterId !== command.characterId);
    });
  }
  function setRole(command) {
    return execute("setRole", command, ["characterId", "role"], () => {
      if (command.actorCharacterId !== leaderCharacterId && command.actorCharacterId !== command.characterId) throw new PartyCommandError("ROLE_CHANGE_NOT_ALLOWED", "only leader or self can change role");
      assertRole(command.role);
      const member = members.find((entry) => entry.characterId === command.characterId);
      if (!member) throw new PartyCommandError("MEMBER_NOT_FOUND", "member is not in party");
      member.role = command.role;
      member.ready = false;
    });
  }
  function setReady(command) {
    return execute("setReady", command, ["ready"], () => {

      if (typeof command.ready !== "boolean") throw new PartyCommandError("INVALID_READY_STATE", "ready must be boolean");
      members.find((member) => member.characterId === command.actorCharacterId).ready = command.ready;
    });
  }
  function setMemberAuthorityProfile(characterId, changes = {}) {
    const current = profiles.get(characterId);
    if (!current) throw new PartyCommandError("UNKNOWN_CHARACTER", "character is not available to the party server");
    profiles.set(characterId, normalizeProfile({ ...current, ...changes, characterId: current.characterId, accountId: current.accountId }));
    if (members.some((member) => member.characterId === characterId)) version += 1;
    return snapshot();
  }
  return Object.freeze({ snapshot, addMember, removeMember, setRole, setReady, setMemberAuthorityProfile });
}