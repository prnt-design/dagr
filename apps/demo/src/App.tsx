import type { JSX } from 'react';
import { PKG_NAME } from '@dagr/graph';

/**
 * Placeholder playground. Its only job today is to prove that the workspace
 * link from the demo app to a Dagr package resolves at build time.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>Dagr demo</h1>
      <p>
        Linked workspace package: <code>{PKG_NAME}</code>
      </p>
    </main>
  );
}
