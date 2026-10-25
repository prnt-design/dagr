import { describe, expect, it } from 'vitest';
import { LayoutError, resolveConfig } from '../src/index.js';
import type { LayoutErrorCode, RankDir } from '../src/index.js';

/** Assert that `run` throws a LayoutError carrying exactly `code`. */
function expectCode(run: () => unknown, code: LayoutErrorCode): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LayoutError);
  expect((thrown as LayoutError).code).toBe(code);
}

describe('resolveConfig', () => {
  it('fills in every default when called with no options', () => {
    expect(resolveConfig()).toEqual({
      rankDir: 'TB',
      rankSpacing: 50,
      nodeSpacing: 30,
      marginX: 0,
      marginY: 0,
    });
  });

  it('fills in every default when called with an empty options object', () => {
    expect(resolveConfig({})).toEqual(resolveConfig());
  });

  it('honors every override', () => {
    expect(
      resolveConfig({
        rankDir: 'LR',
        rankSpacing: 10,
        nodeSpacing: 5,
        marginX: 7,
        marginY: 9,
      }),
    ).toEqual({
      rankDir: 'LR',
      rankSpacing: 10,
      nodeSpacing: 5,
      marginX: 7,
      marginY: 9,
    });
  });

  it('accepts zero spacings and zero margins', () => {
    const config = resolveConfig({
      rankSpacing: 0,
      nodeSpacing: 0,
      marginX: 0,
      marginY: 0,
    });
    expect(config.rankSpacing).toBe(0);
    expect(config.nodeSpacing).toBe(0);
  });

  it('accepts all four rank directions', () => {
    const dirs: readonly RankDir[] = ['TB', 'BT', 'LR', 'RL'];
    for (const rankDir of dirs) {
      expect(resolveConfig({ rankDir }).rankDir).toBe(rankDir);
    }
  });

  it('does not mutate the options object it was given', () => {
    const options = { rankDir: 'BT' as const, nodeSpacing: 4 };
    const snapshot = { ...options };
    resolveConfig(options);
    expect(options).toEqual(snapshot);
  });

  it('rejects an unknown rank direction', () => {
    expectCode(() => resolveConfig({ rankDir: 'sideways' as RankDir }), 'INVALID_RANK_DIR');
  });

  it('rejects negative and non-finite spacings', () => {
    expectCode(() => resolveConfig({ rankSpacing: -1 }), 'INVALID_SPACING');
    expectCode(() => resolveConfig({ nodeSpacing: -1 }), 'INVALID_SPACING');
    expectCode(() => resolveConfig({ rankSpacing: Number.NaN }), 'INVALID_SPACING');
    expectCode(() => resolveConfig({ nodeSpacing: Number.POSITIVE_INFINITY }), 'INVALID_SPACING');
  });

  it('rejects negative and non-finite margins', () => {
    expectCode(() => resolveConfig({ marginX: -1 }), 'INVALID_MARGIN');
    expectCode(() => resolveConfig({ marginY: -1 }), 'INVALID_MARGIN');
    expectCode(() => resolveConfig({ marginX: Number.NaN }), 'INVALID_MARGIN');
    expectCode(() => resolveConfig({ marginY: Number.NEGATIVE_INFINITY }), 'INVALID_MARGIN');
  });
});

describe('LayoutError', () => {
  it('is an Error with a stable name, a code, and a readable message', () => {
    const error = new LayoutError('INVALID_SPACING', 'nodeSpacing must be finite');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LayoutError');
    expect(error.code).toBe('INVALID_SPACING');
    expect(error.message).toBe('nodeSpacing must be finite');
  });
});
