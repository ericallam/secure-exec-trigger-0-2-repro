#!/usr/bin/env node
/**
 * Standalone reproduction: bundles standalone/entry.mjs with esbuild using
 * the same options as Trigger.dev's CLI, then executes the bundled output.
 *
 * Usage:
 *   node standalone/build-and-run.mjs
 *
 * Works with secure-exec@0.1.0, fails with 0.2.0-rc.2.
 */
import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outdir = join(projectRoot, "standalone", "dist");

// Clean output
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

console.log("Building with esbuild (same config as Trigger.dev CLI)...\n");

try {
  const result = await esbuild.build({
    // --- Trigger.dev CLI esbuild options ---
    entryPoints: [join(__dirname, "entry.mjs")],
    outdir,
    absWorkingDir: projectRoot,
    bundle: true,
    metafile: true,
    splitting: true,
    charset: "utf8",
    platform: "node",
    sourcemap: true,
    sourcesContent: true,
    keepNames: true,
    format: "esm",
    target: ["node20", "es2022"],
    conditions: ["trigger.dev", "module", "node"],
    outExtension: { ".js": ".mjs" },
    loader: {
      ".js": "jsx",
      ".mjs": "jsx",
      ".cjs": "jsx",
      ".wasm": "copy",
    },
    logLevel: "warning",
    external: [
      // esbuild must not be bundled — it locates its native binary
      // via a relative path from its JS API entry point.
      "esbuild",
    ],
    plugins: [
      // Plugin 1: Replace node-stdlib-browser with pre-resolved paths.
      // (Same as Conner's working setup and our secureExec() extension)
      {
        name: "node-stdlib-browser-stub",
        setup(build) {
          build.onResolve({ filter: /^node-stdlib-browser$/ }, () => ({
            path: "node-stdlib-browser",
            namespace: "nsb-resolved",
          }));
          build.onLoad({ filter: /.*/, namespace: "nsb-resolved" }, (args) => {
            // node-stdlib-browser is a transitive dep. Resolve it from
            // @secure-exec/nodejs's real location in pnpm's .pnpm store.
            // secure-exec entry → .pnpm/secure-exec@.../node_modules/secure-exec/dist/index.js
            // We need → .pnpm/secure-exec@.../node_modules/@secure-exec/nodejs/dist/polyfills.js
            const secureExecEntry = createRequire(
              join(projectRoot, "package.json")
            ).resolve("secure-exec");
            // Go from secure-exec/dist/index.js → node_modules/@secure-exec/nodejs/
            const pnpmNodeModules = resolve(dirname(secureExecEntry), "..", "..");
            const nsjsPolyfills = join(
              pnpmNodeModules,
              "@secure-exec",
              "nodejs",
              "dist",
              "polyfills.js"
            );
            const buildRequire = createRequire(nsjsPolyfills);
            const resolved = buildRequire("node-stdlib-browser");
            return {
              contents: `export default ${JSON.stringify(resolved)};`,
              loader: "js",
            };
          });
        },
      },
      // Plugin 2: Inline bridge.js at build time.
      // (Same as Conner's working setup — matches @secure-exec/node for v0.1
      //  and @secure-exec/nodejs for v0.2)
      {
        name: "inline-secure-exec-bridge",
        setup(build) {
          build.onLoad(
            {
              filter:
                /[\\/]@secure-exec[\\/]node(?:js)?[\\/]dist[\\/]bridge-loader\.js$/,
            },
            (args) => {
              try {
                // bridge.js lives alongside bridge-loader.js in the same dist/ dir
                const bridgePath = join(dirname(args.path), "bridge.js");
                const bridgeCode = readFileSync(bridgePath, "utf8");
                return {
                  contents: [
                    `import { getIsolateRuntimeSource } from "@secure-exec/core";`,
                    `const bridgeCodeCache = ${JSON.stringify(bridgeCode)};`,
                    `export function getRawBridgeCode() { return bridgeCodeCache; }`,
                    `export function getBridgeAttachCode() { return getIsolateRuntimeSource("bridgeAttach"); }`,
                  ].join("\n"),
                  loader: "js",
                };
              } catch (err) {
                console.warn("bridge-inline plugin failed:", err.message);
                return undefined;
              }
            }
          );
        },
      },
    ],
  });

  console.log(
    `Build succeeded: ${Object.keys(result.metafile.outputs).length} output files\n`
  );
} catch (err) {
  console.error("Build failed:", err.message);
  process.exit(1);
}

// Run the bundled output
console.log("Running bundled output...\n");
try {
  const output = execSync(`node ${join(outdir, "entry.mjs")}`, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    timeout: 15000,
  });
  console.log(output);
} catch (err) {
  console.error("Execution failed:");
  if (err.stdout) console.log("stdout:", err.stdout);
  if (err.stderr) console.error("stderr:", err.stderr);
  process.exit(1);
}
