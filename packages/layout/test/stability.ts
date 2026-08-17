/**
 * The two assertions M3.5 through M3.9 are written against, M3.5 included.
 *
 * They live in `test/` rather than in `src/` on the split M3.4 decided: what
 * ships is `stabilityViolations`, which RETURNS what it found, because a
 * function that returns a list is usable by a test that asserts it is empty, by
 * a corpus runner that prints it, and by a consumer that logs it. A function
 * that throws is only usable inside a test runner, and this package has no
 * testing entry point to put one behind. So the assertion wrappers are here,
 * shared by every later task's suite the way `fakes.ts` and `random.ts` are.
 */

import { expect } from 'vitest';
import { stabilityViolations } from '../src/index.js';
import type { InfluenceSet, LayoutResult, StabilityReport } from '../src/index.js';

/**
 * Asserts the contract: nothing outside the influence set changed at all.
 *
 * Exact, with no tolerance, for the reason `stabilityViolations` takes none.
 * The failure message is the violation list itself rather than a count, because
 * "3 nodes moved" sends the reader back to the debugger and a list of ids does
 * not.
 */
export function expectStable(
  previous: LayoutResult,
  next: LayoutResult,
  influence: InfluenceSet,
): void {
  expect(stabilityViolations(previous, next, influence)).toEqual([]);
}

/**
 * The ceilings a corpus run may assert, all optional and all upper bounds.
 *
 * Every field is a maximum rather than a target because a stability metric only
 * ever regresses upward: a task that lowers one is an improvement nobody needs
 * a test to catch, and a task that raises one past its ceiling is exactly the
 * regression that should stop the build.
 */
export interface StabilityBounds {
  readonly maxMovedFraction?: number;
  readonly maxMeanDisplacement?: number;
  readonly maxMaxDisplacement?: number;
  readonly maxRankChurn?: number;
  readonly maxOrderChurn?: number;
  readonly maxReroutedFraction?: number;
  readonly maxMeanRouteDistance?: number;
  readonly maxBendChurn?: number;
}

/**
 * Asserts a report sits under every ceiling the caller named.
 *
 * A bound that is not named is not checked, so a task can pin the one number it
 * is about without inheriting seven it is not. `toBeLessThanOrEqual` rather than
 * a strict comparison, so a ceiling written at the value a corpus currently
 * produces is a ceiling that passes.
 */
export function expectStabilityWithin(report: StabilityReport, bounds: StabilityBounds): void {
  if (bounds.maxMovedFraction !== undefined) {
    expect(report.nodes.movedFraction).toBeLessThanOrEqual(bounds.maxMovedFraction);
  }
  if (bounds.maxMeanDisplacement !== undefined) {
    expect(report.nodes.meanDisplacement).toBeLessThanOrEqual(bounds.maxMeanDisplacement);
  }
  if (bounds.maxMaxDisplacement !== undefined) {
    expect(report.nodes.maxDisplacement).toBeLessThanOrEqual(bounds.maxMaxDisplacement);
  }
  if (bounds.maxRankChurn !== undefined) {
    expect(report.nodes.rankChurn).toBeLessThanOrEqual(bounds.maxRankChurn);
  }
  if (bounds.maxOrderChurn !== undefined) {
    expect(report.nodes.orderChurn).toBeLessThanOrEqual(bounds.maxOrderChurn);
  }
  if (bounds.maxReroutedFraction !== undefined) {
    expect(report.edges.reroutedFraction).toBeLessThanOrEqual(bounds.maxReroutedFraction);
  }
  if (bounds.maxMeanRouteDistance !== undefined) {
    expect(report.edges.meanRouteDistance).toBeLessThanOrEqual(bounds.maxMeanRouteDistance);
  }
  if (bounds.maxBendChurn !== undefined) {
    expect(report.edges.bendChurn).toBeLessThanOrEqual(bounds.maxBendChurn);
  }
}
