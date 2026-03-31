# secure-exec 0.2.1 + Trigger.dev repro (working setup)

This repo reproduces and works around the current compatibility issues between
`secure-exec@0.2.1` and Trigger.dev's build/index pipeline.

## Root cause

The core issue is path resolution in bundled environments:

- Trigger bundles task code into chunk files.
- Some `secure-exec` internals and `node-stdlib-browser` logic resolve sibling
  files using `import.meta.url` or `require.resolve("./relative")`.
- In bundled output, those resolutions may anchor to chunk locations instead of
  package locations, or can embed host-specific absolute paths into output.

This leads to errors like:

- `Cannot find module './mock/empty.js'`
- `Could not resolve .../node-stdlib-browser/.../proxy/url.js`
- `Could not resolve .../@secure-exec/nodejs/src/polyfills/stream-web.js`
- `V8 runtime process closed stdout before sending socket path`

## Final working approach in this repo

No postinstall patching is required. Everything is handled via
`trigger.config.ts` custom build extension + runtime safeguards.

### 1. Custom build extension plugins

`trigger.config.ts` uses `secureExecCompatibilityExtension()` with 3 plugins:

1. `node-stdlib-browser-stub`
   - Replaces `node-stdlib-browser` import with a runtime-loaded mapping
   - Avoids baking machine-local absolute paths into the bundle

2. `inline-secure-exec-bridge`
   - Inlines `@secure-exec/nodejs` bridge code at build time
   - Avoids `import.meta.url` bridge lookup failures in chunks

3. `fix-secure-exec-polyfills-paths`
   - Rewrites `resolveCustomPolyfillSource(...)` in
     `@secure-exec/nodejs/dist/polyfills.js`
   - Resolves `src/polyfills/*` from package location at runtime

### 2. Deploy-only dependency layer

`onBuildComplete()` adds a deploy layer:

- `secure-exec: "0.2.1"`
- `web-streams-polyfill: "^4.2.0"`

This ensures indexing/runtime modules needed by secure-exec are available in the
deploy image.

### 3. Runtime temp-dir guard

`src/run-js.ts` forces:

- `TMPDIR=/tmp`
- `TMP=/tmp`
- `TEMP=/tmp`

before creating `NodeRuntime`, to avoid long UDS path failures.

## Run it

### Local dev

```bash
cp .env.example .env
pnpm install
pnpm exec trigger dev --profile test
```

Trigger task payload:

```json
{ "code": "module.exports = { answer: 2 + 2 }" }
```

### Deploy

```bash
pnpm exec trigger deploy --profile test --dry-run
pnpm exec trigger deploy --profile test
```

## Notes

- `--dry-run` only validates build packaging; full deploy still runs indexing.
- If you are debugging similar issues, run with `--log-level debug` and inspect
  the generated `.trigger/tmp/build-*/` artifacts.

## Environment

- Node.js: v22.x
- Trigger.dev CLI/SDK: 4.4.3
- secure-exec: 0.2.1
