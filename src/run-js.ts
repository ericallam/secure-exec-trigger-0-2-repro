/**
 * Minimal secure-exec task for Trigger.dev (secure-exec@0.2.x).
 *
 * Trigger with: { "code": "module.exports = { answer: 2 + 2 }" }
 */
import { logger, task } from "@trigger.dev/sdk";
import {
  NodeRuntime,
  createNodeDriver,
  createNodeRuntimeDriverFactory,
} from "secure-exec";

function forceShortTempDir(): void {
  // secure-exec/v8 communicates over a Unix socket under the temp directory.
  // In some Trigger environments, TMPDIR can be a deep path that exceeds
  // socket path length limits. Force a short, stable temp root.
  process.env.TMPDIR = "/tmp";
  process.env.TMP = "/tmp";
  process.env.TEMP = "/tmp";
}

export const runJs = task({
  id: "run-js",
  retry: { maxAttempts: 1 },
  run: async (payload: { code: string }) => {
    logger.info("Creating secure-exec runtime...");
    forceShortTempDir();

    const runtime = new NodeRuntime({
      systemDriver: createNodeDriver(),
      runtimeDriverFactory: createNodeRuntimeDriverFactory(),
      memoryLimit: 64,
      cpuTimeLimitMs: 5000,
    });

    try {
      const result = await runtime.run<unknown>(payload.code);

      logger.info("Execution complete", {
        exitCode: result.code,
        hasExports: result.exports !== undefined,
      });

      return {
        exitCode: result.code,
        exports: result.exports ?? null,
        error: result.errorMessage ?? null,
      };
    } finally {
      runtime.dispose();
    }
  },
});
