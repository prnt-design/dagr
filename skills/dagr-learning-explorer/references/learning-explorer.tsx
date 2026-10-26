import { DagrExplorer } from '@prnt/dagr-explorer';
import type { ExplorerEdge, ExplorerNode } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';

interface Concept extends ExplorerNode {
  readonly summary: string;
  readonly explanation: string;
  readonly example: string;
}

// Illustrative lesson content, not claims about a particular application.
const nodes: readonly Concept[] = [
  {
    id: 'request', label: 'Request',
    summary: 'A client asks a service to perform work.',
    explanation: 'The request carries the operation and its inputs. A received request does not by itself prove the operation succeeded.',
    example: 'A reader asks a library service to reserve a book.',
  },
  {
    id: 'handler', label: 'Handler',
    summary: 'Validates the request and performs the operation.',
    explanation: 'The handler checks inputs and permissions before attempting the operation. It may produce a result or an error.',
    example: 'The service checks that the book is available before reserving it.',
  },
  {
    id: 'response', label: 'Response',
    summary: 'Communicates the result to the client.',
    explanation: 'The response reports the outcome. Network failures can prevent delivery even when the operation completed.',
    example: 'The client receives a reservation number or an unavailable message.',
  },
];
const edges: readonly ExplorerEdge[] = [
  { id: 'request-handled', source: 'request', target: 'handler', label: 'is processed by' },
  { id: 'handler-replies', source: 'handler', target: 'response', label: 'produces' },
];

export function LearningExplorer() {
  return (
    <DagrExplorer
      label="How a request becomes a response, edges follow processing order"
      nodes={nodes}
      edges={edges}
      layout={{ nodeSize: { width: 260, height: 144 } }}
      searchText={(node) => `${node.label} ${node.summary} ${node.explanation}`}
      renderNode={(node, { tier }) => (
        <>
          <strong style={{ display: 'block' }}>{node.label}</strong>
          {tier === 'rich' && <span>{node.summary}</span>}
        </>
      )}
      renderDetails={({ node, connections, follow }) => (
        <>
          <h3>{node.label}</h3>
          <p>Illustrative lesson, not a description of a particular application.</p>
          <p>{node.explanation}</p>
          <p><strong>Example:</strong> {node.example}</p>
          <ul>
            {connections.map(({ edge, node: other }) => (
              <li key={edge.id}>
                <button type="button" onClick={() => follow(other.id)}>
                  {edge.source === node.id
                    ? `${node.label} ${edge.label} ${other.label}`
                    : `${other.label} ${edge.label} ${node.label}`}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    />
  );
}
