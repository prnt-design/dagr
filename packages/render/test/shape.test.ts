import { describe, expect, it } from 'vitest';
import { normalizeShape } from '../src/shape.js';
import type { ShapeInstance, ShapeStyle } from '../src/shape.js';

/**
 * The whole of `shape.ts`'s contract, checked.
 *
 * `shape.ts` is plain data and arithmetic with no GPU anywhere near it, which
 * is the point of splitting it out of `sdf-nodes.ts`: the validator is the part
 * of M4.2 that can be wrong in a way a screenshot would not show, and it is the
 * part a test can reach. `sdf-nodes.ts` needs a device to run at all.
 *
 * **Every rejection below asserts two things: that a `RangeError` came out, and
 * that its message names the offending field.** The second half is not
 * ceremony. A validator that rejects the right shapes with the wrong field name
 * is worse than one that throws a bare `Error`, because the caller then goes
 * and edits a field that was never wrong, and `toThrow(RangeError)` alone
 * cannot tell the two apart: with `size.width` and `size.height` checked by the
 * same helper, a copy-paste that passes `'size.width'` for both passes a
 * bare-class assertion on every case.
 */

/** A rounded rect with nothing optional set, as a base for the cases below. */
const RECT: ShapeInstance = {
  kind: 'rounded-rect',
  center: { x: 0, y: 0 },
  size: { width: 10, height: 6 },
  style: { fillColor: 0x336699 },
};

/** A circle with nothing optional set. Square by construction, as required. */
const CIRCLE: ShapeInstance = {
  kind: 'circle',
  center: { x: 1, y: 2 },
  size: { width: 8, height: 8 },
  style: { fillColor: 0xff0000 },
};

/** The base rounded rect with one style field replaced. */
function withStyle(style: Partial<ShapeStyle>): ShapeInstance {
  return { ...RECT, style: { ...RECT.style, ...style } };
}

/**
 * Asserts that `build()` throws a `RangeError` whose message STARTS with
 * `field`.
 *
 * Starts with rather than merely contains, because the messages in this package
 * are `${field} has to be ...` (see `camera.ts`) and a containment check on
 * `'size.width'` would also pass for a message about `style.outlineWidth`. The
 * function is called twice on purpose: `toThrow` swallows the error it caught,
 * so the message has to be recovered from a second call rather than from the
 * first.
 */
function expectFieldRangeError(build: () => unknown, field: string): void {
  expect(build).toThrow(RangeError);
  let message = '';
  try {
    build();
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message.startsWith(field)).toBe(true);
}

describe('normalizeShape defaults', () => {
  it('fills every optional field of a bare rounded rect', () => {
    expect(normalizeShape(RECT)).toEqual({
      kind: 'rounded-rect',
      center: { x: 0, y: 0 },
      size: { width: 10, height: 6 },
      cornerRadius: 0,
      style: {
        fillColor: 0x336699,
        fillOpacity: 1,
        outlineColor: 0x336699,
        outlineWidth: 0,
        glowColor: 0x336699,
        glowRadius: 0,
      },
    });
  });

  it('defaults the outline and glow colours to the fill colour', () => {
    // The reason is in the docstring on `NormalizedShapeStyle`: with a width
    // and a radius of zero neither colour is ever read, and if one is read
    // anyway the fill colour is the single value that cannot draw a ring the
    // caller would report as a shader bug.
    const normalized = normalizeShape(withStyle({ fillColor: 0x00ff00 }));
    expect(normalized.style.outlineColor).toBe(0x00ff00);
    expect(normalized.style.glowColor).toBe(0x00ff00);
  });

  it('keeps every optional field a caller did supply', () => {
    const normalized = normalizeShape({
      ...RECT,
      cornerRadius: 2,
      style: {
        fillColor: 0x111111,
        fillOpacity: 0.5,
        outlineColor: 0x222222,
        outlineWidth: 0.25,
        glowColor: 0x333333,
        glowRadius: 3,
      },
    });
    expect(normalized).toEqual({
      kind: 'rounded-rect',
      center: { x: 0, y: 0 },
      size: { width: 10, height: 6 },
      cornerRadius: 2,
      style: {
        fillColor: 0x111111,
        fillOpacity: 0.5,
        outlineColor: 0x222222,
        outlineWidth: 0.25,
        glowColor: 0x333333,
        glowRadius: 3,
      },
    });
  });

  it('normalizes a circle to a zero corner radius', () => {
    expect(normalizeShape(CIRCLE).cornerRadius).toBe(0);
  });

  it('copies the point and size records rather than aliasing them', () => {
    // The normalized record is what the material builder and the quad sizer
    // read, possibly a frame later. Sharing a caller's object would let a
    // caller who reuses one scratch record per shape change what has already
    // been normalized.
    const normalized = normalizeShape(RECT);
    expect(normalized.center).not.toBe(RECT.center);
    expect(normalized.size).not.toBe(RECT.size);
    expect(normalized.style).not.toBe(RECT.style);
  });
});

