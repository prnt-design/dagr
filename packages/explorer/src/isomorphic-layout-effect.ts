import { useEffect, useLayoutEffect } from 'react';

/**
 * A layout effect in the browser and a plain one on a server, where React 18
 * warns that a layout effect does nothing.
 */
export const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;
