export const PROJECTILE_VOLLEY_SCHEMA_VERSION = "projectile-volley-v1";
export const DEFAULT_PROJECTILE_SPACING_DEG = 6;
export const MAXIMUM_PROJECTILE_ARC_DEG = 180;
export const MAXIMUM_PROJECTILES_PER_VOLLEY = 64;

function finite(value, name, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}

function normalizeDegrees(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function createProjectileVolley(input = {}) {
  const projectileCount = input.projectileCount ?? 1;
  if (!Number.isInteger(projectileCount) || projectileCount < 1 || projectileCount > MAXIMUM_PROJECTILES_PER_VOLLEY) {
    throw new RangeError(`projectileCount must be an integer between 1 and ${MAXIMUM_PROJECTILES_PER_VOLLEY}`);
  }
  const requestedSpacingDeg = finite(input.spacingDeg ?? DEFAULT_PROJECTILE_SPACING_DEG, "spacingDeg", 0, 180);
  const maximumArcDeg = finite(input.maximumArcDeg ?? MAXIMUM_PROJECTILE_ARC_DEG, "maximumArcDeg", 0, 180);
  const aimAngleDeg = finite(input.aimAngleDeg ?? 0, "aimAngleDeg", -1e9, 1e9);
  const sameVolleyHitLimitPerTarget = input.sameVolleyHitLimitPerTarget ?? 1;
  if (!Number.isInteger(sameVolleyHitLimitPerTarget) || sameVolleyHitLimitPerTarget < 1 || sameVolleyHitLimitPerTarget > projectileCount) {
    throw new RangeError("sameVolleyHitLimitPerTarget must be between 1 and projectileCount");
  }
  const spacingDeg = projectileCount === 1 ? 0 : Math.min(requestedSpacingDeg, maximumArcDeg / (projectileCount - 1));
  const firstOffsetDeg = -spacingDeg * (projectileCount - 1) / 2;
  const projectiles = Array.from({ length: projectileCount }, (_, index) => {
    const relativeAngleDeg = firstOffsetDeg + index * spacingDeg;
    return Object.freeze({
      index,
      relativeAngleDeg: Object.is(relativeAngleDeg, -0) ? 0 : relativeAngleDeg,
      directionAngleDeg: normalizeDegrees(aimAngleDeg + relativeAngleDeg),
    });
  });
  return Object.freeze({
    schemaVersion: PROJECTILE_VOLLEY_SCHEMA_VERSION,
    projectileCount,
    aimAngleDeg: normalizeDegrees(aimAngleDeg),
    spacingDeg,
    totalArcDeg: spacingDeg * Math.max(0, projectileCount - 1),
    simultaneous: true,
    sameVolleyHitLimitPerTarget,
    projectiles: Object.freeze(projectiles),
  });
}

function assertPoint(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} must be a point`);
  finite(value.x, `${name}.x`);
  finite(value.y, `${name}.y`);
  return value;
}

function rayCircleIntersection(origin, directionAngleDeg, target, maximumDistance) {
  const radians = directionAngleDeg * Math.PI / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const offsetX = target.x - origin.x;
  const offsetY = target.y - origin.y;
  const projection = offsetX * dx + offsetY * dy;
  if (projection < 0) return null;
  const perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
  const radiusSquared = target.radius * target.radius;
  if (perpendicularSquared > radiusSquared) return null;
  const entryDistance = Math.max(0, projection - Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared)));
  return entryDistance <= maximumDistance ? entryDistance : null;
}

export function resolveProjectileVolleyCollisions(input = {}) {
  const volley = input.volley;
  if (!volley || volley.schemaVersion !== PROJECTILE_VOLLEY_SCHEMA_VERSION || !Array.isArray(volley.projectiles)) {
    throw new TypeError("volley must be a projectile-volley-v1 value");
  }
  const origin = assertPoint(input.origin ?? { x: 0, y: 0 }, "origin");
  const maximumDistance = finite(input.maximumDistance ?? 30, "maximumDistance", 0.001, 1e6);
  if (!Array.isArray(input.targets)) throw new TypeError("targets must be an array");
  const targets = input.targets.map((target, index) => {
    assertPoint(target, `targets[${index}]`);
    if (typeof target.targetId !== "string" && typeof target.targetId !== "number") throw new TypeError(`targets[${index}].targetId must be a string or number`);
    finite(target.radius, `targets[${index}].radius`, 0.001, maximumDistance);
    return target;
  });
  const hitCounts = new Map();
  const projectiles = volley.projectiles.map((projectile) => {
    const candidates = targets.map((target, targetIndex) => ({
      target,
      targetIndex,
      distance: rayCircleIntersection(origin, projectile.directionAngleDeg, target, maximumDistance),
    })).filter((candidate) => candidate.distance !== null)
      .sort((left, right) => left.distance - right.distance || left.targetIndex - right.targetIndex);
    const collision = candidates[0] ?? null;
    const distance = collision?.distance ?? maximumDistance;
    const radians = projectile.directionAngleDeg * Math.PI / 180;
    const impact = Object.freeze({ x: origin.x + Math.cos(radians) * distance, y: origin.y + Math.sin(radians) * distance });
    if (!collision) return Object.freeze({ ...projectile, state: "miss", targetId: null, distance, impact, effective: false });
    const previousHits = hitCounts.get(collision.target.targetId) ?? 0;
    const effective = previousHits < volley.sameVolleyHitLimitPerTarget;
    if (effective) hitCounts.set(collision.target.targetId, previousHits + 1);
    return Object.freeze({ ...projectile, state: effective ? "effective" : "suppressed", targetId: collision.target.targetId, distance, impact, effective });
  });
  const effectiveHits = projectiles.filter((projectile) => projectile.effective);
  return Object.freeze({
    schemaVersion: "projectile-volley-collision-v1",
    volley,
    origin: Object.freeze({ x: origin.x, y: origin.y }),
    maximumDistance,
    projectiles: Object.freeze(projectiles),
    effectiveHits: Object.freeze(effectiveHits),
    contactCount: projectiles.filter((projectile) => projectile.targetId !== null).length,
    missCount: projectiles.filter((projectile) => projectile.targetId === null).length,
    suppressedCount: projectiles.filter((projectile) => projectile.state === "suppressed").length,
  });
}
