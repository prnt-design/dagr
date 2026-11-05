/** Shared-state fixture for the mobile reading contract, bundled by explorer-mobile.mjs. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { DagrExplorer } from '../../packages/explorer/src/index.js';
import '../../packages/explorer/styles.css';

const nodes = [
  { id: 'booking', label: 'Booking', searchText: 'reservation' },
  { id: 'payment', label: 'Payment' },
  { id: 'receipt', label: 'Receipt' },
];
const edges = [
  { id: 'pays', source: 'booking', target: 'payment', label: 'requires' },
  { id: 'issues', source: 'payment', target: 'receipt', label: 'issues' },
];

function Fixture() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <>
    <p>Scroll before the graph. Headless browser emulation fixture.</p>
    <DagrExplorer label="Booking flow" nodes={nodes} edges={edges}
      selectedId={selectedId} onSelectedChange={setSelectedId} />
    <output id="selection">{selectedId}</output>
    <p style={{ height: 900 }}>Scroll after the graph.</p>
  </>;
}

createRoot(document.getElementById('app')!).render(<Fixture />);
