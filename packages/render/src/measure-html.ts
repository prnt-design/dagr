import type { Size } from './types.js';

/**
 * Measuring HTML so a layout can reserve a box for it.
 *
 * `@dagr/layout` takes sizes through `LayoutConfig.nodeSize`, which it calls
 * exactly once per node during prepare, on the caller's thread even when the
 * run itself is in M2.10's worker. So a DOM measurement CAN feed a layout, and
 * the question this module answers is how to do it without the quadratic.
 *
 * **Rich nodes should DECLARE their size where they can, and measure only where
 * they cannot.** Declaring is right when the content is templated: a card whose
 * shape is fixed per node kind has a size known by construction, and 2,800
 * offscreen mounts at startup buy nothing. Measuring is right when the content
 * is authored per node and its size is a fact about the text, which no constant
 * can stand in for: a label as wide as a name cannot be guessed without the
 * font. That is why this is a helper a caller reaches for rather than something
 * `createRichNodes` does.
 */

/** One thing to measure. */
export interface MeasureItem {
  /** The key in the returned map. Ids have to be unique within one call. */
  readonly id: string;

  /** Builds the element to measure. Called once. */
  readonly create: () => HTMLElement;

  /**
   * The width the element will have where it is finally drawn, in world units,
   * which are CSS pixels inside an overlay layer.
   *
   * Given, the element wraps here the way it will wrap there, so the measured
   * HEIGHT is the height it will have. Omitted, it is measured unconstrained,
   * which is right for a single line and wrong for anything that wraps: an
   * unconstrained paragraph measures as one very long line, and the layout then
   * reserves a box the shape of a sentence.
   */
  readonly maxWidth?: number;
}

/** Where {@link measureHtmlSizes} mounts while it measures. */
export interface MeasureOptions {
  /**
   * The subtree whose styles apply. REQUIRED, and deliberately not defaulted to
   * `document.body`.
   *
   * Inherited font, line height and custom properties decide the answer. A card
   * measured under the page's styles and drawn under the overlay's is measured
   * wrong, silently, and the symptom is a layout whose boxes do not fit their
   * content: text clipped or floating in a box half again too big, with nothing
   * in the code to point at. Naming the subtree is one argument and it removes
   * the whole class.
   */
  readonly parent: HTMLElement;

  /** Put on the offscreen container, so a caller's own CSS can reach inside. */
  readonly className?: string;
}

/**
 * How far offscreen the container sits, in CSS pixels.
 *
 * Far enough to be off any plausible viewport, and NEGATIVE rather than
 * positive: a container to the right of the content can extend the document's
 * scrollable width and give the page a horizontal scrollbar for as long as the
 * measurement lasts, which is a visible flicker on a page that had none.
 */
const OFFSCREEN_X = -100000;

/**
 * How wide the container is, which is the width an unconstrained item sees.
 *
 * An absolutely positioned element shrinks to fit its containing block, so a
 * container with no width would offer zero available width and every item would
 * measure at its MINIMUM content width, which for prose is one word per line.
 * A large number is the way to say "unconstrained" in a language that has no
 * word for it.
 */
const CONTAINER_WIDTH = 100000;

/**
 * Measures a batch of elements, in one layout flush, and returns their sizes.
 *
 * **Mount everything, then read everything, and that ordering is the whole
 * reason this exists rather than being an example in the docs.** A browser
 * flushes pending layout when it is asked for a geometric property, so
 * interleaving a mount and a read per node forces a flush per node: 2,800
 * measurements become 2,800 layouts of a growing tree, which is the classic
 * quadratic and turns a startup into seconds. Writing all, then reading all, is
 * one flush.
 *
 * Two things the caller owns, stated here rather than left to be discovered.
 * A web font that has not finished loading measures in the FALLBACK face, so a
 * caller using one awaits `document.fonts.ready` first; this stays synchronous
 * because `nodeSize` is. And `visibility: hidden` is what the container uses
 * rather than `display: none`, because a `display: none` subtree has no box at
 * all and measures zero on every axis.
 *
 * The container is created, used and removed inside this call. There is nothing
 * for a caller to own, since it does not outlive the function, and a measuring
 * harness that left its container attached is a leak nobody sees.
 *
 * @throws {RangeError} when two items share an id. The alternative is keeping
 * one of them silently, and a duplicate id means the caller's node ids collide,
 * which is worth stopping for rather than papering over with a size that
 * belongs to a different node.
 */
export function measureHtmlSizes(
  items: Iterable<MeasureItem>,
  options: MeasureOptions,
): Map<string, Size> {
  const { parent } = options;
  const document = parent.ownerDocument;

  const container = document.createElement('div');
  if (options.className !== undefined) container.className = options.className;
  container.style.position = 'absolute';
  container.style.left = `${String(OFFSCREEN_X)}px`;
  container.style.top = '0';
  container.style.width = `${String(CONTAINER_WIDTH)}px`;
  container.style.visibility = 'hidden';
  container.style.pointerEvents = 'none';

  const measured: { id: string; element: HTMLElement }[] = [];
  const seen = new Set<string>();
  const sizes = new Map<string, Size>();

  // Every write first. Nothing below this line reads a geometric property, so
  // the browser has no reason to lay anything out until the loop after it.
  for (const item of items) {
    // A `Set` rather than a scan of what has been measured so far: this runs
    // over every node a caller is about to lay out, and a scan would make the
    // duplicate check the quadratic that the rest of this function exists to
    // avoid.
    if (seen.has(item.id)) {
      throw new RangeError(`two items share the id ${JSON.stringify(item.id)}`);
    }
    seen.add(item.id);
    const element = item.create();
    element.style.position = 'absolute';
    element.style.left = '0';
    element.style.top = '0';
    if (item.maxWidth !== undefined) element.style.maxWidth = `${String(item.maxWidth)}px`;
    container.appendChild(element);
    measured.push({ id: item.id, element });
  }
  parent.appendChild(container);

  // Then every read. The first one flushes layout for the whole container and
  // the rest are free.
  for (const entry of measured) {
    const rect = entry.element.getBoundingClientRect();
    sizes.set(entry.id, { width: rect.width, height: rect.height });
  }

  container.remove();
  return sizes;
}
