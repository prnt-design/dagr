# GraphViewport

All public showcase graphs share this interaction surface. Architecture renders HTML/SVG content into its camera plane. The layout
benchmark uses SvgAdapter to update its vector viewBox at screen resolution. Rich content and
the living demo use `RendererAdapter` to drive the native renderer camera without
scaling a bitmap canvas.

The viewport has a fixed responsive height and clips its drawing. Camera updates
change the plane transform, SVG viewBox, or native camera, never the viewport
dimensions. Do not force a composited layer for vector content: enlarging its
cached raster can make high zoom blurry.
A single requestAnimationFrame loop eases toward the latest input and stops when
settled. Reduced motion applies changes immediately. Resize refits the view.

Click or Tab into the graph to activate wheel zoom. The focus ring stays visible
while a descendant has focus. Wheel zoom anchors at the pointer; toolbar buttons
anchor at the viewport center. Drag or arrow keys pan, Shift-wheel pans
horizontally, +/- zoom, 0 fits, and Escape releases focus. Ctrl/Command-wheel
retains the browser's own zoom behavior. Unfocused wheel input scrolls the page.

Keep renderer imports in `RendererAdapter` behind a browser-only boundary.
`LivingStage` exposes optional canvas framing and content slots so its host can
supply this viewport without moving docs-specific UI into the demo package.

Browser verification must cover all four integrations, including unchanged page
and viewport bounds after repeated wheel and button zoom, input focus isolation,
reset, pan, reduced motion, mobile sizing, and mode remounts. GPU checks verify
camera movement and overlay alignment, not a hardware frame-rate claim.
