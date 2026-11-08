import { DagrExplorer } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';
import Link from '@docusaurus/Link';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {
  categories,
  dependencies,
  featureEdges,
  features,
  frameworkViews,
  packages,
  searchText,
} from './model';
import styles from './styles.module.css';
import { useFrameworkPresentation } from './useFrameworkPresentation';

export default function FrameworkMap() {
  useBrokenLinks().collectAnchor('framework-map');
  const { hostRef, mode, chooseMode } = useFrameworkPresentation();
  return (
    <section
      id="framework-map"
      className={styles.section}
      aria-labelledby="framework-title"
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>DAGR, MAPPED WITH DAGR</p>
          <h2 id="framework-title">What fits together.</h2>
        </div>
        <p>
          Eight packages, from graph identity to reading interfaces and charts.
          Start with dependencies, or switch to the features each layer
          provides. Select a node for usage, limits and sources.
        </p>
      </div>
      <ul className={styles.categories} aria-label="Package group membership">
        {categories.map((category) => (
          <li key={category.label} style={{ borderColor: category.color }}>
            <strong>{category.label}</strong>
            <span>
              {category.members
                .map(
                  (id) =>
                    packages.find((node) => node.id === `package:${id}`)!.label,
                )
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <div ref={hostRef} className={styles.explorer}>
        <DagrExplorer
          label="Dagr framework packages and features"
          views={frameworkViews}
          mode={mode}
          onModeChange={chooseMode}
          strictGroups
          searchText={searchText}
          renderViews={({ views, activeView, selectView }) => (
            <>
              <div role="group" aria-label="Framework view">
                {views.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    aria-pressed={view.id === activeView.id}
                    onClick={() => selectView(view.id)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
              <p className={styles.legend}>{activeView.description}</p>
            </>
          )}
          tiers={{ summary: 35, rich: 170 }}
          nodeAriaLabel={(node) =>
            `${node.label}, ${node.kind}, ${node.group}. ${node.summary}`
          }
          renderNode={(node, { tier }) => (
            <>
              <small className={styles.kind}>
                {node.kind === 'package' ? node.group : 'Feature'}
              </small>
              <strong className={styles.nodeLabel}>{node.label}</strong>
              {tier === 'rich' && (
                <span className={styles.summary}>{node.summary}</span>
              )}
            </>
          )}
          renderDetails={({ node, connections, follow }) => (
            <>
              <p className={styles.kind}>
                {node.group} / {node.kind}
              </p>
              <h3>{node.label}</h3>
              <p className={styles.status}>{node.status}</p>
              <p>{node.explanation}</p>
              <pre className={styles.example}>
                <code>{node.example}</code>
              </pre>
              <p>
                <Link to={node.docs}>Read documentation →</Link>
                <br />
                <a href={node.source}>Package source and usage ↗</a>
              </p>
              <h4>Related in this view</h4>
              {connections.length === 0 ? (
                <p>
                  No relationships in this view. Switch to Packages for umbrella
                  dependencies.
                </p>
              ) : (
                <ul className={styles.connections}>
                  {connections.map(({ edge, node: other }) => (
                    <li key={edge.id}>
                      <button
                        type="button"
                        data-node-id={other.id}
                        onClick={() => follow(other.id)}
                      >
                        {edge.source === node.id
                          ? `${node.label} → ${other.label}`
                          : `${other.label} → ${node.label}`}
                        <small>{edge.label}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        />
      </div>
      <p className={styles.note}>
        Use Outline to read at a small screen size. Boundaries mark membership,
        not containment. This map uses Explorer’s SVG/DOM default. Nested
        layout, drill-down and collapse/expand remain planned.{' '}
        <a href="https://github.com/prnt-design/dagr/blob/main/ROADMAP.md">
          Roadmap ↗
        </a>
      </p>
      <details className={styles.reader}>
        <summary>
          Read packages, features and dependencies without the map
        </summary>
        <p>
          Published baseline is 0.1.4 for the seven public packages. This map
          describes current repository source, including later work; it does not
          announce a 0.2.0 publication. Chart remains private. Follow the
          package sources for current details. Graph models parent
          relationships, but layout ignores parent today. Drill-down (M6.4),
          collapse/expand and compound layout (M7) remain planned.
        </p>
        {categories.map((category) => (
          <section key={category.label}>
            <h3>{category.label}</h3>
            {packages
              .filter((node) => node.group === category.label)
              .map((node) => (
                <article key={node.id}>
                  <h4>{node.label}</h4>
                  <p>{node.explanation}</p>
                  <p>
                    <strong>{node.status}</strong>
                  </p>
                  <ul>
                    {dependencies
                      .filter((edge) => edge.source === node.id)
                      .map((edge) => (
                        <li key={edge.id}>
                          {node.label} →{' '}
                          {
                            packages.find((other) => other.id === edge.target)!
                              .label
                          }
                          : {edge.label}
                        </li>
                      ))}
                  </ul>
                  <p>
                    <Link to={node.docs}>Documentation</Link> ·{' '}
                    <a href={node.source}>Source and usage</a>
                  </p>
                </article>
              ))}
          </section>
        ))}
        <h3>Feature guide</h3>
        {features.map((node) => (
          <article key={node.id}>
            <h4>{node.label}</h4>
            <p>{node.explanation}</p>
            <ul>
              {featureEdges
                .filter((edge) => edge.target === node.id)
                .map((edge) => (
                  <li key={edge.id}>
                    {packages.find((pkg) => pkg.id === edge.source)!.label}{' '}
                    {edge.label} {node.label}
                  </li>
                ))}
            </ul>
            <Link to={node.docs}>Documentation</Link>
          </article>
        ))}
      </details>
    </section>
  );
}
