export const INVENTORY_ITEM_KIND = Object.freeze({
  WEAPON: "weapon",
  SKILL: "skill",
  SUPPORT: "support",
});

export const INVENTORY_OCCUPANCY = Object.freeze({
  AVAILABLE: "available",
  EQUIPPED: "equipped",
  SOCKETED: "socketed",
  CONNECTED: "connected",
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function loadoutMaps(snapshot) {
  const skillOwner = new Map();
  const supportOwner = new Map();
  for (const loadout of snapshot.characterBuild.weaponLoadouts) {
    loadout.skillSockets.forEach((instanceId, socketIndex) => {
      if (instanceId) skillOwner.set(instanceId, { weaponInstanceId: loadout.weaponInstanceId, socketIndex });
    });
    loadout.supportSlots.forEach((supportIds, socketIndex) => {
      for (const instanceId of supportIds) {
        supportOwner.set(instanceId, {
          weaponInstanceId: loadout.weaponInstanceId,
          skillInstanceId: loadout.skillSockets[socketIndex],
          socketIndex,
        });
      }
    });
  }
  return { skillOwner, supportOwner };
}

function entryBase(kind, instance, definition, lockedIds) {
  return {
    kind,
    instanceId: instance.instanceId,
    definitionId: instance.definitionId,
    name: definition?.name ?? instance.definitionId,
    level: instance.level ?? null,
    quality: instance.quality ?? null,
    locked: lockedIds.has(instance.instanceId),
  };
}

export function deriveInventoryEntries(snapshot, options = {}) {
  if (!snapshot?.ownershipInput || !snapshot?.characterBuild) throw new TypeError("authoritative snapshot is required");
  const ownership = snapshot.ownershipInput;
  const registry = ownership.registry;
  const lockedIds = new Set(options.lockedInstanceIds ?? []);
  const { skillOwner, supportOwner } = loadoutMaps(snapshot);
  const entries = [];
  for (const instance of ownership.weaponInstances) {
    const equipped = snapshot.characterBuild.equippedWeaponInstanceId === instance.instanceId;
    entries.push({
      ...entryBase(INVENTORY_ITEM_KIND.WEAPON, instance, registry.weapons[instance.definitionId], lockedIds),
      occupancy: equipped ? INVENTORY_OCCUPANCY.EQUIPPED : INVENTORY_OCCUPANCY.AVAILABLE,
      occupiedByWeaponInstanceId: equipped ? instance.instanceId : null,
      socketIndex: null,
      attachedSkillInstanceId: null,
    });
  }
  for (const instance of ownership.skillCardInstances) {
    const owner = skillOwner.get(instance.instanceId);
    entries.push({
      ...entryBase(INVENTORY_ITEM_KIND.SKILL, instance, registry.skills[instance.definitionId], lockedIds),
      occupancy: owner ? INVENTORY_OCCUPANCY.SOCKETED : INVENTORY_OCCUPANCY.AVAILABLE,
      occupiedByWeaponInstanceId: owner?.weaponInstanceId ?? null,
      socketIndex: owner?.socketIndex ?? null,
      attachedSkillInstanceId: null,
    });
  }
  for (const instance of ownership.supportCardInstances) {
    const owner = supportOwner.get(instance.instanceId);
    entries.push({
      ...entryBase(INVENTORY_ITEM_KIND.SUPPORT, instance, registry.supports[instance.definitionId], lockedIds),
      occupancy: owner ? INVENTORY_OCCUPANCY.CONNECTED : INVENTORY_OCCUPANCY.AVAILABLE,
      occupiedByWeaponInstanceId: owner?.weaponInstanceId ?? null,
      socketIndex: owner?.socketIndex ?? null,
      attachedSkillInstanceId: owner?.skillInstanceId ?? null,
    });
  }
  return deepFreeze(entries);
}

export function filterInventoryEntries(entries, options = {}) {
  if (!Array.isArray(entries)) throw new TypeError("inventory entries must be an array");
  const kind = options.kind ?? "all";
  const query = String(options.query ?? "").trim().toLocaleLowerCase();
  if (kind !== "all" && !Object.values(INVENTORY_ITEM_KIND).includes(kind)) {
    throw new RangeError("inventory kind filter is invalid");
  }
  return Object.freeze(entries.filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    if (!query) return true;
    return [entry.name, entry.instanceId, entry.definitionId].some((value) => value.toLocaleLowerCase().includes(query));
  }));
}