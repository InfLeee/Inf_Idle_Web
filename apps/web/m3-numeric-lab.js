import { COMBAT_NUMERICS_SCHEMA_VERSION } from "../../packages/combat-numerics/src/index.js";
import { compareM3DamageBatches, simulateM3DamageBatch } from "../../packages/combat-numerics/src/lab.js";
import { createM3MonsterTemplate } from "../../packages/game-config/m3-monster-templates.js";
import { currentLoadoutSnapshot, loadoutAuthority, publishLoadoutSnapshot, subscribeLoadoutSnapshot } from "./loadout-authority.js?v=m4c-closure-3";

const $ = (id) => document.getElementById(id);
const number = (value, digits = 1) => Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
const percent = (value) => `${number(value * 100, 1)}%`;
let snapshot = currentLoadoutSnapshot();
let latest = null;
let requestSerial = 1;

for (let level = 1; level <= 10; level += 1) {
  $("m3SkillLevel").insertAdjacentHTML("beforeend", `<option value="${level}">${level} 级</option>`);
  $("m3SupportLevel").insertAdjacentHTML("beforeend", `<option value="${level}">${level} 级</option>`);
}
$("m3Schema").textContent = COMBAT_NUMERICS_SCHEMA_VERSION;

function damageSkills(build) {
  return (build?.compiledSkills ?? []).filter((skill) => skill.actions.some((action) => action.effects.some((effect) => effect.kind === "direct_damage")));
}

function syncSkillOptions() {
  const previous = $("m3Skill").value;
  const skills = damageSkills(snapshot.compiledBuild);
  $("m3Skill").innerHTML = skills.map((skill) => `<option value="${skill.entryId}">${skill.actions[0]?.name ?? skill.definitionId}${skill.effectiveDefinitionId !== skill.definitionId ? "（已替换）" : ""}</option>`).join("");
  if (skills.some((skill) => skill.entryId === previous)) $("m3Skill").value = previous;
  const selected = skills.find((skill) => skill.entryId === $("m3Skill").value) ?? skills[0];
  const effect = selected?.actions.flatMap((action) => action.effects).find((item) => item.kind === "direct_damage");
  $("m3SkillLevel").value = String(effect?.params.skillLevel ?? selected?.runtime?.level ?? 1);
  $("m3SkillLevel").disabled = selected?.sourceType !== "skill_card";
  syncSupportOptions(selected);
}

function syncSupportOptions(selectedSkill) {
  const ownership = snapshot.ownershipInput;
  const connectedIds = ownership.loadout.supportConnections[selectedSkill?.sourceInstanceId] ?? [];
  const previous = $("m3Support").value;
  $("m3Support").innerHTML = connectedIds.length ? connectedIds.map((instanceId) => {
    const instance = ownership.supportCardInstances.find((item) => item.instanceId === instanceId);
    const name = ownership.registry.supports[instance?.definitionId]?.name ?? instance?.definitionId ?? instanceId;
    return `<option value="${instanceId}">${name}</option>`;
  }).join("") : '<option value="">当前技能未连接辅助卡</option>';
  if (connectedIds.includes(previous)) $("m3Support").value = previous;
  const instance = ownership.supportCardInstances.find((item) => item.instanceId === $("m3Support").value);
  $("m3Support").disabled = !instance;
  $("m3SupportLevel").disabled = !instance;
  $("m3SupportLevel").value = String(instance?.level ?? 1);
}

function commitSkillLevel() {
  const skill = snapshot.compiledBuild?.compiledSkills.find((item) => item.entryId === $("m3Skill").value);
  if (!skill || skill.sourceType !== "skill_card") return run();
  try {
    const next = loadoutAuthority.setSkillCardLevel({ requestId: `m3-skill-level-${requestSerial++}`, expectedVersion: snapshot.loadoutVersion, skillInstanceId: skill.sourceInstanceId, level: Number($("m3SkillLevel").value) });
    publishLoadoutSnapshot(next);
  } catch (error) { $("m3LabState").textContent = `技能升级被拒绝 · ${error.code ?? error.message}`; }
}

