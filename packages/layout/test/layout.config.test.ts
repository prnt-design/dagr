import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, InvalidConfigError, layout } from '../src/index.js';
import type { LayoutConfig, ResolvedLayoutConfig } from '../src/index.js';
import { recordingStages } from './fakes.js';

function oneNode(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  return graph;
}

/** The config the stages actually received, which is the one that took effect. */
function resolvedFor(config?: LayoutConfig): ResolvedLayoutConfig {
  const recorder = recordingStages();
  const input = config === undefined ? { graph: oneNode() } : { graph: oneNode(), config };
  layout(input, recorder.stages);
  const seen = recorder.inputs.rank;
  if (seen === undefined) throw new Error('the rank stage was never called');
  return seen.config;
}

describe('layout config resolution', () => {
  it('applies every default when the caller says nothing', () => {
    expect(resolvedFor()).toEqual({
      nodeSep: 50,
      rankSep: 50,
      edgeSep: 10,
      defaultNodeSize: { width: 100, height: 40 },
    });
  });

  it('publishes the same defaults it applies', () => {
    expect(resolvedFor()).toEqual(DEFAULT_LAYOUT_CONFIG);
  });

  it('honours every override', () => {
    expect(
      resolvedFor({
        nodeSep: 8,
        rankSep: 120,
        edgeSep: 2,
        defaultNodeSize: { width: 20, height: 10 },
      }),
    ).toEqual({ nodeSep: 8, rankSep: 120, edgeSep: 2, defaultNodeSize: { width: 20, height: 10 } });
  });

  it('leaves the other fields at their defaults when one is overridden', () => {
    expect(resolvedFor({ rankSep: 7 })).toEqual({
      nodeSep: 50,
      rankSep: 7,
      edgeSep: 10,
      defaultNodeSize: { width: 100, height: 40 },
    });
  });

  it('accepts zero for every separation and size', () => {
    expect(
      resolvedFor({
        nodeSep: 0,
        rankSep: 0,
        edgeSep: 0,
        defaultNodeSize: { width: 0, height: 0 },
      }),
    ).toEqual({ nodeSep: 0, rankSep: 0, edgeSep: 0, defaultNodeSize: { width: 0, height: 0 } });
  });

  it('does not let one run leak its overrides into the next', () => {
    resolvedFor({ nodeSep: 999 });
    expect(resolvedFor().nodeSep).toBe(50);
  });

  const rejected: readonly (readonly [string, LayoutConfig, string])[] = [
    ['a negative nodeSep', { nodeSep: -1 }, 'nodeSep'],
    ['a NaN nodeSep', { nodeSep: Number.NaN }, 'nodeSep'],
    ['an infinite nodeSep', { nodeSep: Number.POSITIVE_INFINITY }, 'nodeSep'],
    ['a negative rankSep', { rankSep: -0.5 }, 'rankSep'],
    ['a NaN rankSep', { rankSep: Number.NaN }, 'rankSep'],
    ['an infinite rankSep', { rankSep: Number.NEGATIVE_INFINITY }, 'rankSep'],
    ['a negative edgeSep', { edgeSep: -10 }, 'edgeSep'],
    ['a NaN edgeSep', { edgeSep: Number.NaN }, 'edgeSep'],
    ['an infinite edgeSep', { edgeSep: Number.POSITIVE_INFINITY }, 'edgeSep'],
    [
      'a negative default width',
      { defaultNodeSize: { width: -1, height: 10 } },
      'defaultNodeSize.width',
    ],
    [
      'a NaN default height',
      { defaultNodeSize: { width: 10, height: Number.NaN } },
      'defaultNodeSize.height',
    ],
    [
      'an infinite default width',
      { defaultNodeSize: { width: Number.POSITIVE_INFINITY, height: 10 } },
      'defaultNodeSize.width',
    ],
  ];

  it.each(rejected)('rejects %s', (_label, config, field) => {
    const run = () => layout({ graph: oneNode(), config });
    expect(run).toThrow(InvalidConfigError);
    try {
      run();
      expect.unreachable('layout should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError);
      if (!(error instanceof InvalidConfigError)) throw error;
      expect(error.code).toBe('INVALID_CONFIG');
      expect(error.field).toBe(field);
      expect(error.message).toContain(field);
    }
  });

  it('rejects a bad config before running any stage', () => {
    const recorder = recordingStages();
    expect(() => {
      layout({ graph: oneNode(), config: { nodeSep: -1 } }, recorder.stages);
    }).toThrow(InvalidConfigError);
    expect(recorder.log).toEqual([]);
  });
});
