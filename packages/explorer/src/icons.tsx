/**
 * The parts' icons: 16px line drawings in `currentColor`. Each is hidden from
 * a screen reader, which hears the button's label instead.
 *
 * Strokes are 2px: centered on the whole-pixel coordinates the paths use, a
 * 1.5px stroke straddles pixels and renders soft at 1x.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import type { ReactElement } from 'react';

function Icon({ d }: { readonly d: string }): ReactElement {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export const MinusIcon = (): ReactElement => <Icon d="M3 8h10" />;
export const PlusIcon = (): ReactElement => <Icon d="M3 8h10M8 3v10" />;
/** Four corner brackets. */
export const FitIcon = (): ReactElement => <Icon d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />;
/** A circle with four ticks. */
export const TargetIcon = (): ReactElement => (
  <Icon d="M8 3.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
);
/** Drawn, not the character, so nothing reads it as "times". */
export const CloseIcon = (): ReactElement => <Icon d="M4 4l8 8M12 4l-8 8" />;
