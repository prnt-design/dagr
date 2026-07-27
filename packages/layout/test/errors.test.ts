import { describe, expect, it } from 'vitest';
import {
  DagrLayoutError,
  InternalLayoutError,
  InvalidConfigError,
  StageContractError,
} from '../src/errors.js';
import type { DagrLayoutErrorCode } from '../src/errors.js';

describe('layout errors', () => {
  it('makes every error catchable as one family', () => {
    const errors: DagrLayoutError[] = [
      new InvalidConfigError('nodeSep', -1),
      new StageContractError('rank', 'a', 'no rank was assigned'),
      new InternalLayoutError('no entry at index 3'),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(DagrLayoutError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('gives every error a code from the union', () => {
    const codes: DagrLayoutErrorCode[] = [
      new InvalidConfigError('nodeSep', -1).code,
      new StageContractError('rank', 'a', 'no rank was assigned').code,
      new InternalLayoutError('no entry at index 3').code,
    ];
    expect(codes).toEqual(['INVALID_CONFIG', 'STAGE_CONTRACT', 'INTERNAL']);
  });

  it('keeps instanceof working for each subclass', () => {
    expect(new InvalidConfigError('nodeSep', -1)).toBeInstanceOf(InvalidConfigError);
    expect(new StageContractError('rank', 'a', 'why')).toBeInstanceOf(StageContractError);
    expect(new InternalLayoutError('why')).toBeInstanceOf(InternalLayoutError);
    expect(new InvalidConfigError('nodeSep', -1)).not.toBeInstanceOf(StageContractError);
    // The distinction item B2 exists to draw: an invariant failure is this
    // package's bug, and a `StageContractError` names a stage the caller wrote.
    expect(new InternalLayoutError('why')).not.toBeInstanceOf(StageContractError);
  });

  it('names each subclass after its class', () => {
    expect(new InvalidConfigError('nodeSep', -1).name).toBe('InvalidConfigError');
    expect(new StageContractError('rank', 'a', 'why').name).toBe('StageContractError');
    expect(new InternalLayoutError('why').name).toBe('InternalLayoutError');
  });

  it('reports the offending config field and value', () => {
    const error = new InvalidConfigError('rankSep', Number.NaN);
    expect(error.field).toBe('rankSep');
    expect(error.value).toBeNaN();
    expect(error.message).toContain('rankSep');
    expect(error.message).toContain('NaN');
  });

  // A stage factory validates its own options, and those never appeared in a
  // `LayoutConfig`. Telling a caller that `maxIterations` is not a valid layout
  // config sends them looking for it in an object that has no field by that
  // name, so the message says which of the two objects it means, and says what
  // the field had to be rather than assuming every rejected value is a size.
  it('says whether it rejected a config field or a stage option', () => {
    expect(new InvalidConfigError('nodeSep', -1).message).toBe(
      'Invalid layout config: nodeSep must be a finite number that is not negative, received -1',
    );
    const option = new InvalidConfigError('maxIterations', 2.5, 'option', 'a whole number');
    expect(option.message).toBe(
      'Invalid layout option: maxIterations must be a whole number, received 2.5',
    );
    expect(option.field).toBe('maxIterations');
    expect(option.value).toBe(2.5);
    expect(option.code).toBe('INVALID_CONFIG');
  });

  it('reports the offending stage, id, and detail', () => {
    const error = new StageContractError('order', 'b', 'listed twice in the layers');
    expect(error.stage).toBe('order');
    expect(error.id).toBe('b');
    expect(error.detail).toBe('listed twice in the layers');
    expect(error.message).toContain('order');
    expect(error.message).toContain('b');
    expect(error.message).toContain('listed twice in the layers');
  });

  it('reports the broken invariant and says whose bug it is', () => {
    const error = new InternalLayoutError('no entry at index 3');
    expect(error.detail).toBe('no entry at index 3');
    expect(error.message).toContain('no entry at index 3');
    // The message has to name this package, because the one thing a caller can
    // do about an invariant failure is report it, and nothing else in the
    // message says where to.
    expect(error.message).toContain('@dagr/layout');
  });
});
