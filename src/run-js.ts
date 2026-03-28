/**
 * Minimal secure-exec task for Trigger.dev.
 *
 * Works with secure-exec@0.1.0 but fails with 0.2.0-rc.2:
 *   "V8 runtime process closed stdout before sending socket path"
 *
 * To reproduce:
 *   1. Change secure-exec version in package.json to "0.2.0-rc.2"
 *   2. pnpm install
 *   3. npx trigger dev
 *   4. Trigger the task with: { "code": "module.exports = { answer: 2 + 2 }" }
 */
import { logger, task } from "@trigger.dev/sdk";
import {
  NodeRuntime,
  createNodeDriver,
  createNodeRuntimeDriverFactory,
} from "secure-exec";

export const runJs = task({
  id: "run-js",
  retry: { maxAttempts: 1 },
  run: async (payload: { code: string }) => {
    logger.info("Creating secure-exec runtime...");

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
