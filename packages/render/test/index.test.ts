import { describe, expect, it } from 'vitest';
import { PKG_NAME } from '../src/index.js';

describe('@dagr/render', () => {
  it('exports its own package name', () => {
    expect(PKG_NAME).toBe('@dagr/render');
  });
});
