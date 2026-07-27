import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
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
          routeBasePath: '/',
          editUrl: 'https://github.com/prnt-design/dagr/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
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
