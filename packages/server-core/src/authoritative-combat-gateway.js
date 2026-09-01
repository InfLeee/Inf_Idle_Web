import { COMBAT_COMMAND, CombatGatewayError, validateCombatCommand } from "./combat-request-schema.js";
import { createAuthoritativeSimulatorRouter } from "./authoritative-simulator-router.js";
import { stableHash } from "../../build-compiler/src/compileActionBuild.js";
import { assertValidWeaponLoadoutOwnership } from "../../game-domain/src/model.js";
import { assertCompileInputMatchesOwnership } from "./compile-input-ownership.js";

function requireMethod(port, method, portName) {
  if (!port || typeof port[method] !== "function") throw new TypeError(`${portName}.${method} must be a function`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function serverSeed() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] || 0x9e3779b9;
}

function serverId() {
  return globalThis.crypto.randomUUID();
}

function assertAuth(auth) {
  if (!auth || typeof auth.accountId !== "string" || auth.accountId.trim() === "") {
    throw new CombatGatewayError("AUTHENTICATION_REQUIRED", "authenticated account is required");
  }
}

function assertSessionAuthority(session, auth, characterId) {
  if (!session || session.ownerAccountId !== auth.accountId || session.characterId !== characterId) {
    throw new CombatGatewayError("COMBAT_SESSION_NOT_FOUND", "combat session was not found");
  }
}

function assertRevision(actual, expected) {
  if (actual !== expected) {
    throw new CombatGatewayError("SESSION_REVISION_CONFLICT", `combat session revision is ${actual}, expected ${expected}`, {
      retryable: true,
      details: { actual, expected },
    });
  }
}

function publicSession(session, simulation = null, simulator = null) {
  return deepFreeze({
    combatSessionId: session.combatSessionId,
    characterId: session.characterId,
    revision: session.revision,
    status: session.status,
    buildHash: session.buildHash,
    configVersion: session.configVersion,
    encounterDefinitionId: session.encounterDefinitionId,
    simulatedUntilMs: session.runtimeState.simulatedUntilMs,
    state: simulator?.projectState ? simulator.projectState(session.runtimeState) : {
      monsterHp: session.runtimeState.monsterHp,
      settled: session.runtimeState.settled,
    },
    events: structuredClone(simulation?.events ?? []),
    runtimeEvents: structuredClone(simulation?.runtimeEvents ?? []),
    settlement: simulation?.settlement ? structuredClone(simulation.settlement) : null,
  });
}

