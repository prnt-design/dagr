import { createRef } from 'react';
import { DagrExplorer } from '@prnt/dagr-explorer';
import type { ExplorerApi, ExplorerView } from '@prnt/dagr-explorer';
import { Camera2D, createPinchGesture } from '@prnt/dagr-render/core';
import type { PinchDelta, PinchGesture } from '@prnt/dagr-render/core';

const view: ExplorerView = {
  id: 'v', label: 'View', nodes: [{ id: 'a', label: 'Alpha' }], edges: [],
};
const apiRef = createRef<ExplorerApi>();
export const map = <DagrExplorer label="Consumer map" views={[view]} apiRef={apiRef} />;
const gesture: PinchGesture = createPinchGesture();
gesture.down(1, { x: 0, y: 0 });
gesture.down(2, { x: 100, y: 0 });
const delta: PinchDelta | null = gesture.move(2, { x: 200, y: 0 });
const camera = new Camera2D({ viewport: { width: 390, height: 480, devicePixelRatio: 1 } });
if (delta !== null) {
  camera.panByScreen(delta.pan.x, delta.pan.y);
  camera.zoomAtScreen(delta.anchor, delta.factor);
}
gesture.reset();