describe('normalizeShape accepts the legal edges', () => {
  it('accepts a zero-sized shape, which draws nothing', () => {
    const normalized = normalizeShape({ ...RECT, size: { width: 0, height: 0 } });
    expect(normalized.size).toEqual({ width: 0, height: 0 });
  });

  it('accepts a zero-sized circle', () => {
    expect(() => normalizeShape({ ...CIRCLE, size: { width: 0, height: 0 } })).not.toThrow();
  });

  it('accepts a negative centre, which is just a point left of the origin', () => {
    expect(normalizeShape({ ...RECT, center: { x: -5, y: -7 } }).center).toEqual({
      x: -5,
      y: -7,
    });
  });

  it('accepts opacity exactly 0 and exactly 1', () => {
    expect(normalizeShape(withStyle({ fillOpacity: 0 })).style.fillOpacity).toBe(0);
    expect(normalizeShape(withStyle({ fillOpacity: 1 })).style.fillOpacity).toBe(1);
  });

  it('accepts the colour range endpoints', () => {
    expect(normalizeShape(withStyle({ fillColor: 0x000000 })).style.fillColor).toBe(0);
    expect(normalizeShape(withStyle({ fillColor: 0xffffff })).style.fillColor).toBe(0xffffff);
  });

  it('accepts a corner radius of exactly half the shorter side', () => {
    // A 10 by 6 rect at radius 3 is a stadium, which the distance field draws
    // correctly. It is the first value past it that is rejected.
    expect(normalizeShape({ ...RECT, cornerRadius: 3 }).cornerRadius).toBe(3);
  });

  it('accepts a zero corner radius on a zero-sized rect', () => {
    expect(() =>
      normalizeShape({ ...RECT, size: { width: 0, height: 0 }, cornerRadius: 0 }),
    ).not.toThrow();
  });
});

describe('normalizeShape rejects a bad kind', () => {
  it('rejects a kind outside the two it draws, naming kind', () => {
    expectFieldRangeError(
      () => normalizeShape({ ...RECT, kind: 'triangle' } as unknown as ShapeInstance),
      'kind',
    );
  });
});

