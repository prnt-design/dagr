import type { CampaignNode, SkillCheck } from './types.js';

/**
 * A node's card, as key/value rows a card tier can render directly.
 *
 * This is the display half of the schema: `NodeData` keeps the fields typed,
 * and this function is the one place that decides how each kind reads on a
 * card, so sixteen kinds do not become sixteen ad hoc formatters in the demo.
 * Rows, not markup, because the renderer of the rows owns the markup: the
 * ladder demo's card tier already renders exactly this shape.
 */
export function cardRows(node: CampaignNode): readonly (readonly [string, string])[] {
  const d = node.data;
  switch (d.kind) {
    case 'campaign':
      return [
        ['levels', `${String(d.levelRange[0])} to ${String(d.levelRange[1])}`],
        ['premise', d.premise],
      ];
    case 'arc':
      return [
        ['levels', `${String(d.levelBand[0])} to ${String(d.levelBand[1])}`],
        ['summary', d.summary],
      ];
    case 'chapter':
      return [
        ['order', String(d.expectedOrder)],
        ['summary', d.summary],
      ];
    case 'scene': {
      const rows: (readonly [string, string])[] = [
        ['type', d.sceneType],
        ['trigger', d.trigger],
      ];
      if (d.check !== undefined) rows.push(['check', formatCheck(d.check)]);
      return rows;
    }
    case 'encounter':
      return [
        ['difficulty', d.difficulty],
        ['xp budget', String(d.xpBudget)],
      ];
    case 'location': {
      // Distinct keys even though the generator never sets both flags: the
      // schema type permits it, external datasets are invited to retarget it,
      // and the demo uses the row key as a React list key.
      const rows: (readonly [string, string])[] = [['type', d.subtype]];
      if (d.keyCode !== undefined) rows.push(['key', d.keyCode]);
      if (d.terrain !== undefined) rows.push(['terrain', d.terrain]);
      if (d.hub === true) rows.push(['role', 'hub']);
      if (d.dungeon === true) rows.push(['site', 'keyed, looping']);
      return rows;
    }
    case 'npc': {
      const rows: (readonly [string, string])[] = [
        ['role', d.role],
        ['attitude', d.attitude],
      ];
      if (d.secret !== undefined) rows.push(['secret', d.secret]);
      return rows;
    }
    case 'faction':
      return [
        ['goal', d.goal],
        ['stance', d.stance],
      ];
    case 'quest':
      return [
        ['objective', d.objective],
        ['state', d.state],
      ];
    case 'quest_step': {
      const rows: (readonly [string, string])[] = [['objective', d.objective]];
      if (d.check !== undefined) rows.push(['check', formatCheck(d.check)]);
      if (d.revelation === true) rows.push(['revelation', 'three clues point here']);
      return rows;
    }
    case 'clue':
      return [['fact', d.fact]];
    case 'item':
      return [
        ['rarity', d.rarity.replace('_', ' ')],
        ['plot critical', d.plotCritical ? 'yes' : 'no'],
      ];
    case 'front':
      return [
        ['doom', d.doom],
        ['clock', `${String(d.clockSize)} segments`],
      ];
    case 'clock_tick':
      return [
        ['tick', String(d.index)],
        ['portent', d.portent],
      ];
    case 'statblock':
      return [['challenge', `CR ${String(d.challengeRating)}`]];
    case 'condition_modifier':
      return [
        ['scope', d.scope],
        ['effect', d.effect],
      ];
  }
}

function formatCheck(check: SkillCheck): string {
  return `DC ${String(check.dc)} ${check.skill}`;
}
