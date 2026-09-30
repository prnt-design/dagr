import { Graph } from '@prnt/dagr-graph';
import { layout } from '@prnt/dagr-layout';
import { defineRegistry, sameType } from '@prnt/dagr-vdsl';

const port = (id: string, direction: 'in' | 'out', type: string) => ({
  id,
  direction,
  type,
});
export const registry = defineRegistry(
  {
    client: { ports: [port('request', 'out', 'http')], canConnect: sameType },
    gateway: {
      ports: [port('request', 'in', 'http'), port('route', 'out', 'http')],
      canConnect: sameType,
    },
    service: {
      ports: [
        port('request', 'in', 'http'),
        port('event', 'out', 'event'),
        port('write', 'out', 'record'),
      ],
      canConnect: sameType,
      checkConfig: (attrs) =>
        typeof attrs.replicas === 'number' && attrs.replicas > 0
          ? []
          : ['replicas must be positive'],
    },
    stream: {
      ports: [
        port('publish', 'in', 'event'),
        port('subscribe', 'out', 'event'),
      ],
      canConnect: sameType,
    },
    worker: {
      ports: [
        port('consume', 'in', 'event'),
        port('write', 'out', 'record'),
        port('send', 'out', 'http'),
      ],
      canConnect: sameType,
    },
    store: { ports: [port('write', 'in', 'record')], canConnect: sameType },
    external: { ports: [port('request', 'in', 'http')], canConnect: sameType },
  },
  { rejectCycles: true },
);
export type Kind = (typeof registry.kinds)[number];
export type SystemNode = {
  id: string;
  name: string;
  kind: Kind;
  subtitle: string;
  rows: [string, string][];
  code: string[];
};
const node = (
  id: string,
  name: string,
  kind: Kind,
  subtitle: string,
  rows: [string, string][],
  code: string[],
): SystemNode => ({ id, name, kind, subtitle, rows, code });
export const nodes: SystemNode[] = [
  ...[
    ['web', 'Storefront', 'Next.js / web'],
    ['mobile', 'Mobile app', 'iOS + Android'],
    ['partner', 'Partner API', 'OAuth2 / REST'],
    ['admin', 'Operations', 'Internal console'],
  ].map(([id, name, subtitle]) =>
    node(
      id,
      name,
      'client',
      subtitle,
      [
        ['protocol', 'HTTPS'],
        ['auth', 'JWT / session'],
      ],
      ['GET /catalog', 'POST /checkout', 'GET /orders/:id'],
    ),
  ),
  node(
    'edge',
    'Public gateway',
    'gateway',
    'Ingress / public traffic',
    [
      ['rate limit', '120 req/min'],
      ['timeout', '3,000 ms'],
    ],
    ['verify(token)', 'match(request.path)', 'forward(service)'],
  ),
  node(
    'internal',
    'Admin gateway',
    'gateway',
    'Ingress / trusted traffic',
    [
      ['access', 'Role based'],
      ['audit', 'Every request'],
    ],
    ['requireRole("operator")', 'audit(actor, action)', 'forward(service)'],
  ),
  ...[
    ['identity', 'Identity', 'UserSignedIn', 'POST /sessions'],
    ['catalog', 'Catalog', 'ProductUpdated', 'GET /products/:id'],
    ['cart', 'Cart', 'CartUpdated', 'PUT /carts/:id'],
    ['checkout', 'Checkout', 'OrderPlaced', 'POST /checkout'],
    ['payment', 'Payments', 'PaymentCaptured', 'POST /payments'],
    ['inventory', 'Inventory', 'StockReserved', 'POST /reservations'],
    ['shipping', 'Shipping', 'ShipmentCreated', 'POST /shipments'],
    ['support', 'Support', 'TicketOpened', 'POST /tickets'],
  ].map(([id, name, event, route]) =>
    node(
      id,
      name,
      'service',
      'Application / stateless',
      [
        ['replicas', '3'],
        ['runtime', 'Node.js'],
      ],
      [route, `emit ${event}`, 'retry: exponential(3)'],
    ),
  ),
  ...[
    ['identity-events', 'Identity events', 'UserSignedIn'],
    ['catalog-events', 'Catalog events', 'ProductUpdated'],
    ['cart-events', 'Cart events', 'CartUpdated'],
    ['order-events', 'Order events', 'OrderPlaced'],
    ['payment-events', 'Payment events', 'PaymentCaptured'],
    ['stock-events', 'Stock events', 'StockReserved'],
    ['shipping-events', 'Shipping events', 'ShipmentCreated'],
    ['support-events', 'Support events', 'TicketOpened'],
  ].map(([id, name, event]) =>
    node(
      id,
      name,
      'stream',
      'Event stream / append only',
      [
        ['partitions', '12'],
        ['retention', '7 days'],
      ],
      [
        `${event} {`,
        '  id: uuid, at: timestamp',
        '  payload: versioned<T>',
        '}',
      ],
    ),
  ),
  ...[
    ['indexer', 'Search indexer', 'catalog.search.v2'],
    ['recommend', 'Recommendations', 'personalization.v1'],
    ['fraud', 'Risk engine', 'payments.risk.v3'],
    ['fulfill', 'Fulfillment', 'orders.fulfill.v2'],
    ['receipt', 'Receipts', 'payments.receipt.v1'],
    ['notify', 'Notifications', 'customer.notify.v2'],
    ['analytics', 'Event collector', 'analytics.ingest.v1'],
    ['audit', 'Audit writer', 'compliance.audit.v1'],
    ['warehouse', 'Stock sync', 'warehouse.sync.v1'],
    ['helpdesk', 'Ticket router', 'support.route.v1'],
  ].map(([id, name, group]) =>
    node(
      id,
      name,
      'worker',
      'Consumer / asynchronous',
      [
        ['concurrency', '8'],
        ['delivery', 'At least once'],
      ],
      [`group: ${group}`, 'deduplicate(event.id)', 'handle → commit offset'],
    ),
  ),
  ...[
    ['users-db', 'Users', 'PostgreSQL', 'users(id, email, role)'],
    ['products-db', 'Products', 'PostgreSQL', 'products(sku, price, tags)'],
    ['cart-cache', 'Cart cache', 'Redis', 'cart:{user_id} → items[]'],
    ['orders-db', 'Orders', 'PostgreSQL', 'orders(id, total, state)'],
    ['ledger', 'Payment ledger', 'PostgreSQL', 'entries(id, debit, credit)'],
    ['stock-db', 'Stock levels', 'PostgreSQL', 'stock(sku, location, qty)'],
    ['search', 'Search index', 'OpenSearch', 'products → inverted index'],
    ['lake', 'Event lake', 'Object storage', '/events/{date}/{kind}'],
    ['audit-log', 'Audit log', 'Object storage', '/audit/{actor}/{date}'],
    ['tickets-db', 'Tickets', 'PostgreSQL', 'tickets(id, owner, state)'],
  ].map(([id, name, engine, schema]) =>
    node(
      id,
      name,
      'store',
      engine,
      [
        ['storage', 'Persistent'],
        ['region', 'eu-west-1'],
      ],
      [schema, 'encrypted: true', 'backup: daily'],
    ),
  ),
  node(
    'email',
    'Email provider',
    'external',
    'Transactional delivery',
    [
      ['transport', 'HTTPS'],
      ['timeout', '5,000 ms'],
    ],
    ['POST /messages', 'template + recipient', 'idempotency-key: event.id'],
  ),
  node(
    'carrier',
    'Carrier API',
    'external',
    'Shipping integration',
    [
      ['transport', 'HTTPS'],
      ['retry', '3 attempts'],
    ],
    ['POST /labels', 'parcel + destination', 'returns tracking_id'],
  ),
  node(
    'push',
    'Push delivery',
    'external',
    'Mobile notifications',
    [
      ['transport', 'HTTPS'],
      ['batch size', '100'],
    ],
    ['POST /notifications', 'device + payload', 'ttl: 3600'],
  ),
];
export type Wire = {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
  type: string;
};
export const wires: Wire[] = [];
function connect(
  source: string,
  targets: string[],
  sourcePort: string,
  targetPort: string,
  type: string,
) {
  for (const target of targets)
    wires.push({
      id: `${source}:${target}`,
      source,
      target,
      sourcePort,
      targetPort,
      type,
    });
}
connect('web', ['edge'], 'request', 'request', 'http');
connect('mobile', ['edge'], 'request', 'request', 'http');
connect('partner', ['edge'], 'request', 'request', 'http');
connect('admin', ['internal'], 'request', 'request', 'http');
connect(
  'edge',
  [
    'identity',
    'catalog',
    'cart',
    'checkout',
    'payment',
    'inventory',
    'shipping',
    'support',
  ],
  'route',
  'request',
  'http',
);
connect(
  'internal',
  ['catalog', 'inventory', 'shipping', 'support'],
  'route',
  'request',
  'http',
);
const serviceStreams = [
  'identity',
  'catalog',
  'cart',
  'order',
  'payment',
  'stock',
  'shipping',
  'support',
];
[
  'identity',
  'catalog',
  'cart',
  'checkout',
  'payment',
  'inventory',
  'shipping',
  'support',
].forEach((id, i) =>
  connect(id, [`${serviceStreams[i]}-events`], 'event', 'publish', 'event'),
);
const subscriptions: Record<string, string[]> = {
  'identity-events': ['audit', 'analytics', 'notify'],
  'catalog-events': ['indexer', 'recommend', 'analytics'],
  'cart-events': ['recommend', 'analytics'],
  'order-events': ['fulfill', 'fraud', 'notify', 'analytics', 'audit'],
  'payment-events': ['receipt', 'fraud', 'audit', 'analytics'],
  'stock-events': ['warehouse', 'indexer'],
  'shipping-events': ['notify', 'analytics'],
  'support-events': ['helpdesk', 'notify'],
};
Object.entries(subscriptions).forEach(([id, targets]) =>
  connect(id, targets, 'subscribe', 'consume', 'event'),
);
Object.entries({
  identity: 'users-db',
  catalog: 'products-db',
  cart: 'cart-cache',
  checkout: 'orders-db',
  payment: 'ledger',
  inventory: 'stock-db',
  shipping: 'orders-db',
  support: 'tickets-db',
  indexer: 'search',
  recommend: 'search',
  fraud: 'ledger',
  fulfill: 'orders-db',
  receipt: 'ledger',
  analytics: 'lake',
  audit: 'audit-log',
  warehouse: 'stock-db',
  helpdesk: 'tickets-db',
}).forEach(([id, target]) => connect(id, [target], 'write', 'write', 'record'));
connect('notify', ['email', 'push'], 'send', 'request', 'http');
connect('receipt', ['email'], 'send', 'request', 'http');
connect('fulfill', ['carrier'], 'send', 'request', 'http');