describe('normalizeShape rejects a non-finite number, naming the field', () => {
  const notFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it('rejects a non-finite center.x', () => {
    for (const value of notFinite) {
      expectFieldRangeError(
        () => normalizeShape({ ...RECT, center: { x: value, y: 0 } }),
        'center.x',
      );
    }
  });

  it('rejects a non-finite center.y', () => {
    for (const value of notFinite) {
      expectFieldRangeError(
        () => normalizeShape({ ...RECT, center: { x: 0, y: value } }),
        'center.y',
      );
    }
  });

  it('rejects a non-finite size.width', () => {
    for (const value of notFinite) {
      expectFieldRangeError(
        () => normalizeShape({ ...RECT, size: { width: value, height: 6 } }),
        'size.width',
      );
    }
  });

  it('rejects a non-finite size.height', () => {
    for (const value of notFinite) {
      expectFieldRangeError(
        () => normalizeShape({ ...RECT, size: { width: 10, height: value } }),
        'size.height',
      );
    }
  });

  it('rejects a non-finite cornerRadius', () => {
    for (const value of notFinite) {
      expectFieldRangeError(() => normalizeShape({ ...RECT, cornerRadius: value }), 'cornerRadius');
    }
  });

  it('rejects a non-finite style.fillOpacity', () => {
    for (const value of notFinite) {
      expectFieldRangeError(
        () => normalizeShape(withStyle({ fillOpacity: value })),
        'style.fillOpacity',
      );
    }
  });

  it('rejects a non-finite style.outlineWidth', () => {
    for (const value of notFinite) {
      expectFieldRangeError(
        () => normalizeShape(withStyle({ outlineWidth: value })),
        'style.outlineWidth',
      );
    }
  });

  it('rejects a non-finite style.glowRadius', () => {
    for (const value of notFinite) {
      expectFieldRangeError(
        () => normalizeShape(withStyle({ glowRadius: value })),
        'style.glowRadius',
      );
    }
  });
});

describe('normalizeShape rejects a negative extent, naming the field', () => {
  it('rejects a negative size.width', () => {
    expectFieldRangeError(
      () => normalizeShape({ ...RECT, size: { width: -1, height: 6 } }),
      'size.width',
    );
  });

  it('rejects a negative size.height', () => {
    expectFieldRangeError(
      () => normalizeShape({ ...RECT, size: { width: 10, height: -1 } }),
      'size.height',
    );
  });

  it('rejects a negative cornerRadius', () => {
    expectFieldRangeError(() => normalizeShape({ ...RECT, cornerRadius: -0.5 }), 'cornerRadius');
  });

  it('rejects a negative style.outlineWidth', () => {
    expectFieldRangeError(
      () => normalizeShape(withStyle({ outlineWidth: -0.25 })),
      'style.outlineWidth',
    );
  });

  it('rejects a negative style.glowRadius', () => {
    expectFieldRangeError(() => normalizeShape(withStyle({ glowRadius: -2 })), 'style.glowRadius');
  });
});

describe('normalizeShape rejects an out-of-range opacity, naming the field', () => {
  it('rejects an opacity below zero', () => {
    expectFieldRangeError(
      () => normalizeShape(withStyle({ fillOpacity: -0.001 })),
      'style.fillOpacity',
    );
  });

  it('rejects an opacity above one', () => {
    expectFieldRangeError(
      () => normalizeShape(withStyle({ fillOpacity: 1.001 })),
      'style.fillOpacity',
    );
  });
});

describe('normalizeShape rejects a bad colour, naming the field', () => {
  // Every way of getting a colour wrong is silent downstream: three validates
  // none of it, and a `NaN` or an out-of-range channel comes out as some colour
  // rather than as an error. Same rule as `RendererOptions.clearColor`.
  const bad: readonly (readonly [string, number])[] = [
    ['fractional', 0x336699 + 0.5],
    ['negative', -1],
    ['above 0xffffff', 0x1000000],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ];

  for (const [label, value] of bad) {
    it(`rejects a ${label} style.fillColor`, () => {
      expectFieldRangeError(() => normalizeShape(withStyle({ fillColor: value })), 'style.fillColor');
    });

    it(`rejects a ${label} style.outlineColor`, () => {
      expectFieldRangeError(
        () => normalizeShape(withStyle({ outlineColor: value })),
        'style.outlineColor',
      );
    });

    it(`rejects a ${label} style.glowColor`, () => {
      expectFieldRangeError(
        () => normalizeShape(withStyle({ glowColor: value })),
        'style.glowColor',
      );
    });
  }
});

