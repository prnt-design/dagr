import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  ConfigCheck,
  ConnectionAllowed,
  ConnectionCheck,
  ConnectionCheckResult,
  ConnectionEnd,
  ConnectionEnds,
  ConnectionRefusalCode,
  ConnectionRefused,
  DagrVdslErrorCode,
  DagrVdslErrorLike,
  KindNodeInit,
  NodeRegistry,
  NodeSpec,
  NodeSpecInit,
  PortRef,
  PortSpec,
  ProposedConnection,
  RegistryOptions,
} from '../src/index.js';

describe('@dagr/vdsl public surface', () => {
  it('exports the registry factory and its default key', () => {
    expect(typeof api.defineRegistry).toBe('function');
    expect(api.DEFAULT_KIND_KEY).toBe('kind');
  });

  it('exports the connection check the type token is worth declaring for', () => {
    expect(typeof api.sameType).toBe('function');
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
      'sameType',
    ]);
  });

  it('exports the types a consumer annotates with', () => {
    // Compiled, not executed: the import above failing to resolve is the
    // failure. The runtime body keeps vitest happy about an empty test.
    const spec: NodeSpec<'a'> = { kind: 'a', ports: [] };
    const port: PortSpec = { id: 'p', direction: 'inout' };
    const init: NodeSpecInit = { ports: [port] };
    const check: ConfigCheck = () => [];
    const options: RegistryOptions = { kindKey: 'type', rejectCycles: true };
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
    const end: ConnectionEnd<'a'> = { kind: 'a', port };
    const ends: ConnectionEnds<'a'> = { source: end, target: end };
    const connects: ConnectionCheck<'a'> = () => undefined;
    const code2: ConnectionRefusalCode = 'port-full';
    const allowed: ConnectionAllowed = { ok: true };
    const refused: ConnectionRefused = { ok: false, code: code2, reason: 'full' };
    const result: ConnectionCheckResult = allowed;
    const ref: PortRef<'a'> = { kind: 'a', portId: 'p' };
    const proposed: ProposedConnection = {
      source: 'n',
      sourcePort: 'p',
      target: 'm',
      targetPort: 'p',
    };
    expect(options.kindKey).toBe('type');
    expect(options.rejectCycles).toBe(true);
    expect(check({})).toEqual([]);
    expect(connects(ends)).toBeUndefined();
    expect([result.ok, refused.code, ref.portId, proposed.target]).toEqual([
      true,
      'port-full',
      'p',
      'm',
    ]);
  });
});
