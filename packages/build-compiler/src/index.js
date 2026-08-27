export * from "./applySupportScripts.js";
export * from "./compileActionBuild.js";
export * from "./twoHandedSwordA1Adapter.js";

const clone = (value) => structuredClone(value);

function hasAll(tags, required = []) {
  const set = new Set(tags);
  return required.every((tag) => set.has(tag));
}

function hasAny(tags, excluded = []) {
  const set = new Set(tags);
  return excluded.some((tag) => set.has(tag));
}

function isCompatible(skill, rule = {}) {
  return hasAll(skill.tags, rule.requireAll) && !hasAny(skill.tags, rule.excludeAny);
}

function getAtPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function setAtPath(target, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let cursor = target;
  for (const key of keys) cursor = cursor[key] ??= {};
  cursor[last] = value;
}

function applyEffect(skill, effect) {
  const current = getAtPath(skill, effect.path);
  if (effect.operator === "set") setAtPath(skill, effect.path, clone(effect.value));
  else if (effect.operator === "add") setAtPath(skill, effect.path, current + effect.value);
  else if (effect.operator === "multiply") setAtPath(skill, effect.path, current * effect.value);
  else throw new Error(`Unsupported operator: ${effect.operator}`);
}

function applyMasteries(skills, masteries, phase, diagnostics) {
  for (const mastery of masteries.filter((item) => (item.phase ?? "post_support") === phase)) {
    const skill = skills.get(mastery.skillId);
    if (!skill) throw new Error(`Mastery target skill not found: ${mastery.skillId}`);
    for (const effect of mastery.effects ?? []) applyEffect(skill, effect);
    diagnostics.push({ type: "mastery_applied", masteryId: mastery.id, phase, skillId: mastery.skillId });
  }
}

function compileIdentity(skill, supports, diagnostics) {
  const pending = supports.filter((support) => support.identityChange);
  const history = new Map(pending.map((support) => [support.id, []]));
  let step = 0;

  while (pending.some((support) => !support.__applied)) {
    step += 1;
    const frozenTags = [...skill.tags];
    const eligible = pending.filter(
      (support) => !support.__applied && isCompatible({ tags: frozenTags }, support.compatibility),
    );
    if (eligible.length === 0) break;

    const grouped = new Map();
    const finalists = [];
    for (const support of eligible) {
      if (!support.conflictGroup) finalists.push(support);
      else {
        const group = grouped.get(support.conflictGroup) ?? [];
        group.push(support);
        grouped.set(support.conflictGroup, group);
      }
    }

    for (const group of grouped.values()) {
      group.sort((a, b) => a.insertionOrder - b.insertionOrder);
      finalists.push(group[0]);
      for (const loser of group.slice(1)) history.get(loser.id).push({ step, result: "mutual_exclusion" });
    }

    finalists.sort((a, b) => a.insertionOrder - b.insertionOrder);
    const winner = finalists[0];
    for (const delayed of finalists.slice(1)) history.get(delayed.id).push({ step, result: "delayed" });

    const remove = new Set(winner.identityChange.removeTags ?? []);
    skill.tags = skill.tags.filter((tag) => !remove.has(tag));
    skill.tags = [...new Set([...skill.tags, ...(winner.identityChange.addTags ?? [])])];
    for (const effect of winner.identityChange.effects ?? []) applyEffect(skill, effect);
    winner.__applied = true;
    history.get(winner.id).push({ step, result: "applied", inputTags: frozenTags, outputTags: [...skill.tags] });
  }

  for (const support of pending) {
    const events = history.get(support.id);
    const applied = events.some((event) => event.result === "applied");
    diagnostics.push({
      type: "identity_support",
      supportId: support.id,
      status: applied ? "active" : events.some((event) => event.result === "mutual_exclusion") ? "mutual_exclusion" : "incompatible",
      history: events,
    });
    delete support.__applied;
  }
}

function compileNormalSupports(skill, supports, diagnostics) {
  const candidates = [];
  for (const support of supports.filter((item) => !item.identityChange)) {
    if (!isCompatible(skill, support.compatibility)) {
      diagnostics.push({ type: "normal_support", supportId: support.id, status: "incompatible" });
      continue;
    }
    candidates.push(support);
  }

  const winners = new Set();
  const groups = new Map();
  for (const support of candidates) {
    if (!support.conflictGroup) winners.add(support.id);
    else {
      const group = groups.get(support.conflictGroup) ?? [];
      group.push(support);
      groups.set(support.conflictGroup, group);
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.insertionOrder - b.insertionOrder);
    winners.add(group[0].id);
  }

  for (const support of candidates.sort((a, b) => a.insertionOrder - b.insertionOrder)) {
    if (!winners.has(support.id)) {
      diagnostics.push({ type: "normal_support", supportId: support.id, status: "mutual_exclusion" });
      continue;
    }
    for (const effect of support.effects ?? []) applyEffect(skill, effect);
    diagnostics.push({ type: "normal_support", supportId: support.id, status: "active" });
  }
}

export function compileBuild(input) {
  const skills = new Map(input.skills.map((skill) => [skill.id, clone(skill)]));
  const supports = clone(input.supports ?? []).sort((a, b) => a.insertionOrder - b.insertionOrder);
  const masteries = clone(input.masteries ?? []);
  const diagnostics = [];

  applyMasteries(skills, masteries, "pre_support", diagnostics);
  for (const skill of skills.values()) {
    const attached = supports.filter((support) => support.skillId === skill.id);
    compileIdentity(skill, attached, diagnostics);
    compileNormalSupports(skill, attached, diagnostics);
  }
  applyMasteries(skills, masteries, "post_support", diagnostics);

  return {
    configVersion: input.configVersion,
    skillSlots: input.skillSlots.map((skillId) => clone(skills.get(skillId))),
    compiledSkills: [...skills.values()].map((skill) => clone(skill)),
    diagnostics,
  };
}
export * from "./applySkillReplacements.js";
