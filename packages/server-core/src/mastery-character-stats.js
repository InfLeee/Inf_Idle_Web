import { PRIMARY_STAT_IDS, compileCharacterStats } from "../../character-stats/src/index.js";

const DERIVED_BUCKETS = Object.freeze({
  equipmentBase: "equipmentBase",
  basePercent: "basePercent",
  extra: "extra",
});

function add(target, key, amount) {
  target[key] = (target[key] ?? 0) + amount;
}

export function applyMasteryCharacterStats(baseSnapshot, masteryBudget, config) {
  if (!baseSnapshot) return null;
  const primaryMasterySkill = { ...baseSnapshot.primary.masterySkill };
  const derivedBonuses = {
    equipmentBase: Object.fromEntries(Object.entries(baseSnapshot.derived.sources).map(([statId, source]) => [statId, source.equipmentBase])),
    basePercent: { ...baseSnapshot.derived.basePercent },
    extra: { ...baseSnapshot.derived.extra },
  };
  const provenance = [...(baseSnapshot.provenance ?? [])];
  const nodeNames = new Map((config.masteryNodes ?? []).map((node) => [node.id, node.name]));

  for (const item of masteryBudget.activeEffects) {
    if (!item.active) continue;
    const effect = item.effect;
    const amount = effect.amount * item.rank;
    if (effect.kind === "primary_stat_bonus") {
      if (!PRIMARY_STAT_IDS.includes(effect.statId)) throw new Error(`Unknown mastery primary stat ${effect.statId}`);
      add(primaryMasterySkill, effect.statId, amount);
      provenance.push({
        sourceKind: "mastery_node", sourceDefinitionId: item.nodeId, sourceName: nodeNames.get(item.nodeId) ?? item.nodeId,
        targetKind: "primary", statId: effect.statId, bucket: "masterySkill", amount,
      });
    } else if (effect.kind === "derived_stat_bonus") {
      if (!Object.hasOwn(baseSnapshot.derived.final, effect.statId)) throw new Error(`Unknown mastery derived stat ${effect.statId}`);
      const bucket = DERIVED_BUCKETS[effect.bucket];
      if (!bucket) throw new Error(`Unknown mastery derived bucket ${effect.bucket}`);
      add(derivedBonuses[bucket], effect.statId, amount);
      provenance.push({
        sourceKind: "mastery_node", sourceDefinitionId: item.nodeId, sourceName: nodeNames.get(item.nodeId) ?? item.nodeId,
        targetKind: "derived", statId: effect.statId, bucket, amount,
      });
    }
  }

  return compileCharacterStats({
    level: baseSnapshot.level,
    rules: baseSnapshot.rules,
    allocations: baseSnapshot.allocations,
    primaryBonuses: { masterySkill: primaryMasterySkill, extra: baseSnapshot.primary.extra },
    derivedBonuses,
    provenance,
  });
}
