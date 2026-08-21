import { handleCommentPayload, reconcileIssueComments } from "./comments.js";
import {
  enqueueDocumentSafetySweep,
  handleDocumentPayload,
  reconcileDocumentById,
  reconcileDocumentSweepFinalize,
} from "./documents.js";

export function shouldQueueExtendedPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.type === "Issue") return payload.action !== "remove";
  if (payload.type === "Comment") return ["create", "update", "remove"].includes(payload.action);
  if (payload.type === "Document") return ["create", "update", "remove"].includes(payload.action);
  return false;
}

export async function mirrorExtendedPayload(payload, env) {
  if (payload?.type === "Comment") {
    return handleCommentPayload(payload, env, { reconcileDocument: reconcileDocumentById });
  }
  if (payload?.type === "Document") return handleDocumentPayload(payload, env);
  if (payload?.type === "DocumentSweepFinalize") return reconcileDocumentSweepFinalize(payload, env);
  throw new Error(`Unsupported extended mirror payload type: ${String(payload?.type)}`);
}

export { enqueueDocumentSafetySweep, reconcileIssueComments };
