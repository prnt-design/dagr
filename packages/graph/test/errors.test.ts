import { describe, expect, it } from 'vitest';
import {
  DagrGraphError,
  DuplicateEdgeError,
  DuplicateNodeError,
  EdgeNotFoundError,
  InvalidIdError,
  NodeNotFoundError,
} from '../src/errors.js';
import type { DagrGraphErrorCode } from '../src/errors.js';

/**
 * The base class is abstract, so a test that wants a bare family member has to
 * declare one. Nothing in the package ships a class like this: every real
 * error is one of the five below.
 */
class TestGraphError extends DagrGraphError {
  readonly code = 'INVALID_ID';
}

describe('DagrGraphError', () => {
  it('is an Error subclass with a stable name', () => {
    const error = new TestGraphError('something went wrong');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error.name).toBe('DagrGraphError');
    expect(error.message).toBe('something went wrong');
  });
});

describe('InvalidIdError', () => {
  it('carries the INVALID_ID code and an explanatory message', () => {
    const error = new InvalidIdError('node', '');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(InvalidIdError);
    expect(error.name).toBe('InvalidIdError');
    expect(error.code).toBe('INVALID_ID');
    expect(error.message).toContain('node');
  });

  it('keeps the kind and the offending id as public fields', () => {
    const error = new InvalidIdError('edge', '');
    expect(error.kind).toBe('edge');
    expect(error.id).toBe('');
  });

  it('promises only what the graph actually enforces', () => {
    const error = new InvalidIdError('node', '');
    expect(error.message).toBe('Invalid node id: ids must not be empty');
  });
});

describe('DuplicateNodeError', () => {
  it('carries the DUPLICATE_NODE code and names the offending id', () => {
    const error = new DuplicateNodeError('a');
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(DuplicateNodeError);
    expect(error.name).toBe('DuplicateNodeError');
    expect(error.code).toBe('DUPLICATE_NODE');
    expect(error.message).toContain('a');
  });
});

describe('NodeNotFoundError', () => {
  it('carries the NODE_NOT_FOUND code and names the offending id', () => {
    const error = new NodeNotFoundError('missing');
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(NodeNotFoundError);
    expect(error.name).toBe('NodeNotFoundError');
    expect(error.code).toBe('NODE_NOT_FOUND');
    expect(error.message).toContain('missing');
  });
});

describe('DuplicateEdgeError', () => {
  it('carries the DUPLICATE_EDGE code and names the offending id', () => {
    const error = new DuplicateEdgeError('e1');
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(DuplicateEdgeError);
    expect(error.name).toBe('DuplicateEdgeError');
    expect(error.code).toBe('DUPLICATE_EDGE');
    expect(error.message).toContain('e1');
  });
});

describe('EdgeNotFoundError', () => {
  it('carries the EDGE_NOT_FOUND code and names the offending id', () => {
    const error = new EdgeNotFoundError('e9');
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(EdgeNotFoundError);
    expect(error.name).toBe('EdgeNotFoundError');
    expect(error.code).toBe('EDGE_NOT_FOUND');
    expect(error.message).toContain('e9');
  });
});

describe('error catching', () => {
  it('lets a caller catch every graph error through the base class', () => {
    const errors: DagrGraphError[] = [
      new InvalidIdError('node', ''),
      new DuplicateNodeError('a'),
      new NodeNotFoundError('a'),
      new DuplicateEdgeError('e1'),
      new EdgeNotFoundError('e1'),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(DagrGraphError);
      expect(error.stack).toContain(error.name);
    }
  });

  /**
   * The documented pattern: catch the family, switch on `code`. It has to
   * compile through a value typed as the base class, not as a subclass, or the
   * documentation is a lie. The `never` default keeps the switch exhaustive, so
   * a new code without a new case fails typecheck.
   */
  it('lets a caller switch on code through a base-class-typed value', () => {
    const label = (error: DagrGraphError): string => {
      switch (error.code) {
        case 'INVALID_ID':
          return 'invalid id';
        case 'DUPLICATE_NODE':
          return 'duplicate node';
        case 'NODE_NOT_FOUND':
          return 'node not found';
        case 'DUPLICATE_EDGE':
          return 'duplicate edge';
        case 'EDGE_NOT_FOUND':
          return 'edge not found';
        default: {
          const unreachable: never = error.code;
          return unreachable;
        }
      }
    };

    const errors: DagrGraphError[] = [
      new InvalidIdError('node', ''),
      new DuplicateNodeError('a'),
      new NodeNotFoundError('a'),
      new DuplicateEdgeError('e1'),
      new EdgeNotFoundError('e1'),
    ];
    expect(errors.map(label)).toEqual([
      'invalid id',
      'duplicate node',
      'node not found',
      'duplicate edge',
      'edge not found',
    ]);
  });

  it('reads code off a caught error with no cast and no narrowing', () => {
    const codes: DagrGraphErrorCode[] = [];
    try {
      throw new NodeNotFoundError('missing');
    } catch (error) {
      if (error instanceof DagrGraphError) codes.push(error.code);
    }
    expect(codes).toEqual(['NODE_NOT_FOUND']);
  });
});
