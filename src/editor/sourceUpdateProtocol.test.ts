import { describe, expect, it } from "vitest";
import {
  beginSourceComposition,
  createSourceUpdateProtocol,
  endSourceComposition,
  receiveSourceUpdate
} from "./sourceUpdateProtocol";

describe("source update protocol", () => {
  it("consumes consecutive revisions in order", () => {
    let state = createSourceUpdateProtocol(4);
    const editor = receiveSourceUpdate(state, { update: { revision: 5, kind: "editor" } }, 5);
    state = editor.state;
    expect(editor.action).toEqual({ kind: "consume-editor" });

    const patch = receiveSourceUpdate(state, {
      update: { revision: 6, kind: "model-patch", splices: [{ startLine: 2, endLine: 2, replacementLines: ["B"] }] }
    }, 6);
    expect(patch.state.appliedRevision).toBe(6);
    expect(patch.action).toEqual({
      kind: "apply-model-patch",
      update: { revision: 6, kind: "model-patch", splices: [{ startLine: 2, endLine: 2, replacementLines: ["B"] }] }
    });
  });

  it("queues only update metadata while composing and drains it in order", () => {
    let state = beginSourceComposition(createSourceUpdateProtocol(0));
    state = receiveSourceUpdate(state, { update: { revision: 1, kind: "editor" } }, 2).state;
    state = receiveSourceUpdate(state, {
      update: { revision: 2, kind: "model-patch", splices: [{ startLine: 1, endLine: 1, replacementLines: ["A"] }] }
    }, 2).state;
    expect(state.pending).toEqual([
      { update: { revision: 1, kind: "editor" } },
      { update: { revision: 2, kind: "model-patch", splices: [{ startLine: 1, endLine: 1, replacementLines: ["A"] }] } }
    ]);
    expect(state.pending.some((item) => "resetText" in item && item.resetText !== undefined)).toBe(false);

    const drained = endSourceComposition(state, 2);
    expect(drained.state).toMatchObject({ appliedRevision: 2, composing: false, pending: [] });
    expect(drained.actions.map((action) => action?.kind)).toEqual(["consume-editor", "apply-model-patch"]);
  });

  it("retains source text only for an explicit reset", () => {
    let state = beginSourceComposition(createSourceUpdateProtocol(7));
    state = receiveSourceUpdate(state, {
      update: { revision: 8, kind: "reset" },
      resetText: "nui 1\npoint A = (0, 0)"
    }, 8).state;
    expect(state.pending).toEqual([{
      update: { revision: 8, kind: "reset" },
      resetText: "nui 1\npoint A = (0, 0)"
    }]);
    const drained = endSourceComposition(state, 8);
    expect(drained.actions).toEqual([{
      kind: "reset",
      reason: "reset",
      text: "nui 1\npoint A = (0, 0)"
    }]);
  });

  it("uses a current-store reset fallback for a revision gap", () => {
    const result = receiveSourceUpdate(createSourceUpdateProtocol(2), {
      update: { revision: 4, kind: "model-patch", splices: [] }
    }, 9);
    expect(result.action).toEqual({ kind: "reset", reason: "gap" });
    expect(result.state).toEqual({ appliedRevision: 9, composing: false, pending: [] });
  });
});