function commitSupportLevel() {
  const instanceId = $("m3Support").value;
  if (!instanceId) return run();
  try {
    const next = loadoutAuthority.setSupportCardLevel({ requestId: `m3-support-level-${requestSerial++}`, expectedVersion: snapshot.loadoutVersion, supportInstanceId: instanceId, level: Number($("m3SupportLevel").value) });
    publishLoadoutSnapshot(next);
  } catch (error) { $("m3LabState").textContent = `辅助卡升级被拒绝 · ${error.code ?? error.message}`; }
}

function currentInput(overrides = {}) {
  const build = snapshot.compiledBuild;
  if (!build) throw new Error("当前没有可战斗的权威构筑");
  const level = Math.max(1, Math.min(60, Number($("m3MonsterLevel").value) || 30));
  const monster = createM3MonsterTemplate({ tier: overrides.tier ?? $("m3MonsterTier").value, level });
  return {
    compiledBuild: build,
    skillEntryId: $("m3Skill").value,
    skillLevel: overrides.skillLevel ?? Number($("m3SkillLevel").value),
    monster,
    seed: Number($("m3Seed").value) || 0,
    samples: overrides.samples ?? Number($("m3Samples").value),
  };
}

function sourceLabel(stage) {
  const source = stage.source;
  if (!source) return stage.id === "mitigation" ? "目标防御与角色穿透" : stage.id === "variance" ? "CombatSession 随机种子" : "公共结算阶段";
  if (source.kind === "compiled_build") return source.label;
  if (source.kind === "skill_card") return `技能卡等级 ${source.level}`;
  if (source.kind === "skill") return `技能定义 ${source.definitionId}`;
  if (source.kind === "character_stat") return `角色属性 ${source.statId}`;
  return source.kind;
}

function renderStages(result) {
  const stages = result.numericBreakdown.stages;
  const maximum = Math.max(...stages.map((stage) => stage.output), 1);
  $("m3Stages").innerHTML = stages.map((stage) => `<div class="m3-stage"><label>${stage.label}<small title="${sourceLabel(stage)}">${sourceLabel(stage)}</small></label><i><em style="width:${Math.max(1, stage.output / maximum * 100)}%"></em></i><strong>${number(stage.output, 2)}</strong></div>`).join("");
}

function renderComparison(input, result) {
  const levelOne = simulateM3DamageBatch({ ...input, skillLevel: 1 });
  const comparison = compareM3DamageBatches(levelOne, result);
  const gain = comparison.averageDamage.relative;
  $("m3Comparison").innerHTML = `<article class="m3-compare-card"><small>A · 1级技能</small><strong>${number(levelOne.averageDamage)} 平均伤害</strong><b>${number(levelOne.dps)} DPS</b></article><article class="m3-compare-card"><small>B · 当前 ${input.skillLevel} 级</small><strong>${number(result.averageDamage)} 平均伤害</strong><b>${gain === null ? "基准为0" : `${gain >= 0 ? "+" : ""}${percent(gain)} 收益`}</b></article>`;
  const max = Math.max(...result.histogram, 1);
  $("m3Histogram").innerHTML = result.histogram.map((count, index) => `<i style="height:${Math.max(2, count / max * 100)}%" title="分桶 ${index + 1}：${count}"></i>`).join("");
}

