# secure-exec 0.2.0-rc.2 + esbuild bundling reproduction

Minimal repro showing that `secure-exec@0.2.0-rc.2` fails when bundled with esbuild (the same way Trigger.dev bundles user code). `0.1.0` works fine.

## Root cause

There are **two issues** with 0.2.0-rc.2 in bundled environments:

### Issue 1: V8 binary path resolution

`@secure-exec/v8/dist/runtime.js` uses `createRequire(import.meta.url).resolve()` to locate its platform-specific Rust binary. When esbuild bundles this, `import.meta.url` points to the output chunk — not the original package. The binary can't be found and the spawn fails with `ENOENT`.

**Fix**: An esbuild plugin that resolves the binary path at build time and replaces `resolveBinaryPath()` with a static return. See Plugin 2 in `standalone/build-and-run.mjs`.

### Issue 2: Unix domain socket path length (macOS)

Even after fixing binary resolution, the Rust binary panics:
```
failed to bind UDS: path must be shorter than SUN_LEN
```

macOS limits Unix domain socket paths to 104 bytes. The `@secure-exec/v8` binary creates its socket in the default temp directory. When the working directory or temp path is long (common with pnpm's `.pnpm` store, CI runners, or deep project paths), the socket path exceeds this limit.

**Workaround**: Set `TMPDIR=/tmp` before running. This forces the socket to a short path.

**Suggested fix for secure-exec**: The Rust binary should create its UDS socket in `/tmp` (or a short well-known path) regardless of the working directory/temp path — similar to how PostgreSQL and Docker handle this.

## Standalone reproduction (no Trigger.dev needed)

```bash
pnpm install
node standalone/build-and-run.mjs
```

This script:
1. Bundles `standalone/entry.mjs` with esbuild using the same config as Trigger.dev's CLI
2. Runs the bundled output with Node

**Expected output with 0.2.0-rc.2:**
```
Build succeeded: 2 output files
Running bundled output...
Error: spawn secure-exec-v8 ENOENT          # without binary path fix
# or
failed to bind UDS: path must be shorter than SUN_LEN  # with binary path fix
```

**With `TMPDIR=/tmp` workaround** (after binary path fix):
```
TMPDIR=/tmp node standalone/build-and-run.mjs
```

**With `secure-exec@0.1.0`**: works without any workarounds.

## Trigger.dev reproduction

```bash
cp .env.example .env     # edit TRIGGER_PROJECT_REF
pnpm install
npx trigger login
npx trigger dev
```

Trigger the `run-js` task with:
```json
{ "code": "module.exports = { answer: 2 + 2 }" }
```

## esbuild plugins needed

Three esbuild plugins are required for 0.2.0 (two for 0.1.0):

1. **`node-stdlib-browser-stub`** — Replaces `node-stdlib-browser` with pre-resolved path map. Its `require.resolve("./mock/empty.js")` breaks under esbuild's ESM shim.

2. **`inline-secure-exec-v8-binary`** *(0.2.0 only)* — Resolves the `@secure-exec/v8` platform binary path at build time and inlines it, replacing `resolveBinaryPath()`.

3. **`inline-secure-exec-bridge`** — Inlines `@secure-exec/core/dist/bridge.js` (v0.1) or `@secure-exec/nodejs/dist/bridge.js` (v0.2) at build time. The runtime `require.resolve("@secure-exec/core")` breaks in bundled output.

## Environment

- Node.js: v22.19.0
- esbuild: 0.25.x
- OS: macOS (Apple Silicon)
- macOS UDS path limit: 104 bytes
