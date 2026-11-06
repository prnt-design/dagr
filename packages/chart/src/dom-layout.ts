/** Measured category bounds, relative to the chart's content box. */
export interface CategoryBox {
  readonly left: number;
  readonly right: number;
}

/** Keep endpoints when they fit together, then greedily fill the interior. */
export function visibleCategories(boxes: readonly CategoryBox[], gap = 8): readonly number[] {
  if (boxes.length === 0) return [];
  const chosen = [0];
  const last = boxes.length - 1;
  const firstBox = boxes[0]!;
  const lastBox = boxes[last]!;
  const keepLast = last > 0 && firstBox.right + gap <= lastBox.left;
  let right = firstBox.right;
  for (let i = 1; i < last; i += 1) {
    const box = boxes[i]!;
    if (box.left < right + gap || (keepLast && box.right + gap > lastBox.left)) continue;
    chosen.push(i);
    right = box.right;
  }
  if (keepLast) chosen.push(last);
  return chosen;
}

/** Clamp a measured tooltip to the container, preferring above its anchor. */
export function tooltipPosition(
  anchor: { readonly x: number; readonly top: number },
  tip: { readonly width: number; readonly height: number },
  container: { readonly width: number; readonly height: number },
): { left: number; top: number; below: boolean } {
  const below = anchor.top - tip.height - 10 < 8;
  const clamp = (value: number, extent: number, total: number): number =>
    Math.max(0, Math.min(Math.max(8, value), total - extent - 8));
  return {
    left: clamp(anchor.x - tip.width / 2, tip.width, container.width),
    top: clamp(below ? anchor.top + 10 : anchor.top - tip.height - 10, tip.height, container.height),
    below,
  };
}
