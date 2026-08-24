import { describe, expect, it } from 'vitest';
import {
  DagrVdslError,
  InvalidSpecError,
  NodeKindMissingError,
  UnknownNodeKindError,
  isDagrVdslError,
} from '../src/errors.js';

describe('@dagr/vdsl errors', () => {
  it('gives every error a code and the family a catch base', () => {
    const errors: DagrVdslError[] = [
      new InvalidSpecError('filter', 'port id must not be empty'),
      new NodeKindMissingError('kind', undefined),
      new UnknownNodeKindError('sink', ['source', 'filter']),
    ];
    expect(errors.map((error) => error.code)).toEqual([
      'INVALID_SPEC',
      'NODE_KIND_MISSING',
      'UNKNOWN_NODE_KIND',
    ]);
    for (const error of errors) {
      expect(error).toBeInstanceOf(DagrVdslError);
      expect(error).toBeInstanceOf(Error);
      expect(isDagrVdslError(error)).toBe(true);
      expect(error.name).toBe(error.constructor.name);
      expect(error.message).not.toBe('');
    }
  });

  it('rejects anything that is not one of them', () => {
    expect(isDagrVdslError(new Error('plain'))).toBe(false);
    expect(isDagrVdslError('INVALID_SPEC')).toBe(false);
    expect(isDagrVdslError(undefined)).toBe(false);
    expect(isDagrVdslError({ code: 'INVALID_SPEC' })).toBe(false);
  });

  it('rejects a subclass carrying a code the union does not hold', () => {
    // The base class is exported, so `instanceof` alone would narrow this to a
    // union it is not a member of, and an exhaustive-looking switch would fall
    // through. The membership test on `code` is what stops that, and this is
    // the case that shows it failing rather than being vacuously true.
    class Rogue extends DagrVdslError {
      readonly code = 'NOT_A_CODE' as never;
    }
    const rogue = new Rogue('invented');
    expect(rogue).toBeInstanceOf(DagrVdslError);
    expect(isDagrVdslError(rogue)).toBe(false);
  });

  it('says what a missing kind actually held', () => {
    expect(new NodeKindMissingError('kind', undefined).message).toContain('kind');
    expect(new NodeKindMissingError('kind', 7).message).toContain('number');
  });

  it('lists the kinds it does know', () => {
    const error = new UnknownNodeKindError('sink', ['source', 'filter']);
    expect(error.message).toContain('source');
    expect(error.kinds).toEqual(['source', 'filter']);
    expect(Object.isFrozen(error.kinds)).toBe(true);
  });
});
