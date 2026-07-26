import { describe, expect, it } from 'vitest';
import {
  DagrGraphError,
  DuplicateEdgeError,
  DuplicateNodeError,
  DuplicatePortError,
  EdgeNotFoundError,
  InvalidIdError,
  NodeNotFoundError,
  PortDirectionError,
  PortInUseError,
  PortNotFoundError,
  isDagrGraphError,
} from '../src/errors.js';
import type { DagrGraphErrorCode, DagrGraphErrorLike } from '../src/errors.js';
import { PatchListenerError } from '../src/patch.js';

/**
 * The base class is abstract, so a test that wants a bare family member has to
 * declare one. Nothing in the package ships a class like this: every real
 * error is one of the nine below.
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

describe('DuplicatePortError', () => {
  it('carries the DUPLICATE_PORT code and names the node and the port', () => {
    const error = new DuplicatePortError('a', 'out');
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(DuplicatePortError);
    expect(error.name).toBe('DuplicatePortError');
    expect(error.code).toBe('DUPLICATE_PORT');
    expect(error.nodeId).toBe('a');
    expect(error.portId).toBe('out');
    expect(error.message).toContain('out');
    expect(error.message).toContain('a');
  });
});

describe('PortNotFoundError', () => {
  it('carries the PORT_NOT_FOUND code and names the node and the port', () => {
    const error = new PortNotFoundError('a', 'nope');
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(PortNotFoundError);
    expect(error.name).toBe('PortNotFoundError');
    expect(error.code).toBe('PORT_NOT_FOUND');
    expect(error.nodeId).toBe('a');
    expect(error.portId).toBe('nope');
    expect(error.message).toContain('nope');
  });
});

describe('PortInUseError', () => {
  it('carries the PORT_IN_USE code and the edges still referencing the port', () => {
    const error = new PortInUseError('a', 'out', ['e1', 'e2']);
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(PortInUseError);
    expect(error.name).toBe('PortInUseError');
    expect(error.code).toBe('PORT_IN_USE');
    expect(error.nodeId).toBe('a');
    expect(error.portId).toBe('out');
    expect(error.edgeIds).toEqual(['e1', 'e2']);
    expect(error.message).toContain('e1');
    expect(error.message).toContain('e2');
  });
});

describe('PortDirectionError', () => {
  it('carries the PORT_DIRECTION code, the direction, and the end asked for', () => {
    const error = new PortDirectionError('a', 'sink', 'in', 'source');
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(PortDirectionError);
    expect(error.name).toBe('PortDirectionError');
    expect(error.code).toBe('PORT_DIRECTION');
    expect(error.nodeId).toBe('a');
    expect(error.portId).toBe('sink');
    expect(error.direction).toBe('in');
    expect(error.end).toBe('source');
    expect(error.message).toContain('sink');
  });
});

describe('isDagrGraphError', () => {
  it('accepts every member of the family', () => {
    for (const error of everyError()) expect(isDagrGraphError(error)).toBe(true);
  });

  it('rejects anything else, including a plain Error and a look-alike', () => {
    expect(isDagrGraphError(new Error('plain'))).toBe(false);
    expect(isDagrGraphError({ code: 'NODE_NOT_FOUND', id: 'a' })).toBe(false);
    expect(isDagrGraphError(undefined)).toBe(false);
    expect(isDagrGraphError(null)).toBe(false);
    expect(isDagrGraphError('NODE_NOT_FOUND')).toBe(false);
  });

  /**
   * This predicate means "the graph rejected this call", and a listener failure
   * is the opposite: the mutation was accepted and committed, and something
   * downstream of the commit threw. So {@link PatchListenerError} deliberately
   * stays outside the family, however plausible it looks wrapping a graph error
   * of its own.
   */
  it('rejects a patch listener failure, even one wrapping a graph error', () => {
    const rejection = new DuplicateNodeError('a');
    expect(isDagrGraphError(rejection)).toBe(true);
    expect(isDagrGraphError(new PatchListenerError([rejection]))).toBe(false);
  });

  /**
   * The predicate narrows to a closed union of the nine concrete classes, so
   * an `instanceof` test against the exported base is not enough on its own: a
   * tenth subclass with a code of its own would pass it and be narrowed to a
   * union it is not in, and an exhaustive-looking switch would then read a
   * field off a class that does not carry it. The code membership test is what
   * makes the runtime check as closed as the type claims.
   */
  it('rejects a subclass carrying a code outside the union', () => {
    const foreign = new TestGraphError('from a sibling package');
    // The declared union is enforced on `code`, so the foreign code is
    // installed on the instance the way a JavaScript subclass would have it.
    Object.defineProperty(foreign, 'code', { value: 'LAYOUT_CYCLE', enumerable: true });
    expect(foreign).toBeInstanceOf(DagrGraphError);
    expect(isDagrGraphError(foreign)).toBe(false);
  });

  /**
   * The point of the union: switching on `code` has to narrow the OBJECT, not
   * just the discriminant, so an arm can read the fields that only its own
   * class carries. Reading `error.edgeIds` below with no cast and no `any` is
   * the whole assertion. It is checked by `tsc --noEmit`, which covers this
   * directory, so the proof is a compile-time one and the runtime expectation
   * is only there to keep the test honest about being executed.
   */
  it('narrows a caught error to its concrete class through its code', () => {
    const describeError = (error: DagrGraphErrorLike): string => {
      switch (error.code) {
        case 'INVALID_ID':
          return `invalid ${error.kind} id`;
        case 'DUPLICATE_NODE':
        case 'NODE_NOT_FOUND':
        case 'DUPLICATE_EDGE':
        case 'EDGE_NOT_FOUND':
          return error.id;
        case 'DUPLICATE_PORT':
        case 'PORT_NOT_FOUND':
          return `${error.nodeId}.${error.portId}`;
        case 'PORT_IN_USE':
          return error.edgeIds.join(',');
        case 'PORT_DIRECTION':
          return `${error.direction} as ${error.end}`;
        default: {
          const unreachable: never = error;
          return unreachable;
        }
      }
    };

    const described: string[] = [];
    try {
      throw new PortInUseError('a', 'out', ['e1', 'e2']);
    } catch (error) {
      if (isDagrGraphError(error)) described.push(describeError(error));
    }
    expect(described).toEqual(['e1,e2']);
    expect(everyError().map(describeError)).toEqual([
      'invalid node id',
      'a',
      'a',
      'e1',
      'e1',
      'a.out',
      'a.out',
      'e1,e2',
      'in as source',
    ]);
  });
});

