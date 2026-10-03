import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What this package's source is allowed to import.
 *
 * The explorer must render on a server with three.js absent and must install
 * beside React 18. Both are properties of its import graph: the full
 * `@prnt/dagr-render` entry loads `three/webgpu` at module scope, and
 * `@prnt/dagr-react` requires React 19. So neither may be named here, not
 * even for a type. `@prnt/dagr-render/core` is the allowed way in, and the
 * renderer's own tests hold that entry three-free.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every module specifier a source text names: static, type, dynamic, bare. */
function specifiersOf(text: string): string[] {
  const pattern =
    /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

function isForbidden(specifier: string): boolean {
  return (
    specifier === '@prnt/dagr-render' ||
    specifier === '@prnt/dagr-react' ||
    specifier.startsWith('@prnt/dagr-react/') ||
    specifier === 'three' ||
    specifier.startsWith('three/')
  );
}

describe('the import boundary', () => {
  it('recognizes what it forbids, and what it allows', () => {
    for (const bad of ['@prnt/dagr-render', '@prnt/dagr-react', 'three', 'three/webgpu']) {
      expect(isForbidden(bad)).toBe(true);
    }
    for (const good of ['@prnt/dagr-render/core', '@prnt/dagr-layout', 'react', './layout.js']) {
      expect(isForbidden(good)).toBe(false);
    }
  });

  it('finds every form of import', () => {
    const text = [
      "import { a } from 'one';",
      "import type { B } from 'two';",
      "export { c } from 'three-ish';",
      "const d = await import('four');",
      "import 'five';",
    ].join('\n');
    expect(specifiersOf(text)).toEqual(['one', 'two', 'three-ish', 'four', 'five']);
  });

  it('holds for every source file', () => {
    const files = sourceFiles(SRC);
    // An empty list would satisfy the assertion below for the wrong reason.
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) =>
      specifiersOf(readFileSync(file, 'utf8'))
        .filter(isForbidden)
        .map((specifier) => `${relative(SRC, file)}: ${specifier}`),
    );
    expect(violations).toEqual([]);
  });
});
