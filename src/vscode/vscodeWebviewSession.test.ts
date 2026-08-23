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
});
