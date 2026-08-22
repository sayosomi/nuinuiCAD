import { describe, expect, it } from "vitest";
import {
  onVscodeWebviewSessionRegistryEvent,
  VscodeWebviewSessionRegistry,
  type VscodeWebviewSessionBase,
  type VscodeWebviewSessionRegistryEvent
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

  it("publishes replacement and removal events for Canvas readiness adapters", () => {
    const registry = new VscodeWebviewSessionRegistry<TestSession>();
    const events: VscodeWebviewSessionRegistryEvent[] = [];
    const stop = onVscodeWebviewSessionRegistryEvent((event) => events.push(event));
    const first = sessionFor("file:///pattern.nui", "canvas", "first");
    const replacement = sessionFor("file:///pattern.nui", "canvas", "replacement");

    registry.set(first);
    registry.set(replacement);
    registry.delete("file:///pattern.nui", "canvas");
    stop();
    registry.set(sessionFor("file:///other.nui", "canvas", "ignored"));

    expect(events).toEqual([
      { type: "set", session: first },
      { type: "delete", session: first },
      { type: "set", session: replacement },
      { type: "delete", session: replacement }
    ]);
  });
});
