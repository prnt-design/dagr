# Changelog

## 0.1.4

- `@prnt/dagr/explorer` forwards `@prnt/dagr-explorer` 0.1.4: a camera that frames the part of the graph the open drawer leaves uncovered, `api.focusViewport()`, connections that follow their edge, and icon buttons. Its changelog lists what to change when upgrading from 0.1.3.

## 0.1.3

- Add `@prnt/dagr/explorer`, forwarding `@prnt/dagr-explorer`, and `@prnt/dagr/render/core`, forwarding the renderer's three-free core. The umbrella now depends on `@prnt/dagr-explorer`, and its `three` peer is marked optional, since only `@prnt/dagr/render` and `@prnt/dagr/react` load three.js at runtime. `@prnt/dagr-render` marks it optional too, so a site using neither installs no three.js. The umbrella still requires React 19; a React 18 site installs `@prnt/dagr-explorer` directly.
- Expose `DagrCanvas` navigation, node click and hover events, camera `focusNode` and `fit`, `nodeTiers` level of detail, `detectBackendSupport` and the camera input helpers through the umbrella exports.

## 0.1.2

- Expose live React edge path styles and renderer route shaping through the umbrella exports.

## 0.1.1

- Include default graph-aware camera limits through the React and renderer entry points.
- Require the 0.1.1 package set so installations receive the camera fix.

## 0.1.0

Initial umbrella package, forwarding the five `@prnt/dagr-*` APIs without copying their implementation.
