import { describe, expect, it } from 'vitest';
import * as core from '../src/core.js';
import * as api from '../src/index.js';

describe('@prnt/dagr-render/core and the full entry', () => {
  it('export the same objects, not copies', () => {
    // One class, so `instanceof Camera2D` holds whichever entry built it.
    expect(core.Camera2D).toBe(api.Camera2D);
    expect(core.fitZoom).toBe(api.fitZoom);
    expect(core.shapeEdgePath).toBe(api.shapeEdgePath);
  });
});
