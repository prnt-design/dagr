/**
 * Which node an arrow key moves focus to, as one pure function.
 *
 * Candidates are the nodes whose center lies strictly in the arrow's
 * half-plane from the focused node's center. The score is the distance along
 * the arrow's axis plus twice the distance across it, lowest wins, and a tie
 * goes to the lower id. Weighing the cross axis keeps a press on a row or a
 * column rather than letting it drift onto a nearer diagonal.
 *
 * It scans every node in the layout, mounted or not: an unmounted node is a
 * mark with no element, and focus has to be able to reach it. Linear, like
 * the visible set's scan, and for the same reason.
 *
 * Internal to the package.
 */

import type { LayoutIndex } from './visible-set.js';

/** In screen terms, which are world terms: the world is y-down. */
export type ExplorerDirection = 'up' | 'down' | 'left' | 'right';

export function nearestInDirection(
  index: LayoutIndex,
  fromId: string,
  direction: ExplorerDirection,
): string | null {
  const from = index.nodeIds.indexOf(fromId);
  const origin = index.nodeBoxes[from];
  if (from < 0 || origin === undefined) return null;
  const fromX = origin.x + origin.width / 2;
  const fromY = origin.y + origin.height / 2;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;

  let best: string | null = null;
  let bestScore = Infinity;
  index.nodeBoxes.forEach((box, i) => {
    if (i === from) return;
    const dx = box.x + box.width / 2 - fromX;
    const dy = box.y + box.height / 2 - fromY;
    const along = (horizontal ? dx : dy) * sign;
    if (!(along > 0)) return;
    const score = along + 2 * Math.abs(horizontal ? dy : dx);
    const id = index.nodeIds[i] as string;
    if (score < bestScore || (score === bestScore && best !== null && id < best)) {
      best = id;
      bestScore = score;
    }
  });
  return best;
}
