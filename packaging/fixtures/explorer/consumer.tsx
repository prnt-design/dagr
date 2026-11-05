import { createRef } from 'react';
import { DagrExplorer } from '@prnt/dagr-explorer';
import type { ExplorerApi, ExplorerView } from '@prnt/dagr-explorer';
import { Camera2D, createPinchGesture, visibleFrame, visualViewportInset } from '@prnt/dagr-render/core';
import type { FrameInset, PinchDelta, PinchGesture, VisibleFrame, VisualViewportBox } from '@prnt/dagr-render/core';

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
const visual: VisualViewportBox = { offsetLeft: 0, offsetTop: 0, width: 390, height: 300, scale: 1 };
const inset: FrameInset = visualViewportInset({ left: 0, top: 0, right: 390, bottom: 480 }, { width: 390, height: 844 }, visual);
camera.setInset(inset);
const frame: VisibleFrame = visibleFrame({ width: 390, height: 480 }, inset);
export const centred = camera.centerFor({ x: frame.width / 2, y: frame.height / 2 });
