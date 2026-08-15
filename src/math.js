// math.js — toroidal geometry primitives. No DOM, no state, pure functions.

/**
 * Wrap a coordinate into [0, max). Handles negatives correctly.
 * @param {number} x
 * @param {number} max - world extent (must be >= 0)
 */
export function wrap(x, max) {
  if (max <= 0) return 0;
  let r = x % max;
  if (r < 0) r += max;
  // Normalize -0 to 0 so strict equality holds
  return r === 0 ? 0 : r;
}

/**
 * Shortest signed delta from a to b on a torus of extent max.
 * Result is in [-max/2, max/2].
 */
export function torusDelta(a, b, max) {
  if (max <= 0) return 0;
  let d = (b - a) % max;
  if (d > max / 2) d -= max;
  if (d < -max / 2) d += max;
  return d;
}

/**
 * Euclidean distance on a torus (shortest path across edges).
 */
export function torusDistance(ax, ay, bx, by, w, h) {
  const dx = torusDelta(ax, bx, w);
  const dy = torusDelta(ay, by, h);
  return Math.hypot(dx, dy);
}

/**
 * Circle collision on a torus. Returns true if the two circles overlap or touch.
 */
export function circleCollision(ax, ay, ar, bx, by, br, w, h) {
  return torusDistance(ax, ay, bx, by, w, h) <= ar + br;
}

/**
 * Earliest time at which two moving circles touch on a torus.
 *
 * Positions and velocities are sampled at the beginning of the interval. The
 * relative segment is tested against every periodic image it can reach, so the
 * result remains correct across seams and even when an entity crosses more
 * than one world extent during the interval.
 *
 * @returns {number|null} time in [0, maxTime], or null when there is no hit
 */
export function sweptCircleCollisionTime(
  ax, ay, ar, avx, avy,
  bx, by, br, bvx, bvy,
  w, h, maxTime
) {
  const duration = Math.max(0, maxTime);
  const radius = Math.max(0, ar) + Math.max(0, br);
  let qx = ax - bx;
  let qy = ay - by;
  let vx = avx - bvx;
  let vy = avy - bvy;

  // Match the degenerate-axis behaviour of torusDelta/torusDistance.
  if (w <= 0) { qx = 0; vx = 0; }
  if (h <= 0) { qy = 0; vy = 0; }

  const endX = qx + vx * duration;
  const endY = qy + vy * duration;
  const loX = Math.min(qx, endX);
  const hiX = Math.max(qx, endX);
  const loY = Math.min(qy, endY);
  const hiY = Math.max(qy, endY);
  const epsilon = 1e-9;

  const minK = w > 0 ? Math.ceil((-radius - hiX - epsilon) / w) : 0;
  const maxK = w > 0 ? Math.floor((radius - loX + epsilon) / w) : 0;
  const minL = h > 0 ? Math.ceil((-radius - hiY - epsilon) / h) : 0;
  const maxL = h > 0 ? Math.floor((radius - loY + epsilon) / h) : 0;

  const speedSq = vx * vx + vy * vy;
  const radiusSq = radius * radius;
  let earliest = null;

  for (let k = minK; k <= maxK; k++) {
    for (let l = minL; l <= maxL; l++) {
      const dx = qx + k * w;
      const dy = qy + l * h;
      const c = dx * dx + dy * dy - radiusSq;

      if (c <= epsilon) {
        earliest = 0;
        continue;
      }
      if (speedSq <= epsilon) continue;

      // Solve |d + v*t|^2 = radius^2. `dot` is half of the
      // conventional quadratic B coefficient.
      const dot = dx * vx + dy * vy;
      const discriminant = dot * dot - speedSq * c;
      if (discriminant < -epsilon) continue;

      const root = Math.sqrt(Math.max(0, discriminant));
      const enter = (-dot - root) / speedSq;
      const exit = (-dot + root) / speedSq;
      if (exit < -epsilon || enter > duration + epsilon) continue;

      const hitTime = Math.max(0, enter);
      if (earliest === null || hitTime < earliest) earliest = hitTime;
    }
  }

  return earliest;
}

/**
 * Distance from a ray origin to the first intersection with a circle on a
 * toroidal world. Periodic circle images intersecting the segment AABB are
 * enumerated, so a forward image across a seam is never mistaken for a nearer
 * image behind the ray.
 *
 * @returns {number|null} distance in [0, range], or null when there is no hit
 */
export function rayCircleHitDistanceTorus(
  ox, oy, angle, range, cx, cy, radius, w, h
) {
  const maxDistance = Math.max(0, range);
  const r = Math.max(0, radius);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const endX = ox + dx * maxDistance;
  const endY = oy + dy * maxDistance;
  const minX = Math.min(ox, endX) - r;
  const maxX = Math.max(ox, endX) + r;
  const minY = Math.min(oy, endY) - r;
  const maxY = Math.max(oy, endY) + r;

  const minK = w > 0 ? Math.ceil((minX - cx) / w) : 0;
  const maxK = w > 0 ? Math.floor((maxX - cx) / w) : 0;
  const minL = h > 0 ? Math.ceil((minY - cy) / h) : 0;
  const maxL = h > 0 ? Math.floor((maxY - cy) / h) : 0;
  let earliest = null;

  for (let k = minK; k <= maxK; k++) {
    for (let l = minL; l <= maxL; l++) {
      const relX = (w > 0 ? cx + k * w : cx) - ox;
      const relY = (h > 0 ? cy + l * h : cy) - oy;
      const projection = relX * dx + relY * dy;
      if (projection < -r || projection > maxDistance + r) continue;

      const perpendicularSq = relX * relX + relY * relY - projection * projection;
      const radiusSq = r * r;
      if (perpendicularSq > radiusSq + 1e-9) continue;

      const halfChord = Math.sqrt(Math.max(0, radiusSq - perpendicularSq));
      if (projection + halfChord < -1e-9) continue;
      const entry = Math.max(0, projection - halfChord);
      if (entry <= maxDistance + 1e-9 && (earliest === null || entry < earliest)) {
        earliest = entry;
      }
    }
  }

  return earliest;
}

/**
 * Return the visual edge-copy offsets for an entity whose visual radius may
 * extend past a world boundary. The canonical copy at (0,0) is always
 * included; additional copies at ±w and ±h are returned when the visual bounds
 * cross an edge or corner. This keeps renderer logic pure and testable.
 *
 * @returns {Array<{dx:number, dy:number}>}
 */
export function visualEdgeOffsets(x, y, visualRadius, w, h) {
  const offsets = [{ dx: 0, dy: 0 }];
  const r = visualRadius;

  if (w > 0) {
    if (x - r < 0) offsets.push({ dx: w, dy: 0 });
    if (x + r > w) offsets.push({ dx: -w, dy: 0 });
  }
  if (h > 0) {
    if (y - r < 0) offsets.push({ dx: 0, dy: h });
    if (y + r > h) offsets.push({ dx: 0, dy: -h });
  }
  if (w > 0 && h > 0) {
    if (x - r < 0 && y - r < 0) offsets.push({ dx: w, dy: h });
    if (x - r < 0 && y + r > h) offsets.push({ dx: w, dy: -h });
    if (x + r > w && y - r < 0) offsets.push({ dx: -w, dy: h });
    if (x + r > w && y + r > h) offsets.push({ dx: -w, dy: -h });
  }

  return offsets;
}
