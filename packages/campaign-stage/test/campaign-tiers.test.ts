// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cardRows, generateCampaign } from '@dagr/campaign';
import type { CampaignNode, NodeKind } from '@dagr/campaign';
import type { RichNode } from '@dagr/render';
import { zoomLimits } from '../src/camera-input.js';
import { SMALLEST_NODE_SIZE, nodeColor, styleFor } from '../src/campaign-style.js';
import {
  CARD_MIN_SCREEN_WIDTH,
  CARD_SIZES,
  LABEL_MIN_SCREEN_WIDTH,
  cardFootprint,
  cardHeight,
  cardWidth,
  createCampaignTiers,
} from '../src/campaign-tiers.js';

/**
 * The campaign's two overlay tiers.
 *
 * Three things are worth a test here and the rest is CSS. The declared size
 * table has to keep up with `card.ts`, which is checked against a whole
 * generated campaign rather than against a handful of hand-written nodes,
 * because the optional rows are exactly what a spot check misses. The gates
 * have to satisfy the rule `createRichNodes` enforces, disjoint and half-open,
 * and the card gate has to satisfy the rule it was derived from. And `update`
 * has to REPLACE what it wrote last time, because the elements are pooled
 * across nodes and the failure mode is a card showing the previous node's
 * fields.
 */

const KINDS: readonly NodeKind[] = [
  'campaign',
  'arc',
  'chapter',
  'scene',
  'encounter',
  'location',
  'npc',
  'faction',
  'quest',
  'quest_step',
  'clue',
  'item',
  'front',
  'clock_tick',
  'statblock',
  'condition_modifier',
];

const tiers = createCampaignTiers({ nodeColor: () => 'rgb(1, 2, 3)' });

const titleTier = tiers[0];
const cardTier = tiers[1];
if (titleTier === undefined || cardTier === undefined) {
  throw new Error('expected a title tier and a card tier');
}

/**
 * A scene-sized extent, for deriving the zoom ceiling the way the demo does.
 *
 * The ceiling is the smallest node framed in the viewport, which does not
 * depend on this box; it is the floor that reads the scene extent. So any
 * plausible campaign-sized box gives the same ceiling, and the reachability
 * check below is about the ceiling.
 */
const SCENE_BOUNDS = { minX: 0, minY: 0, maxX: 40000, maxY: 24000 };

/** A rich node wrapping a campaign node, which is what the tiers are handed. */
function richNode(node: CampaignNode): RichNode<CampaignNode> {
  return { id: node.id, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 }, data: node };
}

describe('the declared size table', () => {
  /**
   * What is NOT tested here, and why.
   *
   * Whether a kind's line budget is big enough for its text is a question about
   * word wrapping in a real browser, and word wrap breaks at word boundaries
   * rather than at a character count: arithmetic over string lengths picks the
   * wrong worst case rather than an approximate one. `bench/browser/card-heights.mjs`
   * answers it by rendering all 8,946 cards of three seeds and reporting the
   * tallest per kind, and the table holds its output. jsdom has no layout, so
   * repeating that here would assert a number this file made up.
   *
   * What is left is what the table has to satisfy whatever the browser does:
   * every kind covered, and every card's rows fitting the box the gate reads.
   */
  it('covers every node kind', () => {
    for (const kind of KINDS) {
      expect(CARD_SIZES[kind]).toBeDefined();
      expect(CARD_SIZES[kind].lines).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(CARD_SIZES)).toHaveLength(KINDS.length);
  });

  it('budgets at least one line for the name and one per row of every node', () => {
    // The floor the browser cannot go under: a card shows its name and then one
    // row per cardRows entry, so a budget below that is short however the text
    // wraps. Three seeds, because the optional rows are drawn per node.
    for (const seed of [20260814, 7, 999]) {
      const seen = new Set<NodeKind>();
      for (const node of generateCampaign({ seed }).nodes) {
        const kind = node.data.kind;
        seen.add(kind);
        expect(
          CARD_SIZES[kind].lines,
          `${kind} "${node.name}" has more rows than its card budgets lines`,
        ).toBeGreaterThanOrEqual(1 + cardRows(node).length);
      }
      expect(seen.size).toBe(KINDS.length);
    }
  });

  it('gives a card a height that grows with its lines', () => {
    expect(cardHeight('statblock')).toBeLessThan(cardHeight('quest'));
    for (const kind of KINDS) expect(cardHeight(kind)).toBeGreaterThan(0);
  });
});

