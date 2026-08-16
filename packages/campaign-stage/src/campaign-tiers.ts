import { cardRows } from '@dagr/campaign';
import type { CampaignNode, NodeKind } from '@dagr/campaign';
import type { RichNodeTier } from '@dagr/render';
import { GLYPH_STROKE_WIDTH, GLYPH_VIEWBOX, nodeGlyph } from './campaign-glyphs.js';
// The rules these tiers write class names for live in `campaign-cards.css`,
// which `stage.css` pulls in. NOT imported here, though this is the module that
// owns them: the package builds through `tsc`, which copies no stylesheet into
// `dist`, so an import here would resolve in the demo's Vite build and point at
// a file that does not exist in the docs site's. The stylesheet is a named
// package entry the host imports instead; see the header of `stage.css`.

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
const titleRefs = new WeakMap<HTMLElement, { name: HTMLElement; icon: GlyphElement }>();
const cardRefs = new WeakMap<
  HTMLElement,
  {
    name: HTMLElement;
    badge: HTMLElement;
    badgeIcon: GlyphElement;
    mark: GlyphElement;
    oneLine: HTMLElement;
    rows: HTMLElement;
    card: HTMLElement;
  }
>();

/** An element with a class, which is most of what building these tiers is. */
function el(className: string, tag: 'div' | 'dl' | 'span' = 'div'): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

/** SVG elements are not in the HTML namespace, and `createElement` makes one. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * One kind's mark, built once and rewritten on every bind.
 *
 * The `svg` and its single `path` are held separately because `update` writes
 * to both: the colour goes on the root, which the stroke reads through
 * `currentColor`, and the shape goes on the path's `d`. Keeping the pair means
 * a bind is two attribute writes rather than a `querySelector` per element per
 * pass, which is the same reason the tiers hold every other ref.
 */
interface GlyphElement {
  readonly root: SVGSVGElement;
  readonly path: SVGPathElement;
}

/**
 * A blank mark of one class: the `svg` with its drawing attributes and an empty
 * `path`.
 *
 * The stroke is `currentColor`, so the mark takes the colour whoever binds it
 * puts on the root, and this module needs no palette of its own. The attributes
 * are set with `setAttribute` rather than through properties because an SVG
 * element's `className` is an `SVGAnimatedString` and assigning a string to it
 * does nothing at all: the element gets no class, no rule matches, and nothing
 * anywhere fails, which is the same silent-drop failure `style.color` has and
 * the reason `campaign-style.ts` round trips its colours in a test.
 */
function glyph(className: string): GlyphElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('class', className);
  root.setAttribute('viewBox', GLYPH_VIEWBOX);
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', 'currentColor');
  root.setAttribute('stroke-width', String(GLYPH_STROKE_WIDTH));
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  // The name beside it says what the node is, so the mark is decoration for
  // anything reading the DOM rather than looking at it.
  root.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  root.appendChild(path);
  return { root, path };
}

/**
 * Points one built mark at one node: its kind's path, in its own colour.
 *
 * Called on every bind, never conditionally, because the elements are POOLED
 * and a mark that kept the last node's `d` would draw a room's four walls on an
 * NPC. Both writes are unconditional for the same reason.
 */
