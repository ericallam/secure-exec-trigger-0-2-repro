# secure-exec 0.2.0-rc.2 + Trigger.dev reproduction

Minimal repro showing that `secure-exec@0.2.0-rc.2` fails in Trigger.dev's esbuild-bundled environment while `0.1.0` works.

## Setup

```bash
cp .env.example .env     # edit TRIGGER_PROJECT_REF if it differs from your project
pnpm install
npx trigger login        # authenticate with Trigger.dev
npx trigger dev          # start dev server
```

Then trigger the task with payload:
```json
{ "code": "module.exports = { answer: 2 + 2 }" }
```

## What works (0.1.0)

With `secure-exec@0.1.0` (current `package.json`), the task runs correctly and returns `{ exitCode: 0, exports: { answer: 4 } }`.

The two esbuild plugins in `trigger.config.ts` handle the build-time workarounds:
1. **node-stdlib-browser-stub** — replaces `node-stdlib-browser` with pre-resolved path map (its `require.resolve("./mock/empty.js")` breaks under Trigger's ESM shim)
2. **inline-secure-exec-bridge** — inlines `@secure-exec/core/dist/bridge.js` at build time (runtime `require.resolve("@secure-exec/core")` fails in bundled output)

## What breaks (0.2.0-rc.2)

Change `package.json`:
```diff
-"secure-exec": "0.1.0"
+"secure-exec": "0.2.0-rc.2"
```

Then `pnpm install && npx trigger dev` and trigger the task. Error:

```
V8 runtime process closed stdout before sending socket path
```

### Root cause

In 0.2.0, the package structure changed:
- `@secure-exec/node` → `@secure-exec/nodejs` (bridge-loader path changed)
- New `@secure-exec/v8` package spawns a Rust binary via `createRequire(import.meta.url).resolve()` to locate platform packages (`@secure-exec/v8-darwin-arm64`, etc.)

When esbuild bundles `@secure-exec/v8/dist/runtime.js`, the `import.meta.url` points to the output chunk directory, not the original package — so the Rust binary can't be found and the child process fails immediately.

### Possible fixes

1. Make `@secure-exec/v8` and platform packages external (adding them to `build.external` in trigger.config.ts) — but this alone doesn't resolve it, suggesting there may be additional bundling issues in 0.2.0
2. The bridge-loader regex needs updating for the new `@secure-exec/nodejs` path
3. Ideally `@secure-exec/v8` could resolve its binary without `import.meta.url` (e.g. via `__dirname` or a build-time-inlinable path)

## Environment

- Node.js: v22.19.0
- Trigger.dev: 4.4.3
- OS: macOS (Apple Silicon)
