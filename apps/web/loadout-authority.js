import { projectTwoHandedSwordA1Legacy } from "../../packages/build-compiler/src/twoHandedSwordA1Adapter.js";
import { twoHandedSwordA1Config as config } from "../../packages/game-config/two-handed-sword-a1.js?v=three-support-slots-1";
import { createTwoHandedSwordA1DemoOwnership } from "../../packages/game-config/two-handed-sword-a1-domain.js";
import { createAuthoritativeLoadoutService } from "../../packages/server-core/src/authoritative-loadout-service.js";

export let loadoutAuthority = createAuthoritativeLoadoutService({
  config,
  ownershipInput: createTwoHandedSwordA1DemoOwnership(config),
});

export function resetLoadoutAuthority() {
  loadoutAuthority = createAuthoritativeLoadoutService({
    config,
    ownershipInput: createTwoHandedSwordA1DemoOwnership(config),
  });
  return loadoutAuthority.snapshot();
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
  const legacyBuild = legacyBuildFromSnapshot(snapshot);
  window.dispatchEvent(new CustomEvent("authoritative-loadout-change", {
    detail: { snapshot, legacyBuild },
  }));
  return snapshot;
}
