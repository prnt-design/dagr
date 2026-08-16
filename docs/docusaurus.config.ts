import type * as Preset from '@docusaurus/preset-classic';
import type { Config, Plugin } from '@docusaurus/types';
import type { PrismTheme } from 'prism-react-renderer';

// Syntax palette, lifted off the Dagr mark: the sun's vermilion for strings,
// the node violet for keywords, the brand green for numbers, and the mark's
// mid-gradient magenta for functions. Code is the one place the docs are
// allowed to be colourful, so the colours may as well be the logo's.
//
// `plain` is not a fallback. Docusaurus turns it into inline custom
// properties on the code block container, where it shadows anything
// custom.css declares on `:root`. So the surface is declared transparent
// here and painted on `.theme-code-block` in custom.css instead, which keeps
// every surface in the site coming from the brand tokens. The base text
// colour has to stay here, and is `--dagr-foreground` by value.
//
// Light mode note: code blocks sit on a 3.5% tint of the primary, so these
// are checked against that rather than against pure white. Comment and
// punctuation are the two that need watching; both clear 4.5:1 there.
const daybreakLight: PrismTheme = {
  plain: { color: '#131615', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'cdata'], style: { color: '#5a786d' } },
    { types: ['punctuation'], style: { color: '#657770' } },
    {
      types: ['keyword', 'operator', 'tag', 'selector', 'atrule'],
      style: { color: '#5b41e8' },
    },
    {
      types: ['string', 'char', 'attr-value', 'regex', 'inserted'],
      style: { color: '#b4451f' },
    },
    {
      types: ['number', 'boolean', 'constant', 'symbol', 'deleted'],
      style: { color: '#1d6a52' },
    },
    {
      types: ['function', 'class-name', 'property', 'attr-name', 'builtin'],
      style: { color: '#8e3aa0' },
    },
    { types: ['variable', 'parameter'], style: { color: '#131615' } },
    { types: ['important'], style: { fontWeight: 'bold' } },
  ],
};

const daybreakDark: PrismTheme = {
  plain: { color: '#e6ebe9', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'cdata'], style: { color: '#7d9a90' } },
    { types: ['punctuation'], style: { color: '#8fa39b' } },
    {
      types: ['keyword', 'operator', 'tag', 'selector', 'atrule'],
      style: { color: '#a796ff' },
    },
    {
      types: ['string', 'char', 'attr-value', 'regex', 'inserted'],
      style: { color: '#f8a05a' },
    },
    {
      types: ['number', 'boolean', 'constant', 'symbol', 'deleted'],
      style: { color: '#6fcfaa' },
    },
    {
      types: ['function', 'class-name', 'property', 'attr-name', 'builtin'],
      style: { color: '#d89ae8' },
    },
    { types: ['variable', 'parameter'], style: { color: '#e6ebe9' } },
    { types: ['important'], style: { fontWeight: 'bold' } },
  ],
};

/**
 * What the site's live demos need from the bundler to run their layout in a web
 * worker.
 *
 * TWO ENTRIES USE THIS NOW: the landing page's benchmark, and the campaign at
 * `/demos/campaign`. They are separate worker modules because webpack resolves
 * `new Worker(new URL(...))` from the module that writes it, so each gets its
 * own entrypoint and each needs the runtime this plugin puts back.
 *
 * A demo builds one with `new Worker(new URL('./layout.worker.ts', ...))`,
 * which webpack compiles into a second entrypoint. Two things in the stock
 * Docusaurus client config stop that entrypoint from being loadable, and both
 * of them are invisible until the worker's first line throws
 * `__webpack_require__ is not defined`. The symptom is worse than the error: a
 * worker that dies never answers, a run that is never answered never settles by
 * design (see `runAsync` in @dagr/layout), and the demo sits saying it is
 * laying out, forever.
 *
 * `runtimeChunk: true` lifts each entrypoint's runtime into a file of its own,
 * which is a caching win for a page that can load two scripts and a broken
 * worker for one that cannot: a worker loads exactly one. Off, the runtime
 * rides in the bundle that needs it. It costs the site a couple of kilobytes
 * that no longer cache separately, and webpack has no per-entrypoint form of
 * the option.
 *
 * The second is a Docusaurus bug rather than a trade-off. Its ChunkAssetPlugin
 * adds a `__webpack_require__.gca` runtime module to every runtime chunk
 * without declaring that it needs `__webpack_require__`, the public path, or
 * the chunk filename helper. Every chunk the site itself loads needs those
 * anyway, so nothing shows. A worker entrypoint holding one concatenated module
 * and no dynamic import needs none of them, so webpack emits no runtime
 * bootstrap at all and the injected module references a function that was never
 * written. Declaring the requirements is what the plugin should have done, and
 * doing it here is additive: it can only add runtime pieces to a chunk, never
 * remove one.
 */
