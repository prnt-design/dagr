import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DagrExplorer } from '@prnt/dagr-explorer';
import type { ExplorerApi } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';
import type { Report, Content } from '../../reports/src/index.js';
import './style.css';
import { reportLink } from './route.js';

type Feed = { reports: Report[]; dates: string[]; errors: Record<string, string[]> };
function App() {
  const [feed, setFeed] = useState<Feed>();
  const [error, setError] = useState('');
  const [route, setRoute] = useState(location.hash.slice(1));
  const api = useRef<ExplorerApi | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/reports', { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('Private archive unavailable');
      setFeed(await r.json() as Feed);
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    const update = () => setRoute(location.hash.slice(1));
    addEventListener('hashchange', update);
    return () => { controller.abort(); removeEventListener('hashchange', update); };
  }, []);
  useEffect(() => {
    if (!feed) return;
    const params = new URLSearchParams(route);
    const report = feed.reports.find(r => r.date === (params.get('date') ?? feed.dates.at(-1)) && (!params.get('repository') || r.repository === params.get('repository')));
    const id = params.get('node');
    const view = report?.views.find(v => id && v.nodeIds.includes(id));
    if (!id || !view) return;
    api.current?.selectView(view.id);
    const frame = requestAnimationFrame(() => { api.current?.inspect(id); api.current?.focusNode(id); });
    return () => cancelAnimationFrame(frame);
  }, [feed, route]);
  if (error) return <main><h1>Briefing unavailable</h1><p role="alert">{error}</p></main>;
  if (!feed) return <main><p role="status">Loading private briefing…</p></main>;
  const params = new URLSearchParams(route);
  const date = params.get('date') ?? feed.dates.at(-1);
  const report = feed.reports.find(r => r.date === date && (!params.get('repository') || r.repository === params.get('repository')));
  const href = (day: string, node?: string) => reportLink(day, report?.repository ?? params.get('repository') ?? '', node);
  const index = feed.dates.indexOf(date ?? '');
  const navigation = <nav aria-label="Report days">{feed.dates[index - 1] && <a href={href(feed.dates[index - 1]!)}>Previous day</a>} {' '}{feed.dates[index + 1] && <a href={href(feed.dates[index + 1]!)}>Next day</a>} {' '}<a href="#">Latest report</a></nav>;
  if (!report) return <main><h1>{date ? 'Report unavailable' : 'No reports yet'}</h1>{navigation}<p role="alert">{date && feed.errors[date] ? `Invalid report: ${feed.errors[date]!.join('; ')}` : 'Missing report. Generate a private daily report first.'}</p></main>;
  const inspect = (id: string) => {
    const view = report.views.find(v => v.nodeIds.includes(id));
    if (view) { api.current?.selectView(view.id); requestAnimationFrame(() => { api.current?.inspect(id); api.current?.focusNode(id); }); }
  };
  const content = (block: Content, i: number) => {
    switch (block.kind) {
      case 'paragraph': return <p key={i}>{block.text}</p>;
      case 'code': return <pre key={i}><code>{block.text}</code></pre>;
      case 'list': return <ul key={i}>{block.items.map((text, j) => <li key={j}>{text}</li>)}</ul>;
      case 'node': return <a key={i} href={href(report.date, block.nodeId)} onClick={() => inspect(block.nodeId)}>{block.label}</a>;
      case 'link': return <a key={i} href={report.sources.find(s => s.id === block.sourceId)!.url} rel="noreferrer">{block.label}</a>;
    }
  };
  return <main key={report.date}><h1>{report.title}</h1>{navigation}<p>{report.repository}, {report.date}</p>
    {report.date < new Date().toISOString().slice(0, 10) && <p role="status">Stale report: observed on {report.date}. Later activity is unknown.</p>}
    <p>Coverage is partial: the generator reads at most 50 PR records. Missing items do not mean completion or deletion.</p>
    <section aria-label="Overview"><h2>What changed</h2><p>{report.overview.changed}</p><h2>Blocked</h2><p>{report.overview.blocked}</p><h2>Attention</h2><p>{report.overview.attention}</p><h2>Unknowns</h2><ul>{report.overview.unknowns.map((x,i) => <li key={i}>{x}</li>)}</ul></section>
    <section aria-label="Tour"><h2>Briefing tour</h2>{report.tour.map(step => <article key={step.id}><h3>{step.title}</h3><p>{step.text}</p><button onClick={() => { api.current?.selectView(step.viewId); requestAnimationFrame(() => { api.current?.inspect(step.nodeIds[0]!); api.current?.focusNode(step.nodeIds[0]!); }); }}>Explore {step.title}</button></article>)}</section>
    <DagrExplorer apiRef={api} label="Report explorer" defaultMode="outline" views={report.views.map(v => ({ id:v.id, label:v.label, nodes:report.nodes.filter(n => v.nodeIds.includes(n.id)), edges:report.edges.filter(e => v.edgeIds.includes(e.id)) }))} renderDetails={({node}) => <div><p>{node.summary}</p>{node.content.map(content)}</div>} />
    <section aria-label="Text outline"><h2>Complete text outline</h2>{report.nodes.map(node => <article key={node.id} id={node.id}><h3>{node.label}</h3><p>{node.previousStatus}, {node.activity}, {node.state}</p><p>{node.summary}</p><p>Confidence: {node.confidence.level}. {node.confidence.reason}</p><p>Attention: {node.attention.reason}</p>{node.content.map(content)}<a href={href(report.date, node.id)} onClick={() => inspect(node.id)}>Inspect {node.label}</a></article>)}</section>
    {params.get('node') && <p>Linked item: <button onClick={() => inspect(params.get('node')!)}>{report.nodes.find(n => n.id === params.get('node'))?.label ?? 'Unknown item'}</button></p>}
    <section><h2>Sources</h2><ul>{report.sources.map(s => <li key={s.id}><a href={s.url} rel="noreferrer">{s.label}</a> (as of {s.asOf})</li>)}</ul></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
