/**
 * What a published tarball has to be true of, written as predicates over the
 * tarball rather than over the manifest that produced it.
 *
 * The distinction is the whole reason this member exists. `pnpm typecheck`
 * resolves sibling packages through tsconfig `paths`, `pnpm test` through a
 * vitest alias, and `pnpm build` through the workspace symlink, so every one
 * of them passes on a package no consumer can resolve. Each check here reads
 * only what `npm install` would put on disk: the manifest npm rewrote and the
 * files the tarball actually carries.
 *
 * The checks are pure so they can be shown failing on a constructed package.
 * `test/checks.test.ts` does exactly that, and `test/pack.test.ts` runs them
 * over the five real tarballs. A guard that only ever runs against a tree
 * already known to be correct never demonstrates that it can fail.
 */

/** The subset of a package manifest these checks read. */
export interface Manifest {
  readonly name?: string;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  /**
   * Declared so the exemption is visible in the type rather than reached
   * through a cast: npm installs no devDependencies for a package it is
   * installing as a dependency, so nothing here reaches a consumer and
   * {@link workspaceRanges} deliberately does not read it.
   */
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: { readonly access?: string };
}

/**
 * A packed package as a consumer's `node_modules` would hold it: the manifest
 * after the packer rewrote it, the file list, and a reader for the text files.
 *
 * `files` are POSIX paths relative to the package root, with no leading `./`.
 * `text` returns `undefined` for a path the tarball does not carry, which is
 * what lets a check distinguish "the map is wrong" from "there is no map".
 */
export interface PackedPackage {
  readonly name: string;
  readonly manifest: Manifest;
  readonly files: readonly string[];
  readonly text: (file: string) => string | undefined;
}

/**
 * Dependency ranges still carrying pnpm's `workspace:` protocol.
 *
 * `npm pack` leaves the string alone and it resolves to nothing on a
 * consumer's machine; `pnpm pack` rewrites it to the sibling's real version.
 * So this is a check on the PACKER as much as on the manifest, and it is the
 * reason the publish command has to be `pnpm publish`.
 *
 * `devDependencies` are deliberately not read: npm never installs them for a
 * consumer, so a workspace range there reaches nobody.
 */
export function workspaceRanges(manifest: Manifest): string[] {
  const found: string[] = [];
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const deps = manifest[field];
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (range.startsWith('workspace:')) found.push(`${field}.${dep} is "${range}"`);
    }
  }
  return found.sort();
}

/**
 * Paths the manifest points at that the tarball does not carry.
 *
 * Covers `main`, `module`, `types` and every string in the `exports` tree,
 * because a condition map nests arbitrarily and the one branch nobody reads
 * is the one that breaks for the consumer whose bundler reads it.
 */
export function unresolvedEntryPoints(pkg: PackedPackage): string[] {
  const carried = new Set(pkg.files);
  const declared = new Set<string>();

  for (const field of ['main', 'module', 'types'] as const) {
    const value = pkg.manifest[field];
    if (typeof value === 'string') declared.add(value);
  }
  collectExportPaths(pkg.manifest.exports, declared);

  return [...declared]
    .filter((path) => !carried.has(normalise(path)))
    .sort()
    .map((path) => `${path} is not in the tarball`);
}

function collectExportPaths(node: unknown, into: Set<string>): void {
  if (typeof node === 'string') {
    if (node.startsWith('.')) into.add(node);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectExportPaths(value, into);
  }
}

/**
 * Source maps whose `sources` point outside the tarball.
 *
 * This is the general form of the defect rather than a check for one option.
 * A package that ships `src` passes because every source resolves; a package
 * that stops emitting maps passes because it has none to check. Only shipping
 * a map that points at a file nobody installed fails, which is the state the
 * five packages were in: 128 maps against a `files` list with no `src`.
 *
 * A map with no `sources` array, or with a `sourceContent` entry carrying the
 * text inline, is not dangling: there is nothing to resolve.
 */
export function danglingSourceMaps(pkg: PackedPackage): string[] {
  const carried = new Set(pkg.files);
  const dangling: string[] = [];

  for (const file of pkg.files) {
    if (!file.endsWith('.map')) continue;
    const raw = pkg.text(file);
    if (raw === undefined) continue;

    let map: { sources?: unknown; sourcesContent?: unknown };
    try {
      map = JSON.parse(raw) as typeof map;
    } catch {
      dangling.push(`${file} is not readable JSON`);
      continue;
    }

    const sources = map.sources;
    if (!Array.isArray(sources)) continue;
    const inline = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];

    sources.forEach((source, index) => {
      if (typeof source !== 'string') return;
      if (typeof inline[index] === 'string') return;
      const resolved = resolveFrom(file, source);
      if (resolved === undefined || !carried.has(resolved)) {
        dangling.push(`${file} points at ${source}`);
      }
    });
  }

  return dangling.sort();
}

/**
 * Files an npm page and a licence audit need, and which no build produces.
 *
 * A README is what renders on the package page, so a package without one
 * publishes a blank page. A LICENSE is what a consumer's audit reads out of
 * the tarball, and a `license` field naming MIT with no text beside it is the
 * repo asserting a licence it did not ship.
 */
export function missingConsumerFiles(pkg: PackedPackage): string[] {
  return ['README.md', 'LICENSE', 'CHANGELOG.md']
    .filter((file) => !pkg.files.includes(file))
    .map((file) => `${file} is not in the tarball`);
}

/**
 * Whether a scoped package would publish public.
 *
 * npm defaults a scoped package to restricted, so a first publish without
 * this fails outright rather than publishing something wrong, which is the
 * better failure of the two. Checked here because the failure lands at the
 * one moment nobody wants to be debugging a manifest.
 */
export function publishesPublic(manifest: Manifest): boolean {
  return manifest.publishConfig?.access === 'public';
}

function normalise(path: string): string {
  return path.replace(/^\.\//, '');
}

/**
 * Resolves a map's `sources` entry against the map's own directory.
 *
 * Returns `undefined` for a path that climbs out of the package root, which a
 * `../src/*.ts` does from `dist/` only when `src` is not shipped, and for an
 * absolute path or a URL, neither of which resolves inside a tarball at all.
 */
function resolveFrom(mapFile: string, source: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('/')) return undefined;

  const segments = mapFile.split('/').slice(0, -1);
  for (const part of source.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}