export function createAuthoritativeCombatGateway(options) {
  const {
    authorityRepository,
    encounterRepository,
    compileService,
    buildStore,
    sessionStore,
    commandStore,
    settlementStore,
  } = options ?? {};
  requireMethod(authorityRepository, "loadCombatAuthority", "authorityRepository");
  requireMethod(encounterRepository, "loadEncounterDefinition", "encounterRepository");
  requireMethod(compileService, "request", "compileService");
  requireMethod(buildStore, "put", "buildStore");
  requireMethod(buildStore, "get", "buildStore");
  requireMethod(sessionStore, "createIfNoActive", "sessionStore");
  requireMethod(sessionStore, "get", "sessionStore");
  requireMethod(sessionStore, "compareAndSet", "sessionStore");
  requireMethod(commandStore, "executeOnce", "commandStore");
  requireMethod(settlementStore, "claimCombatRewards", "settlementStore");

  const simulator = options.simulator ?? createAuthoritativeSimulatorRouter();
  requireMethod(simulator, "createInitialState", "simulator");
  requireMethod(simulator, "advance", "simulator");
  const compileInputAssembler = options.compileInputAssembler ?? (({ authority }) => authority.compileInput);
  if (typeof compileInputAssembler !== "function") throw new TypeError("compileInputAssembler must be a function");
  const now = options.clock ?? Date.now;
  const idFactory = options.idFactory ?? serverId;
  const seedFactory = options.seedFactory ?? serverSeed;
  const bootstrapDurationMs = options.bootstrapDurationMs ?? 500;
  const maxAdvancePerRequestMs = options.maxAdvancePerRequestMs ?? 5_000;
  if (!Number.isInteger(bootstrapDurationMs) || bootstrapDurationMs < 0) throw new RangeError("bootstrapDurationMs must be a non-negative integer");
  if (!Number.isInteger(maxAdvancePerRequestMs) || maxAdvancePerRequestMs < 1) throw new RangeError("maxAdvancePerRequestMs must be a positive integer");

  async function startCombat(auth, rawRequest) {
    assertAuth(auth);
    const request = validateCombatCommand(COMBAT_COMMAND.START, rawRequest);
    return commandStore.executeOnce(`${auth.accountId}:${COMBAT_COMMAND.START}:${request.requestId}`, stableHash(request), async () => {
      const authority = await authorityRepository.loadCombatAuthority({ accountId: auth.accountId, characterId: request.characterId });
      if (!authority || authority.ownerAccountId !== auth.accountId) {
        throw new CombatGatewayError("CHARACTER_NOT_FOUND", "character was not found");
      }
      if (authority.loadoutVersion !== request.expectedLoadoutVersion) {
        throw new CombatGatewayError("STALE_LOADOUT_VERSION", "loadout version is stale", {
          retryable: true,
          details: { actual: authority.loadoutVersion, expected: request.expectedLoadoutVersion },
        });
      }
      try {
        assertValidWeaponLoadoutOwnership(authority.ownershipInput, { requireCombatReady: true });
      } catch (error) {
        throw new CombatGatewayError("INVALID_WEAPON_LOADOUT", "server-owned weapon loadout failed combat validation", {
          details: { issueCodes: error.issues?.map((issue) => issue.code) ?? [] },
        });
      }
      const compileInput = await compileInputAssembler({
        authority,
        accountId: auth.accountId,
        characterId: request.characterId,
      });
      try {
        assertCompileInputMatchesOwnership(compileInput, authority.ownershipInput);
      } catch (error) {
        throw new CombatGatewayError("COMPILE_INPUT_OWNERSHIP_MISMATCH", "server compile input does not match owned loadout", {
          details: { issueCodes: error.issues?.map((issue) => issue.code) ?? [] },
        });
      }
      if (!authority.allowedEncounterDefinitionIds?.includes(request.encounterDefinitionId)) {
        throw new CombatGatewayError("ENCOUNTER_NOT_UNLOCKED", "encounter is not unlocked for this character");
      }
      const encounter = await encounterRepository.loadEncounterDefinition(request.encounterDefinitionId);
      if (!encounter) throw new CombatGatewayError("ENCOUNTER_NOT_FOUND", "encounter definition was not found");
      const compiledBuild = await compileService.request(compileInput);
      await buildStore.put(compiledBuild.buildHash, compiledBuild);
      const rngSeed = seedFactory();
      if (!Number.isInteger(rngSeed)) throw new TypeError("seedFactory must return an integer");
      const startedAt = now();
      const initialState = simulator.createInitialState({ compiledBuild, encounter, rngSeed });
      const simulation = simulator.advance({ state: initialState, compiledBuild, encounter, rngSeed, targetUntilMs: bootstrapDurationMs });
      const session = deepFreeze({
        combatSessionId: idFactory(),
        ownerAccountId: auth.accountId,
        characterId: request.characterId,
        revision: 1,
        status: simulation.settlement ? "settled" : "running",
        buildHash: compiledBuild.buildHash,
        configVersion: compiledBuild.configVersion,
        encounterDefinitionId: encounter.id,
        rngSeed,
        startedAt,
        runtimeState: structuredClone(simulation.state),
        pendingRewardDefinitionId: simulation.settlement?.rewardDefinitionId ?? null,
      });
      const created = await sessionStore.createIfNoActive(session);
      if (!created) throw new CombatGatewayError("ACTIVE_COMBAT_SESSION_EXISTS", "character already has an active combat session", { retryable: true });
      return publicSession(session, simulation, simulator);
    });
  }

  async function advanceCombat(auth, rawRequest) {
    assertAuth(auth);
    const request = validateCombatCommand(COMBAT_COMMAND.ADVANCE, rawRequest);
    return commandStore.executeOnce(`${auth.accountId}:${COMBAT_COMMAND.ADVANCE}:${request.requestId}`, stableHash(request), async () => {
      const session = await sessionStore.get(request.combatSessionId);
      assertSessionAuthority(session, auth, request.characterId);
      assertRevision(session.revision, request.expectedRevision);
      if (session.status !== "running") throw new CombatGatewayError("COMBAT_SESSION_NOT_RUNNING", "combat session is not running");
      const compiledBuild = await buildStore.get(session.buildHash);
      if (!compiledBuild) throw new CombatGatewayError("COMPILED_BUILD_NOT_FOUND", "compiled build snapshot was not found");
      const encounter = await encounterRepository.loadEncounterDefinition(session.encounterDefinitionId);
      if (!encounter) throw new CombatGatewayError("ENCOUNTER_NOT_FOUND", "encounter definition was not found");
      const elapsedMs = Math.max(0, now() - session.startedAt);
      const targetUntilMs = Math.min(elapsedMs, session.runtimeState.simulatedUntilMs + maxAdvancePerRequestMs);
      const simulation = simulator.advance({ state: session.runtimeState, compiledBuild, encounter, rngSeed: session.rngSeed, targetUntilMs });
      const next = deepFreeze({
        ...structuredClone(session),
        revision: session.revision + 1,
        status: simulation.settlement ? "settled" : "running",
        runtimeState: structuredClone(simulation.state),
        pendingRewardDefinitionId: simulation.settlement?.rewardDefinitionId ?? session.pendingRewardDefinitionId,
      });
      const saved = await sessionStore.compareAndSet(session.combatSessionId, session.revision, next);
      if (!saved) throw new CombatGatewayError("SESSION_REVISION_CONFLICT", "combat session changed concurrently", { retryable: true });
      return publicSession(next, simulation, simulator);
    });
  }

  async function claimCombat(auth, rawRequest) {
    assertAuth(auth);
    const request = validateCombatCommand(COMBAT_COMMAND.CLAIM, rawRequest);
    return commandStore.executeOnce(`${auth.accountId}:${COMBAT_COMMAND.CLAIM}:${request.requestId}`, stableHash(request), async () => {
      const session = await sessionStore.get(request.combatSessionId);
      assertSessionAuthority(session, auth, request.characterId);
      assertRevision(session.revision, request.expectedRevision);
      if (session.status !== "settled" || !session.pendingRewardDefinitionId) {
        throw new CombatGatewayError("COMBAT_NOT_SETTLED", "combat session has no claimable settlement");
      }
      const result = await settlementStore.claimCombatRewards({
        accountId: auth.accountId,
        characterId: request.characterId,
        combatSessionId: session.combatSessionId,
        expectedRevision: session.revision,
      });
      if (!result?.claimed) {
        throw new CombatGatewayError(result?.code ?? "CLAIM_CONFLICT", "combat rewards could not be claimed", { retryable: result?.retryable ?? false });
      }
      return deepFreeze({ combatSessionId: session.combatSessionId, revision: result.revision, status: "claimed", rewards: structuredClone(result.rewards) });
    });
  }

  return Object.freeze({ startCombat, advanceCombat, claimCombat });
}
