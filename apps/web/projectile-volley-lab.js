import { createProjectileVolley, resolveProjectileVolleyCollisions } from "../../packages/combat-protocol/src/projectile-volley.js";

const $ = (id) => document.getElementById(id);
const stage = $("volleyStage");

if (stage) {
  const origin = Object.freeze({ x: 140, y: 210 });
  const target = { x: 535, y: 210, radius: 22 };
  let animationFrame = null;
  let fireSerial = 0;
  let dragging = false;

  function svgPoint(event) {
    const point = stage.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(stage.getScreenCTM().inverse());
  }
  function aimAngle() { return Math.atan2(target.y - origin.y, target.x - origin.x) * 180 / Math.PI; }
  function endpoint(angleDeg, distance = 680) { const radians = angleDeg * Math.PI / 180; return { x: origin.x + Math.cos(radians) * distance, y: origin.y + Math.sin(radians) * distance }; }
  function gridMarkup() { return `<circle cx="${origin.x}" cy="${origin.y}" r="64"/><circle cx="${origin.x}" cy="${origin.y}" r="128"/><circle cx="${origin.x}" cy="${origin.y}" r="192"/><line x1="20" y1="${origin.y}" x2="700" y2="${origin.y}"/><line x1="${origin.x}" y1="20" x2="${origin.x}" y2="400"/>`; }
  function actorMarkup(hit = false) { return `<g class="volley-player" transform="translate(${origin.x} ${origin.y})"><circle r="24"/><text text-anchor="middle" y="6">⚔</text></g><g id="volleyTarget" class="volley-target${hit ? " hit" : ""}" transform="translate(${target.x} ${target.y})"><circle r="${target.radius}"/><text text-anchor="middle" y="6">怪</text><path d="M-25,-31 h50"/></g>`; }
  function updatePresets(count) { $("volleyPresets").querySelectorAll("button").forEach((button) => button.classList.toggle("active", Number(button.dataset.volleyCount) === count)); }
  function fire() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    const count = Number($("volleyCount").value), volley = createProjectileVolley({ projectileCount: count, aimAngleDeg: aimAngle() });
    const collision = resolveProjectileVolleyCollisions({ volley, origin, maximumDistance: 680, targets: [{ targetId: "lab-target", ...target }] });
    const candidates = collision.projectiles.filter((projectile) => projectile.targetId !== null);
    const effectiveHitIndex = collision.projectiles.find((projectile) => projectile.effective)?.index ?? null;
    $("volleyGrid").innerHTML = gridMarkup(); $("volleyActors").innerHTML = actorMarkup(false);
    $("volleyTrajectories").innerHTML = `<line class="volley-aim-axis" x1="${origin.x}" y1="${origin.y}" x2="${target.x}" y2="${target.y}"/>${collision.projectiles.map((projectile) => { const end = endpoint(projectile.directionAngleDeg); return `<g data-projectile-index="${projectile.index}" data-hit-state="${projectile.state}"><line class="volley-path state-${projectile.state}" x1="${origin.x}" y1="${origin.y}" x2="${end.x}" y2="${end.y}"/><circle class="volley-projectile state-${projectile.state}" cx="${origin.x}" cy="${origin.y}" r="5" filter="url(#volleyGlow)"/></g>`; }).join("")}`;
    $("volleyCountLabel").textContent = count; $("volleySpacing").textContent = `${volley.spacingDeg.toFixed(volley.spacingDeg % 1 ? 2 : 0)}°`; $("volleyArc").textContent = `${volley.totalArcDeg.toFixed(volley.totalArcDeg % 1 ? 2 : 0)}°`; $("volleySimultaneous").textContent = `同帧 ×${count}`; $("volleyHitCount").textContent = `${collision.effectiveHits.length}有效 / ${candidates.length}接触`;
    $("volleyAngles").textContent = `[${volley.projectiles.map((item) => `${item.relativeAngleDeg > 0 ? "+" : ""}${item.relativeAngleDeg}°`).join(", ")}]`;
    const symmetric = volley.projectiles.every((item, index, entries) => Math.abs(item.relativeAngleDeg + entries.at(-(index + 1)).relativeAngleDeg) < 1e-9);
    $("volleySymmetryProof").textContent = symmetric ? "轴对称通过" : "轴对称失败"; $("volleySymmetryProof").dataset.tone = symmetric ? "pass" : "fail"; $("volleyArcProof").textContent = `总扇面 ${volley.totalArcDeg}° / 上限 180°`;
    $("volleyEmitTime").textContent = `Volley #${++fireSerial} · ${count}枚同时生成`; $("volleyTestState").textContent = candidates.length ? `${candidates.length}条轨迹接触目标 · 仅1次有效` : "本组未接触目标";
    const nodes = [...$("volleyTrajectories").querySelectorAll("[data-projectile-index]")]; const start = performance.now(), maximumTravel = 680, projectileSpeedUnitsPerMs = 1;
    let impactShown = false;
    const animate = (now) => { const elapsed = now - start; nodes.forEach((node, index) => { const projectile = collision.projectiles[index], travel = projectile.effective ? projectile.distance : maximumTravel; const distance = Math.min(travel, elapsed * projectileSpeedUnitsPerMs), radians = projectile.directionAngleDeg * Math.PI / 180; const circle = node.querySelector("circle"); circle.setAttribute("cx", origin.x + Math.cos(radians) * distance); circle.setAttribute("cy", origin.y + Math.sin(radians) * distance); if (!impactShown && projectile.effective && distance >= travel) { impactShown = true; circle.classList.add("impacted"); $("volleyTarget")?.querySelector("circle")?.classList.add("hit-pulse"); } }); if (elapsed * projectileSpeedUnitsPerMs < maximumTravel) animationFrame = requestAnimationFrame(animate); else animationFrame = null; };
    animationFrame = requestAnimationFrame(animate);
  }
  function autoFire() { if ($("volleyAutoFire").checked) fire(); }
  $("volleyCount").addEventListener("input", () => { updatePresets(Number($("volleyCount").value)); autoFire(); });
  $("volleyPresets").addEventListener("click", (event) => { const button = event.target.closest("[data-volley-count]"); if (!button) return; $("volleyCount").value = button.dataset.volleyCount; updatePresets(Number(button.dataset.volleyCount)); fire(); });
  $("volleyFire").addEventListener("click", fire);
  stage.addEventListener("pointerdown", (event) => { const point = svgPoint(event); if (Math.hypot(point.x - target.x, point.y - target.y) > target.radius * 1.8) return; dragging = true; stage.setPointerCapture(event.pointerId); });
  stage.addEventListener("pointermove", (event) => { if (!dragging) return; const point = svgPoint(event); target.x = Math.max(300, Math.min(675, point.x)); target.y = Math.max(45, Math.min(375, point.y)); $("volleyActors").innerHTML = actorMarkup(false); $("volleyTrajectories").innerHTML = ""; });
  stage.addEventListener("pointerup", (event) => { if (!dragging) return; dragging = false; stage.releasePointerCapture(event.pointerId); autoFire(); });
  fire();
}
