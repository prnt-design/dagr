import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutView, validateViews } from '@prnt/dagr-explorer';
import { describe, expect, it } from 'vitest';
import {
  categories,
  dependencies,
  featureEdges,
  features,
  frameworkViews,
  packages,
  searchText,
} from './model';

const root = new URL('../../../../', import.meta.url);
const manifest = (id: string) =>
  JSON.parse(
    readFileSync(new URL(`packages/${id}/package.json`, root), 'utf8'),
  ) as {
    name: string;
    private?: boolean;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    exports?: Record<string, unknown>;
  };
describe('the framework self portrait', () => {
  it('has valid semantic IDs, stable shared concepts and truthful group boundaries', () => {
    expect(() => validateViews(frameworkViews)).not.toThrow();
    expect(packages).toHaveLength(8);
    for (const view of frameworkViews) {
      expect(() => layoutView(view, { strictGroups: true })).not.toThrow();
      for (const node of view.nodes)
        expect(node.id).toMatch(/^(package|feature):[a-z]+$/);
    }
    for (const node of packages)
      expect(
        frameworkViews[1]!.nodes.find((other) => other.id === node.id),
      ).toBe(node);
    expect(categories.flatMap((group) => group.members)).toHaveLength(
      packages.length,
    );
  });
  it('matches all internal dependency and peer edges to current manifests, excluding dev dependencies', () => {
    const names = new Map(
      packages.map((node) => [manifest(node.id.split(':')[1]!).name, node.id]),
    );
    const expected: string[] = [];
    for (const node of packages) {
      const pkg = manifest(node.id.split(':')[1]!);
      for (const [field, relation] of [
        ['dependencies', 'dependency'],
        ['peerDependencies', 'peer'],
      ] as const) {
        for (const name of Object.keys(pkg[field] ?? {})) {
          const target = names.get(name);
          if (target) expected.push(`${relation}:${node.id}:${target}`);
        }
      }
      expect(node.status.startsWith('Private')).toBe(pkg.private === true);
    }
    expect(
      dependencies
        .map((edge) => `${edge.relation}:${edge.source}:${edge.target}`)
        .sort(),
    ).toEqual(expected.sort());
    expect(
      dependencies
        .filter((edge) => edge.source === 'package:dagr')
        .every((edge) => edge.label?.includes('forwards')),
    ).toBe(true);
    expect(dependencies.some((edge) => edge.source === 'package:render')).toBe(
      false,
    );
  });
  it('retains core/full renderer and umbrella entry distinctions', () => {
    for (const id of ['render', 'dagr']) {
      expect(manifest(id).peerDependenciesMeta?.three?.optional).toBe(true);
      expect(manifest(id).peerDependencies?.three).toBeDefined();
    }
    const umbrella = manifest('dagr');
    for (const id of [
      'graph',
      'layout',
      'render',
      'react',
      'vdsl',
      'explorer',
    ]) {
      expect(umbrella.exports?.[`./${id}`]).toBeDefined();
      const entry = readFileSync(
        new URL(`packages/dagr/src/${id}.ts`, root),
        'utf8',
      );
      expect(entry).toContain(`export * from '@prnt/dagr-${id}'`);
    }
    expect(umbrella.exports?.['./render/core']).toBeDefined();
    expect(umbrella.exports?.['./chart']).toBeUndefined();
    expect(manifest('render').exports?.['./core']).toBeDefined();
  });
  it('keeps feature links distinct and supplies searchable, source-backed reading material', () => {
    expect(features).toHaveLength(7);
    expect(
      featureEdges.every(
        (edge) => edge.relation === 'provides' || edge.relation === 'uses',
      ),
    ).toBe(true);
    for (const feature of features)
      expect(
        featureEdges.some(
          (edge) =>
            edge.target === feature.id &&
            edge.source === feature.packageId &&
            edge.relation === 'provides',
        ),
      ).toBe(true);
    for (const node of [...packages, ...features]) {
      const path = node.source.split('/blob/main/')[1]!;
      expect(existsSync(fileURLToPath(new URL(path, root)))).toBe(true);
      expect(node.explanation.length).toBeGreaterThan(100);
      expect(node.example.length).toBeGreaterThan(10);
      if (node.docs.startsWith('/docs/')) {
        const slug = node.docs.slice('/docs/'.length);
        expect(
          existsSync(new URL(`docs/docs/${slug || 'intro'}.md`, root)),
        ).toBe(true);
      } else {
        expect(node.docs).toBe(node.source);
      }
    }
    expect(
      searchText(packages.find((node) => node.id === 'package:explorer')!),
    ).toContain('ExplorerOutline');
    expect(
      searchText(packages.find((node) => node.id === 'package:render')!),
    ).toContain('core');
  });
});
