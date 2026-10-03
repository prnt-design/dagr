import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * What the package exports at runtime, pinned as a list. A surface test: it
 * catches a name added or dropped without anybody deciding to. Types are
 * erased, so the other test files exercise those by importing them.
 */
describe('@prnt/dagr-explorer', () => {
  it('exports exactly this runtime surface', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'DEFAULT_NODE_SEP',
        'DEFAULT_NODE_SIZE',
        'DEFAULT_RANK_SEP',
        'ExplorerDataError',
        'layoutView',
        'resolveNodeSize',
        'validateView',
        'validateViews',
      ].sort(),
    );
  });
});