function dagrWorkerRuntime(): Plugin {
  return {
    name: 'dagr-worker-runtime',
    configureWebpack(_config, isServer, utils) {
      if (isServer) return {};
      const { RuntimeGlobals } = utils.currentBundler.instance;
      return {
        optimization: { runtimeChunk: false },
        plugins: [
          {
            apply(compiler) {
              compiler.hooks.thisCompilation.tap('DagrWorkerRuntime', (compilation) => {
                compilation.hooks.additionalTreeRuntimeRequirements.tap(
                  'DagrWorkerRuntime',
                  (_chunk, requirements) => {
                    requirements.add(RuntimeGlobals.require);
                    requirements.add(RuntimeGlobals.publicPath);
                    requirements.add(RuntimeGlobals.getChunkScriptFilename);
                  },
                );
              });
            },
          },
        ],
      };
    },
  };
}

const config: Config = {
  title: 'Dagr',
  tagline: 'Directed graph layout, WebGPU rendering, and visual DSLs',
  favicon: 'img/logo.svg',

  // Served from its own domain on Render, so the site sits at the root rather
  // than under a GitHub Pages project subpath.
  url: 'https://dagr.prnt.design',
  baseUrl: '/',
  organizationName: 'prnt-design',
  projectName: 'dagr',

  onBrokenLinks: 'throw',
  // Anchors default to `warn`, which passes CI silently. The layout page now
  // cross-references its own sections heavily enough that a typo'd anchor is a
  // real risk, and a warning nobody reads is not a check.
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  // Note: `future.v4` is deliberately off. It pulls in @docusaurus/faster
  // (rspack plus swc), which is a lot of dependency weight for a four page
  // site. Revisit when the docs are large enough for build time to matter.

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // The site root is the landing page (src/pages/index.tsx); the
          // docs moved from `/` to `/docs` when it landed.
          routeBasePath: '/docs',
          editUrl: 'https://github.com/prnt-design/dagr/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    dagrWorkerRuntime,
    [
      '@docusaurus/plugin-client-redirects',
      {
        // The docs lived at the site root before the landing page. These are
        // the URLs that existed then; the intro's old home is the root
        // itself, which the landing page now owns, so it is not redirected.
        redirects: [
          { from: '/graph-model', to: '/docs/graph-model' },
          { from: '/layout', to: '/docs/layout' },
          { from: '/render', to: '/docs/render' },
          // The campaign schema page, which was published here for a day
          // before D4 moved it into `packages/campaign/README.md`. A reader who
          // followed the link the package used to carry lands on the demo the
          // dataset exists for, which is the nearest live thing and is where
          // the one-line pointer to the README now is. The broken-link check
          // cannot cover this: it validates links the site still contains, and
          // an external bookmark is not one of them.
          { from: '/docs/campaign', to: '/demos/campaign' },
        ],
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'Dagr',
      logo: {
        // The title next to it already says Dagr, so the mark is decoration
        // for a screen reader. Empty alt keeps it out of the reading order.
        alt: '',
        src: 'img/logo.svg',
      },
      items: [
        {
          to: '/docs/',
          label: 'Docs',
          position: 'left',
        },
        {
          // One demo today, and the label is plural because the tab is where
          // the animated examples on the roadmap go: a sibling route under
          // /demos/ rather than a second nav item each. Pointing at the one
          // page rather than a /demos/ index, since an index listing a single
          // link is a click a reader pays for nothing.
          to: '/demos/campaign',
          label: 'Demos',
          position: 'left',
        },
        {
          href: 'https://github.com/prnt-design/dagr',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      // Light, not dark. A dark slab under a light page is a lot of weight
      // for one line of copyright, and the tinted neutrals give the footer
      // enough separation with a hairline and a tinted ground.
      style: 'light',
      copyright: `MIT licensed. Copyright ${String(new Date().getFullYear())} the Dagr contributors.`,
    },
    prism: {
      theme: daybreakLight,
      darkTheme: daybreakDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
