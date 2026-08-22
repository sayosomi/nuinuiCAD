import { describe, expect, it } from "vitest";
import {
  VscodeWebviewSessionRegistry,
  type VscodeWebviewSessionBase
} from "./vscodeWebviewSession";

type TestSession = VscodeWebviewSessionBase & { id: string };

const sessionFor = (
  documentUri: string,
  surfaceKind: TestSession["surfaceKind"],
  id: string
): TestSession => ({
  id,
  documentUri,
  surfaceKind
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
});
