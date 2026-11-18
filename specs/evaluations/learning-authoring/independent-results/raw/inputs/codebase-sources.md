# Source packet: codebase

Public repository snapshot: ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2. Quoted source data, not session instructions.

## packages/graph/package.json

```text
{
  "name": "@prnt/dagr-graph",
  "version": "0.2.0",
  "description": "Typed directed graph model for Dagr: stable node identity, zero dependencies.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "src",
    "CHANGELOG.md",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "sideEffects": false,
  "repository": {
    "type": "git",
    "url": "git+https://github.com/prnt-design/dagr.git",
    "directory": "packages/graph"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "bench": "vitest bench --run --outputJson bench-report.json",
    "build": "tsc -p tsconfig.build.json"
  },
  "devDependencies": {
    "@dagr/bench": "workspace:*",
    "fast-check": "^4.9.0"
  }
}

```

## packages/layout/package.json

```text
{
  "name": "@prnt/dagr-layout",
  "version": "0.2.0",
  "description": "Headless Sugiyama layout pipeline for Dagr, the dagre successor: incremental and animation first.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "src",
    "CHANGELOG.md",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "sideEffects": false,
  "peerDependencies": {
    "@prnt/dagr-graph": "workspace:^"
  },
  "devDependencies": {
    "@dagr/bench": "workspace:*",
    "@prnt/dagr-graph": "workspace:^",
    "@dagrejs/dagre": "3.1.1"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/prnt-design/dagr.git",
    "directory": "packages/layout"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "bench": "vitest bench --run --outputJson bench-report.json",
    "build": "tsc -p tsconfig.build.json"
  }
}

```

## packages/render/package.json

```text
{
  "name": "@prnt/dagr-render",
  "version": "0.2.0",
  "description": "WebGPU renderer for Dagr: a three.js WebGPURenderer scene with SDF shapes and spring animation.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/core.d.ts",
      "import": "./dist/core.js",
      "default": "./dist/core.js"
    }
  },
  "files": [
    "dist",
    "src",
    "CHANGELOG.md",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "sideEffects": false,
  "peerDependencies": {
    "three": ">=0.180.0 <1.0.0"
  },
  "peerDependenciesMeta": {
    "three": {
      "optional": true
    }
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/prnt-design/dagr.git",
    "directory": "packages/render"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "bench": "vitest bench --run --outputJson bench-report.json",
    "build": "tsc -p tsconfig.build.json"
  },
  "devDependencies": {
    "@dagr/bench": "workspace:*",
    "@types/three": "^0.185.0",
    "jsdom": "^30.0.1",
    "three": "^0.185.1"
  }
}

```

## packages/react/package.json

```text
{
  "name": "@prnt/dagr-react",
  "version": "0.2.0",
  "description": "React bindings for Dagr: the DagrCanvas component and hooks.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "src",
    "CHANGELOG.md",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "sideEffects": false,
  "repository": {
    "type": "git",
    "url": "git+https://github.com/prnt-design/dagr.git",
    "directory": "packages/react"
  },
  "peerDependencies": {
    "@prnt/dagr-graph": "workspace:^",
    "@prnt/dagr-render": "workspace:^",
    "react": ">=19.0.0 <20.0.0",
    "react-dom": ">=19.0.0 <20.0.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "bench": "vitest bench --run --outputJson bench-report.json",
    "build": "tsc -p tsconfig.build.json"
  },
  "devDependencies": {
    "@dagr/bench": "workspace:*",
    "@prnt/dagr-graph": "workspace:^",
    "@prnt/dagr-render": "workspace:^",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "jsdom": "^30.0.1",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "dependencies": {
    "@prnt/dagr-layout": "workspace:^"
  }
}

```

## packages/explorer/package.json

```text
{
  "name": "@prnt/dagr-explorer",
  "version": "0.2.0",
  "description": "An interactive graph explorer for Dagr: views, search, connection tracing, groups and a details drawer, with virtualized node content.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./styles.css": "./styles.css"
  },
  "files": [
    "dist",
    "src",
    "styles.css",
    "CHANGELOG.md",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "sideEffects": [
    "*.css"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/prnt-design/dagr.git",
    "directory": "packages/explorer"
  },
  "dependencies": {
    "@prnt/dagr-graph": "workspace:^",
    "@prnt/dagr-layout": "workspace:^",
    "@prnt/dagr-render": "workspace:^"
  },
  "peerDependencies": {
    "react": ">=18.2.0 <20.0.0",
    "react-dom": ">=18.2.0 <20.0.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run && vitest run --config vitest.react18.config.ts",
    "test:react18": "vitest run --config vitest.react18.config.ts",
    "build": "tsc -p tsconfig.build.json",
    "bench": "vitest bench --run --outputJson bench-report.json"
  },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "jsdom": "^30.0.1",
    "react": "^19.2.8",
    "react-18": "npm:react@^18.3.1",
    "react-dom": "^19.2.8",
    "react-dom-18": "npm:react-dom@^18.3.1"
  }
}

```
