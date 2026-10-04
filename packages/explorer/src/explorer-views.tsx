/**
 * `ExplorerViews`: the view switcher. It renders nothing for a single view,
 * slot or not, because there is nothing to switch to.
 *
 * The default is a group of buttons, the active one `aria-pressed`. Buttons
 * rather than tabs: tabs promise arrow-key movement and a tab panel, and the
 * panel here is the whole explorer.
 */

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useExplorerContext } from './context.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView } from './types.js';

/** What the switcher's slot receives. */
export interface ExplorerViewsContext<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge> {
  readonly views: readonly ExplorerView<N, E>[];
  readonly activeView: ExplorerView<N, E>;
  readonly selectView: (id: string) => void;
}

export interface ExplorerViewsProps<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge> {
  /** The switcher's content. Default: a button per view. */
  readonly children?: ((context: ExplorerViewsContext<N, E>) => ReactNode) | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

export function ExplorerViews<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge>(
  props: ExplorerViewsProps<N, E>,
): ReactElement | null {
  const { children, className, style } = props;
  const { state } = useExplorerContext('ExplorerViews');
  // The part's type parameters are a claim about the root's data. See context.ts.
  const views = state.views as unknown as readonly ExplorerView<N, E>[];
  const activeView = state.activeView as ExplorerView<N, E> | null;
  if (views.length < 2 || activeView === null) return null;

  if (children !== undefined) {
    return (
      <div data-dagr-explorer="views" className={className} style={style}>
        {children({ views, activeView, selectView: state.selectView })}
      </div>
    );
  }

  return (
    <div data-dagr-explorer="views" role="group" aria-label={state.labels.views} className={className} style={style}>
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          data-view-id={view.id}
          aria-pressed={view.id === activeView.id}
          onClick={() => state.selectView(view.id)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
