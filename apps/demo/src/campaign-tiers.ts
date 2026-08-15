import { cardRows } from '@dagr/campaign';
import type { CampaignNode, NodeKind } from '@dagr/campaign';
import type { RichNodeTier } from '@dagr/render';
import './campaign-cards.css';

/**
 * The campaign's two overlay tiers, and the sizes the card gate is derived
 * from.
 *
 * `createRichNodes` IS the semantic zoom: tiers are the overlay's screen-width
 * gates, half-open and disjoint, and the bottom tier is the ABSENCE of an
 * entry, which is the instanced shape the GPU draws. So there is no
 * level-of-detail machinery here, only two tier descriptors and the content
 * they render.
 *
 * **Sizes are declared, not measured.** `measureHtmlSizes` exists for content
 * whose size is a fact about its own text, and a templated card is not that: a
 * card's shape is decided by this file, so mounting 3,010 cards offscreen at
 * startup would measure this file's own CSS back to it. What the table below
 * declares is what a card of each kind is authored to occupy, and the one thing
 * that reads it is {@link CARD_MIN_SCREEN_WIDTH}.
 */

/** What a card of one kind is authored to occupy. */
export interface CardSize {
  /** Text lines the card budgets: one for the name, then one-liner and rows. */
  readonly lines: number;
}

/**
 * One width for every kind, in CSS pixels.
 *
 * Two widths were the first version, a narrow one for kinds whose values are
 * tokens and a wide one for kinds carrying sentences, on the theory that
 * narrower cards would let the gate open sooner. They do not. The gate is
 * driven by card HEIGHT against node aspect, and a narrower card wraps its text
 * into more lines, so narrowing a card raises the gate rather than lowering it:
 * at 268 the gate is 460, at 320 it is 415. One width is both simpler and
 * earlier.
 */
const CARD_WIDTH = 320;

/** A text line at the card's 12px type, 1.5 line height. */
const CARD_LINE_HEIGHT = 18;

/** The one-liner's rule: its padding, its margin, and the border between. */
const CARD_RULE_HEIGHT = 13;

/**
 * The card's own vertical padding and border: 8 above, 9 below, 1 each side.
 *
 * Inside the declared box, because `.campaign-card` is `border-box`, so the
 * height written in `update` already contains it.
 */
const CARD_PADDING = 19;

/**
 * How far the card sits inside its node's top-left corner.
 *
 * OUTSIDE the declared box, and the only thing that is: the inset is a
 * `translate` composed after the counter-scale, so it is 8 CSS pixels at every
 * zoom and it pushes the card's far edges 8 pixels closer to the node's. That
 * is why {@link cardFootprint} adds it to both dimensions: a footprint that
 * ignores it is a card that overhangs by exactly this much, which is the
 * overhang the gate exists to prevent.
 */
const CARD_INSET = 8;

/**
 * How many lines of text each kind's card budgets.
 *
 * **Lines, not rows, because the text WRAPS.** The first version counted
 * `cardRows` entries and assumed one rendered line each. That is false for this
 * dataset: a quest's objective runs to 76 characters, several lines in the value
 * column, against a card that declared two rows in total. A card that renders
 * taller than it declares hangs past its node's bottom edge, which is exactly
 * the fault the gate's height half exists to prevent, so a size table that
 * ignores wrapping quietly defeats the gate that reads it.
 *
 * **Measured, not computed, and that is not a shortcut.** Word wrap breaks at
 * word boundaries rather than at a character count, so arithmetic over string
 * lengths does not merely approximate the answer, it picks the wrong worst case:
 * a version of this table computed that way had `front` at six lines while the
 * browser drew seven, and the sampling check that was meant to catch it chose
 * five other cards. `bench/browser/card-heights.mjs` renders EVERY card of three
 * seeds, 8,946 of them, and reports the tallest per kind; these numbers are its
 * output. Re-run it when the generator's text changes.
 *
 * The harness pins its probe to a 0.6em monospace and asserts the advance,
 * because a headless browser on a bare box resolves every font family to a
 * 6.000px advance at 12px, about a sixth narrower than any monospace a reader
 * has.
 * Budgets taken against that wrap later than reality: five kinds measured as
 * fitting there clip in a real face, quest_step by two whole lines.
 *
 * `.campaign-card` also clips its overflow and is given a fixed height, so a
 * stale number here truncates a line rather than occluding the node underneath.
 * The measurement is the budget; the clip is what keeps the declared box true
 * when the budget is wrong.
 */
