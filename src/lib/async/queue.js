import { log } from "../log.js";

export async function enqueueAsyncIngressEvent(env, envelope) {
  const queue = env?.ASYNC_INGRESS_QUEUE;
  if (!queue || typeof queue.send !== "function") {
    return {
      queued: false,
      queueName: null,
      reason: "binding-missing",
    };
  }

  try {
    await queue.send(envelope);
    return {
      queued: true,
      queueName: "ASYNC_INGRESS_QUEUE",
    };
  } catch (error) {
    log.warn(
      "Failed to enqueue async ingress event:",
      error?.message || String(error),
    );
    return {
      queued: false,
      queueName: "ASYNC_INGRESS_QUEUE",
      reason: "send-failed",
      error: error?.message || String(error),
    };
  }
}