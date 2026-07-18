import { act, createRef } from "react";
import { fireEvent, render, screen as globalScreen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { PaletteSettingsDialog } from "./PalettePanel";
import { SourceEditorPane } from "./SourceEditorPane";
import { VisibilityProfileSettingsDialog } from "./VisibilityProfilePanel";

describe("SourceEditorPane", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("mounts outside AppLayout and applies a model patch without resetting the full document", () => {
    useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)\npoint B = coordinate(x: 1 y: 1)", "test");
    const ref = createRef<SourceEditorHandle>();
    const screen = render(<SourceEditorPane ref={ref} />);
    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "A" ? ({ ...element, locked: true } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });

    expect(ref.current?.getText()).toBe(
      "nui 2\npoint A = coordinate(\n  x: 0\n  y: 0\n  locked: true\n)\npoint B = coordinate(x: 1 y: 1)"
    );
    screen.unmount();
  });

  it("rejects external model mutations during composition and leaves no stale preview", () => {
    useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)", "test");
    const ref = createRef<SourceEditorHandle>();
    const screen = render(<SourceEditorPane ref={ref} />);
    const content = screen.container.querySelector(".cm-content");
    expect(content).not.toBeNull();
    fireEvent.compositionStart(content!);

    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "A" ? ({ ...element, locked: true } as CadElement) : element
    );
    const result = useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    expect(ref.current?.getText()).toBe("nui 2\npoint A = coordinate(x: 0 y: 0)");
    expect(result).toEqual({ status: "rejected", reason: "composition" });
    expect(useCadDocumentStore.getState().previewElements).toBeNull();

    fireEvent.compositionEnd(content!);
    expect(ref.current?.getText()).toBe("nui 2\npoint A = coordinate(x: 0 y: 0)");
    screen.unmount();
  });

  it("unsubscribes on destroy", () => {
    const screen = render(<SourceEditorPane />);
    screen.unmount();
    expect(() => useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)", "test")).not.toThrow();
  });

  it("shows the current document file state in the header", () => {
    useCadDocumentStore.setState({
      currentFilePath: "/tmp/pattern.nui",
      dirtySinceSave: true
    });

    const screen = render(<SourceEditorPane />);

    expect(globalScreen.getByText("pattern.nui")).toBeInTheDocument();
    expect(globalScreen.getByText("未保存の変更")).toBeInTheDocument();
    screen.unmount();
  });

  it("opens palette settings from the header button", () => {
    const screen = render(
      <>
        <SourceEditorPane />
        <PaletteSettingsDialog />
      </>
    );

    expect(globalScreen.queryByRole("dialog", { name: "パレット設定" })).not.toBeInTheDocument();

    fireEvent.click(globalScreen.getByRole("button", { name: "パレット" }));

    expect(globalScreen.getByRole("dialog", { name: "パレット設定" })).toBeInTheDocument();
    screen.unmount();
  });

  it("opens visibility profile settings from the header button", () => {
    const screen = render(
      <>
        <SourceEditorPane />
        <VisibilityProfileSettingsDialog />
      </>
    );

    expect(globalScreen.queryByRole("dialog", { name: "表示プロファイル" })).not.toBeInTheDocument();

    fireEvent.click(globalScreen.getByRole("button", { name: "表示プロファイル" }));

    expect(globalScreen.getByRole("dialog", { name: "表示プロファイル" })).toBeInTheDocument();
    screen.unmount();
  });

  it("renders the docked command ribbon from command ribbon settings", () => {
    useCadUiStore.getState().setCommandRibbonSettings(defaultCommandRibbonSettings());
    const screen = render(<SourceEditorPane />);

    expect(globalScreen.getByLabelText("Source Editorのコマンドリボン")).toBeInTheDocument();
    expect(globalScreen.getByRole("button", { name: "選択操作を移動" })).toBeInTheDocument();
    expect(globalScreen.getByRole("button", { name: "上へ" })).toBeInTheDocument();
    screen.unmount();
  });

  it("dispatches selected element commands from the docked command ribbon", () => {
    useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)\npoint B = coordinate(x: 1 y: 1)", "test");
    const elements = useCadDocumentStore.getState().elements;
    const target = elements.find((element) => element.name === "A");
    expect(target).toBeDefined();
    useCadUiStore.setState({
      selectedElementId: target!.id,
      selectedElementIds: [target!.id],
      selectionAnchorElementId: target!.id
    });
    useCadUiStore.getState().setCommandRibbonSettings(defaultCommandRibbonSettings());
    const screen = render(<SourceEditorPane />);

    fireEvent.click(globalScreen.getByRole("button", { name: "複製" }));

    expect(useCadDocumentStore.getState().elements).toHaveLength(elements.length + 1);
    screen.unmount();
  });

  it("disables only ordering actions in the docked command ribbon while the search panel is open", () => {
    useCadUiStore.getState().setCommandRibbonSettings(defaultCommandRibbonSettings());
    const ref = createRef<SourceEditorHandle>();
    const screen = render(<SourceEditorPane ref={ref} />);

    expect(globalScreen.getByRole("button", { name: "上へ" })).toBeEnabled();

    act(() => ref.current?.focusSearch());

    expect(globalScreen.getByRole("button", { name: "上へ" })).toBeDisabled();
    expect(globalScreen.getByRole("button", { name: "下へ" })).toBeDisabled();
    expect(globalScreen.getByRole("button", { name: "複製" })).toBeEnabled();
    expect(globalScreen.getByRole("button", { name: "削除" })).toBeEnabled();
    screen.unmount();
  });
});
