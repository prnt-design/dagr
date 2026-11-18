import { describe, expect, it } from 'vitest';
import { reportLink } from './route.js';
describe('durable report links', () => {
  it('preserves repository and canonical node identity without interpreting delimiters', () => {
    const link = reportLink('2026-11-18', 'prnt-design/dagr', 'package:%40prnt%2Fdagr');
    const parsed = new URLSearchParams(link.slice(1));
    expect(parsed.get('repository')).toBe('prnt-design/dagr');
    expect(parsed.get('date')).toBe('2026-11-18');
    expect(parsed.get('node')).toBe('package:%40prnt%2Fdagr');
  });
});
