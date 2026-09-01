import { TARGET_SELECTOR_KIND } from "../../combat-protocol/src/action-schema.js";
import { createSeededRng } from "../../combat-protocol/src/settlement.js";
import { DAMAGE_TYPES, settleDirectDamage } from "../../combat-numerics/src/index.js";
import {
  advanceCompiledCombat,
  advanceEncounterWorld,
  createCompiledCombatState,
  createEncounterWorldState,
  defeatEncounterMonster,
  encounterFrequencyCapacity,
  encounterKillRatePerSecond,
  encounterLivingCapacity,
  migrateCompiledCombatState,
  removeCompiledCombatStates,
  restartEncounterWorld,
} from "../../combat-runtime/src/index.js";

export const AUTHORITATIVE_ENCOUNTER_SCHEMA_VERSION = "authoritative-encounter-v1";
export const AUTHORITATIVE_ENCOUNTER_MODE = "endless_world_v1";

const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function finite(value, name, minimum = -Infinity, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeMonsterDefinitions(encounter) {
  const source = encounter.monsterDefinitions ?? [{
    id: "default-monster",
    maxHp: encounter.monsterHp,
    attackDamage: 0,
    attackIntervalMs: 2_000,
  }];
  if (!Array.isArray(source) || source.length < 1 || source.length > 32) {
    throw new RangeError("encounter.monsterDefinitions must contain between 1 and 32 definitions");
  }
  return source.map((definition, index) => {
    if (typeof definition?.id !== "string" || definition.id.trim() === "") {
      throw new TypeError(`encounter.monsterDefinitions[${index}].id must be a non-empty string`);
    }
    return Object.freeze({
      id: definition.id,
      maxHp: finite(definition.maxHp, `encounter.monsterDefinitions[${index}].maxHp`, 1, 1_000_000_000_000),
      attackDamage: finite(definition.attackDamage ?? 0, `encounter.monsterDefinitions[${index}].attackDamage`, 0, 1_000_000_000),
      attackIntervalMs: finite(definition.attackIntervalMs ?? 2_000, `encounter.monsterDefinitions[${index}].attackIntervalMs`, 100, 60_000),
      level: finite(definition.level ?? encounter.level ?? 1, `encounter.monsterDefinitions[${index}].level`, 1, 10_000),
      physicalDefense: finite(definition.physicalDefense ?? 0, `encounter.monsterDefinitions[${index}].physicalDefense`, 0, 1_000_000_000),
      magicDefense: finite(definition.magicDefense ?? 0, `encounter.monsterDefinitions[${index}].magicDefense`, 0, 1_000_000_000),
      critResistance: finite(definition.critResistance ?? 0, `encounter.monsterDefinitions[${index}].critResistance`, 0, 1_000_000_000),
      attackType: definition.attackType ?? DAMAGE_TYPES.PHYSICAL,
      tier: definition.tier ?? "normal",
    });
  });
}

function emit(state, events, atMs, type, payload = {}, lineage = null) {
  const eventId = `authority:${state.eventIndex}`;
  events.push({
    index: state.eventIndex,
    atMs,
    eventId,
    eventOrigin: lineage ? "derived" : "root",
    rootEventId: lineage?.rootEventId ?? eventId,
    parentEventId: lineage?.parentEventId ?? null,
    triggerId: lineage?.triggerId ?? null,
    derivationDepth: lineage?.derivationDepth ?? 0,
    triggerChain: lineage?.triggerChain ? [...lineage.triggerChain] : [],
    type,
    ...payload,
  });
  state.eventIndex += 1;
}

function eventRoll(seed, eventIndex) {
  return createSeededRng((seed ^ Math.imul(eventIndex + 1, 0x9e3779b1)) >>> 0).nextFloat();
}

function synchronizeActionClock(actionRuntime, atMs, cancelActive = false) {
  const next = clone(actionRuntime);
  if (atMs < next.nowMs) throw new RangeError("action runtime clock cannot move backwards");
  next.nowMs = atMs;
  if (cancelActive) next.activeAction = null;
  return next;
}

function worldMonsterPosition(monster) {
  const radians = monster.angleDeg * Math.PI / 180;
  return { xM: Math.cos(radians) * monster.distanceM, yM: Math.sin(radians) * monster.distanceM };
}

function engagedMonsterIds(state) {
  return state.world.monsters
    .filter((monster) => monster.state === "engaged" && state.monsters[monster.id]?.hp > 0)
    .map((monster) => monster.id)
    .sort((a, b) => a - b);
}

function selectTargets(state, targeting) {
  const engagedIds = engagedMonsterIds(state);
  if (!engagedIds.length || targeting?.kind === TARGET_SELECTOR_KIND.SELF) return [];
  if (targeting?.kind === TARGET_SELECTOR_KIND.CURRENT_TARGET) return engagedIds.slice(0, 1);
  const radiusM = targeting?.radiusM ?? 0;
  const worldById = new Map(state.world.monsters.map((monster) => [monster.id, monster]));
  let selected;
  if (targeting?.kind === TARGET_SELECTOR_KIND.ENEMIES_AROUND_SELF) {
    selected = engagedIds.filter((id) => worldById.get(id).distanceM <= radiusM);
  } else if (targeting?.kind === TARGET_SELECTOR_KIND.ENEMIES_IN_RADIUS) {
    const center = worldMonsterPosition(worldById.get(engagedIds[0]));
    selected = engagedIds.filter((id) => {
      const position = worldMonsterPosition(worldById.get(id));
      return Math.hypot(position.xM - center.xM, position.yM - center.yM) <= radiusM;
    });
  } else selected = engagedIds.slice(0, 1);
  return selected.slice(0, targeting?.maxTargets ?? selected.length);
}

function nextWorldDueAt(world) {
  const approachAt = world.monsters
    .filter((monster) => monster.state === "approaching")
    .reduce((minimum, monster) => Math.min(minimum, monster.engageAtMs), Number.POSITIVE_INFINITY);
  const killExpiryAt = world.recentDefeatAtMs.length
    ? world.recentDefeatAtMs[0] + world.config.killRateWindowMs
    : Number.POSITIVE_INFINITY;
  return Math.min(world.nextEncounterAtMs ?? Number.POSITIVE_INFINITY, approachAt, killExpiryAt);
}

function nextMonsterAttackAt(state) {
  return engagedMonsterIds(state).reduce(
    (minimum, id) => Math.min(minimum, state.monsters[id].nextAttackAtMs ?? Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );
}

function publicRuntimeEvent(event) {
  const allowed = new Set([
    "action_started", "channel_started", "channel_tick", "channel_ended", "action_interrupted",
    "resource_changed", "state_applied", "state_refreshed", "state_expired", "state_removed", "damage_intent",
  ]);
  return allowed.has(event.type) ? { ...clone(event), type: `authoritative_${event.type}` } : null;
}

function applyWorldEvents(state, worldEvents, events, definitions) {
  for (const event of worldEvents) {
    if (event.type === "monster_spawned") {
      const definition = definitions[event.monster.encounterSerial % definitions.length];
      state.monsters[event.monster.id] = {
        id: event.monster.id,
        definitionId: definition.id,
        maxHp: definition.maxHp,
        hp: definition.maxHp,
        attackDamage: definition.attackDamage,
        attackIntervalMs: definition.attackIntervalMs,
        level: definition.level,
        physicalDefense: definition.physicalDefense,
        magicDefense: definition.magicDefense,
        critResistance: definition.critResistance,
        attackType: definition.attackType,
        tier: definition.tier,
        nextAttackAtMs: null,
      };
      emit(state, events, event.at, "authoritative_monster_spawned", {
        monsterId: event.monster.id,
        definitionId: definition.id,
        maxHp: definition.maxHp,
        angleDeg: event.monster.angleDeg,
        distanceM: event.monster.distanceM,
      });
    } else if (event.type === "monster_approach_completed") {
      const monster = state.monsters[event.monsterId];
      if (monster) monster.nextAttackAtMs = event.at + monster.attackIntervalMs;
      emit(state, events, event.at, "authoritative_monster_approach_completed", {
        monsterId: event.monsterId,
        distanceM: event.distanceM,
      });
    } else if (event.type === "monster_defeated") {
      emit(state, events, event.at, "authoritative_monster_defeated", {
        monsterId: event.monsterId,
        livingCapacity: event.livingCapacity,
        killRatePerSecond: event.killRatePerSecond,
      });
    } else {
      emit(state, events, event.at, `authoritative_${event.type}`, Object.fromEntries(
        Object.entries(event).filter(([key]) => !["index", "at", "type"].includes(key)),
      ));
    }
  }
}

function advanceWorldTo(state, untilMs, events, definitions) {
  const segment = advanceEncounterWorld({ state: state.world, untilMs, maxEvents: 256 });
  state.world = clone(segment.state);
  applyWorldEvents(state, segment.events, events, definitions);
}

function applyDamageIntents(state, runtimeEvents, events, definitions, encounter, rngSeed) {
  for (const intent of runtimeEvents.filter((event) => event.type === "damage_intent")) {
    const targets = selectTargets(state, intent.targeting);
    for (const monsterId of targets) {
      const monster = state.monsters[monsterId];
      if (!monster || monster.hp <= 0) continue;
      const hitCount = Math.max(1, intent.hitCount ?? 1);
      const derived = state.characterStats?.derived?.final;
      const damageType = intent.skillTags?.includes("TRUE") ? DAMAGE_TYPES.TRUE
        : intent.skillTags?.includes("MAGIC") ? DAMAGE_TYPES.MAGIC : DAMAGE_TYPES.PHYSICAL;
      const statDamage = damageType === DAMAGE_TYPES.MAGIC ? derived?.magicAttack : derived?.physicalAttack;
      const playerBaseDamage = statDamage ?? encounter.playerBaseDamage;
      const baseMultiplier = intent.baseMultiplier ?? intent.multiplier;
      const compiledModifier = baseMultiplier === 0 ? 0 : intent.multiplier / baseMultiplier;
      const settlement = settleDirectDamage({
        damageType,
        attackPower: playerBaseDamage,
        skillCoefficient: baseMultiplier * hitCount,
        skillLevel: intent.skillLevel ?? 1,
        skillLevelGrowth: intent.skillLevelGrowth ?? 0.08,
        moreDamage: compiledModifier === 1 ? [] : [compiledModifier - 1],
        moreSources: compiledModifier === 1 ? [] : [{ kind: "compiled_build", label: "辅助卡与精通编译结果" }],
        attackerLevel: state.characterStats?.level ?? encounter.playerLevel ?? 1,
        defenderLevel: monster.level,
        defense: damageType === DAMAGE_TYPES.MAGIC ? monster.magicDefense : monster.physicalDefense,
        penetration: damageType === DAMAGE_TYPES.MAGIC ? derived?.magicPenetration ?? 0 : derived?.physicalPenetration ?? 0,
        critRating: derived?.critRating ?? 0,
        critResistance: monster.critResistance,
        critMultiplier: state.characterStats?.combatRates?.baseCritDamageMultiplier ?? 1.5,
        critRoll: eventRoll(rngSeed, state.damageRollIndex++),
        varianceRoll: eventRoll(rngSeed, state.damageRollIndex++),
        attackSource: { kind: "character_stat", statId: damageType === DAMAGE_TYPES.MAGIC ? "magicAttack" : "physicalAttack" },
        skillSource: { kind: "skill", definitionId: intent.skillDefinitionId },
        skillLevelSource: { kind: "skill_card", entryId: intent.skillEntryId, level: intent.skillLevel ?? 1 },
      });
      const damage = settlement.finalDamage;
      monster.hp = Math.max(0, monster.hp - damage);
      emit(state, events, intent.at, "authoritative_damage", {
        skillEntryId: intent.skillEntryId,
        skillDefinitionId: intent.skillDefinitionId,
        actionId: intent.actionId,
        targetMonsterId: monsterId,
        hitCount,
        damage,
        critical: settlement.critical,
        damageType,
        numericBreakdown: settlement,
        monsterHp: monster.hp,
      }, {
        rootEventId: intent.rootEventId ?? intent.eventId,
        parentEventId: intent.eventId,
        triggerId: "server.resolve_damage",
        derivationDepth: (intent.derivationDepth ?? 0) + 1,
        triggerChain: [...(intent.triggerChain ?? []), "server.resolve_damage"],
      });
      if (monster.hp === 0) {
        const defeated = defeatEncounterMonster({ state: state.world, monsterId });
        state.world = clone(defeated.state);
        delete state.monsters[monsterId];
        applyWorldEvents(state, defeated.events, events, definitions);
      }
    }
  }
}

function applyMonsterAttacks(state, events, runtimeEvents, rngSeed) {
  if (!state.player.alive) return;
  for (const monsterId of engagedMonsterIds(state)) {
    const monster = state.monsters[monsterId];
    if (monster.nextAttackAtMs === null || monster.nextAttackAtMs > state.simulatedUntilMs) continue;
    const derived = state.characterStats?.derived?.final;
    const incoming = settleDirectDamage({
      damageType: monster.attackType,
      attackPower: monster.attackDamage,
      attackerLevel: monster.level,
      defenderLevel: state.characterStats?.level ?? 1,
      defense: monster.attackType === DAMAGE_TYPES.MAGIC ? derived?.magicDefense ?? 0 : derived?.physicalDefense ?? 0,
      critRoll: 1,
      varianceRoll: eventRoll(rngSeed, state.damageRollIndex++),
    });
    const damage = Math.min(state.player.hp, incoming.finalDamage);
    state.player.hp -= damage;
    emit(state, events, state.simulatedUntilMs, "authoritative_player_damaged", {
      monsterId,
      damage,
      playerHp: state.player.hp,
      damageType: monster.attackType,
      numericBreakdown: incoming,
    });
    monster.nextAttackAtMs += monster.attackIntervalMs;
    if (state.player.hp === 0) {
      state.player.alive = false;
      state.player.reviveAtMs = state.simulatedUntilMs + state.reviveDelayMs;
      const removed = removeCompiledCombatStates({
        state: state.actionRuntime,
        atMs: state.simulatedUntilMs,
        reason: "death",
      });
      removed.events.map(publicRuntimeEvent).filter(Boolean).forEach((event) => runtimeEvents.push(event));
      state.actionRuntime = synchronizeActionClock(removed.state, state.simulatedUntilMs, true);
      emit(state, events, state.simulatedUntilMs, "authoritative_player_died", { reviveAtMs: state.player.reviveAtMs });
      break;
    }
  }
}

function revivePlayer(state, events, definitions) {
  const atMs = state.player.reviveAtMs;
  const restarted = restartEncounterWorld({
    state: state.world,
    atMs,
    initialEncounterDelayMs: state.reviveInitialEncounterDelayMs,
    reason: "player_revived",
  });
  state.world = clone(restarted.state);
  state.monsters = {};
  state.player.hp = state.player.maxHp;
  state.player.alive = true;
  state.player.reviveAtMs = null;
  state.actionRuntime = synchronizeActionClock(state.actionRuntime, atMs, true);
  state.simulatedUntilMs = atMs;
  emit(state, events, atMs, "authoritative_player_revived", { playerHp: state.player.hp });
  applyWorldEvents(state, restarted.events, events, definitions);
}

export function projectAuthoritativeEncounterState(state) {
  const worldById = new Map(state.world.monsters.map((monster) => [monster.id, monster]));
  return deepFreeze({
    player: clone(state.player),
    monsters: Object.values(state.monsters).map((monster) => ({ ...clone(monster), ...clone(worldById.get(monster.id) ?? {}) })),
    encounter: {
      center: clone(state.world.playerPosition),
      frequencyCapacity: encounterFrequencyCapacity(state.world),
      livingCapacity: encounterLivingCapacity(state.world),
      killRatePerSecond: encounterKillRatePerSecond(state.world),
      paused: state.world.encounterPaused,
    },
    settled: false,
  });
}

export function createEncounterAuthoritativeSimulator(options = {}) {
  const maxEventsPerSegment = options.maxEventsPerSegment ?? 512;
  const maxRuntimeEventsPerSlice = options.maxRuntimeEventsPerSlice ?? 256;
  const maxIterationsPerSegment = options.maxIterationsPerSegment ?? 8_192;

  function createInitialState({ compiledBuild, encounter, rngSeed }) {
    if (encounter.mode !== AUTHORITATIVE_ENCOUNTER_MODE) throw new Error(`unsupported encounter mode ${encounter.mode}`);
    const characterStats = compiledBuild.characterStats ?? null;
    if (!characterStats) finite(encounter.playerBaseDamage, "encounter.playerBaseDamage", 0, 1_000_000_000);
    const playerMaxHp = finite(encounter.playerMaxHp ?? characterStats?.derived?.final?.maxHp ?? 100, "encounter.playerMaxHp", 1, 1_000_000_000_000);
    const reviveDelayMs = finite(encounter.reviveDelayMs ?? 5_000, "encounter.reviveDelayMs", 100, 60_000);
    const reviveInitialEncounterDelayMs = finite(encounter.reviveInitialEncounterDelayMs ?? 1_150, "encounter.reviveInitialEncounterDelayMs", 0, 60_000);
    normalizeMonsterDefinitions(encounter);
    return deepFreeze({
      schemaVersion: AUTHORITATIVE_ENCOUNTER_SCHEMA_VERSION,
      simulatedUntilMs: 0,
      eventIndex: 0,
      damageRollIndex: 0,
      characterStats: characterStats ? clone(characterStats) : null,
      player: { maxHp: playerMaxHp, hp: playerMaxHp, alive: true, reviveAtMs: null },
      reviveDelayMs,
      reviveInitialEncounterDelayMs,
      world: createEncounterWorldState({
        ...(encounter.worldConfig ?? {}),
        ...(characterStats ? { movementSpeedMultiplier: characterStats.combatRates.encounterMovementMultiplier } : {}),
        seed: rngSeed,
      }),
      monsters: {},
      actionRuntime: createCompiledCombatState(compiledBuild),
    });
  }

  function advance({ state: inputState, compiledBuild, encounter, rngSeed, targetUntilMs }) {
    if (inputState.schemaVersion !== AUTHORITATIVE_ENCOUNTER_SCHEMA_VERSION) throw new Error("invalid authoritative encounter state");
    finite(targetUntilMs, "targetUntilMs", inputState.simulatedUntilMs);
    const state = clone(inputState);
    const definitions = normalizeMonsterDefinitions(encounter);
    const events = [];
    const runtimeEvents = [];
    if (state.actionRuntime.buildHash !== compiledBuild.buildHash) {
      const previousMaxHp = state.player.maxHp;
      const hpRatio = previousMaxHp > 0 ? state.player.hp / previousMaxHp : 1;
      const nextCharacterStats = compiledBuild.characterStats ?? null;
      const nextMaxHp = finite(encounter.playerMaxHp ?? nextCharacterStats?.derived?.final?.maxHp ?? previousMaxHp, "encounter.playerMaxHp", 1, 1_000_000_000_000);
      state.actionRuntime = clone(migrateCompiledCombatState(state.actionRuntime, compiledBuild));
      state.characterStats = nextCharacterStats ? clone(nextCharacterStats) : null;
      state.player.maxHp = nextMaxHp;
      if (state.player.alive) state.player.hp = Math.min(nextMaxHp, Math.max(1, nextMaxHp * hpRatio));
      runtimeEvents.push({
        type: "authoritative_build_changed",
        at: state.simulatedUntilMs,
        previousBuildHash: inputState.actionRuntime.buildHash,
        buildHash: compiledBuild.buildHash,
      });
    }
    let iterations = 0;

    while (state.simulatedUntilMs < targetUntilMs && events.length < maxEventsPerSegment && iterations < maxIterationsPerSegment) {
      iterations += 1;
      if (!state.player.alive) {
        if (state.player.reviveAtMs > targetUntilMs) {
          state.simulatedUntilMs = targetUntilMs;
          break;
        }
        revivePlayer(state, events, definitions);
        continue;
      }

      const worldDueAt = nextWorldDueAt(state.world);
      const attackDueAt = nextMonsterAttackAt(state);
      const boundaryAt = Math.min(targetUntilMs, worldDueAt, attackDueAt);
      const engaged = engagedMonsterIds(state);

      if (engaged.length) {
        const runtime = advanceCompiledCombat({
          state: state.actionRuntime,
          compiledBuild,
          untilMs: boundaryAt,
          maxEvents: maxRuntimeEventsPerSlice,
          controlEvents: encounter.controlEvents ?? [],
          stopAfterDamageIntent: true,
        });
        state.actionRuntime = clone(runtime.state);
        runtime.events.map(publicRuntimeEvent).filter(Boolean).forEach((event) => runtimeEvents.push(event));
        if (runtime.state.nowMs > state.world.nowMs) advanceWorldTo(state, runtime.state.nowMs, events, definitions);
        state.simulatedUntilMs = Math.max(state.simulatedUntilMs, runtime.state.nowMs);
        if (runtime.events.some((event) => event.type === "damage_intent")) {
          applyDamageIntents(state, runtime.events, events, definitions, encounter, rngSeed);
          continue;
        }
      }

      if (boundaryAt >= state.world.nowMs && Number.isFinite(boundaryAt)) {
        advanceWorldTo(state, boundaryAt, events, definitions);
      }
      state.simulatedUntilMs = Math.max(state.simulatedUntilMs, boundaryAt);
      if (!engagedMonsterIds(state).length) {
        state.actionRuntime = synchronizeActionClock(state.actionRuntime, state.simulatedUntilMs, true);
      }
      applyMonsterAttacks(state, events, runtimeEvents, rngSeed);
      if (boundaryAt === targetUntilMs) break;
    }

    if (iterations >= maxIterationsPerSegment) throw new Error("authoritative encounter exceeded the server iteration limit");
    return deepFreeze({ state, events, runtimeEvents, settlement: null });
  }

  return Object.freeze({ createInitialState, advance, projectState: projectAuthoritativeEncounterState });
}
