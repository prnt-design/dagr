import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The optional stylesheet, read as text. It is a public entry
 * (`@prnt/dagr-explorer/styles.css`), so what it may depend on is pinned
 * here: the parts' `data-dagr-explorer` hooks and the variables the spec
 * lists, and nothing a host framework provides.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
  files: string[];
  sideEffects: string[];
};

/** The variables a host sets to theme the explorer, per the spec's Styling section. */
const THEME = [
  '--dagr-explorer-accent',
  '--dagr-explorer-fg',
  '--dagr-explorer-fg-muted',
  '--dagr-explorer-border',
  '--dagr-explorer-bg',
  '--dagr-explorer-bg-subtle',
  '--dagr-explorer-focus',
  '--dagr-explorer-font-mono',
];
/** The two the parts themselves read or write. */
const FUNCTIONAL = ['--dagr-explorer-height', '--dagr-explorer-inv-zoom'];

const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector list in front of a block, at-rules aside. */
function selectors(text: string): string[] {
  return [...text.matchAll(/([^{}]+)\{/g)]
    .map((match) => (match[1] ?? '').trim())
    .filter((selector) => selector !== '' && !selector.startsWith('@'))
    .flatMap((list) => list.split(','))
    .map((selector) => selector.trim());
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

describe('styles.css', () => {
  it('is an entry of its own, shipped in the tarball and kept by bundlers', () => {
    expect(manifest.exports['./styles.css']).toBe('./styles.css');
    expect(manifest.files).toContain('styles.css');
    expect(manifest.sideEffects).toContain('*.css');
  });

  it('styles only through the data-dagr-explorer hooks', () => {
    const found = selectors(withoutComments);
    expect(found.length).toBeGreaterThan(10);
    expect(found.filter((selector) => !selector.includes('[data-dagr-explorer'))).toEqual([]);
  });

  it('reads only the variables the spec lists, and reads every theme variable', () => {
    const used = new Set([...withoutComments.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]));
    expect([...used].filter((name) => name !== undefined && ![...THEME, ...FUNCTIONAL].includes(name))).toEqual([]);
    expect(THEME.filter((name) => !used.has(name))).toEqual([]);
    // It reads them, it never defines them, so a host can set them anywhere above the explorer.
    expect(withoutComments).not.toMatch(/(^|[;{\s])--dagr-explorer-[\w-]+\s*:/);
  });

  it('names no host framework, and no em-dash', () => {
    expect(css).not.toMatch(/docusaurus|ifm-|navbar|tailwind|chakra|mui|bootstrap|data-theme/i);
    expect(css).not.toContain('—');
  });

  it('is imported by no module, so the JavaScript entry loads no CSS', () => {
    const importers = sourceFiles(join(ROOT, 'src')).filter((file) => /\.css['"]/.test(readFileSync(file, 'utf8')));
    expect(importers).toEqual([]);
  });
});
