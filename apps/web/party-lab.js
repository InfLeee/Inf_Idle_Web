import { createAuthoritativePartyService } from "../../packages/server-core/src/authoritative-party-service.js";
import { currentLoadoutSnapshot, subscribeLoadoutSnapshot } from "./loadout-authority.js?v=m4c-closure-3";

const $ = (id) => document.getElementById(id);
const LEADER_ID = "party-hero";
const candidates = [
  { characterId: "party-tank", accountId: "test-tank", displayName: "守护骑士", level: 30, defaultRole: "TANK", buildRef: { loadoutVersion: 2, buildHash: "tank-server-build-0001" } },
  { characterId: "party-healer", accountId: "test-healer", displayName: "治愈服事", level: 30, defaultRole: "HEALER", buildRef: { loadoutVersion: 3, buildHash: "healer-server-build-01" } },
  { characterId: "party-dps", accountId: "test-dps", displayName: "迅捷游侠", level: 30, defaultRole: "DPS", buildRef: { loadoutVersion: 4, buildHash: "ranger-server-build-01" } },
  { characterId: "party-extra", accountId: "test-extra", displayName: "候补法师", level: 30, defaultRole: "DPS", buildRef: { loadoutVersion: 1, buildHash: "wizard-server-build-01" } },
];
function leaderBuildRef(snapshot) {
  return snapshot?.compiledBuild
    ? { loadoutVersion: snapshot.loadoutVersion, buildHash: snapshot.compiledBuild.buildHash }
    : null;
}
const initialLoadout = currentLoadoutSnapshot();
const party = createAuthoritativePartyService({
  leaderCharacterId: LEADER_ID,
  leaderRole: "DPS",
  profiles: [
    { characterId: LEADER_ID, accountId: "local-player", displayName: "双手剑持有者", level: 30, buildRef: leaderBuildRef(initialLoadout) },
    ...candidates,
  ],
});
let snapshot = party.snapshot();
let requestSequence = 0;
let lastLeaderBuildKey = JSON.stringify(snapshot.members[0].buildRef);

