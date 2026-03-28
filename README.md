# secure-exec 0.2.0-rc.2 + esbuild bundling reproduction

Minimal repro showing issues with `secure-exec@0.2.0-rc.2` in bundled environments (esbuild, same config as Trigger.dev). `0.1.0` works fine. All issues are now worked around with a pnpm patch + `TMPDIR=/tmp`.

## Issues found (and fixes)

### 1. Unix domain socket path length (macOS) — needs fix in Rust binary

The Rust binary (`@secure-exec/v8`) creates a UDS socket in the default temp directory. On macOS the path limit is 104 bytes. Deep working directories (pnpm `.pnpm` store, CI runners, monorepos) push the path over this limit:

```
failed to bind UDS: path must be shorter than SUN_LEN
```

**Our workaround**: `TMPDIR=/tmp`

**What maintainers should do**: Create the socket in `/tmp` (or a short well-known path) regardless of the system temp directory — similar to how PostgreSQL and Docker handle this. The Rust code at `src/main.rs:305` should use a short fixed base path.

### 2. Missing polyfill source files in published package — needs packaging fix

`@secure-exec/nodejs/dist/polyfills.js` resolves custom polyfill sources via:

```js
// line 7
new URL(`../src/polyfills/${fileName}`, import.meta.url)
```

This looks for `@secure-exec/nodejs/src/polyfills/*.js` — but only `dist/` is published. The `src/` directory is excluded from the package.

The 13 polyfill files referenced are: `crypto.js`, `stream-web.js`, `util-types.js`, `webstreams-runtime.js`, `js-transferable.js`, `internal-mime.js`, `internal-test-binding.js`, `internal-worker-js-transferable.js`, and 5 `internal-webstreams-*.js` files.

**Our workaround**: pnpm patch that:
1. Changes the path from `../src/polyfills/` to `./polyfills/`
2. Copies the polyfill source files from the GitHub repo into `dist/polyfills/`

**What maintainers should do**: Either include `src/polyfills/` in the published package (`files` field in package.json), or compile/copy these files into `dist/polyfills/` during the build step and update the path.

### 3. Missing `web-streams-polyfill` dependency — needs package.json fix

`@secure-exec/nodejs/dist/polyfills.js` references `web-streams-polyfill/dist/ponyfill.js` in two places:
- Line 9: hardcoded `WEB_STREAMS_PONYFILL_PATH` (also has a broken relative path `../../../node_modules/.pnpm/node_modules/...` baked in from the dev workspace)
- `dist/polyfills/webstreams-runtime.js`: `import * as ponyfill from "web-streams-polyfill/dist/ponyfill.js"`

But `web-streams-polyfill` is not listed in `dependencies` or `devDependencies` of `@secure-exec/nodejs`.

**Our workaround**: Added `web-streams-polyfill` as a direct dependency in our project, and patched `polyfills.js` to use `createRequire` with a try/catch instead of the broken hardcoded path.

**What maintainers should do**: Add `web-streams-polyfill` to `dependencies` in `@secure-exec/nodejs/package.json`. Also fix the `WEB_STREAMS_PONYFILL_PATH` to not use a hardcoded dev workspace path — use `createRequire(import.meta.url).resolve("web-streams-polyfill/dist/ponyfill.js")` instead.

### 4. Binary path resolution when bundled — externals solve this

`@secure-exec/v8/dist/runtime.js` uses `createRequire(import.meta.url).resolve()` to locate its platform binary. When esbuild bundles this, `import.meta.url` points to the output chunk, not the original package.

**Our workaround**: Make all `@secure-exec/*` packages external (not bundled). They resolve from `node_modules` at runtime and the binary path works correctly. No esbuild plugins needed.

**What maintainers should do**: This is fine as-is — users just need to externalize the packages. Could document this for bundler users, or consider a fallback that checks `__dirname` relative paths.

## Running the reproduction

### Standalone (no Trigger.dev needed)

```bash
pnpm install
TMPDIR=/tmp node standalone/build-and-run.mjs
```

With the pnpm patch applied (already in this repo), this succeeds:
```
Build succeeded: 2 output files
Running bundled output...
SUCCESS: { "code": 0, "exports": { "answer": 4 } }
```

Without `TMPDIR=/tmp`, hits the UDS path length issue on macOS.

### Trigger.dev reproduction

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

## Summary for maintainers

Three things to fix in the published packages:

1. **`@secure-exec/v8` (Rust binary)**: Use `/tmp` for UDS socket path, not the default temp dir
2. **`@secure-exec/nodejs` (packaging)**: Include `src/polyfills/` in the published package (or copy to `dist/polyfills/` and fix the path)
3. **`@secure-exec/nodejs` (package.json)**: Add `web-streams-polyfill` to `dependencies`, and fix the hardcoded `WEB_STREAMS_PONYFILL_PATH` to use runtime resolution instead of a dev workspace path

## Environment

- Node.js: v22.19.0
- esbuild: 0.25.x
- OS: macOS (Apple Silicon)
- macOS UDS path limit: 104 bytes
