import { describe, expect, it } from 'vitest';
import { cardRows, generateCampaign } from '../src/index.js';

describe('cardRows', () => {
  it('gives every kind in the default campaign at least one row, with no empty cells', () => {
    const campaign = generateCampaign();
    const kindsSeen = new Set<string>();
    for (const node of campaign.nodes) {
      const rows = cardRows(node);
      expect(rows.length).toBeGreaterThan(0);
      for (const [key, value] of rows) {
        expect(key.length).toBeGreaterThan(0);
        expect(value.length).toBeGreaterThan(0);
      }
      kindsSeen.add(node.data.kind);
    }
    // All sixteen kinds occur in the default campaign, so the loop above has
    // exercised every branch of the formatter.
    expect(kindsSeen.size).toBe(16);
  });

  it('formats a check as the DC line a DM would write', () => {
    const campaign = generateCampaign();
    const checked = campaign.nodes.find(
      (n) => n.data.kind === 'scene' && n.data.check !== undefined,
    );
    expect(checked).toBeDefined();
    if (checked === undefined) return;
    const row = cardRows(checked).find(([key]) => key === 'check');
    expect(row).toBeDefined();
    if (row !== undefined) expect(row[1]).toMatch(/^DC \d{2} [A-Z]/);
  });
});
