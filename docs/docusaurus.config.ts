import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'Dagr',
  tagline: 'Directed graph layout, WebGPU rendering, and visual DSLs',
  favicon: 'img/favicon.svg',

  // Served from its own domain on Render, so the site sits at the root rather
  // than under a GitHub Pages project subpath.
  url: 'https://dagr.prnt.design',
  baseUrl: '/',
  organizationName: 'prnt-design',
  projectName: 'dagr',

  onBrokenLinks: 'throw',
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
      items: [
        {
          href: 'https://github.com/prnt-design/dagr',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `MIT licensed. Copyright ${String(new Date().getFullYear())} the Dagr contributors.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
