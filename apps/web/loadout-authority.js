import { projectTwoHandedSwordA1Legacy } from "../../packages/build-compiler/src/twoHandedSwordA1Adapter.js";
import { twoHandedSwordA1Config as config } from "../../packages/game-config/two-handed-sword-a1.js?v=mastery-stats-2";
import { createTwoHandedSwordA1InventoryLabOwnership } from "../../packages/game-config/two-handed-sword-a1-domain.js";
import { createLocalSaveV0, restoreLocalSaveV0, serializeLocalSaveV0 } from "../../packages/save-core/src/local-save-v0.js";
import { createAuthoritativeLoadoutService } from "../../packages/server-core/src/authoritative-loadout-service.js";
import { createAuthoritativeCharacterProgressionService } from "../../packages/server-core/src/authoritative-character-progression-service.js";

export const LOCAL_SAVE_STORAGE_KEY = "inf-idle.local-save.v0.2";
export const CHARACTER_PROGRESSION_STORAGE_KEY = "inf-idle.character-progression.v0";

let activeAutoPolicy = Object.freeze(structuredClone(config.build.autoPolicy));
let localSaveStatus = Object.freeze({ status: "empty", code: null });

const LOADOUT_CHANNEL_KEY = Symbol.for("inf-idle.authoritative-loadout-channel.v1");
const loadoutChannel = globalThis[LOADOUT_CHANNEL_KEY] ??= { snapshot: null, listeners: new Set() };

function publishSharedSnapshot(snapshot) {
  loadoutChannel.snapshot = snapshot;
  for (const listener of [...loadoutChannel.listeners]) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("authoritative loadout subscriber failed", error);
    }
  }
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function restoreCharacterProgressionAuthority() {
  const storage = browserStorage();
  try {
    const serialized = storage?.getItem(CHARACTER_PROGRESSION_STORAGE_KEY);
    if (!serialized) return createAuthoritativeCharacterProgressionService({ level: 30 });
    const source = JSON.parse(serialized);
    const allowed = new Set(["schemaVersion", "level", "allocations"]);
    if (source?.schemaVersion !== "character-progression-save-v0" ||
        Object.keys(source).some((field) => !allowed.has(field))) throw new Error("invalid character progression source save");
    return createAuthoritativeCharacterProgressionService({ level: source.level, allocations: source.allocations });
  } catch {
    try { storage?.removeItem(CHARACTER_PROGRESSION_STORAGE_KEY); } catch { /* safe baseline below */ }
    return createAuthoritativeCharacterProgressionService({ level: 30 });
  }
}

export let characterProgressionAuthority = restoreCharacterProgressionAuthority();

function createBaselineOwnership() {
  return createTwoHandedSwordA1InventoryLabOwnership(config);
}

function createBaselineAuthority() {
  const ownershipInput = createBaselineOwnership();
  return createAuthoritativeLoadoutService({
    config,
    ownershipInput,
    weaponLoadouts: ownershipInput.weaponLoadouts,
    equippedWeaponInstanceId: null,
    characterStatSnapshot: characterProgressionAuthority.snapshot().characterStats,
  });
}

function restoreAuthority() {
  const storage = browserStorage();
  const baseline = createBaselineOwnership();
  let serialized;
  try {
    serialized = storage?.getItem(LOCAL_SAVE_STORAGE_KEY);
  } catch (error) {
    localSaveStatus = Object.freeze({ status: "read_failed", code: error.code ?? "LOCAL_STORAGE_READ_FAILED" });
    return createBaselineAuthority();
  }
  if (!serialized) return createBaselineAuthority();
  try {
    const restored = restoreLocalSaveV0(serialized, {
      configVersion: config.configVersion,
      registry: baseline.registry,
      maxSupportsPerSkill: config.build.supportSlotsPerSkill,
    });
    activeAutoPolicy = restored.autoPolicy;
    localSaveStatus = Object.freeze({ status: "restored", code: null });
    return createAuthoritativeLoadoutService({
      config,
      ownershipInput: restored.primaryOwnershipInput,
      equippedWeaponInstanceId: restored.characterBuild.equippedWeaponInstanceId,
      weaponLoadouts: restored.characterBuild.weaponLoadouts,
      characterStatSnapshot: characterProgressionAuthority.snapshot().characterStats,
    });
  } catch (error) {
    try {
      storage?.removeItem(LOCAL_SAVE_STORAGE_KEY);
    } catch {
      // A blocked storage backend must not prevent a safe baseline fallback.
    }
    localSaveStatus = Object.freeze({ status: "rejected", code: error.code ?? "INVALID_LOCAL_SAVE" });
    return createBaselineAuthority();
  }
}

export let loadoutAuthority = restoreAuthority();
if (loadoutChannel.snapshot === null) loadoutChannel.snapshot = loadoutAuthority.snapshot();

export function currentLoadoutSnapshot() {
  return loadoutChannel.snapshot ?? loadoutAuthority.snapshot();
}