/** One instance of every concrete error, in `DagrGraphErrorCode` order. */
function everyError(): DagrGraphErrorLike[] {
  return [
    new InvalidIdError('node', ''),
    new DuplicateNodeError('a'),
    new NodeNotFoundError('a'),
    new DuplicateEdgeError('e1'),
    new EdgeNotFoundError('e1'),
    new DuplicatePortError('a', 'out'),
    new PortNotFoundError('a', 'out'),
    new PortInUseError('a', 'out', ['e1', 'e2']),
    new PortDirectionError('a', 'sink', 'in', 'source'),
  ];
}

describe('error catching', () => {
  it('lets a caller catch every graph error through the base class', () => {
    const errors: DagrGraphError[] = everyError();
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
        case 'DUPLICATE_PORT':
          return 'duplicate port';
        case 'PORT_NOT_FOUND':
          return 'port not found';
        case 'PORT_IN_USE':
          return 'port in use';
        case 'PORT_DIRECTION':
          return 'port direction';
        default: {
          const unreachable: never = error.code;
          return unreachable;
        }
      }
    };

    const errors: DagrGraphError[] = everyError();
    expect(errors.map(label)).toEqual([
      'invalid id',
      'duplicate node',
      'node not found',
      'duplicate edge',
      'edge not found',
      'duplicate port',
      'port not found',
      'port in use',
      'port direction',
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
