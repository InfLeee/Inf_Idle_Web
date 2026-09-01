import { stableHash } from "../../build-compiler/src/compileActionBuild.js";
import { createEncounterAuthoritativeSimulator } from "./encounter-authoritative-simulator.js";

export const COMBAT_REPLAY_SCHEMA_VERSION = "authoritative-combat-replay-v1";
export const DEFAULT_REPLAY_CHECKPOINTS = Object.freeze([5_000, 10_000, 20_000]);

const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizeCheckpoints(input = DEFAULT_REPLAY_CHECKPOINTS) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 64) {
    throw new RangeError("replay checkpoints must contain between 1 and 64 entries");
  }
  let previous = 0;
  return input.map((checkpoint, index) => {
    if (!Number.isInteger(checkpoint) || checkpoint <= previous || checkpoint > 24 * 60 * 60 * 1_000) {
      throw new RangeError(`replay checkpoint ${index} must be strictly increasing and within 24 hours`);
    }
    previous = checkpoint;
    return checkpoint;
  });
}

function simulateReplay({ simulator, compiledBuild, encounter, rngSeed, checkpoints }) {
  let state = simulator.createInitialState({ compiledBuild, encounter, rngSeed });
  const segments = [];
  for (const targetUntilMs of checkpoints) {
    const events = [];
    const runtimeEvents = [];
    let advances = 0;
    while (state.simulatedUntilMs < targetUntilMs) {
      const result = simulator.advance({ state, compiledBuild, encounter, rngSeed, targetUntilMs });
      if (result.state.simulatedUntilMs <= state.simulatedUntilMs) throw new Error("replay simulation made no progress");
      state = result.state;
      events.push(...result.events);
      runtimeEvents.push(...result.runtimeEvents);
      advances += 1;
      if (advances > 64) throw new Error("replay checkpoint exceeded the server segment limit");
    }
    segments.push({
      targetUntilMs,
      eventCount: events.length,
      eventHash: stableHash(events),
      runtimeEventCount: runtimeEvents.length,
      runtimeEventHash: stableHash(runtimeEvents),
      stateHash: stableHash(state),
    });
  }
  return { state, segments };
}

export function createAuthoritativeReplayRecord(input) {
  const simulator = input.simulator ?? createEncounterAuthoritativeSimulator();
  const checkpoints = normalizeCheckpoints(input.checkpoints);
  if (!input.compiledBuild?.buildHash) throw new TypeError("compiledBuild is required");
  if (typeof input.encounter?.id !== "string" || !input.encounter.id) throw new TypeError("encounter.id is required");
  if (!Number.isInteger(input.rngSeed)) throw new TypeError("rngSeed must be an integer");
  const replay = simulateReplay({ ...input, simulator, checkpoints });
  const core = {
    schemaVersion: COMBAT_REPLAY_SCHEMA_VERSION,
    buildHash: input.compiledBuild.buildHash,
    encounterId: input.encounter.id,
    encounterHash: stableHash(input.encounter),
    rngSeed: input.rngSeed,
    checkpoints,
    segments: replay.segments,
    finalStateHash: stableHash(replay.state),
  };
  return deepFreeze({ ...core, recordHash: stableHash(core) });
}

export function verifyAuthoritativeReplayRecord(input) {
  const record = input.record;
  if (!record || record.schemaVersion !== COMBAT_REPLAY_SCHEMA_VERSION) throw new TypeError("invalid replay record");
  const { recordHash, ...recordCore } = clone(record);
  const mismatches = [];
  if (stableHash(recordCore) !== recordHash) mismatches.push("RECORD_HASH_MISMATCH");
  if (record.buildHash !== input.compiledBuild?.buildHash) mismatches.push("BUILD_HASH_MISMATCH");
  if (record.encounterId !== input.encounter?.id || record.encounterHash !== stableHash(input.encounter)) mismatches.push("ENCOUNTER_MISMATCH");
  if (mismatches.length) return deepFreeze({ verified: false, recordHash, replayHash: null, mismatches });

  const simulator = input.simulator ?? createEncounterAuthoritativeSimulator();
  const checkpoints = normalizeCheckpoints(record.checkpoints);
  const replay = simulateReplay({
    simulator,
    compiledBuild: input.compiledBuild,
    encounter: input.encounter,
    rngSeed: record.rngSeed,
    checkpoints,
  });
  const replaySegmentsHash = stableHash(replay.segments);
  const recordedSegmentsHash = stableHash(record.segments);
  if (replaySegmentsHash !== recordedSegmentsHash) mismatches.push("EVENT_CHAIN_MISMATCH");
  if (stableHash(replay.state) !== record.finalStateHash) mismatches.push("FINAL_STATE_MISMATCH");
  return deepFreeze({
    verified: mismatches.length === 0,
    recordHash,
    replayHash: stableHash({ segments: replay.segments, finalStateHash: stableHash(replay.state) }),
    mismatches,
    segmentCount: replay.segments.length,
    eventCount: replay.segments.reduce((sum, segment) => sum + segment.eventCount, 0),
    runtimeEventCount: replay.segments.reduce((sum, segment) => sum + segment.runtimeEventCount, 0),
  });
}