export function subscribeLoadoutSnapshot(listener) {
  if (typeof listener !== "function") throw new TypeError("loadout snapshot listener must be a function");
  loadoutChannel.listeners.add(listener);
  listener(currentLoadoutSnapshot());
  return () => loadoutChannel.listeners.delete(listener);
}

export function resetLoadoutAuthority() {
  activeAutoPolicy = Object.freeze(structuredClone(config.build.autoPolicy));
  localSaveStatus = Object.freeze({ status: "reset", code: null });
  loadoutAuthority = createBaselineAuthority();
  return loadoutAuthority.snapshot();
}

export function commitCharacterProgression(nextProgressionSnapshot) {
  const storage = browserStorage();
  try {
    storage?.setItem(CHARACTER_PROGRESSION_STORAGE_KEY, JSON.stringify({
      schemaVersion: "character-progression-save-v0",
      level: nextProgressionSnapshot.characterStats.level,
      allocations: nextProgressionSnapshot.characterStats.allocations,
    }));
  } catch {
    // The authority snapshot remains valid even when browser storage is unavailable.
  }
  const loadoutSnapshot = loadoutAuthority.setCharacterStatSnapshot(nextProgressionSnapshot.characterStats);
  publishLoadoutSnapshot(loadoutSnapshot);
  window.dispatchEvent(new CustomEvent("authoritative-character-stats-change", {
    detail: { progressionSnapshot: nextProgressionSnapshot, loadoutSnapshot },
  }));
  return loadoutSnapshot;
}

export function allocatePrimaryStat(command) {
  return commitCharacterProgression(characterProgressionAuthority.allocate(command));
}

export function unallocatePrimaryStat(command) {
  return commitCharacterProgression(characterProgressionAuthority.unallocate(command));
}

export function resetPrimaryStats(command) {
  return commitCharacterProgression(characterProgressionAuthority.reset(command));
}

export function getLocalSaveStatus() {
  return localSaveStatus;
}

export function legacyBuildFromSnapshot(snapshot = loadoutAuthority.snapshot()) {
  if (!snapshot.compiledBuild) return null;
  return projectTwoHandedSwordA1Legacy(
    snapshot.compiledBuild,
    config,
    snapshot.compiledBuild.buildMetadata.masteryBudget,
  );
}

export function publishLoadoutSnapshot(snapshot = loadoutAuthority.snapshot()) {
  publishSharedSnapshot(snapshot);
  const storage = browserStorage();
  if (storage) {
    try {
      const save = createLocalSaveV0({ configVersion: config.configVersion, snapshot, autoPolicy: activeAutoPolicy });
      storage.setItem(LOCAL_SAVE_STORAGE_KEY, serializeLocalSaveV0(save));
    } catch (error) {
      localSaveStatus = Object.freeze({ status: "write_failed", code: error.code ?? "LOCAL_STORAGE_WRITE_FAILED" });
    }
  }
  const legacyBuild = legacyBuildFromSnapshot(snapshot);
  window.dispatchEvent(new CustomEvent("authoritative-loadout-change", {
    detail: { snapshot, legacyBuild },
  }));
  return snapshot;
}

export function acceptIdentifiedSkillCardGrant(grant) {
  return publishLoadoutSnapshot(loadoutAuthority.grantIdentifiedSkillCard(grant));
}
export function verifyLocalSaveRoundTrip(snapshot = loadoutAuthority.snapshot()) {
  const save = createLocalSaveV0({ configVersion: config.configVersion, snapshot, autoPolicy: activeAutoPolicy });
  const serialized = serializeLocalSaveV0(save);
  const baseline = createBaselineOwnership();
  const restored = restoreLocalSaveV0(serialized, {
    configVersion: config.configVersion,
    registry: baseline.registry,
    maxSupportsPerSkill: config.build.supportSlotsPerSkill,
  });
  const rebuilt = createAuthoritativeLoadoutService({
    config,
    ownershipInput: restored.primaryOwnershipInput,
    weaponLoadouts: restored.characterBuild.weaponLoadouts,
    equippedWeaponInstanceId: restored.characterBuild.equippedWeaponInstanceId,
    maxSupportsPerSkill: config.build.supportSlotsPerSkill,
    characterStatSnapshot: characterProgressionAuthority.snapshot().characterStats,
  }).snapshot();
  return Object.freeze({
    serializedBytes: new TextEncoder().encode(serialized).byteLength,
    storedCompiledBuild: serialized.includes("compiledBuild") || serialized.includes("compileInput"),
    sourceBuildHash: snapshot.compiledBuild?.buildHash ?? null,
    rebuiltBuildHash: rebuilt.compiledBuild?.buildHash ?? null,
    hashMatched: (snapshot.compiledBuild?.buildHash ?? null) === (rebuilt.compiledBuild?.buildHash ?? null),
    rebuilt,
  });
}
