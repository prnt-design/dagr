import { defaultStages } from '../src/index.js';
import type {
  LayoutStages,
  OrderedState,
  PositionedState,
  PreparedState,
  RankedState,
  RoutedState,
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

  /** What each stage returned, so a test can check it is what the next one got. */
  readonly outputs: {
    rank?: RankedState;
    order?: OrderedState;
    position?: PositionedState;
    route?: RoutedState;
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