describe('normalizeShape clamps a corner radius the size cannot hold', () => {
  // Clamped rather than rejected, deferring to `clampCornerRadius` in `sdf.ts`,
  // which owns the bound and the argument for it: a corner radius arrives from
  // a theme, so a radius bigger than a small node is ordinary rather than a
  // mistake, and half the shorter side is a genuinely neutral answer.

  it('clamps a radius above half the shorter side', () => {
    expect(normalizeShape({ ...RECT, cornerRadius: 3.001 }).cornerRadius).toBe(3);
  });

  it('measures the bound against the SHORTER side, not the longer one', () => {
    // The failure this catches is a clamp written against `width`, which lets a
    // radius of 5 through on a 10 by 6 rect and draws corners that overflow the
    // height.
    expect(normalizeShape({ ...RECT, cornerRadius: 5 }).cornerRadius).toBe(3);
  });

  it('clamps any positive radius on a zero-sized rect to zero', () => {
    expect(
      normalizeShape({ ...RECT, size: { width: 0, height: 0 }, cornerRadius: 1 }).cornerRadius,
    ).toBe(0);
  });

  it('still rejects a negative radius rather than clamping it to zero', () => {
    // The front door is stricter than the internal clamp on purpose: a negative
    // radius is a sign error on a line the caller can see, where an oversized
    // one is inherited from a theme.
    expectFieldRangeError(() => normalizeShape({ ...RECT, cornerRadius: -0.5 }), 'cornerRadius');
  });
});

describe('normalizeShape circle rules', () => {
  it('rejects an unequal size on a circle, naming size', () => {
    expectFieldRangeError(
      () => normalizeShape({ ...CIRCLE, size: { width: 8, height: 6 } }),
      'size',
    );
  });

  it('rejects an unequal size whichever side is larger', () => {
    expectFieldRangeError(
      () => normalizeShape({ ...CIRCLE, size: { width: 6, height: 8 } }),
      'size',
    );
  });

  it('accepts an equal size on a circle', () => {
    expect(normalizeShape({ ...CIRCLE, size: { width: 3, height: 3 } }).size).toEqual({
      width: 3,
      height: 3,
    });
  });

  it('rejects a cornerRadius on a circle, naming cornerRadius', () => {
    expectFieldRangeError(() => normalizeShape({ ...CIRCLE, cornerRadius: 2 }), 'cornerRadius');
  });

  it('rejects even a zero cornerRadius on a circle', () => {
    // Present at all is the line, not the value: see the decision recorded on
    // `ShapeInstance.cornerRadius`. A rule that let `0` through and rejected
    // `0.0001` would make the error depend on the value of a field that has no
    // meaning for this kind.
    expectFieldRangeError(() => normalizeShape({ ...CIRCLE, cornerRadius: 0 }), 'cornerRadius');
  });

  it('does not reject an absent cornerRadius on a circle', () => {
    expect(() => normalizeShape(CIRCLE)).not.toThrow();
  });

  it('applies every other rule to a circle too', () => {
    expectFieldRangeError(
      () => normalizeShape({ ...CIRCLE, center: { x: Number.NaN, y: 0 } }),
      'center.x',
    );
    expectFieldRangeError(
      () => normalizeShape({ ...CIRCLE, style: { fillColor: -1 } }),
      'style.fillColor',
    );
  });
});

describe('normalizeShape checks the size before the corner radius', () => {
  it('names size.width when both the width and the radius are wrong', () => {
    // Ordering matters for the report: a negative width makes the radius clamp
    // meaningless, so the width is the one the caller has to fix first, and
    // `clampCornerRadius` would otherwise raise `halfWidth`, a field that does
    // not appear anywhere in the caller's shape record.
    expectFieldRangeError(
      () => normalizeShape({ ...RECT, size: { width: -10, height: 6 }, cornerRadius: -99 }),
      'size.width',
    );
  });
});
