#!/usr/bin/env node
/**
 * The three checks `pnpm test` deliberately cannot run, because each of them
 * needs the network.
 *
 * 1. `publint` over every tarball.
 * 2. `arethetypeswrong` over every tarball, under the `esm-only` profile.
 * 3. A scratch project OUTSIDE the workspace that installs all six tarballs,
 *    typechecks their public surfaces, and runs a headless runtime smoke.
 *
 * The vitest suite beside this is the gate: it runs on every `pnpm test`, needs
 * no registry, and checks the things that go wrong silently. This script is the
 * independent cross-check on that gate, and it is run by hand whenever the
 * packaging changes and before a publish. Run it with:
 *
 *     pnpm --filter @dagr/packaging verify:tools
 *
 * WHY THE PROFILE IS `esm-only` AND NOT THE DEFAULT `strict`. Every one of these
 * packages is `"type": "module"` with no CommonJS build, on purpose. Under
 * `strict`, attw reports `CJSResolvesToESM` on all six, which is not a defect:
 * it is the accurate description of an ESM-only package, and the profile exists
 * to say so. If a CommonJS build is ever added, this profile is the line that
 * has to change.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGES = ['graph', 'layout', 'render', 'react', 'vdsl', 'dagr'];

const workDir = mkdtempSync(join(tmpdir(), 'dagr-verify-'));
let failures = 0;

function run(command, args, cwd, label) {
  try {
    execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
    console.log(`  PASS  ${label}`);
    return true;
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    console.log(String(error.stdout ?? '') + String(error.stderr ?? ''));
    return false;
  }
}

try {
  console.log('Building and packing the published packages...');
  execFileSync(
    'pnpm',
    [
      ...PACKAGES.flatMap((p) => [
        '--filter',
        p === 'dagr' ? 'dagr' : `@prnt/dagr-${p}`,
      ]),
      'build',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  for (const name of PACKAGES) {
    execFileSync('pnpm', ['pack', '--pack-destination', workDir], {
      cwd: join(REPO_ROOT, 'packages', name),
      stdio: 'pipe',
    });
  }
  const tarballs = readdirSync(workDir)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => join(workDir, f))
    .sort();

  console.log('\npublint:');
  for (const tarball of tarballs) run('pnpm', ['exec', 'publint', tarball], REPO_ROOT, tarball);

  console.log('\narethetypeswrong (profile esm-only):');
  for (const tarball of tarballs) {
    run('pnpm', ['exec', 'attw', '--profile', 'esm-only', tarball], REPO_ROOT, tarball);
  }

  console.log('\nA scratch project outside the workspace:');
  const scratch = join(workDir, 'scratch');
  // `node_modules` and no lockfile, installed with npm rather than pnpm, so the
  // install resolves the tarballs the way a consumer's would rather than
  // through anything this workspace set up.
  mkdirSync(scratch, { recursive: true });
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'dagr-scratch', private: true, type: 'module', version: '0.0.0' }, null, 2),
  );
  writeFileSync(
    join(scratch, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          noEmit: true,
          target: 'ES2022',
          jsx: 'react-jsx',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: ['node', 'react', 'react-dom'],
          skipLibCheck: true,
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(scratch, 'index.tsx'),
    [
      "import { Graph as ScopedGraph } from '@prnt/dagr-graph';",
      "import { Graph as RootGraph } from 'dagr';",
      "import { Graph as SubpathGraph } from 'dagr/graph';",
      "import { layout } from '@prnt/dagr-layout';",
      "import { layout as UmbrellaLayout } from 'dagr/layout';",
      "import { defineRegistry, sameType } from '@prnt/dagr-vdsl';",
      "import { defineRegistry as UmbrellaRegistry } from 'dagr/vdsl';",
      "import { DagrCanvas, Html } from '@prnt/dagr-react';",
      "import { DagrCanvas as UmbrellaCanvas, Html as UmbrellaHtml } from 'dagr/react';",
      "import type { DagrCanvasProps, HtmlProps } from '@prnt/dagr-react';",
      "import type { DagrCanvasProps as UmbrellaCanvasProps, HtmlProps as UmbrellaHtmlProps } from 'dagr/react';",
      "import { Camera2D, fitZoom, ribbonWidthAt, stepSpring2D } from '@prnt/dagr-render';",
      "import { Camera2D as UmbrellaCamera } from 'dagr/render';",
      "import type { Renderer, RendererOptions, SceneNode, WorldBounds } from '@prnt/dagr-render';",
      "import type { Renderer as UmbrellaRenderer, RendererOptions as UmbrellaRendererOptions } from 'dagr/render';",
      "import { createRoot } from 'react-dom/client';",
      '',
      'const graph = new RootGraph();',
      'const _scopedGraph: ScopedGraph = graph;',
      'const _subpathGraph: SubpathGraph = graph;',
      "graph.addNode('a');",
      "graph.addNode('b');",
      "graph.addEdge('a', 'b');",
      '',
      'const result = layout({ graph });',
      'const umbrellaResult = UmbrellaLayout({ graph });',
      "const registry = defineRegistry({ box: { ports: [{ id: 'out', direction: 'out', type: 'event' }], canConnect: sameType } });",
      "const umbrellaRegistry = UmbrellaRegistry({ box: { ports: [{ id: 'out', direction: 'out', type: 'event' }], canConnect: sameType } });",
      "const registryNode = graph.addNode(registry.nodeInit('box', { id: 'registry-node' }));",
      "if (registry.checkConfig(registryNode).length !== 0) throw new Error('unexpected VDSL config failure');",
      '',
      "const bounds: WorldBounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };",
      'const camera = new Camera2D({ viewport: { width: 320, height: 200, devicePixelRatio: 1 } });',
      'camera.fitBounds(bounds);',
      'if (fitZoom(bounds, camera.viewport) !== camera.zoom) throw new Error(\'camera fit mismatch\');',
      'const ribbon = ribbonWidthAt({ worldHalfWidth: 1, pixelsPerWorldUnit: camera.zoom, minHalfWidthPixels: 0.5, maxHalfWidthPixels: 4 });',
      'const spring = stepSpring2D({ position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }, { x: 1, y: 1 }, 4, 0.016);',
      'if (!(ribbon.halfWidthPixels > 0) || !(spring.position.x > 0)) throw new Error(\'renderer arithmetic smoke failed\');',
      '',
      "const sceneNode: SceneNode = { id: 'a', shape: 'roundedRect', center: { x: 0, y: 0 }, size: { width: 10, height: 10 }, fillColor: 0xffffff, glowColor: 0x000000, glowWorld: 0 };",
      'declare const canvas: HTMLCanvasElement;',
      'const rendererOptions: RendererOptions = { canvas, nodes: [sceneNode], backend: \'webgl2\' };',
      'const umbrellaRendererOptions: UmbrellaRendererOptions = rendererOptions;',
      'const _umbrellaRenderer: UmbrellaRenderer | undefined = undefined;',
      'const onFrame = (_frame: Parameters<NonNullable<DagrCanvasProps[\'onFrame\']>>[0], renderer: Renderer) => renderer.camera.setZoom(1);',
      "const htmlProps: HtmlProps = { node: 'a', interactive: true };",
      'const umbrellaHtmlProps: UmbrellaHtmlProps = htmlProps;',
      'const umbrellaCanvasProps: UmbrellaCanvasProps = { graph, onFrame };',
      'function App() {',
      '  return <DagrCanvas graph={graph} onFrame={onFrame}><Html {...htmlProps}>Node {result.nodes.get(\'a\')?.x}</Html></DagrCanvas>;',
      '}',
      'function UmbrellaApp() {',
      '  return <UmbrellaCanvas {...umbrellaCanvasProps}><UmbrellaHtml {...umbrellaHtmlProps}>Node {umbrellaResult.nodes.get(\'a\')?.x}</UmbrellaHtml></UmbrellaCanvas>;',
      '}',
      'function mount(host: HTMLElement) { createRoot(host).render(<App />); }',
      'void rendererOptions;',
      'void umbrellaRendererOptions;',
      'void _scopedGraph;',
      'void _subpathGraph;',
      'void _umbrellaRenderer;',
      'void umbrellaRegistry;',
      'void UmbrellaApp;',
      'void mount;',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(scratch, 'smoke.mjs'),
    [
      "import { Graph as ScopedGraph } from '@prnt/dagr-graph';",
      "import { Graph as RootGraph } from 'dagr';",
      "import { Graph as SubpathGraph } from 'dagr/graph';",
      "import { layout as ScopedLayout } from '@prnt/dagr-layout';",
      "import { layout as UmbrellaLayout } from 'dagr/layout';",
      "import { Camera2D as ScopedCamera, fitZoom, ribbonWidthAt, stepSpring2D } from '@prnt/dagr-render';",
      "import { Camera2D as UmbrellaCamera } from 'dagr/render';",
      "import { defineRegistry as ScopedRegistry, sameType } from '@prnt/dagr-vdsl';",
      "import { defineRegistry as UmbrellaRegistry } from 'dagr/vdsl';",
      "import * as react from '@prnt/dagr-react';",
      "import * as umbrellaReact from 'dagr/react';",
      '',
      "if (ScopedGraph !== RootGraph || ScopedGraph !== SubpathGraph) throw new Error('graph umbrella identity failed');",
      "if (ScopedCamera !== UmbrellaCamera) throw new Error('render umbrella identity failed');",
      "if (react.DagrCanvas !== umbrellaReact.DagrCanvas || react.Html !== umbrellaReact.Html) throw new Error('React umbrella identity failed');",
      "const graph = new RootGraph();",
      "graph.addNode('a');",
      "graph.addNode('b');",
      "graph.addEdge('a', 'b');",
      "if (ScopedLayout({ graph }).nodes.size !== 2 || UmbrellaLayout({ graph }).nodes.size !== 2) throw new Error('layout smoke failed');",
      "if (ScopedRegistry !== UmbrellaRegistry) throw new Error('VDSL umbrella identity failed');",
      "const registry = ScopedRegistry({ source: { ports: [{ id: 'out', direction: 'out', type: 'event' }] }, sink: { ports: [{ id: 'in', direction: 'in', type: 'event' }], canConnect: sameType } });",
      "const source = graph.addNode(registry.nodeInit('source', { id: 'source' }));",
      "const sink = graph.addNode(registry.nodeInit('sink', { id: 'sink' }));",
      "if (!registry.checkConnection(graph, { source: source.id, sourcePort: 'out', target: sink.id, targetPort: 'in' }).ok) throw new Error('VDSL smoke failed');",
      "const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };",
      "const camera = new ScopedCamera({ viewport: { width: 320, height: 200, devicePixelRatio: 1 } });",
      "camera.fitBounds(bounds);",
      "if (fitZoom(bounds, camera.viewport) !== camera.zoom) throw new Error('camera smoke failed');",
      "if (!(ribbonWidthAt({ worldHalfWidth: 1, pixelsPerWorldUnit: camera.zoom, minHalfWidthPixels: 0.5, maxHalfWidthPixels: 4 }).halfWidthPixels > 0)) throw new Error('ribbon smoke failed');",
      "if (!(stepSpring2D({ position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }, { x: 1, y: 1 }, 4, 0.016).position.x > 0)) throw new Error('spring smoke failed');",
      "if (typeof react.DagrCanvas !== 'function' || typeof react.Html !== 'function' || typeof umbrellaReact.DagrCanvas !== 'function') throw new Error('React entrypoint smoke failed');",
      '',
    ].join('\n'),
  );

  const pick = (name) => {
    const found = tarballs.find((t) => t.includes(`dagr-${name}-`));
    if (found === undefined) throw new Error(`no tarball was packed for @prnt/dagr-${name}`);
    return found;
  };
  const graphTarball = pick('graph');
  const layoutTarball = pick('layout');
  const renderTarball = pick('render');
  const reactTarball = pick('react');
  const vdslTarball = pick('vdsl');
  const umbrellaTarball = tarballs.find((t) => /^dagr-\d.*\.tgz$/.test(basename(t)));
  if (umbrellaTarball === undefined) throw new Error('no tarball was packed for dagr');
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      graphTarball,
      layoutTarball,
      renderTarball,
      reactTarball,
      vdslTarball,
      umbrellaTarball,
      'react@19',
      'react-dom@19',
      'three',
      'typescript',
      '@types/node',
      '@types/react',
      '@types/react-dom',
    ],
    scratch,
    'npm install of all six tarballs and their public peers',
  );
  run('npx', ['tsc', '--noEmit'], scratch, 'tsc over scoped and umbrella public package surfaces');
  run('node', ['smoke.mjs'], scratch, 'headless scoped and umbrella graph, layout, VDSL, render, and React smoke');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nEverything passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
