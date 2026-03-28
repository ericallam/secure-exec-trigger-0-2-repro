/**
 * Minimal secure-exec usage — this file gets bundled by esbuild
 * in the same way Trigger.dev bundles user task code.
 */
import {
  NodeRuntime,
  createNodeDriver,
  createNodeRuntimeDriverFactory,
} from "secure-exec";

const runtime = new NodeRuntime({
  systemDriver: createNodeDriver(),
  runtimeDriverFactory: createNodeRuntimeDriverFactory(),
  memoryLimit: 64,
  cpuTimeLimitMs: 5000,
});

try {
  const result = await runtime.run("module.exports = { answer: 2 + 2 };");
  console.log("SUCCESS:", JSON.stringify(result, null, 2));
} catch (err) {
  console.error("FAILED:", err.message);
} finally {
  runtime.dispose();
}