const roleNames = { TANK: "坦克", HEALER: "治疗", DPS: "输出" };
const nextRole = { TANK: "HEALER", HEALER: "DPS", DPS: "TANK" };
function command(actorCharacterId = LEADER_ID) {
  requestSequence += 1;
  return { requestId: `party-ui-${requestSequence}`, expectedVersion: snapshot.partyVersion, actorCharacterId };
}
function setStatus(message, tone = "ready") {
  $("partyCommandState").textContent = message;
  $("partyCommandState").dataset.tone = tone;
}
function execute(action, successMessage) {
  try {
    snapshot = action();
    setStatus(successMessage);
    render();
    return true;
  } catch (error) {
    setStatus(`服务器拒绝 · ${error.code ?? error.message}`, "error");
    render();
    return false;
  }
}
function memberCard(member) {
  const ref = member.buildRef;
  return `<article class="party-slot occupied role-${member.role.toLowerCase()}">
    <div class="party-avatar">${member.role === "TANK" ? "盾" : member.role === "HEALER" ? "愈" : "刃"}</div>
    <div class="party-member-copy"><small>槽位 ${member.slot} · ${member.isLeader ? "队长" : roleNames[member.role]}</small><strong>${member.displayName}</strong><span>Lv.${member.level} · ${ref ? `构筑 v${ref.loadoutVersion} / ${ref.buildHash.slice(0, 10)}` : "当前无可战斗构筑"}</span></div>
    <b class="party-ready ${member.ready ? "ready" : ""}">${member.ready ? "已就绪" : "未就绪"}</b>
    <div class="party-member-actions">
      <button type="button" data-party-ready="${member.characterId}">${member.ready ? "取消就绪" : "设为就绪"}</button>
      <button type="button" data-party-role="${member.characterId}">定位：${roleNames[member.role]}</button>
      ${member.isLeader ? "" : `<button type="button" data-party-remove="${member.characterId}">移出</button>`}
    </div>
  </article>`;
}
function render() {
  const occupied = snapshot.members.map(memberCard);
  while (occupied.length < snapshot.capacity) occupied.push(`<article class="party-slot empty"><div>＋</div><strong>空队伍槽位</strong><span>等待服务器确认成员加入</span></article>`);
  $("partySlots").innerHTML = occupied.join("");
  $("partyVersion").textContent = `Party v${snapshot.partyVersion}`;
  $("partyHash").textContent = snapshot.partyHash.slice(0, 16);
  $("partyCapacity").textContent = `${snapshot.members.length} / ${snapshot.capacity}`;
  const roles = snapshot.members.reduce((result, member) => ({ ...result, [member.role]: (result[member.role] ?? 0) + 1 }), {});
  $("partyComposition").textContent = `坦 ${roles.TANK ?? 0} · 治 ${roles.HEALER ?? 0} · 输出 ${roles.DPS ?? 0}`;
  $("partyBuildRefs").textContent = `${snapshot.members.filter((member) => member.buildRef).length} / ${snapshot.members.length} 可解析`;
  $("partyCandidates").innerHTML = candidates.map((candidate) => {
    const joined = snapshot.members.some((member) => member.characterId === candidate.characterId);
    return `<button type="button" data-party-add="${candidate.characterId}" ${joined || snapshot.members.length >= snapshot.capacity ? "disabled" : ""}><b>${candidate.displayName}</b><small>${roleNames[candidate.defaultRole]} · ${joined ? "已在队伍" : "加入测试"}</small></button>`;
  }).join("");

  window.__partySnapshot = snapshot;
  window.dispatchEvent(new CustomEvent("party-snapshot-updated", { detail: snapshot }));
  $("partySlots").querySelectorAll("[data-party-ready]").forEach((button) => button.addEventListener("click", () => {
    const member = snapshot.members.find((entry) => entry.characterId === button.dataset.partyReady);
    execute(() => party.setReady({ ...command(member.characterId), ready: !member.ready }), `${member.displayName} 就绪状态已由服务器更新`);
  }));
  $("partySlots").querySelectorAll("[data-party-role]").forEach((button) => button.addEventListener("click", () => {
    const member = snapshot.members.find((entry) => entry.characterId === button.dataset.partyRole);
    execute(() => party.setRole({ ...command(LEADER_ID), characterId: member.characterId, role: nextRole[member.role] }), `${member.displayName} 已切换为${roleNames[nextRole[member.role]]}`);
  }));
  $("partySlots").querySelectorAll("[data-party-remove]").forEach((button) => button.addEventListener("click", () => {
    const member = snapshot.members.find((entry) => entry.characterId === button.dataset.partyRemove);
    execute(() => party.removeMember({ ...command(), characterId: member.characterId }), `${member.displayName} 已移出队伍`);
  }));
  $("partyCandidates").querySelectorAll("[data-party-add]").forEach((button) => button.addEventListener("click", () => {
    const candidate = candidates.find((entry) => entry.characterId === button.dataset.partyAdd);
    execute(() => party.addMember({ ...command(), characterId: candidate.characterId, role: candidate.defaultRole }), `${candidate.displayName} 已加入队伍`);
  }));
}
function fillTriangleParty() {
  for (const candidate of candidates.slice(0, 3)) {
    if (snapshot.members.some((member) => member.characterId === candidate.characterId)) continue;
    if (snapshot.members.length >= snapshot.capacity) break;
    snapshot = party.addMember({ ...command(), characterId: candidate.characterId, role: candidate.defaultRole });
  }
  setStatus("服务器已建立 1坦克 + 1治疗 + 2输出测试队伍");
  render();
}
$("partyFillBtn").addEventListener("click", fillTriangleParty);
$("partyForgeryBtn").addEventListener("click", () => {
  const candidate = candidates.find((entry) => !snapshot.members.some((member) => member.characterId === entry.characterId)) ?? candidates[0];
  execute(() => party.addMember({ ...command(), characterId: candidate.characterId, role: candidate.defaultRole, buildHash: "client-forged-build" }), "异常：伪造包被接受");
});
$("partyNavBtn")?.addEventListener("click", () => $("partyLab").scrollIntoView({ behavior: "smooth", block: "start" }));
subscribeLoadoutSnapshot((loadoutSnapshot) => {
  const buildRef = leaderBuildRef(loadoutSnapshot);
  const key = JSON.stringify(buildRef);
  if (key === lastLeaderBuildKey) return;
  lastLeaderBuildKey = key;
  snapshot = party.setMemberAuthorityProfile(LEADER_ID, { buildRef });
  setStatus(buildRef ? "当前角色最新权威构筑已同步到队伍引用" : "当前角色无可战斗构筑，队伍引用已清空", buildRef ? "ready" : "warning");
  render();
});
render();
