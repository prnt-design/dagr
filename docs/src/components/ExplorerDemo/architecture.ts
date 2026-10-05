/**
 * The architecture demo's data: Tidewater, an invented ferry booking system.
 *
 * Twenty components in two views of the same system. The overview flows right
 * and groups by what a component is for. The deployment view flows down,
 * outlines what runs on devices and what runs at the edge, and dashes every
 * edge that crosses from where one component runs to where another does,
 * third parties included. Both have parallel
 * edges, which the explorer bows apart.
 *
 * Plain data and no React, so the docs test can validate it in Node.
 */

import type { ExplorerEdge, ExplorerGroup, ExplorerNode, ExplorerView } from '@prnt/dagr-explorer';

export const KINDS = ['client', 'gateway', 'service', 'queue', 'worker', 'store', 'external'] as const;
export type Kind = (typeof KINDS)[number];

export interface ArchitectureNode extends ExplorerNode {
  readonly kind: Kind;
  /** The team that runs it. */
  readonly owner: string;
  /** One sentence on what it does. */
  readonly summary: string;
}

export interface ArchitectureEdge extends ExplorerEdge {
  /** What crosses the edge, in a few words. */
  readonly label: string;
}

const node = (id: string, label: string, kind: Kind, owner: string, summary: string): ArchitectureNode => ({
  id,
  label,
  kind,
  owner,
  summary,
});

const nodes: readonly ArchitectureNode[] = [
  node('rider-app', 'Rider app', 'client', 'Rider experience', 'The phone app riders book and board with.'),
  node('harbor-kiosk', 'Harbor kiosk', 'client', 'Terminal operations', 'Walk-up ticket machines at each terminal.'),
  node('ops-console', 'Operations console', 'client', 'Terminal operations', 'Where crews see sailings and manifests.'),
  node('content-edge', 'Content edge', 'gateway', 'Platform', 'Caches the app shell and timetables near riders.'),
  node('api-gateway', 'API gateway', 'gateway', 'Platform', 'Authenticates every request and routes it to a service.'),
  node('identity', 'Identity', 'service', 'Platform', 'Accounts, sign-in and crew roles.'),
  node('booking', 'Booking', 'service', 'Rider experience', 'Holds seats and vehicle spaces, then confirms them.'),
  node('schedule', 'Schedule', 'service', 'Fleet planning', 'Sailings, vessels and their capacities.'),
  node('payments', 'Payments', 'service', 'Finance', 'Charges and refunds fares.'),
  node('manifest', 'Passenger manifest', 'service', 'Terminal operations', 'Who is aboard each sailing, for the crew and the port.'),
  node('notify', 'Notifications', 'service', 'Rider experience', 'Delay and boarding messages to riders.'),
  node('event-bus', 'Event bus', 'queue', 'Platform', 'Carries booking and payment events to whoever listens.'),
  node('fare-sync', 'Fare sync', 'worker', 'Finance', 'Pulls tariff changes from the port authority each night.'),
  node('report-builder', 'Report builder', 'worker', 'Finance', 'Builds daily revenue and load reports.'),
  node('bookings-db', 'Bookings database', 'store', 'Rider experience', 'The record of every booking.'),
  node('schedule-cache', 'Schedule cache', 'store', 'Fleet planning', 'Sailings and fares, read far more than written.'),
  node('archive', 'Cold archive', 'store', 'Finance', 'Seven years of reports, write once.'),
  node('card-processor', 'Card processor', 'external', 'Finance', 'A third party that moves the money.'),
  node('sms-provider', 'SMS provider', 'external', 'Rider experience', 'A third party that sends text messages.'),
  node('port-authority', 'Port authority feed', 'external', 'Fleet planning', 'Published tariffs and berth closures.'),
];

const edge = (source: string, target: string, label: string, suffix = ''): ArchitectureEdge => ({
  id: `${source}>${target}${suffix}`,
  source,
  target,
  label,
});

