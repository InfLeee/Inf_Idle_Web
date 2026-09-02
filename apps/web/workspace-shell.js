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

const testCenter = document.createElement("section");
testCenter.className = "test-center";
testCenter.innerHTML = `<header class="test-center-head"><div><small>DEVELOPMENT ACCEPTANCE HUB</small><h2>测试中心</h2><p>协议、权威校验与数值实验统一收束于此，不再与正式功能页并列。</p></div><b>4 组验证工具</b></header><nav id="testCenterTabs" class="test-center-tabs" aria-label="测试工具分类"></nav><div id="testCenterViews" class="test-center-views"></div>`;
const networkAuthorityBoundary = document.createElement("section");
networkAuthorityBoundary.id = "networkAuthorityBoundary";
networkAuthorityBoundary.className = "network-authority-boundary";
networkAuthorityBoundary.innerHTML = `<header><div><small>PRODUCTION AUTHORITY BOUNDARY</small><h3>网络权威边界</h3></div><b>当前：浏览器内权威模拟</b></header><div><article><small>正式服持久化</small><strong>角色资产 · 装备 · 构筑关系 · 成长属性</strong><span>仅服务器数据库可写，客户端不保存可信最终值。</span></article><article><small>战斗会话</small><strong>服务器 Runtime + 有界检查点</strong><span>战斗事件按增量发给客户端，不永久保存无界日志。</span></article><article><small>请求验证</small><strong>身份 · 所有权 · Revision · 幂等键 · 字段白名单</strong><span>截包改伤害、词缀、等级或最终属性均拒绝。</span></article><article><small>客户端职责</small><strong>输入意图 + 快照表现</strong><span>本地改字或改动画只影响显示，下个服务器快照会覆盖。</span></article></div><p>GitHub Pages 仅用于交互与协议验收，不是生产安全边界；正式部署必须把这些权威服务移出浏览器。</p>`;
const testDefinitions = [
  { id: "authority", name: "战斗与服务器", hint: "遭遇、回放、防篡改", nodes: [networkAuthorityBoundary, document.querySelector(".encounter-tuning"), document.querySelector(".server-authority-lab")] },
  { id: "timing", name: "时序协议", hint: "GCD、吟唱、引导", nodes: [$("timingLab")] },
  { id: "numerics", name: "数值实验", hint: "M3 批量验收", nodes: [$("m3NumericLab")] },
  { id: "projectiles", name: "投射物轨迹", hint: "齐射、碰撞、命中", nodes: [$("projectileVolleyLab")] },
];
const testTabs = testCenter.querySelector("#testCenterTabs");
const testViews = testCenter.querySelector("#testCenterViews");
for (const definition of testDefinitions) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.testCenterTab = definition.id;
  button.innerHTML = `<b>${definition.name}</b><small>${definition.hint}</small>`;
  testTabs.append(button);
  const view = document.createElement("section");
  view.className = "test-center-view";
  view.dataset.testCenterView = definition.id;
  view.hidden = true;
  definition.nodes.filter(Boolean).forEach((node) => view.append(node));
  testViews.append(view);
}
function activateTestView(testId) {
  if (!testDefinitions.some((definition) => definition.id === testId)) return;
  testTabs.querySelectorAll("[data-test-center-tab]").forEach((button) => button.classList.toggle("active", button.dataset.testCenterTab === testId));
  testViews.querySelectorAll("[data-test-center-view]").forEach((view) => { view.hidden = view.dataset.testCenterView !== testId; });
}
testTabs.querySelectorAll("[data-test-center-tab]").forEach((button) => button.addEventListener("click", () => activateTestView(button.dataset.testCenterTab)));
activateTestView("authority");

const definitions = [
  { id: "combat", name: "战斗日志", hint: "实时战斗与记录", nodes: [document.querySelector(".lower-grid")] },
  { id: "build", name: "武器构筑", hint: "穿戴与背包", nodes: [document.querySelector(".character-weapon-panel"), $("inventoryPanel"), $("loadoutLab")] },
  { id: "mastery", name: "武器精通", hint: "节点与效果", nodes: [masteryGroup] },
  { id: "character", name: "角色属性", hint: "六维与二级属性", nodes: [document.querySelector(".character-stats-lab")] },
  { id: "itemization", name: "掉落背包", hint: "M4C 成长闭环", nodes: [$("m4ItemizationLab")] },
  { id: "crafting", name: "装备打造", hint: "M4D 通货与词缀", nodes: [$("m4CraftingLab")] },
  { id: "party", name: "四人队伍", hint: "成员与定位", nodes: [$("partyLab")] },
  { id: "tests", name: "测试中心", hint: "协议与验收工具", nodes: [testCenter] },
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
$("testCenterNavBtn")?.addEventListener("click", () => activateTab("tests"));

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
