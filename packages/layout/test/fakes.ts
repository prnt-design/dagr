import { defaultStages } from '../src/index.js';
import type {
  LayoutStages,
  OrderOutput,
  OrderedState,
  PositionOutput,
  PositionedState,
  PreparedState,
  RankOutput,
  RankedState,
  RouteOutput,
} from '../src/index.js';

/**
 * A full set of stages that delegates to the defaults and writes down what it
 * saw. The tests assert on the recording rather than on the stages themselves,
 * so they check the runner's behaviour (order of calls, what each stage is
 * handed) without depending on any particular stage doing real work.
 */
export interface StageRecorder {
  /** Stage names in call order, one entry per `run` call. */
  readonly log: string[];

  /** The stage set to hand to `layout`. */
  readonly stages: LayoutStages;

  /** The argument each stage was called with, keyed by phase. */
  readonly inputs: {
    rank?: PreparedState;
    order?: RankedState;
    position?: OrderedState;
    route?: PositionedState;
  };

  /**
   * What each stage returned: its own contribution, not the next record.
   *
   * The invariant these used to serve, "what a stage returned is what the next
   * one got", was retired in M2.4a and could not be repaired, because it is no
   * longer true and no longer should be. A stage returns a `RankOutput` and its
   * three siblings; the runner builds the record. What holds instead, and what
   * `layout.pipeline.test.ts` asserts, is that stage N + 1 is handed a record
   * carrying the runner's own graph by identity, the config the runner
   * resolved, and the fields stage N returned. That is a stronger claim than
   * the old one: identity of a whole object could be satisfied by a runner that
   * passed a stage's record along without reading it, and this cannot.
   */
  readonly outputs: {
    rank?: RankOutput;
    order?: OrderOutput;
    position?: PositionOutput;
    route?: RouteOutput;
  };
}

export function recordingStages(): StageRecorder {
  const log: string[] = [];
  const inputs: StageRecorder['inputs'] = {};
  const outputs: StageRecorder['outputs'] = {};
  return {
    log,
    inputs,
    outputs,
    stages: {
      rank: {
        name: 'recording-rank',
        run(input) {
          log.push('rank');
          inputs.rank = input;
          outputs.rank = defaultStages.rank.run(input);
          return outputs.rank;
        },
      },
      order: {
        name: 'recording-order',
        run(input) {
          log.push('order');
          inputs.order = input;
          outputs.order = defaultStages.order.run(input);
          return outputs.order;
        },
      },
      position: {
        name: 'recording-position',
        run(input) {
          log.push('position');
          inputs.position = input;
          outputs.position = defaultStages.position.run(input);
          return outputs.position;
        },
      },
      route: {
        name: 'recording-route',
        run(input) {
          log.push('route');
          inputs.route = input;
          outputs.route = defaultStages.route.run(input);
          return outputs.route;
        },
      },
    },
  };
}
