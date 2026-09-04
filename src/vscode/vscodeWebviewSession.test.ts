import { describe, expect, it, vi } from "vitest";
import {
  publishVscodeMultiDocumentGraphPublication,
  VscodeWebviewSessionRegistry,
  type VscodeWebviewSessionBase
} from "./vscodeWebviewSession";

type TestSession = VscodeWebviewSessionBase & {
  id: string;
  panel?: { webview: { postMessage: ReturnType<typeof vi.fn> } };
};

const sessionFor = (
  documentUri: string,
  surfaceKind: TestSession["surfaceKind"],
  id: string,
  postMessage?: ReturnType<typeof vi.fn>
): TestSession => ({
  id,
  documentUri,
  surfaceKind,
  ...(postMessage ? { panel: { webview: { postMessage } } } : {})
});

describe("VS Code Webview session identity", () => {
  it("keeps different surface kinds distinct for one document URI", () => {
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const canvas = sessionFor("file:///pattern.nui", "canvas", "canvas");
    const outputPreview = sessionFor("file:///pattern.nui", "outputPreview", "output");

    registry.set(canvas);
    registry.set(outputPreview);

    expect(registry.get("file:///pattern.nui", "canvas")).toBe(canvas);
    expect(registry.get("file:///pattern.nui", "outputPreview")).toBe(outputPreview);
    expect([...registry.values()]).toHaveLength(2);
  });

  it("removes one surface without removing another surface for the same document", () => {
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const canvas = sessionFor("file:///pattern.nui", "canvas", "canvas");
    const outputPreview = sessionFor("file:///pattern.nui", "outputPreview", "output");
    registry.set(canvas);
    registry.set(outputPreview);

    expect(registry.delete("file:///pattern.nui", "canvas")).toBe(true);

    expect(registry.get("file:///pattern.nui", "canvas")).toBeUndefined();
    expect(registry.get("file:///pattern.nui", "outputPreview")).toBe(outputPreview);
  });

  it("finds every surface session belonging to a closing document", () => {
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const canvas = sessionFor("file:///pattern.nui", "canvas", "canvas");
    const outputPreview = sessionFor("file:///pattern.nui", "outputPreview", "output");
    const other = sessionFor("file:///other.nui", "canvas", "other");
    registry.set(canvas);
    registry.set(outputPreview);
    registry.set(other);

    expect(registry.forDocument("file:///pattern.nui")).toEqual([canvas, outputPreview]);
  });

  it("fans one root-owned graph publication out to matching Canvas and Output Preview sessions", () => {
    const documentUri = "file:///graph-publication.nui";
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const canvasPost = vi.fn();
    const outputPost = vi.fn();
    const otherPost = vi.fn();
    registry.set(sessionFor(documentUri, "canvas", "canvas", canvasPost));
    registry.set(sessionFor(documentUri, "outputPreview", "output", outputPost));
    registry.set(sessionFor("file:///not-the-root.nui", "canvas", "other", otherPost));

    const publication = {
      type: "multiDocumentGraphPublication" as const,
      documentVersion: 7,
      status: "building" as const,
      graph: null
    };
    publishVscodeMultiDocumentGraphPublication(documentUri, publication);

    expect(canvasPost).toHaveBeenCalledWith(publication);
    expect(outputPost).toHaveBeenCalledWith(publication);
    expect(otherPost).not.toHaveBeenCalled();
    registry.clear();
  });

  it("hydrates a surface opened after the latest root graph publication", () => {
    const documentUri = "file:///late-output-preview.nui";
    const publication = {
      type: "multiDocumentGraphPublication" as const,
      documentVersion: 3,
      status: "invalidated" as const,
      graph: null
    };
    publishVscodeMultiDocumentGraphPublication(documentUri, publication);

    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const postMessage = vi.fn();
    registry.set(sessionFor(documentUri, "outputPreview", "output", postMessage));

    expect(postMessage).toHaveBeenCalledWith(publication);
    registry.clear();
  });

  it("replays the retained publication only to the exact registered session", () => {
    const documentUri = "file:///replay-exact-session.nui";
    const publication = {
      type: "multiDocumentGraphPublication" as const,
      documentVersion: 4,
      status: "building" as const,
      graph: null
    };
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const currentPost = vi.fn();
    const stalePost = vi.fn();
    const current = sessionFor(documentUri, "canvas", "current", currentPost);
    const stale = sessionFor(documentUri, "canvas", "stale", stalePost);
    publishVscodeMultiDocumentGraphPublication(documentUri, publication);
    registry.set(current);

    registry.replayLatestMultiDocumentGraphPublication(stale);
    registry.replayLatestMultiDocumentGraphPublication(current);

    expect(stalePost).not.toHaveBeenCalled();
    expect(currentPost).toHaveBeenCalledWith(publication);
    registry.clear();
  });

  it("does not send a replay when no publication is retained", () => {
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const postMessage = vi.fn();
    const session = sessionFor("file:///replay-without-publication.nui", "canvas", "canvas", postMessage);
    registry.set(session);

    registry.replayLatestMultiDocumentGraphPublication(session);

    expect(postMessage).not.toHaveBeenCalled();
    registry.clear();
  });

  it("keeps later publications on the normal live fan-out path after replay", () => {
    const documentUri = "file:///replay-followed-by-publication.nui";
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const canvasPost = vi.fn();
    const canvas = sessionFor(documentUri, "canvas", "canvas", canvasPost);
    registry.set(canvas);
    const firstPublication = {
      type: "multiDocumentGraphPublication" as const,
      documentVersion: 1,
      status: "building" as const,
      graph: null
    };
    const laterPublication = {
      type: "multiDocumentGraphPublication" as const,
      documentVersion: 2,
      status: "invalidated" as const,
      graph: null
    };
    publishVscodeMultiDocumentGraphPublication(documentUri, firstPublication);
    registry.replayLatestMultiDocumentGraphPublication(canvas);
    publishVscodeMultiDocumentGraphPublication(documentUri, laterPublication);

    expect(canvasPost.mock.calls.map(([message]) => message)).toEqual([
      firstPublication,
      firstPublication,
      laterPublication
    ]);
    registry.clear();
  });
});
