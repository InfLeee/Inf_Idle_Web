import { projectTwoHandedSwordA1Legacy } from "../../packages/build-compiler/src/twoHandedSwordA1Adapter.js";
import { twoHandedSwordA1Config as config } from "../../packages/game-config/two-handed-sword-a1.js?v=build-sync-2";
import { createTwoHandedSwordA1InventoryLabOwnership } from "../../packages/game-config/two-handed-sword-a1-domain.js";
import { createLocalSaveV0, restoreLocalSaveV0, serializeLocalSaveV0 } from "../../packages/save-core/src/local-save-v0.js";
import { createAuthoritativeLoadoutService } from "../../packages/server-core/src/authoritative-loadout-service.js";

export const LOCAL_SAVE_STORAGE_KEY = "inf-idle.local-save.v0.2";

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
