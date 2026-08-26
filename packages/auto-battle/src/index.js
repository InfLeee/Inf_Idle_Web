export const DEFAULT_PRIORITY_LAYERS = ["temporary", "highlight", "burst", "slot_order"];

function isUsable(skill, state) {
  const readyAt = state.cooldowns?.[skill.id] ?? 0;
  const resource = state.resource ?? 0;
  const requiredResource = skill.activationResource ?? skill.resourceCost ?? 0;
  return skill.enabled !== false && readyAt <= state.now && resource >= requiredResource;
}

function activeSlots(build, state) {
  const actionSlots = build.skillSlots.map((baseSkill, slotIndex) => {
    const replacement = state.temporaryReplacementBySlot?.[slotIndex];
    return { slotIndex, skill: replacement ?? baseSkill, replaced: Boolean(replacement) };
  }).filter((slot) => Boolean(slot.skill));
  const weaponSkills = (build.weaponSkills ?? []).map((skill) => ({
    slotIndex: null,
    skill,
    replaced: false,
    priorityOnly: true,
  }));
  return [...actionSlots, ...weaponSkills];
}

export function chooseNextAction(build, state, policy = {}) {
  const layers = policy.priorityLayers ?? DEFAULT_PRIORITY_LAYERS;
  const slots = activeSlots(build, state);
  const highlighted = new Set(state.highlightedSkillIds ?? []);
  const burstReady = new Set(state.burstReadySkillIds ?? []);

  for (const layer of layers) {
    let candidates = [];
    if (layer === "temporary") candidates = slots.filter((slot) => slot.replaced);
    else if (layer === "highlight") candidates = slots.filter((slot) => highlighted.has(slot.skill.id));
    else if (layer === "burst") candidates = slots.filter((slot) => burstReady.has(slot.skill.id) || slot.skill.role === "burst");
    else if (layer === "slot_order") candidates = slots.filter((slot) => !slot.priorityOnly && !slot.skill.backgroundAction);
    else throw new Error(`Unknown priority layer: ${layer}`);

    const selected = candidates.find(({ skill }) => isUsable(skill, state));
    if (selected) return { type: "cast", reason: layer, ...selected };
  }

  return { type: "wait", reason: "no_usable_skill" };
}

export function applyChosenAction(action, state) {
  if (action.type !== "cast") return { ...state, now: state.now + 100 };
  const skill = action.skill;
  return {
    ...state,
    now: state.now + (skill.actionTimeMs ?? 1000),
    resource: (state.resource ?? 0) - (skill.resourceCost ?? 0) + (skill.resourceGain ?? 0),
    cooldowns: {
      ...(state.cooldowns ?? {}),
      [skill.id]: state.now + (skill.cooldownMs ?? 0),
    },
  };
}
