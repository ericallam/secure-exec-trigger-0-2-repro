import { defineConfig } from "@trigger.dev/sdk";
import type { BuildExtension } from "@trigger.dev/build";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  project: "proj_repro",
  runtime: "node-22",
  dirs: ["./src"],
  maxDuration: 3600,
  build: {
    extensions: [secureExecCompatibilityExtension()],
    external: [
      // esbuild must not be bundled — secure-exec uses it at runtime.
      "esbuild",
    ],
  },
});

function secureExecCompatibilityExtension(): BuildExtension {
  return {
    name: "secure-exec-compatibility",
    async onBuildStart(context) {
      context.registerPlugin({
        name: "node-stdlib-browser-stub",
        setup(build) {
          build.onResolve({ filter: /^node-stdlib-browser$/ }, function onResolve() {
            return {
              path: "node-stdlib-browser",
              namespace: "nsb-resolved",
            };
          });
          build.onLoad({ filter: /.*/, namespace: "nsb-resolved" }, function onLoad() {
            return {
              contents: [
                `import { createRequire } from "node:module";`,
                `const runtimeRequire = createRequire(import.meta.url);`,
                `const stdLibBrowser = runtimeRequire("node-stdlib-browser");`,
                `export default stdLibBrowser;`,
              ].join("\n"),
              loader: "js",
            };
          });
        },
      });

      context.registerPlugin({
        name: "inline-secure-exec-bridge",
        setup(build) {
          build.onLoad(
            {
              filter:
                /[\\/]@secure-exec[\\/]node(?:js)?[\\/]dist[\\/]bridge-loader\.js$/,
            },
            function onLoad(args) {
              const bridgePath = path.join(path.dirname(args.path), "bridge.js");
              const bridgeCode = fs.readFileSync(bridgePath, "utf8");
              return {
                contents: [
                  `import { getIsolateRuntimeSource } from "@secure-exec/core";`,
                  `const bridgeCodeCache = ${JSON.stringify(bridgeCode)};`,
                  `export function getRawBridgeCode() { return bridgeCodeCache; }`,
                  `export function getBridgeAttachCode() { return getIsolateRuntimeSource("bridgeAttach"); }`,
                ].join("\n"),
                loader: "js",
              };
            }
          );
        },
      });

      context.registerPlugin({
        name: "fix-secure-exec-polyfills-paths",
        setup(build) {
          build.onLoad(
            { filter: /[\\/]@secure-exec[\\/]nodejs[\\/]dist[\\/]polyfills\.js$/ },
            function onLoad(args) {
              const source = fs.readFileSync(args.path, "utf8");
              const patched = source.replace(
                /function resolveCustomPolyfillSource\(fileName\) \{[\s\S]*?\n\}/,
                [
                  `const secureExecNodejsRequire = createRequire(import.meta.url);`,
                  `const secureExecNodejsPolyfillsEntry = secureExecNodejsRequire.resolve("@secure-exec/nodejs/internal/polyfills");`,
                  `const secureExecNodejsRoot = path.resolve(path.dirname(secureExecNodejsPolyfillsEntry), "..");`,
                  `function resolveCustomPolyfillSource(fileName) {`,
                  `  return path.join(secureExecNodejsRoot, "src", "polyfills", fileName);`,
                  `}`,
                ].join("\n")
              );
              return {
                contents: `import path from "node:path";\n${patched}`,
                loader: "js",
              };
            }
          );
        },
      });
    },
    async onBuildComplete(context) {
      if (context.target !== "deploy") {
        return;
      }

      context.addLayer({
        id: "secure-exec-runtime-deps",
        dependencies: {
          "secure-exec": "0.2.1",
          "web-streams-polyfill": "^4.2.0",
        },
      });
    },
  };
}
