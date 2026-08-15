import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrap, torusDelta, torusDistance, circleCollision,
  sweptCircleCollisionTime, rayCircleHitDistanceTorus, visualEdgeOffsets,
} from '../src/math.js';

test('wrap: wraps positive overflow into [0,max)', () => {
  assert.equal(wrap(10, 800), 10);
  assert.equal(wrap(800, 800), 0);
  assert.equal(wrap(801, 800), 1);
  assert.equal(wrap(1600, 800), 0);
});

test('wrap: wraps negative values into [0,max)', () => {
  assert.equal(wrap(-1, 800), 799);
  assert.equal(wrap(-800, 800), 0);
  assert.equal(wrap(-801, 800), 799);
});

test('wrap: zero max returns 0 (degenerate world)', () => {
  assert.equal(wrap(100, 0), 0);
});

test('torusDelta: short distance unchanged', () => {
  assert.equal(torusDelta(100, 120, 800), 20);
  assert.equal(torusDelta(120, 100, 800), -20);
});

test('torusDelta: wraps across right edge to left', () => {
  // a=790, b=10, max=800 → shortest is +20 (go right, wrap to left)
  assert.equal(torusDelta(790, 10, 800), 20);
});

test('torusDelta: wraps across left edge to right', () => {
  // a=10, b=790, max=800 → shortest is -20 (go left, wrap to right)
  assert.equal(torusDelta(10, 790, 800), -20);
});

test('torusDistance: normal euclidean when far from edges', () => {
  const d = torusDistance(100, 100, 110, 100, 800, 600);
  assert.equal(d, 10);
});

test('torusDistance: toroidal across right/bottom edges', () => {
  // points near opposite corners should be close via wrap
  const d = torusDistance(795, 595, 5, 5, 800, 600);
  assert.ok(d < 15, `expected <15, got ${d}`);
});

test('torusDistance: toroidal across left/top edges', () => {
  const d = torusDistance(5, 5, 795, 595, 800, 600);
  assert.ok(d < 15, `expected <15, got ${d}`);
});

test('circleCollision: overlap returns true', () => {
  assert.equal(circleCollision(100, 100, 20, 110, 100, 20, 800, 600), true);
});

test('circleCollision: no overlap returns false', () => {
  assert.equal(circleCollision(100, 100, 10, 500, 500, 10, 800, 600), false);
});

test('circleCollision: overlap across wrap edge returns true', () => {
  // two circles straddling the right/left edge
  assert.equal(circleCollision(795, 100, 20, 5, 100, 20, 800, 600), true);
});

test('circleCollision: touching exactly is a collision (<=)', () => {
  assert.equal(circleCollision(100, 100, 10, 120, 100, 10, 800, 600), true);
});

test('swept collision: returns null for separated circles without relative motion', () => {
  const hit = sweptCircleCollisionTime(
    10, 10, 2, 30, 0,
    30, 10, 2, 30, 0,
    100, 100, 1
  );
  assert.equal(hit, null);
});

test('swept collision: detects the earliest hit across multiple torus wraps', () => {
  const hit = sweptCircleCollisionTime(
    10, 50, 2, 500, 0,
    50, 50, 2, 0, 0,
    100, 100, 0.5
  );
  assert.ok(hit !== null);
  assert.ok(Math.abs(hit - 0.072) < 1e-9, `expected first hit at 0.072s, got ${hit}`);
});

test('swept collision: does not report a near miss', () => {
  const hit = sweptCircleCollisionTime(
    10, 45.9, 2, 500, 0,
    50, 50, 2, 0, 0,
    100, 100, 0.5
  );
  assert.equal(hit, null);
});

test('toroidal ray: returns the first circle entry distance in front', () => {
  assert.equal(
    rayCircleHitDistanceTorus(100, 100, 0, 200, 150, 100, 10, 800, 600),
    40
  );
});

test('toroidal ray: follows the forward ray through a world seam', () => {
  assert.equal(
    rayCircleHitDistanceTorus(790, 100, 0, 100, 20, 100, 5, 800, 600),
    25
  );
});

test('toroidal ray: rejects a circle image entirely behind the origin', () => {
  assert.equal(
    rayCircleHitDistanceTorus(0, 0, 0, 100, 997.5, 2, 3, 1000, 1000),
    null
  );
});

test('toroidal ray: supports a degenerate non-wrapping world dimension', () => {
  assert.equal(
    rayCircleHitDistanceTorus(10, 20, 0, 100, 50, 20, 5, 0, 0),
    35
  );
});

// ---- Visual edge copies ----

test('visualEdgeOffsets: returns only canonical copy when away from edges', () => {
  const offsets = visualEdgeOffsets(100, 100, 14, 800, 600);
  assert.deepEqual(offsets, [{ dx: 0, dy: 0 }]);
});

test('visualEdgeOffsets: adds left/right copies when visual radius crosses vertical edges', () => {
  // visualRadius 20 at x=10 crosses left edge; x=790 crosses right edge.
  assert.deepEqual(visualEdgeOffsets(10, 300, 20, 800, 600), [
    { dx: 0, dy: 0 }, { dx: 800, dy: 0 }
  ]);
  assert.deepEqual(visualEdgeOffsets(790, 300, 20, 800, 600), [
    { dx: 0, dy: 0 }, { dx: -800, dy: 0 }
  ]);
});

test('visualEdgeOffsets: adds top/bottom copies when visual radius crosses horizontal edges', () => {
  assert.deepEqual(visualEdgeOffsets(400, 10, 20, 800, 600), [
    { dx: 0, dy: 0 }, { dx: 0, dy: 600 }
  ]);
  assert.deepEqual(visualEdgeOffsets(400, 590, 20, 800, 600), [
    { dx: 0, dy: 0 }, { dx: 0, dy: -600 }
  ]);
});

test('visualEdgeOffsets: adds corner copies when near two edges', () => {
  const offsets = visualEdgeOffsets(10, 10, 20, 800, 600);
  assert.ok(offsets.some(o => o.dx === 800 && o.dy === 0));
  assert.ok(offsets.some(o => o.dx === 0 && o.dy === 600));
  assert.ok(offsets.some(o => o.dx === 800 && o.dy === 600));
  assert.ok(offsets.some(o => o.dx === 0 && o.dy === 0));
});

test('visualEdgeOffsets: visual radius larger than collision radius triggers earlier', () => {
  // Same position; larger visual radius crosses the edge where collision radius does not.
  const small = visualEdgeOffsets(5, 300, 4, 800, 600);
  const large = visualEdgeOffsets(5, 300, 14, 800, 600);
  assert.equal(small.length, 1);
  assert.equal(large.length, 2);
});
