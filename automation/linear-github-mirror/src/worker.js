import issueWorker, { isFreshWebhook, verifyLinearSignature } from "./index.js";
import {
  enqueueDocumentSafetySweep,
  mirrorExtendedPayload,
  reconcileIssueComments,
  shouldQueueExtendedPayload,
} from "./extensions.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, mirrorMode: effectiveMirrorMode(env) });
    }
    if (request.method !== "POST" || url.pathname !== "/webhooks/linear") return new Response("Not found", { status: 404 });

    const rawBody = await request.text();
    const signature = request.headers.get("Linear-Signature");
    if (!signature || !(await verifyLinearSignature(rawBody, signature, env.LINEAR_WEBHOOK_SECRET))) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!isFreshWebhook(payload.webhookTimestamp, Date.now())) return new Response("Stale webhook", { status: 401 });
    if (!shouldQueueExtendedPayload(payload)) return jsonResponse({ ok: true, ignored: true });
    if (effectiveMirrorMode(env) === "disabled") return jsonResponse({ ok: true, disabled: true });

    await env.LINEAR_EVENTS.send({ deliveryId: request.headers.get("Linear-Delivery") ?? null, payload });
    return jsonResponse({ ok: true, queued: true });
  },

  async queue(batch, env) {
    if (effectiveMirrorMode(env) === "disabled") {
      for (const message of batch.messages) message.ack();
      return;
    }

    for (const message of batch.messages) {
      const payload = message.body?.payload ?? message.body;
      try {
        if (payload?.type === "Issue") {
          await issueWorker.queue({ messages: [message] }, env);
          const issueId = payload?.data?.id;
          if (typeof issueId === "string") await reconcileIssueComments(issueId, env);
        } else {
          await mirrorExtendedPayload(payload, env);
        }
      } catch (error) {
        console.error("Linear -> GitHub extended mirror failed", safeError(error));
        throw error;
      }
    }
  },

  async scheduled(controller, env) {
    if (effectiveMirrorMode(env) === "disabled") return;

    await issueWorker.scheduled(controller, env);
    await enqueueDocumentSafetySweep(env);
  },
};

function effectiveMirrorMode(env) {
  return env?.MIRROR_MODE === "active" ? "active" : "disabled";
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}