export const CARD_SIZES: Readonly<Record<NodeKind, CardSize>> = {
  campaign: { lines: 5 },
  arc: { lines: 5 },
  chapter: { lines: 5 },
  scene: { lines: 6 },
  encounter: { lines: 4 },
  location: { lines: 5 },
  npc: { lines: 6 },
  faction: { lines: 5 },
  quest: { lines: 8 },
  quest_step: { lines: 7 },
  clue: { lines: 6 },
  item: { lines: 5 },
  front: { lines: 7 },
  clock_tick: { lines: 5 },
  statblock: { lines: 3 },
  condition_modifier: { lines: 6 },
};

/** Every card is this wide; only the height varies by kind. */
export const cardWidth = (): number => CARD_WIDTH;

/** A card's authored height for its kind, in CSS pixels, border included. */
export function cardHeight(kind: NodeKind): number {
  return CARD_SIZES[kind].lines * CARD_LINE_HEIGHT + CARD_RULE_HEIGHT + CARD_PADDING;
}

/**
 * What a card of this kind occupies on screen, its inset included.
 *
 * Exported so the gate can be checked against the node sizes in
 * `campaign-style.ts` without this module importing them, which would make the
 * palette and the tiers a cycle.
 */
export function cardFootprint(kind: NodeKind): { readonly width: number; readonly height: number } {
  return { width: CARD_WIDTH + CARD_INSET, height: cardHeight(kind) + CARD_INSET };
}

/**
 * Below this, a node gets NO overlay element, which is the first tier rather
 * than a gap: the instanced shape draws it and it says nothing.
 *
 * 24 CSS pixels is M4.11's number and it is a legibility floor rather than a
 * scene fact: under it a title has fewer pixels than the text needs, whatever
 * the node is.
 */
export const LABEL_MIN_SCREEN_WIDTH = 24;

/**
 * Where the title tier ends and the card tier begins.
 *
 * **Derived, not copied, and derived from BOTH dimensions.** The ladder's 240
 * came from the rule that a card should not be wider than the node it
 * describes. Width alone is not enough here. A card sits inside its node's
 * top-left corner, so a card TALLER than its node hangs over whatever is drawn
 * below it, and at card zoom that is a neighbour the reader is also reading,
 * which is the width rule's fault turned ninety degrees.
 *
 * So the gate is the largest screen width any kind needs to contain its own
 * card in both directions, `max(footprintWidth, footprintHeight * nodeAspect)`,
 * over every kind AND over location's four subtypes, which are four node sizes
 * under one kind. A quest drives it: its node is 160 by 64 world units, an
 * aspect of 2.5, and a quest card's declared envelope is eight lines, so its
 * footprint is 184 tall and its node has to be 460 wide before it is 184 tall.
 *
 * Reachability is what makes this affordable rather than theoretical: the zoom
 * ceiling frames the smallest node, so the smallest node is around 630 CSS
 * pixels wide there and every kind clears this with room left.
 * `campaign-tiers.test.ts` checks all three halves against `campaign-style.ts`'s
 * real node sizes and against the demo's own `zoomLimits`: the gate covers every
 * variant, it is the SMALLEST value that does (so it cannot drift upward and
 * delay every card silently), and the ceiling can still reach it.
 */
export const CARD_MIN_SCREEN_WIDTH = 460;

/**
 * What each tier's `create` built, keyed by the element it built it into.
 *
 * `update` is handed the root and nothing else, and it runs on every pop-in
 * during a pan rather than only when data changes, so re-querying the DOM for
 * each field would be a tree walk per field per node per pass. A `WeakMap`
 * keyed by the root holds nothing alive that the pool has dropped.
 */
const titleRefs = new WeakMap<HTMLElement, { name: HTMLElement }>();
const cardRefs = new WeakMap<
  HTMLElement,
  { name: HTMLElement; badge: HTMLElement; oneLine: HTMLElement; rows: HTMLElement; card: HTMLElement }
>();

/** An element with a class, which is most of what building these tiers is. */
function el(className: string, tag: 'div' | 'dl' | 'span' = 'div'): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

/** What the tiers need from the demo that this module does not decide. */
export interface CampaignTierOptions {
  /**
   * A node's badge colour, from `campaign-style.ts`.
   *
   * Passed in rather than imported so that one module owns the palette: the
   * instanced shapes and the card badges have to agree on what colour a scene
   * is, and two modules holding their own copy is how they stop agreeing. They
   * agree here because both call the same function, not because a value was
   * copied from one to the other.
   *
   * It takes the NODE rather than the kind, because `location` is one kind and
   * four colours: a room and the region containing it are different blues, and
   * a signature over `NodeKind` alone cannot say which. The caller reads the
   * subtype off the node's own data and hands it to `kindColor`.
   */
  readonly nodeColor: (node: CampaignNode) => string;
}

