import { describe, expect, it } from 'vitest';
import { DagrLayoutError, InvalidConfigError, StageContractError } from '../src/errors.js';
import type { DagrLayoutErrorCode } from '../src/errors.js';

describe('layout errors', () => {
  it('makes every error catchable as one family', () => {
    const errors: DagrLayoutError[] = [
      new InvalidConfigError('nodeSep', -1),
      new StageContractError('rank', 'a', 'no rank was assigned'),
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
    ];
    expect(codes).toEqual(['INVALID_CONFIG', 'STAGE_CONTRACT']);
  });

  it('keeps instanceof working for each subclass', () => {
    expect(new InvalidConfigError('nodeSep', -1)).toBeInstanceOf(InvalidConfigError);
    expect(new StageContractError('rank', 'a', 'why')).toBeInstanceOf(StageContractError);
    expect(new InvalidConfigError('nodeSep', -1)).not.toBeInstanceOf(StageContractError);
  });

  it('names each subclass after its class', () => {
    expect(new InvalidConfigError('nodeSep', -1).name).toBe('InvalidConfigError');
    expect(new StageContractError('rank', 'a', 'why').name).toBe('StageContractError');
  });

  it('reports the offending config field and value', () => {
    const error = new InvalidConfigError('rankSep', Number.NaN);
    expect(error.field).toBe('rankSep');
    expect(error.value).toBeNaN();
    expect(error.message).toContain('rankSep');
    expect(error.message).toContain('NaN');
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
});
