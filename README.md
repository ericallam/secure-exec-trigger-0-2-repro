# secure-exec 0.2.0-rc.2 + esbuild bundling reproduction

Minimal repro showing that `secure-exec@0.2.0-rc.2` fails when bundled with esbuild (the same way Trigger.dev bundles user code). `0.1.0` works fine.

## Standalone reproduction (no Trigger.dev needed)

```bash
pnpm install
node standalone/build-and-run.mjs
```

This script:
1. Bundles `standalone/entry.mjs` with esbuild using the same config as Trigger.dev's CLI (`bundle: true, splitting: true, format: "esm", platform: "node", target: ["node20", "es2022"]`)
2. Runs the bundled output with Node

**With `secure-exec@0.2.0-rc.2`** (current `package.json`):

```
Build succeeded: 2 output files

Running bundled output...

Error: spawn secure-exec-v8 ENOENT
```

The `@secure-exec/v8` package tries to spawn its Rust binary but can't locate it in the bundled output — `createRequire(import.meta.url).resolve()` resolves against the chunk directory, not the original package.

**With `secure-exec@0.1.0`**: works correctly, returns `{ code: 0, exports: { answer: 4 } }`.

## Trigger.dev reproduction

```bash
cp .env.example .env     # edit TRIGGER_PROJECT_REF if it differs from your project
pnpm install
npx trigger login        # authenticate with Trigger.dev
npx trigger dev           # start dev server
```

Then trigger the `run-js` task with payload:
```json
{ "code": "module.exports = { answer: 2 + 2 }" }
```

Same result — works with 0.1.0, fails with 0.2.0-rc.2.

## What the esbuild plugins do

Two esbuild plugins are needed for secure-exec to work in a bundled environment (both versions):

1. **`node-stdlib-browser-stub`** — `node-stdlib-browser`'s index.js calls `require.resolve("./mock/empty.js")` at module scope. In the bundled output, `require.resolve` is anchored to the chunk path, so this breaks. The plugin intercepts the import at build time, loads the real module (where `require.resolve` works), captures the resolved path map, and inlines it as a static JSON export.

2. **`inline-secure-exec-bridge`** — `@secure-exec/node`'s `bridge-loader.js` calls `require.resolve("@secure-exec/core")` at module scope to find `dist/bridge.js`. Same problem — fails in bundled output. The plugin reads `bridge.js` at build time and inlines it as a string literal.

These plugins are sufficient for 0.1.0 (which uses `isolated-vm`). For 0.2.0, the new `@secure-exec/v8` package has a third path-resolution issue that these plugins don't cover.

## Root cause (0.2.0)

In 0.2.0, the runtime switched from `isolated-vm` (native Node addon) to `@secure-exec/v8` (Rust binary). The `@secure-exec/v8` runtime:

1. Uses `createRequire(import.meta.url).resolve()` to find its platform-specific binary package (`@secure-exec/v8-darwin-arm64`, etc.)
2. Spawns the binary as a child process

When esbuild bundles this, `import.meta.url` points to the output chunk — not the original `@secure-exec/v8` package directory. So `require.resolve` can't find the platform package and the binary spawn fails with `ENOENT`.

Making `@secure-exec/v8` external doesn't fully resolve the issue either (we tried).

## Environment

- Node.js: v22.19.0
- esbuild: 0.25.x
- OS: macOS (Apple Silicon)