describe('the tier gates', () => {
  it('leaves no width at which a node shows both tiers or neither', () => {
    // Half-open and adjacent: the two meet exactly, so at the card threshold
    // the card shows and the title does not.
    expect(titleTier.maxScreenWidth).toBe(cardTier.minScreenWidth);
    expect(titleTier.minScreenWidth).toBe(LABEL_MIN_SCREEN_WIDTH);
    expect(cardTier.maxScreenWidth).toBeUndefined();
  });

  /**
   * What screen width a kind needs before its card fits inside its node.
   *
   * Both dimensions, against the real node sizes: a card wider than its node
   * breaks the rule the ladder's 240 came from, and a card taller than its node
   * hangs over the neighbour below it, which at card zoom is something the
   * reader is also reading.
   */
  const widthNeededFor = (kind: NodeKind, subtype?: string): number => {
    const node = styleFor(kind, subtype).size;
    const card = cardFootprint(kind);
    return Math.max(card.width, card.height * (node.width / node.height));
  };

  /** Every styled variant: the 16 kinds, with location's four subtypes. */
  const VARIANTS: readonly (readonly [NodeKind, string | undefined])[] = [
    ...KINDS.filter((kind) => kind !== 'location').map(
      (kind) => [kind, undefined] as readonly [NodeKind, string | undefined],
    ),
    ...(['region', 'settlement', 'building', 'room'] as const).map(
      (subtype) => ['location', subtype] as readonly [NodeKind, string | undefined],
    ),
  ];

  it('opens the card tier no earlier than every kind needs to contain its card', () => {
    for (const [kind, subtype] of VARIANTS) {
      const needed = widthNeededFor(kind, subtype);
      expect(CARD_MIN_SCREEN_WIDTH, `${kind}${subtype === undefined ? '' : `/${subtype}`}`,
      ).toBeGreaterThanOrEqual(needed);
    }
  });

  it('opens it no later, so the gate cannot drift upward and delay every card', () => {
    // The gate is the tightest value that satisfies the check above. Rounding
    // it up "for safety" costs every card zoom levels nobody asked for, and
    // nothing would fail to say so.
    const needed = Math.max(...VARIANTS.map(([kind, subtype]) => widthNeededFor(kind, subtype)));
    expect(CARD_MIN_SCREEN_WIDTH).toBeLessThan(needed + 1);
  });

  it('leaves every kind reachable at the campaign zoom ceiling', () => {
    // A gate above what the ceiling can reach is a card nobody can ever open.
    // The ceiling is DERIVED here rather than copied: this file's whole argument
    // is that the gate follows from the sizes, and pinning the other side of the
    // comparison to a literal 19.9 would keep asserting against a ceiling the
    // demo had moved away from, silently. `zoomLimits` is the same function
    // FirstLight calls, and it is DOM-free.
    const viewport = { width: 1440, height: 900 };
    const { maxZoom } = zoomLimits(SCENE_BOUNDS, SMALLEST_NODE_SIZE, viewport);
    // The ceiling frames the SMALLEST node, so that node is the tight case: if
    // it clears the gate, everything larger clears it earlier.
    expect(SMALLEST_NODE_SIZE.width * maxZoom).toBeGreaterThan(CARD_MIN_SCREEN_WIDTH);
  });
});