export function buildSystem() {
  const graph = new Graph();
  for (const n of nodes) {
    const added = graph.addNode(
      registry.nodeInit(n.kind, { id: n.id, attrs: { replicas: 3 } }),
    );
    const errors = registry.checkConfig(added);
    if (errors.length) throw new Error(`${n.id}: ${errors.join(', ')}`);
  }
  for (const wire of wires) {
    const verdict = registry.checkConnection(graph, wire);
    if (verdict.ok === false) throw new Error(`${wire.id}: ${verdict.reason}`);
    graph.addEdge(wire);
  }
  // Transpose the vertical engine geometry into a left-to-right reading direction.
  const result = layout({
    graph,
    config: {
      defaultNodeSize: { width: 200, height: 440 },
      nodeSep: 24,
      rankSep: 180,
    },
  });
  const boxes = new Map(
    [...result.nodes].map(([id, b]) => [
      id,
      {
        x: b.y - b.height / 2 - result.bounds.y + 40,
        y: b.x - b.width / 2 - result.bounds.x + 40,
        width: b.height,
        height: b.width,
      },
    ]),
  );
  const routes = new Map(
    [...result.edges].map(([id, e]) => [
      id,
      e.points.map((p) => ({
        x: p.y - result.bounds.y + 40,
        y: p.x - result.bounds.x + 40,
      })),
    ]),
  );
  return {
    graph,
    boxes,
    routes,
    width: result.bounds.height + 80,
    height: result.bounds.width + 80,
  };
}
export function searchNodes(query: string) {
  const normalized = query.trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const rank = (n: SystemNode) =>
    n.id === normalized || n.name.toLowerCase() === normalized
      ? 0
      : n.name.toLowerCase().includes(normalized) || n.id.includes(normalized)
        ? 1
        : 2;
  return nodes
    .filter((n) =>
      tokens.every((t) =>
        [n.id, n.name, n.kind, n.subtitle, ...n.code, ...n.rows.flat()]
          .join(' ')
          .toLowerCase()
          .includes(t),
      ),
    )
    .sort((a, b) => rank(a) - rank(b));
}
export function neighbors(id: string) {
  return new Set([
    id,
    ...wires
      .filter((e) => e.source === id || e.target === id)
      .flatMap((e) => [e.source, e.target]),
  ]);
}
