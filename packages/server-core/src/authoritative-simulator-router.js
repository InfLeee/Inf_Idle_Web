import { createCompiledAuthoritativeSimulator } from "./compiled-authoritative-simulator.js";
import {
  AUTHORITATIVE_ENCOUNTER_MODE,
  AUTHORITATIVE_ENCOUNTER_SCHEMA_VERSION,
  createEncounterAuthoritativeSimulator,
  projectAuthoritativeEncounterState,
} from "./encounter-authoritative-simulator.js";

export function createAuthoritativeSimulatorRouter(options = {}) {
  const legacy = options.legacySimulator ?? createCompiledAuthoritativeSimulator(options.legacyOptions);
  const encounter = options.encounterSimulator ?? createEncounterAuthoritativeSimulator(options.encounterOptions);
  return Object.freeze({
    createInitialState(input) {
      return input.encounter.mode === AUTHORITATIVE_ENCOUNTER_MODE
        ? encounter.createInitialState(input)
        : legacy.createInitialState(input);
    },
    advance(input) {
      return input.state.schemaVersion === AUTHORITATIVE_ENCOUNTER_SCHEMA_VERSION
        ? encounter.advance(input)
        : legacy.advance(input);
    },
    projectState(state) {
      return state.schemaVersion === AUTHORITATIVE_ENCOUNTER_SCHEMA_VERSION
        ? projectAuthoritativeEncounterState(state)
        : { monsterHp: state.monsterHp, settled: state.settled };
    },
  });
}