describe('the tiers themselves', () => {
  const campaign = generateCampaign();
  const scene = campaign.nodes.find((node) => node.data.kind === 'scene');
  const clue = campaign.nodes.find((node) => node.data.kind === 'clue');
  if (scene === undefined || clue === undefined) throw new Error('expected a scene and a clue');

  it('builds a blank title element and fills it', () => {
    const element = titleTier.create();
    expect(element.textContent).toBe('');
    titleTier.update(element, richNode(scene));
    expect(element.textContent).toBe(scene.name);
  });

  it('builds a blank card element and fills it with name, badge, one-liner and rows', () => {
    const element = cardTier.create();
    expect(element.textContent).toBe('');

    cardTier.update(element, richNode(scene));
    expect(element.textContent).toContain(scene.name);
    expect(element.textContent).toContain(scene.oneLine);
    for (const [key, value] of cardRows(scene)) {
      expect(element.textContent).toContain(key);
      expect(element.textContent).toContain(value);
    }
  });

  it('replaces the previous node content when an element is recycled', () => {
    // The pooling failure mode: a card leaving the view goes back to its pool
    // and comes back for a different node, so an update that only appends
    // shows both nodes at once.
    const element = cardTier.create();
    cardTier.update(element, richNode(scene));
    cardTier.update(element, richNode(clue));

    expect(element.textContent).toContain(clue.name);
    expect(element.textContent).not.toContain(scene.name);
    expect(element.querySelectorAll('dt')).toHaveLength(cardRows(clue).length);
  });

  it('takes the name colour it is given rather than deciding one', () => {
    // A real CSS colour, and that is a requirement rather than test hygiene:
    // the value goes to `style.color`, where anything the parser rejects is
    // dropped silently and leaves the badge its inherited colour. Whatever
    // `campaign-style.ts` hands over has to be a colour the browser accepts.
    const tint = createCampaignTiers({
      nodeColor: (node) => (node.data.kind === 'scene' ? 'rgb(9, 8, 7)' : 'rgb(0, 0, 0)'),
    });
    const card = tint[1];
    if (card === undefined) throw new Error('expected a card tier');
    const element = card.create();
    card.update(element, richNode(scene));
    const name = element.querySelector<HTMLElement>('.campaign-card-name');
    expect(name?.style.color).toBe('rgb(9, 8, 7)');
    // The badge is NOT tinted: the name carries the colour on both tiers, so it
    // does not change appearance as a reader crosses the gate.
    const badge = element.querySelector<HTMLElement>('.campaign-card-badge');
    expect(badge?.style.color).toBe('');
  });

  it('colours the title and the card name identically, across the gate', () => {
    // The name is the one element present on both sides of the gate. If the two
    // tiers disagreed, a node would change colour at one pixel of zoom.
    const title = titleTier.create();
    titleTier.update(title, richNode(scene));
    const card = cardTier.create();
    cardTier.update(card, richNode(scene));
    const titleName = title.querySelector<HTMLElement>('.campaign-title-name');
    const cardName = card.querySelector<HTMLElement>('.campaign-card-name');
    expect(cardName?.style.color).toBe(titleName?.style.color);
    expect(titleName?.style.color).not.toBe('');
  });

  /**
   * Every node's colour has to survive a `style.color` round trip.
   *
   * The failure this guards is silent: the CSS parser drops a value it does not
   * accept, `style.color` reads back unchanged, and the badge keeps whatever it
   * inherited while nothing anywhere throws. So the check is not "is it a
   * string" but "does the browser give it back", which is the only question
   * that matters and the only one a type cannot answer.
   *
   * Run over REAL nodes covering all sixteen kinds and all four location
   * subtypes, against the palette the demo actually passes in. `location` is
   * one kind and four colours, so a palette can be right about the kind and
   * wrong about a room.
   */
  it('gives every kind and location subtype a colour the CSS parser accepts', () => {
    const seen = new Map<string, CampaignNode>();
    for (const node of campaign.nodes) {
      const key =
        node.data.kind === 'location' ? `location/${node.data.subtype}` : node.data.kind;
      if (!seen.has(key)) seen.set(key, node);
    }
    // 16 kinds, with location standing in for four of its own: 15 + 4.
    expect(seen.size).toBe(KINDS.length - 1 + 4);

    const probe = document.createElement('span');
    for (const [what, node] of seen) {
      const colour = nodeColor(node);
      probe.style.color = '';
      probe.style.color = colour;
      expect(probe.style.color, `${what} colour ${JSON.stringify(colour)} was rejected`).not.toBe(
        '',
      );
    }
  });

  it('shows the silent failure the round trip guards against', () => {
    const probe = document.createElement('span');
    probe.style.color = 'rgb(1, 2, 3)';
    probe.style.color = 'not-a-colour';
    // Unchanged, not cleared and not thrown: the assignment did nothing at all.
    expect(probe.style.color).toBe('rgb(1, 2, 3)');
  });

  it('writes the kind declared size onto the card', () => {
    const element = cardTier.create();
    cardTier.update(element, richNode(clue));
    const card = element.querySelector<HTMLElement>('.campaign-card');
    expect(card?.style.width).toBe(`${String(cardWidth())}px`);
    // HEIGHT, not minHeight: a card that could grow past its declared box would
    // defeat the gate that was derived from it.
    expect(card?.style.height).toBe(`${String(cardHeight('clue'))}px`);
  });
});