function renderResult(input, result) {
  latest = result;
  const breakdown = result.numericBreakdown;
  $("m3LabState").textContent = `已同步 ${snapshot.compiledBuild.buildHash.slice(0, 12)} · ${result.samples} 样本`;
  $("m3Average").textContent = number(result.averageDamage);
  $("m3Range").textContent = `范围 ${number(result.minimumDamage, 0)}～${number(result.maximumDamage, 0)}`;
  $("m3Dps").textContent = number(result.dps);
  $("m3Frequency").textContent = `${number(result.castsPerSecond, 2)} 次/秒`;
  $("m3Crit").textContent = percent(result.criticalRate);
  $("m3CritProof").textContent = `理论 ${percent(breakdown.rates.effectiveCritChance)}`;
  $("m3Mitigation").textContent = percent(breakdown.rates.effectiveMitigationRate);
  $("m3DefenseProof").textContent = `防御 ${number(breakdown.rates.defenseRate * 100)}% − 穿透 ${number(breakdown.rates.penetrationRate * 100)}%`;
  $("m3Ttk").textContent = result.estimatedTtkSeconds === null ? "∞" : `${number(result.estimatedTtkSeconds, 2)}s`;
  $("m3MonsterProof").textContent = `${input.monster.name} · HP ${number(input.monster.maxHp, 0)}`;
  $("m3DamageType").textContent = ({ physical: "物理伤害", magic: "魔法伤害", true: "真实伤害" })[breakdown.damageType];
  renderStages(result);
  renderComparison(input, result);
}

function run() {
  try {
    const input = currentInput();
    renderResult(input, simulateM3DamageBatch(input));
  } catch (error) {
    latest = null;
    $("m3LabState").textContent = error.message;
    $("m3Stages").innerHTML = `<div class="m3-empty">装备带伤害技能的武器后，这里会即时生成权威数值拆解。</div>`;
  }
}

function runAcceptance() {
  const cases = [];
  try {
    const input = currentInput({ samples: 500 });
    const first = simulateM3DamageBatch(input);
    const repeated = simulateM3DamageBatch(input);
    const levelOne = simulateM3DamageBatch({ ...input, skillLevel: 1 });
    const levelTen = simulateM3DamageBatch({ ...input, skillLevel: 10 });
    const normal = simulateM3DamageBatch({ ...input, monster: createM3MonsterTemplate({ tier: "normal", level: input.monster.level }) });
    const boss = simulateM3DamageBatch({ ...input, monster: createM3MonsterTemplate({ tier: "boss", level: input.monster.level }) });
    cases.push(["来源账本阶段完整", first.numericBreakdown.stages.length >= 9]);
    cases.push(["相同种子完全复现", JSON.stringify(first) === JSON.stringify(repeated)]);
    cases.push(["技能1→10级伤害成长", levelTen.averageDamage > levelOne.averageDamage]);
    cases.push(["Boss击杀时间高于普通怪", boss.estimatedTtkSeconds > normal.estimatedTtkSeconds]);
    cases.push(["防御/穿透/暴击均有结果", Object.values(first.numericBreakdown.rates).every(Number.isFinite)]);
    cases.push(["批量结果与直方图有界", first.samples === 500 && first.histogram.length === 10]);
  } catch (error) {
    cases.push([error.message, false]);
  }
  $("m3AcceptanceCases").innerHTML = cases.map(([label, passed], index) => `<li class="${passed ? "pass" : "fail"}"><i>${passed ? "✓" : "!"}</i><span>${label}</span><strong>${passed ? "通过" : "失败"}</strong></li>`).join("");
}

$("m3Skill").addEventListener("change", () => { syncSkillOptions(); run(); });
$("m3SkillLevel").addEventListener("change", commitSkillLevel);
$("m3Support").addEventListener("change", () => { syncSupportOptions(snapshot.compiledBuild?.compiledSkills.find((item) => item.entryId === $("m3Skill").value)); run(); });
$("m3SupportLevel").addEventListener("change", commitSupportLevel);
for (const id of ["m3MonsterTier", "m3MonsterLevel", "m3Samples", "m3Seed"]) $(id).addEventListener("change", run);
$("m3Run").addEventListener("click", run);
$("m3RunAcceptance").addEventListener("click", runAcceptance);
subscribeLoadoutSnapshot((next) => { snapshot = next; syncSkillOptions(); run(); });