/**
 * The two tiers, built against `RichNode<CampaignNode>`.
 *
 * `create` returns a BLANK element of the tier's shape and `update` fills it
 * with one node's content, which is what lets a tier pool its elements: a card
 * leaving the view goes back to the pool and the next node to reach card tier
 * gets it with new content rather than a new subtree. `update` therefore has to
 * REPLACE everything it wrote last time, since the element it is handed may
 * have belonged to a different node a frame ago.
 *
 * In both tiers the OUTER element is what the overlay positions and sizes, so
 * it is the node's world box and scales with the zoom, and the INNER element
 * counter-scales through `--dagr-overlay-inv-zoom` so its text is the same
 * number of CSS pixels at every zoom. The stylesheet does that half, and it
 * composes the inset INTO the transform after the scale, because a margin on a
 * counter-scaled element is still in world units.
 */
export function createCampaignTiers(
  options: CampaignTierOptions,
): readonly RichNodeTier<CampaignNode>[] {
  const { nodeColor } = options;

  return [
    {
      name: 'title',
      minScreenWidth: LABEL_MIN_SCREEN_WIDTH,
      maxScreenWidth: CARD_MIN_SCREEN_WIDTH,
      create: () => {
        const box = el('campaign-node');
        const title = el('campaign-title');
        const name = el('campaign-title-name', 'span');
        title.appendChild(name);
        box.appendChild(title);
        titleRefs.set(box, { name });
        return box;
      },
      update: (element, node) => {
        const refs = titleRefs.get(element);
        if (refs === undefined) return;
        // The id on the element is how the hover controller finds what to
        // highlight. Written here rather than tracked in a map beside the
        // overlay, because the overlay owns these elements: it creates,
        // recycles and detaches them, and a map beside it would be a second
        // record of which element belongs to which node, kept in step by hand.
        element.dataset.nodeId = node.id;
        // Cleared on every bind, because elements are POOLED: an element that
        // was hovered when it left the view comes back for a different node,
        // and the class would ride along and highlight the wrong one. The hover
        // controller re-applies it after each sync while a node is hovered.
        element.classList.remove('is-hovered');
        refs.name.textContent = node.data.name;
        // The kind's own colour, from the same function the instanced shapes
        // read. A title in one colour over a shape in another reads as a design
        // choice rather than as the drift it would be.
        refs.name.style.color = nodeColor(node.data);
      },
    },
    {
      name: 'card',
      minScreenWidth: CARD_MIN_SCREEN_WIDTH,
      create: () => {
        const box = el('campaign-node');
        const card = el('campaign-card');
        const head = el('campaign-card-head');
        const name = el('campaign-card-name', 'span');
        const badge = el('campaign-card-badge', 'span');
        head.append(name, badge);
        const oneLine = el('campaign-card-oneline');
        const rows = el('campaign-card-rows', 'dl');
        card.append(head, oneLine, rows);
        box.appendChild(card);
        cardRefs.set(box, { name, badge, oneLine, rows, card });
        return box;
      },
      update: (element, node) => {
        const refs = cardRefs.get(element);
        if (refs === undefined) return;
        const campaignNode = node.data;
        const kind = campaignNode.data.kind;

        element.dataset.nodeId = node.id;
        // See the title tier: pooled elements must not carry a highlight over.
        element.classList.remove('is-hovered');
        refs.name.textContent = campaignNode.name;
        // The NAME takes the colour, on both tiers, because the name is the one
        // element a reader sees on both sides of the gate. The badge stays the
        // dim ink the stylesheet gives it.
        refs.name.style.color = nodeColor(campaignNode);
        refs.badge.textContent = kind.replace('_', ' ');
        refs.oneLine.textContent = campaignNode.oneLine;

        // The declared size, written onto the element rather than left to the
        // content, so a card is the size this module says it is and the gate
        // above is a statement about something real.
        refs.card.style.width = `${String(cardWidth())}px`;
        // HEIGHT, not minHeight: the declared box is what the gate was derived
        // from, so a card that could grow past it would defeat the derivation.
        // The stylesheet clips the overflow, so text past the budget is
        // truncated rather than hanging over the node below.
        refs.card.style.height = `${String(cardHeight(kind))}px`;

        // Replaced wholesale rather than appended to, because this element may
        // have been a different node's card one frame ago.
        refs.rows.replaceChildren();
        for (const [key, value] of cardRows(campaignNode)) {
          refs.rows.append(
            Object.assign(document.createElement('dt'), { textContent: key }),
            Object.assign(document.createElement('dd'), { textContent: value }),
          );
        }
      },
    },
  ];
}