const edges: readonly ArchitectureEdge[] = [
  edge('rider-app', 'content-edge', 'app shell'),
  edge('rider-app', 'api-gateway', 'bookings'),
  edge('harbor-kiosk', 'api-gateway', 'walk-up sales'),
  edge('ops-console', 'api-gateway', 'crew requests'),
  edge('api-gateway', 'identity', 'token checks'),
  edge('api-gateway', 'booking', 'book, change, cancel'),
  edge('api-gateway', 'schedule', 'timetables'),
  edge('api-gateway', 'manifest', 'manifests'),
  edge('booking', 'payments', 'charge a fare'),
  edge('booking', 'bookings-db', 'writes'),
  edge('booking', 'bookings-db', 'reads', ':read'),
  edge('booking', 'event-bus', 'booking confirmed'),
  edge('payments', 'card-processor', 'charges'),
  edge('payments', 'card-processor', 'refunds', ':refund'),
  edge('payments', 'event-bus', 'payment settled'),
  edge('schedule', 'schedule-cache', 'reads'),
  edge('manifest', 'bookings-db', 'reads'),
  edge('event-bus', 'notify', 'subscribes'),
  edge('event-bus', 'report-builder', 'subscribes'),
  edge('notify', 'sms-provider', 'messages'),
  edge('port-authority', 'fare-sync', 'nightly tariffs'),
  edge('fare-sync', 'schedule-cache', 'fares'),
  edge('report-builder', 'archive', 'daily reports'),
];

/** Asynchronous edges: the event bus and the nightly sync. Drawn dashed in the overview. */
const asynchronous = new Set(['booking>event-bus', 'payments>event-bus', 'event-bus>notify', 'event-bus>report-builder', 'port-authority>fare-sync']);

// A group moves no node, so each one here names nodes the layout already puts
// side by side. The docs test lays both views out with `strictGroups` to hold
// that: an outline over a stranger would be a false statement.
const overviewGroups: readonly ExplorerGroup[] = [
  { id: 'clients', label: 'Clients', nodeIds: ['rider-app', 'harbor-kiosk', 'ops-console'] },
  { id: 'edge', label: 'Edge', nodeIds: ['content-edge', 'api-gateway'] },
  { id: 'data', label: 'Data', nodeIds: ['bookings-db', 'schedule-cache'] },
  { id: 'listeners', label: 'Event listeners', nodeIds: ['notify', 'report-builder'] },
];

/** Where every node runs, for the deployment view's groups and dashes. */
const placeOf: Readonly<Record<string, string>> = {
  'rider-app': 'device',
  'harbor-kiosk': 'device',
  'ops-console': 'device',
  'content-edge': 'edge',
  'api-gateway': 'edge',
  'card-processor': 'third-party',
  'sms-provider': 'third-party',
  'port-authority': 'third-party',
};
const place = (id: string): string => placeOf[id] ?? 'cloud';

const deploymentGroups: readonly ExplorerGroup[] = [
  { id: 'devices', label: 'On devices', nodeIds: nodes.filter((n) => place(n.id) === 'device').map((n) => n.id) },
  { id: 'edge-network', label: 'Edge network', nodeIds: nodes.filter((n) => place(n.id) === 'edge').map((n) => n.id) },
];

export const architectureViews: readonly ExplorerView<ArchitectureNode, ArchitectureEdge>[] = [
  {
    id: 'overview',
    label: 'Overview',
    nodes,
    edges: edges.map((e) => (asynchronous.has(e.id) ? { ...e, dash: true } : e)),
    groups: overviewGroups,
  },
  {
    id: 'deployment',
    label: 'Deployment',
    nodes,
    edges: edges.map((e) => (place(e.source) !== place(e.target) ? { ...e, dash: true } : e)),
    groups: deploymentGroups,
    layout: { direction: 'down' },
  },
];
