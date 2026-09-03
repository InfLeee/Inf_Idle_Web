import { stableHash } from "../../build-compiler/src/compileActionBuild.js";
import { CRAFTING_CURRENCIES, EQUIPMENT_SLOTS, ITEM_CATEGORY, ITEM_RARITIES, ITEM_RARITY, RARITY_META, aggregateEquipmentBonuses, craftItemWithCurrency, generateEquipmentDrop, generateMonsterLoot } from "../../itemization-core/src/index.js";

export class EquipmentCommandError extends Error { constructor(code, message) { super(message); this.name = "EquipmentCommandError"; this.code = code; } }

export function createAuthoritativeEquipmentService(options = {}) {
  let version = options.initialVersion ?? 1;
  let items = structuredClone(options.items ?? []);
  let skillCardStacks = structuredClone(options.skillCardStacks ?? []);
  let pendingDrops = structuredClone(options.pendingDrops ?? []);
  let acquisitionSerial = options.acquisitionSerial ?? items.length;
  let lootRollSerial = options.lootRollSerial ?? 0;
  let craftSerial = options.craftSerial ?? 0;
  let gold = options.gold ?? 0;
  let currencies = Object.fromEntries(CRAFTING_CURRENCIES.map((entry) => [entry.id, Math.max(0, Number(options.currencies?.[entry.id] ?? (entry.enabled ? 30 : 3)) || 0)]));
  let slots = { ...Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])), ...(options.slots ?? {}) };
  const results = new Map();
  const maximumEquipmentItems = options.maximumEquipmentItems ?? options.maximumItems ?? 600;
  const maximumSkillStacks = options.maximumSkillStacks ?? 100;
  const maximumSkillQuantityPerStack = options.maximumSkillQuantityPerStack ?? 9999;
  const maximumPendingDrops = options.maximumPendingDrops ?? 2000;
  const allowedSkillDefinitionIds = new Set(options.allowedSkillDefinitionIds ?? []);
  const allowTestCommands = options.allowTestCommands === true;

  function snapshot() {
    const equippedItems = EQUIPMENT_SLOTS.map((slot) => items.find((item) => item.instanceId === slots[slot]) ?? null);
    const bonuses = aggregateEquipmentBonuses(equippedItems);
    const value = { kind: "AuthoritativeEquipmentSnapshot", equipmentVersion: version, slots: structuredClone(slots), items: structuredClone(items), skillCardStacks: structuredClone(skillCardStacks), pendingDrops: structuredClone(pendingDrops), acquisitionSerial, lootRollSerial, craftSerial, gold, currencies: structuredClone(currencies), maximumItems: maximumEquipmentItems, maximumEquipmentItems, maximumSkillStacks, maximumSkillQuantityPerStack, maximumPendingDrops, bonuses };
    return Object.freeze({ ...value, equipmentHash: stableHash(value) });
  }

  function command(kind, input, allowed, mutate, createResult = (state) => state) {
    if (!input || typeof input !== "object") throw new EquipmentCommandError("INVALID_COMMAND", "command must be an object");
    for (const key of Object.keys(input)) if (!["requestId", "expectedVersion", ...allowed].includes(key)) throw new EquipmentCommandError(["affixes", "itemLevel", "bonuses", "value", "tier"].includes(key) ? "CLIENT_AUTHORITY_FIELD_REJECTED" : "UNEXPECTED_COMMAND_FIELD", `unexpected field ${key}`);
    if (typeof input.requestId !== "string" || !input.requestId) throw new EquipmentCommandError("INVALID_REQUEST_ID", "requestId is required");
    const fingerprint = stableHash({ kind, ...input });
    if (results.has(input.requestId)) { const previous = results.get(input.requestId); if (previous.fingerprint !== fingerprint) throw new EquipmentCommandError("REQUEST_ID_REUSED", "request id was reused"); return previous.result; }
    if (input.expectedVersion !== version) throw new EquipmentCommandError("VERSION_CONFLICT", "equipment version conflict");
    const mutationResult = mutate(); version += 1; const result = createResult(snapshot(), mutationResult); results.set(input.requestId, { fingerprint, result }); while (results.size > 512) results.delete(results.keys().next().value); return result;
  }

  function grantDrop(input) { return command("grant_drop", input, ["monsterLevel", "mapId", "encounterId", "slot", "seed", "highAttribute"], () => { if (items.length >= maximumEquipmentItems) throw new EquipmentCommandError("EQUIPMENT_INVENTORY_FULL", "equipment inventory is full"); const generated = generateEquipmentDrop(input); if (items.some((item) => item.instanceId === generated.instanceId)) throw new EquipmentCommandError("DUPLICATE_DROP", "drop seed already granted"); items.push(generated); }); }
  function grantValidationWeapon(input) { return command("grant_validation_weapon", input, ["monsterLevel", "seed"], () => { if (items.length >= maximumEquipmentItems) throw new EquipmentCommandError("EQUIPMENT_INVENTORY_FULL", "equipment inventory is full"); const generated = generateMonsterLoot({ monsterLevel: input.monsterLevel, seed: input.seed, category: ITEM_CATEGORY.WEAPON, subtype: "two_handed_sword", rarity: ITEM_RARITY.RARE }); if (items.some((item) => item.instanceId === generated.instanceId)) throw new EquipmentCommandError("DUPLICATE_DROP", "drop seed already granted"); items.push({ ...generated, acquiredOrder: acquisitionSerial + 1 }); acquisitionSerial += 1; return generated; }, (state, generated) => Object.freeze({ snapshot: state, item: generated })); }

  function rollMonsterLoot(input) { return command("roll_monster_loot", input, ["monsterLevel", "mapId", "encounterId", "monsterId", "seed"], () => {
    if (pendingDrops.length >= maximumPendingDrops) throw new EquipmentCommandError("GROUND_LOOT_LIMIT_EXCEEDED", "map ground loot queue is full");
    lootRollSerial += 1;
    const validationRarities = [ITEM_RARITY.NORMAL, ITEM_RARITY.MAGIC, ITEM_RARITY.RARE, ITEM_RARITY.UNIQUE];
    const validationCategories = [ITEM_CATEGORY.SKILL_CARD, ITEM_CATEGORY.SKILL_CARD, ITEM_CATEGORY.EQUIPMENT, ITEM_CATEGORY.EQUIPMENT, ITEM_CATEGORY.WEAPON, ITEM_CATEGORY.WEAPON];
    const item = generateMonsterLoot({ ...input, rarity: lootRollSerial <= validationRarities.length ? validationRarities[lootRollSerial - 1] : undefined, category: lootRollSerial <= validationCategories.length ? validationCategories[lootRollSerial - 1] : undefined });
    if (items.some((entry) => entry.instanceId === item.instanceId) || pendingDrops.some((entry) => entry.item.instanceId === item.instanceId)) throw new EquipmentCommandError("DUPLICATE_DROP", "monster drop already rolled");
    const dropId = `drop-${stableHash({ monsterId: input.monsterId, seed: input.seed, itemId: item.instanceId }).slice(0, 12)}`;
    pendingDrops.push({ dropId, monsterId: input.monsterId, createdAt: Date.now(), groundOrder: lootRollSerial, item });
  }); }

  function collectDrop(input) { return command("collect_drop", input, ["dropId"], () => {
    const index = pendingDrops.findIndex((entry) => entry.dropId === input.dropId);
    if (index < 0) throw new EquipmentCommandError("DROP_NOT_FOUND", "pending drop does not exist");
    if (index !== 0) throw new EquipmentCommandError("DROP_ORDER_VIOLATION", "ground loot must be collected in drop order");
    const drop = pendingDrops[0];
    if (drop.item.category === ITEM_CATEGORY.SKILL_CARD) {
      const existing = skillCardStacks.find((entry) => entry.skillLevel === drop.item.skillLevel && entry.unidentified === true && entry.quantity < maximumSkillQuantityPerStack);
      if (!existing && skillCardStacks.length >= maximumSkillStacks) throw new EquipmentCommandError("SKILL_CARD_INVENTORY_FULL", "skill card stack inventory is full");
      if (existing) existing.quantity += 1;
      else skillCardStacks.push({ kind: "UnidentifiedSkillGemStack", stackId: `uncut-skill-lv-${drop.item.skillLevel}`, category: ITEM_CATEGORY.SKILL_CARD, subtype: "unidentified_skill_gem", name: "未鉴定技能宝石", icon: "✧", skillLevel: drop.item.skillLevel, itemLevel: drop.item.itemLevel, unidentified: true, quantity: 1, acquiredOrder: acquisitionSerial + 1 });
    } else {
      if (items.length >= maximumEquipmentItems) throw new EquipmentCommandError("EQUIPMENT_INVENTORY_FULL", "equipment inventory is full");
      items.push({ ...drop.item, acquiredOrder: acquisitionSerial + 1 });
    }
    pendingDrops.shift(); acquisitionSerial += 1;
  }); }

  function identifySkillGem(input) {
    return command("identify_skill_gem", input, ["stackId", "definitionId"], () => {
      const stackIndex = skillCardStacks.findIndex((entry) => entry.stackId === input.stackId);
      if (stackIndex < 0 || skillCardStacks[stackIndex].quantity < 1) throw new EquipmentCommandError("SKILL_GEM_STACK_NOT_OWNED", "unidentified skill gem stack is not owned");
      if (!allowedSkillDefinitionIds.has(input.definitionId)) throw new EquipmentCommandError("SKILL_DEFINITION_NOT_ALLOWED", "skill definition is not in the server identification pool");
      const stack = skillCardStacks[stackIndex];
      const grantId = `skill-grant-${stableHash({ requestId: input.requestId, stackId: stack.stackId, definitionId: input.definitionId }).slice(0, 16)}`;
      const grant = Object.freeze({
        kind: "IdentifiedSkillCardGrant",
        grantId,
        instanceId: `identified-skill-${grantId.slice(-16)}`,
        definitionId: input.definitionId,
        level: stack.skillLevel,
        sourceStackId: stack.stackId,
      });
      stack.quantity -= 1;
      if (stack.quantity === 0) skillCardStacks.splice(stackIndex, 1);
      return grant;
    }, (state, grant) => Object.freeze({ snapshot: state, grant }));
  }

  function authorizeWeaponGrant(input) {
    return command("authorize_weapon_grant", input, ["instanceId"], () => {
      const index = items.findIndex((entry) => entry.instanceId === input.instanceId);
      if (index < 0 || items[index].category !== ITEM_CATEGORY.WEAPON) throw new EquipmentCommandError("WEAPON_ITEM_NOT_OWNED", "loot weapon is not owned");
      const item = items[index];
      if (item.subtype !== "two_handed_sword") throw new EquipmentCommandError("WEAPON_TYPE_NOT_IMPLEMENTED", "this weapon type has no formal mastery/loadout definition yet");
      const grant = Object.freeze({
        kind: "LootWeaponGrant",
        grantId: `weapon-grant-${stableHash({ instanceId: item.instanceId, itemVersion: item.version }).slice(0, 16)}`,
        sourceItemInstanceId: item.instanceId,
        instanceId: `domain-${item.instanceId}`,
        definitionId: "two_handed_sword",
        rolledAffixes: [...(item.baseStats ?? []), ...(item.affixes ?? [])],
        rolledWeaponSkillDefinitionIds: item.rolledWeaponSkillDefinitionIds ?? [],
        skillCardSocketCount: item.skillCardSocketCount,
        supportSocketsPerSkill: item.supportSocketsPerSkill,
        grantedSocketedSkillCard: item.grantedSocketedSkillCard,
      });
      items[index] = { ...item, loadoutBound: true, loadoutWeaponInstanceId: grant.instanceId };
      return grant;
    }, (state, grant) => Object.freeze({ snapshot: state, grant }));
  }

  function discard(input) { return command("discard", input, ["instanceId"], () => {
    const index = items.findIndex((entry) => entry.instanceId === input.instanceId);
    if (index < 0) throw new EquipmentCommandError("ITEM_NOT_OWNED", "equipment item is not owned");
    if (Object.values(slots).includes(input.instanceId) || items[index].loadoutBound) throw new EquipmentCommandError("EQUIPPED_ITEM_LOCKED", "equipped or loadout-bound item must be unequipped first");
    items.splice(index, 1);
  }); }

  function saleValue(item) { return Math.max(1, item.itemLevel) * (RARITY_META[item.rarity]?.rank + 1 || 1) * 5; }
  function normalizeSaleFilter(filter) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new EquipmentCommandError("INVALID_SALE_FILTER", "sale filter must be an object");
    for (const key of Object.keys(filter)) if (!["maximumItemLevel", "rarities", "positions"].includes(key)) throw new EquipmentCommandError("INVALID_SALE_FILTER", `unexpected sale filter field ${key}`);
    const maximumItemLevel = filter.maximumItemLevel;
    if (!Number.isInteger(maximumItemLevel) || maximumItemLevel < 1 || maximumItemLevel > 100) throw new EquipmentCommandError("INVALID_SALE_FILTER", "maximumItemLevel must be 1-100");
    const rarities = filter.rarities ?? [];
    if (!Array.isArray(rarities) || rarities.some((rarity) => !ITEM_RARITIES.includes(rarity))) throw new EquipmentCommandError("INVALID_SALE_FILTER", "rarities contain an unknown value");
    const validPositions = ["weapon", ...EQUIPMENT_SLOTS]; const positions = filter.positions ?? [];
    if (!Array.isArray(positions) || positions.some((position) => !validPositions.includes(position))) throw new EquipmentCommandError("INVALID_SALE_FILTER", "positions contain an unknown value");
    return { maximumItemLevel, rarities: [...new Set(rarities)], positions: [...new Set(positions)] };
  }
  function itemMatchesSaleFilter(item, filter) {
    const position = item.category === ITEM_CATEGORY.WEAPON ? "weapon" : item.slot;
    return item.itemLevel <= filter.maximumItemLevel && (!filter.rarities.length || filter.rarities.includes(item.rarity)) && (!filter.positions.length || filter.positions.includes(position));
  }
  function sellItems(input) {
    const filter = normalizeSaleFilter(input?.filter);
    return command("sell_items", input, ["filter"], () => {
      const equipped = new Set(Object.values(slots).filter(Boolean));
      const sold = items.filter((item) => !equipped.has(item.instanceId) && !item.loadoutBound && itemMatchesSaleFilter(item, filter));
      if (!sold.length) throw new EquipmentCommandError("NO_ITEMS_MATCH_SALE_FILTER", "no unequipped items match the sale filter");
      const soldIds = new Set(sold.map((item) => item.instanceId));
      items = items.filter((item) => !soldIds.has(item.instanceId));
      gold += sold.reduce((sum, item) => sum + saleValue(item), 0);
    });
  }

  function craftItem(input) {
    return command("craft_item", input, ["instanceId", "currencyId", "catalystId", "catalystIds"], () => {
      const index = items.findIndex((entry) => entry.instanceId === input.instanceId);
      if (index < 0) throw new EquipmentCommandError("ITEM_NOT_OWNED", "craft target is not owned");
      if (items[index].loadoutBound) throw new EquipmentCommandError("EQUIPPED_WEAPON_CRAFT_LOCKED", "unequip the active weapon before crafting so the server can rebuild its WeaponLoadout atomically");
      const currency = CRAFTING_CURRENCIES.find((entry) => entry.id === input.currencyId);
      if (input.catalystIds != null && !Array.isArray(input.catalystIds)) throw new EquipmentCommandError("INVALID_OMEN_LIST", "catalystIds must be an array");
      const catalystIds = input.catalystIds ?? (input.catalystId ? [input.catalystId] : []), catalysts = catalystIds.map((id) => CRAFTING_CURRENCIES.find((entry) => entry.id === id));
      if (!currency || !currency.enabled || currency.catalyst) throw new EquipmentCommandError("CURRENCY_NOT_USABLE", "selected currency cannot craft this item");
      if (catalystIds.some((id) => typeof id !== "string") || new Set(catalystIds).size !== catalystIds.length || catalysts.some((entry) => !entry || !entry.enabled || !entry.catalyst)) throw new EquipmentCommandError("OMEN_NOT_USABLE", "selected omen list is invalid");
      if ((currencies[currency.id] ?? 0) < 1) throw new EquipmentCommandError("CURRENCY_NOT_OWNED", "selected currency quantity is zero");
      if (catalysts.some((entry) => (currencies[entry.id] ?? 0) < 1)) throw new EquipmentCommandError("CATALYST_NOT_OWNED", "selected omen quantity is zero");
      craftSerial += 1;
      let crafted;
      if (currency.id === "mirror") {
        if (items.length >= maximumEquipmentItems) { craftSerial -= 1; throw new EquipmentCommandError("EQUIPMENT_INVENTORY_FULL", "equipment inventory is full"); }
        if (items[index].mirrored || items[index].rarity === ITEM_RARITY.UNIQUE) { craftSerial -= 1; throw new EquipmentCommandError("MIRROR_TARGET_INVALID", "mirrored or unique items cannot be copied"); }
        acquisitionSerial += 1;
        crafted = { ...structuredClone(items[index]), instanceId: `mirror-${stableHash({ source: items[index].instanceId, craftSerial, entropy: options.serverEntropy ?? "m4d-server" }).slice(0, 16)}`, name: `${items[index].name} · 镜像`, mirrored: true, loadoutBound: false, loadoutWeaponInstanceId: null, acquiredOrder: acquisitionSerial, version: 1, craftHistory: [...(items[index].craftHistory ?? []), { currencyId: "mirror", sourceItemInstanceId: items[index].instanceId }] };
        items.push(crafted); currencies[currency.id] -= 1;
        return crafted;
      }
      if (currency.id === "foretelling_braid") {
        if (items[index].mirrored || items[index].corrupted) { craftSerial -= 1; throw new EquipmentCommandError("FORETELLING_TARGET_INVALID", "mirrored or corrupted items cannot be foretold"); }
        if (items[index].foretelling) { craftSerial -= 1; throw new EquipmentCommandError("ITEM_ALREADY_FORETOLD", "item already has an active foretelling"); }
        const foretelling = { kind: "currency_foretelling", seed: stableHash({ entropy: options.serverEntropy ?? "m4d-server", craftSerial, instanceId: items[index].instanceId, version: items[index].version }), appliedAtVersion: items[index].version };
        crafted = { ...structuredClone(items[index]), foretelling, version: (items[index].version ?? 1) + 1, craftHistory: [...(items[index].craftHistory ?? []), { currencyId: currency.id, resultingAffixCount: items[index].affixes?.length ?? 0 }] };
        items[index] = crafted; currencies[currency.id] -= 1; return crafted;
      }
      const foretellingSeed = items[index].foretelling?.seed ? `${items[index].foretelling.seed}:${currency.id}:${catalystIds.join(",") || "none"}` : null;
      try { crafted = craftItemWithCurrency({ item: items[index], currencyId: currency.id, catalystIds, serverSeed: foretellingSeed ?? `${options.serverEntropy ?? "m4d-server"}:${craftSerial}:${items[index].instanceId}:${items[index].version}` }); }
      catch (error) { craftSerial -= 1; throw new EquipmentCommandError(error.code ?? "CRAFT_FAILED", error.message); }
      if (items[index].foretelling) { const { foretelling: _consumed, ...withoutForetelling } = structuredClone(crafted); crafted = withoutForetelling; }
      items[index] = crafted; currencies[currency.id] -= 1; for (const catalyst of catalysts) currencies[catalyst.id] -= 1;
      return crafted;
    }, (state, crafted) => Object.freeze({ snapshot: state, item: structuredClone(crafted) }));
  }

  function previewCraftItem(input) {
    if (!input || typeof input !== "object") throw new EquipmentCommandError("INVALID_COMMAND", "preview command must be an object");
    for (const key of Object.keys(input)) if (!["expectedVersion", "instanceId", "currencyId", "catalystId", "catalystIds"].includes(key)) throw new EquipmentCommandError("UNEXPECTED_COMMAND_FIELD", `unexpected field ${key}`);
    if (input.expectedVersion !== version) throw new EquipmentCommandError("VERSION_CONFLICT", "equipment version conflict");
    const item = items.find((entry) => entry.instanceId === input.instanceId); if (!item) throw new EquipmentCommandError("ITEM_NOT_OWNED", "craft target is not owned");
    if (!item.foretelling?.seed) throw new EquipmentCommandError("FORETELLING_REQUIRED", "item has no active foretelling");
    if (input.catalystIds != null && !Array.isArray(input.catalystIds)) throw new EquipmentCommandError("INVALID_OMEN_LIST", "catalystIds must be an array");
    const currency = CRAFTING_CURRENCIES.find((entry) => entry.id === input.currencyId), catalystIds = input.catalystIds ?? (input.catalystId ? [input.catalystId] : []), catalysts = catalystIds.map((id) => CRAFTING_CURRENCIES.find((entry) => entry.id === id));
    if (!currency || !currency.enabled || currency.catalyst || currency.serviceOperation) throw new EquipmentCommandError("CURRENCY_NOT_PREVIEWABLE", "selected currency cannot be foretold");
    if (catalysts.some((entry) => !entry || !entry.enabled || !entry.catalyst)) throw new EquipmentCommandError("OMEN_NOT_USABLE", "selected omen is not enabled");
    if ((currencies[currency.id] ?? 0) < 1 || catalysts.some((entry) => (currencies[entry.id] ?? 0) < 1)) throw new EquipmentCommandError("CURRENCY_NOT_OWNED", "previewed currency is not owned");
    try { return Object.freeze({ equipmentVersion: version, item: structuredClone(craftItemWithCurrency({ item, currencyId: currency.id, catalystIds, serverSeed: `${item.foretelling.seed}:${currency.id}:${catalystIds.join(",") || "none"}` })) }); }
    catch (error) { throw new EquipmentCommandError(error.code ?? "CRAFT_PREVIEW_FAILED", error.message); }
  }

  function grantTestCurrencies(input) {
    if (!allowTestCommands) throw new EquipmentCommandError("TEST_COMMAND_DISABLED", "test currency grants are disabled");
    return command("grant_test_currencies", input, ["currencyId", "amount"], () => {
      const amount = input.amount;
      if (!Number.isInteger(amount) || amount < 1 || amount > 9999) throw new EquipmentCommandError("INVALID_TEST_GRANT_AMOUNT", "test grant amount must be 1-9999");
      const ids = input.currencyId === "all" ? CRAFTING_CURRENCIES.filter((entry) => entry.enabled).map((entry) => entry.id) : [input.currencyId];
      if (!ids.length || ids.some((id) => !CRAFTING_CURRENCIES.some((entry) => entry.id === id && entry.enabled))) throw new EquipmentCommandError("UNKNOWN_TEST_CURRENCY", "test currency must be enabled");
      for (const id of ids) currencies[id] = Math.min(999999, (currencies[id] ?? 0) + amount);
      return { currencyIds: ids, amount };
    }, (state, grant) => Object.freeze({ snapshot: state, grant }));
  }

  function equip(input) { return command("equip", input, ["instanceId", "slot"], () => { const item = items.find((entry) => entry.instanceId === input.instanceId); if (!item) throw new EquipmentCommandError("ITEM_NOT_OWNED", "equipment item is not owned"); if (!EQUIPMENT_SLOTS.includes(input.slot) || item.slot !== input.slot) throw new EquipmentCommandError("SLOT_MISMATCH", "item cannot be equipped in this slot"); slots[input.slot] = item.instanceId; }); }
  function unequip(input) { return command("unequip", input, ["slot"], () => { if (!EQUIPMENT_SLOTS.includes(input.slot)) throw new EquipmentCommandError("UNKNOWN_SLOT", "unknown equipment slot"); slots[input.slot] = null; }); }
  return Object.freeze({ snapshot, grantDrop, grantValidationWeapon, rollMonsterLoot, collectDrop, identifySkillGem, authorizeWeaponGrant, discard, sellItems, craftItem, previewCraftItem, grantTestCurrencies, equip, unequip });
}
