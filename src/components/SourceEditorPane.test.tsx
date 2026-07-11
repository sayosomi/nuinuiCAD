import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement } from "../types/geometry";
import { SourceEditorPane } from "./SourceEditorPane";

describe("SourceEditorPane", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("mounts outside AppLayout and applies a model patch without resetting the full document", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\npoint B = (1, 1)", "test");
    const ref = createRef<SourceEditorHandle>();
    const screen = render(<SourceEditorPane ref={ref} />);
    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "A" ? ({ ...element, locked: true } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });

    expect(ref.current?.getText()).toBe("nui 1\npoint A = (0, 0) locked=true\npoint B = (1, 1)");
    screen.unmount();
  });

  it("rejects external model mutations during composition and leaves no stale preview", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");
    const ref = createRef<SourceEditorHandle>();
    const screen = render(<SourceEditorPane ref={ref} />);
    const content = screen.container.querySelector(".cm-content");
    expect(content).not.toBeNull();
    fireEvent.compositionStart(content!);

    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "A" ? ({ ...element, locked: true } as CadElement) : element
    );
    const result = useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    expect(ref.current?.getText()).toBe("nui 1\npoint A = (0, 0)");
    expect(result).toEqual({ status: "rejected", reason: "composition" });
    expect(useCadDocumentStore.getState().previewElements).toBeNull();

    fireEvent.compositionEnd(content!);
    expect(ref.current?.getText()).toBe("nui 1\npoint A = (0, 0)");
    screen.unmount();
  });

  it("unsubscribes on destroy", () => {
    const screen = render(<SourceEditorPane />);
    screen.unmount();
    expect(() => useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test")).not.toThrow();
  });
});
