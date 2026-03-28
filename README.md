# secure-exec 0.2.0-rc.2 + esbuild bundling reproduction

Minimal repro showing issues with `secure-exec@0.2.0-rc.2` in bundled environments (esbuild, same config as Trigger.dev). `0.1.0` works fine.

## Issues found

### 1. Unix domain socket path length (macOS)

The Rust binary (`@secure-exec/v8`) creates a UDS socket in the default temp directory. On macOS the path limit is 104 bytes. Deep working directories (pnpm `.pnpm` store, CI runners, monorepos) push the path over this limit:

```
failed to bind UDS: path must be shorter than SUN_LEN
```

**Workaround**: `TMPDIR=/tmp`

**Suggested fix**: Create the socket in `/tmp` (or a short well-known path) regardless of the system temp directory — similar to how PostgreSQL and Docker handle this.

### 2. Missing polyfill source files in published package

When secure-exec runs user code, it internally calls esbuild to bundle Node.js stdlib polyfills for the V8 isolate. `@secure-exec/nodejs/dist/polyfills.js` line 7 resolves custom polyfill sources via:

```js
new URL(`../src/polyfills/${fileName}`, import.meta.url)
```

This looks for `@secure-exec/nodejs/src/polyfills/*.js` — but only `dist/` is published (no `src/` directory). The custom polyfill files referenced are: `crypto.js`, `stream-web.js`, `util-types.js`, and several `internal-webstreams-*.js` / `internal-*.js` files.

Error:
```
Could not resolve "/path/to/node_modules/@secure-exec/nodejs/src/polyfills/stream-web.js"
```

**Fix**: Either include `src/polyfills/` in the published package, or compile those files into `dist/polyfills/` and update the path resolution.

### 3. Binary path resolution when bundled (esbuild plugin workaround exists)

`@secure-exec/v8/dist/runtime.js` uses `createRequire(import.meta.url).resolve()` to locate its platform binary. When esbuild bundles this, `import.meta.url` points to the output chunk, not the original package.

**Workaround**: Make all `@secure-exec/*` packages external so they resolve from `node_modules` at runtime. No esbuild plugins needed — just externals. See the `external` list in `standalone/build-and-run.mjs`.

## Standalone reproduction (no Trigger.dev needed)

```bash
pnpm install

# Without TMPDIR fix — hits UDS path length issue:
node standalone/build-and-run.mjs

# With TMPDIR fix — hits missing polyfill source issue:
TMPDIR=/tmp node standalone/build-and-run.mjs
```

**Expected output with `TMPDIR=/tmp`:**
```
Build succeeded: 2 output files

Running bundled output...

stdout: SUCCESS: {
  "code": 1,
  "errorMessage": "Build failed with 1 error:\nerror: Could not resolve \".../src/polyfills/stream-web.js\""
}
```

**With `secure-exec@0.1.0`** (change version in `package.json`): works without any workarounds.

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

## Summary

With all `@secure-exec/*` packages externalized (not bundled), the only changes needed in secure-exec itself are:

1. Use a short path (`/tmp`) for the UDS socket regardless of system temp directory
2. Fix the polyfill bundler to not reference `src/` files that aren't in the published package

No esbuild plugins should be needed for v0.2 if these are fixed — just adding the packages to the `external` list.

## Environment

- Node.js: v22.19.0
- esbuild: 0.25.x
- OS: macOS (Apple Silicon)
- macOS UDS path limit: 104 bytes
