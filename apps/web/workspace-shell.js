const $ = (id) => document.getElementById(id);
const content = document.querySelector(".content");
const pageHeader = document.querySelector(".page-header");
const viewport = document.querySelector(".viewport-panel");
const metrics = document.querySelector(".metric-grid");
const aura = document.querySelector(".aura-panel");

const battleDock = document.createElement("div");
battleDock.className = "battle-dock";
battleDock.setAttribute("aria-label", "固定实时战斗窗口");
content.insertBefore(battleDock, viewport);
battleDock.append(pageHeader, viewport, metrics, aura);

const mastery = $("masteryWorkbench");
const masteryGroup = document.createElement("section");
masteryGroup.className = "workspace-group mastery-workspace-group";
if (mastery) masteryGroup.append(mastery);

const definitions = [
  { id: "combat", name: "战斗验证", hint: "日志与遭遇", nodes: [document.querySelector(".encounter-tuning"), document.querySelector(".server-authority-lab"), document.querySelector(".lower-grid")] },
  { id: "party", name: "四人队伍", hint: "成员与定位", nodes: [$("partyLab")] },
  { id: "character", name: "角色属性", hint: "六维与二级属性", nodes: [document.querySelector(".character-stats-lab")] },
  { id: "build", name: "武器构筑", hint: "穿戴与背包", nodes: [document.querySelector(".character-weapon-panel"), $("inventoryPanel"), $("loadoutLab")] },
  { id: "mastery", name: "武器精通", hint: "节点与效果", nodes: [masteryGroup] },
  { id: "timing", name: "时序测试", hint: "吟唱与引导", nodes: [$("timingLab")] },
  { id: "numerics", name: "数值实验室", hint: "M3 可验收", nodes: [$("m3NumericLab")] },
  { id: "itemization", name: "掉落背包", hint: "M4C 可验收", nodes: [$("m4ItemizationLab")] },
];

const workspace = document.createElement("section");
workspace.className = "workspace-shell";
workspace.innerHTML = `<header class="workspace-bar"><nav id="workspaceTabs" aria-label="功能分页面"></nav></header><div id="workspaceViews" class="workspace-views"></div>`;
content.append(workspace);
const tabs = $("workspaceTabs");
const views = $("workspaceViews");
for (const definition of definitions) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.workspaceTab = definition.id;
  button.innerHTML = `<b>${definition.name}</b><small>${definition.hint}</small>`;
  tabs.append(button);
  const view = document.createElement("section");
  view.className = "workspace-view";
  view.dataset.workspaceView = definition.id;
  view.hidden = true;
  definition.nodes.filter(Boolean).forEach((node) => view.append(node));
  views.append(view);
}

let activeTab = "combat";
function activateTab(tabId) {
  if (!definitions.some((definition) => definition.id === tabId)) return;
  activeTab = tabId;
  tabs.querySelectorAll("[data-workspace-tab]").forEach((button) => button.classList.toggle("active", button.dataset.workspaceTab === tabId));
  views.querySelectorAll("[data-workspace-view]").forEach((view) => { view.hidden = view.dataset.workspaceView !== tabId; });
  views.scrollTop = 0;
}
tabs.querySelectorAll("[data-workspace-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.workspaceTab)));
$("partyNavBtn")?.addEventListener("click", () => activateTab("party"));
$("masteryNavBtn")?.addEventListener("click", () => activateTab("mastery"));

function updateBattleDockHeight() {
  const logicalHeight = Math.max(350, Math.min(620, window.innerHeight * .56));
  document.documentElement.style.setProperty("--battle-dock-height", `${Math.round(logicalHeight)}px`);
}

const partyRoster = document.createElement("section");
partyRoster.id = "battlePartyRoster";
partyRoster.className = "battle-party-roster";
document.querySelector(".encounter-view .player-summary")?.after(partyRoster);
const radarPartyUnits = document.createElement("div");
radarPartyUnits.id = "radarPartyUnits";
radarPartyUnits.className = "radar-party-units";
$("radarUnits")?.after(radarPartyUnits);
const partyHeaderState = document.createElement("span");
partyHeaderState.className = "header-party-state";
partyHeaderState.innerHTML = "<small>队伍</small><b>单人</b>";
document.querySelector(".header-meta")?.prepend(partyHeaderState);

const partyPositions = [{ x: 44, y: 52 }, { x: 56, y: 52 }, { x: 50, y: 43 }];
const roleNames = { TANK: "坦克", HEALER: "治疗", DPS: "输出" };
function renderBattleParty(snapshot) {
  const members = snapshot?.members ?? [];
  const allies = members.filter((member) => !member.isLeader);
  partyHeaderState.innerHTML = `<small>队伍</small><b>${members.length || 1} / 4</b>`;
  if (!allies.length) {
    partyRoster.innerHTML = `<div class="battle-party-empty"><b>当前为单人战斗</b><span>在“四人队伍”页签加入成员后，队友会同步到这里和雷达中心。</span></div>`;
    radarPartyUnits.innerHTML = "";
    return;
  }
  partyRoster.innerHTML = `<header><b>队友状态</b><span>来自 Party v${snapshot.partyVersion} 权威快照</span></header><div>${allies.map((member) => `<article class="battle-ally role-${member.role.toLowerCase()}"><img src="./assets/player-knight.png" alt=""><div><small>${roleNames[member.role]}</small><b>${member.displayName}</b><i><em></em></i></div><strong>HP 100%</strong></article>`).join("")}</div>`;
  radarPartyUnits.innerHTML = allies.map((member, index) => {
    const position = partyPositions[index];
    return `<span class="radar-party-unit role-${member.role.toLowerCase()}" style="left:${position.x}%;top:${position.y}%" title="${member.displayName} · ${roleNames[member.role]}"><img src="./assets/player-knight.png" alt=""><b>${roleNames[member.role]}</b></span>`;
  }).join("");
}
window.addEventListener("resize", updateBattleDockHeight);
window.addEventListener("party-snapshot-updated", (event) => renderBattleParty(event.detail));
renderBattleParty(window.__partySnapshot);
updateBattleDockHeight();
activateTab(activeTab);
pageHeader?.classList.add("compact");
