// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { version as domVersion } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, reactMajor } from './dom.js';
import type { Mounted } from './dom.js';

/**
 * The harness itself, under whichever React the config names. Every other
 * component test passing under the React 18 config proves nothing if that
 * config quietly resolved React 19.
 */
let tree: Mounted | null = null;
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  vi.restoreAllMocks();
});

describe('the React under test', () => {
  it('is the major the config names, for react and react-dom alike', () => {
    const expected = Number(process.env['DAGR_REACT_MAJOR']);
    expect(expected).toBeGreaterThan(0);
    expect(reactMajor).toBe(expected);
    expect(Number(domVersion.split('.')[0])).toBe(expected);
  });

  it('mounts, runs effects inside act, and warns about nothing', async () => {
    const errors = vi.spyOn(console, 'error');
    function Counter() {
      const [count, setCount] = useState(0);
      useEffect(() => setCount(1), []);
      return <p>{count}</p>;
    }
    tree = await mount(<Counter />);
    expect(tree.container.textContent).toBe('1');
    expect(errors).not.toHaveBeenCalled();
  });
});
