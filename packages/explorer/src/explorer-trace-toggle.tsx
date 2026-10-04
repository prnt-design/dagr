/**
 * `ExplorerTraceToggle`: trace on and off. With trace on and a node
 * selected, every node not adjacent to it is dimmed.
 *
 * The text names what a press does (`labels.traceOn` while off), so the
 * button is not also `aria-pressed`: a toggle whose name flips and that
 * reports a pressed state reads its state twice. `data-active` is the
 * styling hook.
 */

import type { CSSProperties, ReactElement } from 'react';
import { useExplorerContext } from './context.js';

export interface ExplorerTraceToggleProps {
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

export function ExplorerTraceToggle(props: ExplorerTraceToggleProps): ReactElement {
  const { state } = useExplorerContext('ExplorerTraceToggle');
  const { trace, labels } = state;
  return (
    <button
      type="button"
      data-dagr-explorer="trace"
      data-active={trace ? 'true' : undefined}
      className={props.className}
      style={props.style}
      onClick={() => state.setTrace(!trace)}
    >
      {trace ? labels.traceOff : labels.traceOn}
    </button>
  );
}