function bindGlyph(element: GlyphElement, node: CampaignNode, colour: string): void {
  element.path.setAttribute('d', nodeGlyph(node));
  element.root.style.color = colour;
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
        const icon = glyph('campaign-title-icon');
        const name = el('campaign-title-name', 'span');
        title.append(icon.root, name);
        box.appendChild(title);
        titleRefs.set(box, { name, icon });
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
        const colour = nodeColor(node.data);
        refs.name.style.color = colour;
        // The mark takes the same colour rather than the rule's dim ink, so the
        // tag reads as one object: at this tier the title is the only thing on
        // screen that says what the node IS, and a grey mark beside a coloured
        // name would read as two labels.
        bindGlyph(refs.icon, node.data, colour);
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
        const badgeIcon = glyph('campaign-card-badge-icon');
        badge.appendChild(badgeIcon.root);
        // The kind's name follows its mark in its own span, because the badge
        // is what `update` rewrites and `textContent` on the badge would take
        // the mark with it.
        const badgeText = el('campaign-card-badge-text', 'span');
        badge.appendChild(badgeText);
        head.append(name, badge);
        const oneLine = el('campaign-card-oneline');
        const rows = el('campaign-card-rows', 'dl');
        // The same mark again at four times the size, which is this demo's
        // answer to "or images maybe": see `campaign-cards.css` for why it is
        // out of flow and why it is not a picture.
        const mark = glyph('campaign-card-mark');
        card.append(mark.root, head, oneLine, rows);
        box.appendChild(card);
        cardRefs.set(box, { name, badge: badgeText, badgeIcon, mark, oneLine, rows, card });
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
        // element a reader sees on both sides of the gate. The badge's TEXT
        // stays the dim ink the stylesheet gives it, and its mark does not: a
        // coloured mark is what carries the kind at a glance once a card is
        // dense with rows, and it is the one element the title tier and this
        // one draw identically.
        const colour = nodeColor(campaignNode);
        refs.name.style.color = colour;
        bindGlyph(refs.badgeIcon, campaignNode, colour);
        bindGlyph(refs.mark, campaignNode, colour);
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

/** What a far-end label built, keyed by the element, as the tiers above do. */
const farEndRefs = new WeakMap<HTMLElement, { name: HTMLElement }>();

/**
 * The tier D3 hangs a hovered node's NEIGHBOURS off: a name on a node that is
 * too small to have earned one.
 *
 * **Its whole reason is the gate it does not have.** The title tier opens at
 * {@link LABEL_MIN_SCREEN_WIDTH}, so at the zoom where a reader can see one
 * node's edges fan out across a tile, the nodes at the far ends of those edges
 * are shapes. "Where does this edge go" is then answerable only by following
 * the line, which is what the highlight is trying to save them from. So this
 * tier has no floor, and a node bound to it gets a name at any zoom.
 *
 * **It has a CEILING instead, and the ceiling is the title tier's floor**, so
 * the two can never both draw. A far end wide enough to have its own title
 * already has one, and the overlay's own per-frame gate is what decides that:
 * keeping the rule here rather than filtering the node list means it stays
 * right while a reader zooms with the pointer held still, which is exactly when
 * a hand-filtered list would go stale.
 *
 * **NO MARK ON THIS ONE**, which is the one place D5's icons stop. The other
 * two tiers are a node saying what it is; this is an annotation a hover put on
 * a node too small to have earned a name, and it is drawn at a zoom where the
 * screen is mostly edges. A mark here would add sixteen more shapes to the
 * densest picture the demo draws, to label nodes the reader did not ask about.
 * The dashed rule and the lighter ground already say what this is.
 *
 * A SEPARATE `createRichNodes` layer rather than a third tier beside the other
 * two, because its node set is different: the campaign's 3,010 nodes are bound
 * to the tiers above once and never change, while this holds only the handful a
 * hover is about and is replaced on every change of hovered node. One layer per
 * lifetime is what keeps `setNodes` on this one from walking 3,010 entries to
 * light eleven.
 */
export function createFarEndTiers(
  options: CampaignTierOptions,
): readonly RichNodeTier<CampaignNode>[] {
  const { nodeColor } = options;
  return [
    {
      name: 'far-end',
      maxScreenWidth: LABEL_MIN_SCREEN_WIDTH,
      create: () => {
        const box = el('campaign-node');
        const title = el('campaign-title campaign-title--far');
        const name = el('campaign-title-name', 'span');
        title.appendChild(name);
        box.appendChild(title);
        farEndRefs.set(box, { name });
        return box;
      },
      update: (element, node) => {
        const refs = farEndRefs.get(element);
        if (refs === undefined) return;
        // No `data-node-id` here, deliberately: that attribute is how the hover
        // controller finds the element to put `is-hovered` on, and a far end
        // carrying one would make a query for the hovered node ambiguous the
        // moment a node is both hovered and somebody else's neighbour.
        refs.name.textContent = node.data.name;
        refs.name.style.color = nodeColor(node.data);
      },
    },
  ];
}
