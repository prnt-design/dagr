import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  ConfigCheck,
  DagrVdslErrorCode,
  DagrVdslErrorLike,
  KindNodeInit,
  NodeRegistry,
  NodeSpec,
  NodeSpecInit,
  PortSpec,
  RegistryOptions,
} from '../src/index.js';

describe('@dagr/vdsl public surface', () => {
  it('exports the registry factory and its default key', () => {
    expect(typeof api.defineRegistry).toBe('function');
    expect(api.DEFAULT_KIND_KEY).toBe('kind');
  });

  it('exports the error family and its predicate', () => {
    expect(typeof api.DagrVdslError).toBe('function');
    expect(typeof api.InvalidSpecError).toBe('function');
    expect(typeof api.NodeKindMissingError).toBe('function');
    expect(typeof api.UnknownNodeKindError).toBe('function');
    expect(typeof api.isDagrVdslError).toBe('function');
  });

  it('exports nothing else', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DEFAULT_KIND_KEY',
      'DagrVdslError',
      'InvalidSpecError',
      'NodeKindMissingError',
      'UnknownNodeKindError',
      'defineRegistry',
      'isDagrVdslError',
    ]);
  });

  it('exports the types a consumer annotates with', () => {
    // Compiled, not executed: the import above failing to resolve is the
    // failure. The runtime body keeps vitest happy about an empty test.
    const spec: NodeSpec<'a'> = { kind: 'a', ports: [] };
    const port: PortSpec = { id: 'p', direction: 'inout' };
    const init: NodeSpecInit = { ports: [port] };
    const check: ConfigCheck = () => [];
    const options: RegistryOptions = { kindKey: 'type' };
    const nodeInit: KindNodeInit = { id: 'n' };
    const code: DagrVdslErrorCode = 'INVALID_SPEC';
    const like: DagrVdslErrorLike = new api.InvalidSpecError('a', 'because');
    const registry: NodeRegistry<'a'> = api.defineRegistry({ a: init });
    expect([spec.kind, code, like.code, registry.kinds[0], nodeInit.id]).toEqual([
      'a',
      'INVALID_SPEC',
      'INVALID_SPEC',
      'a',
      'n',
    ]);
    expect(options.kindKey).toBe('type');
    expect(check({})).toEqual([]);
  });
});
