import { describe, expect, it } from 'vitest';
import {
  DagrGraphError,
  DuplicateEdgeError,
  DuplicateNodeError,
  EdgeNotFoundError,
  InvalidIdError,
  NodeNotFoundError,
} from '../src/errors.js';

describe('DagrGraphError', () => {
  it('is an Error subclass with a stable name', () => {
    const error = new DagrGraphError('something went wrong');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error.name).toBe('DagrGraphError');
    expect(error.message).toBe('something went wrong');
  });
});

describe('InvalidIdError', () => {
  it('carries the INVALID_ID code and an explanatory message', () => {
    const error = new InvalidIdError('node');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DagrGraphError);
    expect(error).toBeInstanceOf(InvalidIdError);
    expect(error.name).toBe('InvalidIdError');
    expect(error.code).toBe('INVALID_ID');
    expect(error.message).toContain('node');
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
      new InvalidIdError('node'),
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
});
