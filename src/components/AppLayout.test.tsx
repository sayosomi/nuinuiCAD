import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import { AppLayout } from "./AppLayout";

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    palette: defaultDocumentPalette(),
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    isParameterEditMode: false,
    selectedParameterKey: "name",
    showElementInfoPanel: true,
    isDependencyJumpMode: false,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activeExpressionInsertTarget: null,
    activeMeasurementInsertTarget: null,
    activePickCursor: null,
    selectedDependencyJumpIndex: 0,
    elementSearchQuery: "",
    elementSearchCursorId: null,
    elementSearchPickableOnly: false,
    showCanvasElementNames: true,
    showCanvasPoints: true,
    showShortcutHelp: false,
    showShortcutSettings: false,
    showPaletteSettings: false,
    showCommandRibbonSettings: false,
    showSelectionColorPicker: false,
    shortcutSettings: { version: 1, overrides: [] },
    shortcutSettingsLoading: false,
    shortcutSettingsError: null,
    commandRibbonSettings: null,
    commandRibbonSettingsLoading: false,
    commandRibbonSettingsError: null,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  });
};

const mockCanvasContext = () => ({
  arc: vi.fn(),
  bezierCurveTo: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn()
});

beforeEach(() => {
  resetStore();
  window.localStorage.clear();

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: 500
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 400
  });
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 500,
    bottom: 400,
    width: 500,
    height: 400,
    toJSON: () => ({})
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    mockCanvasContext() as unknown as CanvasRenderingContext2D
  );

  class ResizeObserverMock {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback([{ target } as ResizeObserverEntry], this);
    }

    disconnect() {
      return undefined;
    }

    unobserve() {
      return undefined;
    }
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

describe("AppLayout keyboard handling", () => {
  it.each(["d", "Delete", "Backspace"])("deletes the selected element with %s", (key) => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector(".canvas-viewport");
    if (!(viewport instanceof HTMLDivElement)) {
      throw new Error("Missing canvas viewport");
    }

    viewport.focus();
    fireEvent.keyDown(window, { key });

    expect(useCadStore.getState().elements.some((element) => element.id === sampleElements[0].id)).toBe(
      false
    );
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("deletes the selected element from the command palette delete query", async () => {
    const view = render(<AppLayout />);

    fireEvent.keyDown(window, { key: "/" });
    const input = await view.findByLabelText("コマンドを検索");
    fireEvent.change(input, { target: { value: "削除" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useCadStore.getState().elements.some((element) => element.id === sampleElements[0].id)).toBe(
      false
    );
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);
    expect(view.queryByRole("dialog", { name: "コマンドパレット" })).not.toBeInTheDocument();
  });

  it("selects the command palette query when the input is focused", async () => {
    const view = render(<AppLayout />);

    fireEvent.keyDown(window, { key: "/" });
    const input = await view.findByLabelText("コマンドを検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "削除" } });
    input.blur();
    input.focus();

    await waitFor(() => expect(input.selectionStart).toBe(0));
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("selects the default name after creating an element from a shortcut", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector(".canvas-viewport");
    if (!(viewport instanceof HTMLDivElement)) {
      throw new Error("Missing canvas viewport");
    }

    viewport.focus();
    fireEvent.keyDown(window, { key: "c" });

    const nameInput = await waitFor(() => {
      const input = view.container.querySelector(".right-panel .selected-parameter input");
      expect(input).toHaveFocus();
      return input;
    });
    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error("Missing name input");
    }

    expect(nameInput.selectionStart).toBe(0);
    expect(nameInput.selectionEnd).toBe(nameInput.value.length);
    expect(useCadStore.getState()).toMatchObject({
      selectedParameterKey: "name",
      isParameterEditMode: true
    });
  });

  it("toggles evaluation with a from the focused canvas", () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector(".canvas-viewport");
    if (!(viewport instanceof HTMLDivElement)) {
      throw new Error("Missing canvas viewport");
    }

    viewport.focus();
    fireEvent.keyDown(window, { key: "a" });

    expect(useCadStore.getState().elements[0].enabled).toBe(false);
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("uses saved shortcut settings for keyboard dispatch", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.shortcutSettings.v1",
      JSON.stringify({
        version: 1,
        overrides: [
          {
            bindingId: "normal.toggleSelectedElementVisibility",
            chords: [{ key: "h", mod: false, alt: false, shift: false }]
          }
        ]
      })
    );
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector(".canvas-viewport");
    if (!(viewport instanceof HTMLDivElement)) {
      throw new Error("Missing canvas viewport");
    }

    await waitFor(() =>
      expect(useCadStore.getState().shortcutSettings.overrides).toHaveLength(1)
    );

    viewport.focus();
    fireEvent.keyDown(window, { key: "h" });

    expect(useCadStore.getState().elements[0].visible).toBe(false);
    expect(useCadStore.getState().past).toHaveLength(1);
  });
});

describe("AppLayout left panel resizing", () => {
  it("loads the saved left panel width", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.layoutSettings.v1",
      JSON.stringify({ version: 1, leftPanelWidth: 520 })
    );
    const view = render(<AppLayout />);
    const shell = view.container.querySelector(".app-shell");
    if (!(shell instanceof HTMLElement)) {
      throw new Error("Missing app shell");
    }

    await waitFor(() => expect(shell.style.getPropertyValue("--left-panel-width")).toBe("520px"));
  });

  it("saves the left panel width after pointer resizing", async () => {
    const view = render(<AppLayout />);
    const shell = view.container.querySelector(".app-shell");
    if (!(shell instanceof HTMLElement)) {
      throw new Error("Missing app shell");
    }
    const handle = view.getByRole("separator", { name: "左パネル幅を変更" });

    fireEvent.pointerDown(handle, { button: 0, clientX: 320, pointerId: 1 });
    await waitFor(() => expect(shell).toHaveClass("is-resizing-left-panel"));
    fireEvent.pointerMove(window, { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 500, pointerId: 1 });

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.layoutSettings.v1") ?? "{}")).toEqual({
        version: 1,
        leftPanelWidth: 500,
        collapsedPrintPanelSections: ["variables"]
      })
    );
    expect(shell.style.getPropertyValue("--left-panel-width")).toBe("500px");
  });

  it("resets the left panel width with a double click", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.layoutSettings.v1",
      JSON.stringify({ version: 1, leftPanelWidth: 520 })
    );
    const view = render(<AppLayout />);
    const shell = view.container.querySelector(".app-shell");
    if (!(shell instanceof HTMLElement)) {
      throw new Error("Missing app shell");
    }
    const handle = view.getByRole("separator", { name: "左パネル幅を変更" });
    await waitFor(() => expect(shell.style.getPropertyValue("--left-panel-width")).toBe("520px"));

    fireEvent.doubleClick(handle);

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.layoutSettings.v1") ?? "{}")).toEqual({
        version: 1,
        leftPanelWidth: 320,
        collapsedPrintPanelSections: ["variables"]
      })
    );
    expect(shell.style.getPropertyValue("--left-panel-width")).toBe("320px");
  });
});

describe("AppLayout command ribbon", () => {
  it("loads the saved command ribbon position", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.commandRibbonSettings.v1",
      JSON.stringify({
        version: 1,
        ribbons: [
          {
            id: "custom",
            label: "Custom",
            x: 80,
            y: 24,
            orientation: "horizontal",
            iconSize: 20,
            buttons: [
              {
                id: "line",
                commandId: "addLine",
                icon: "slash",
                label: "Line",
                showLabel: true
              }
            ]
          }
        ]
      })
    );
    const view = render(<AppLayout />);

    const ribbon = await view.findByLabelText("コマンドリボン");
    const customRibbon = ribbon.querySelector(".command-ribbon");
    if (!(customRibbon instanceof HTMLElement)) {
      throw new Error("Missing command ribbon");
    }

    const positionedRibbon = customRibbon.parentElement;
    if (!(positionedRibbon instanceof HTMLElement)) {
      throw new Error("Missing positioned command ribbon");
    }

    expect(positionedRibbon.style.left).toBe("80px");
    expect(positionedRibbon.style.top).toBe("24px");
  });

  it("saves the command ribbon position after dragging its handle", async () => {
    const view = render(<AppLayout />);
    const handle = await view.findByRole("button", { name: "作図を移動" });

    fireEvent.pointerDown(handle, { button: 0, clientX: 250, clientY: 20, pointerId: 2 });
    await waitFor(() => expect(handle.closest(".command-ribbon")).toHaveClass("is-dragging"));
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 50, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 50, pointerId: 2 });

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons[0].x).toBeGreaterThan(0);
      expect(settings.ribbons[0].y).toBe(42);
    });
  });

  it("docks a floating command ribbon when dragging it onto the left-panel ribbon dock", async () => {
    const view = render(<AppLayout />);
    const dock = await view.findByLabelText("左ペインのコマンドリボン");
    dock.getBoundingClientRect = () => ({
      x: 0,
      y: 330,
      top: 330,
      left: 0,
      right: 320,
      bottom: 400,
      width: 320,
      height: 70,
      toJSON: () => ({})
    });
    const handle = await view.findByRole("button", { name: "作図を移動" });

    fireEvent.pointerDown(handle, { button: 0, clientX: 250, clientY: 20, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 40, clientY: 360, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientX: 40, clientY: 360, pointerId: 2 });

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons.find((ribbon: { id: string }) => ribbon.id === "drafting").dock).toBe(
        "leftPanelBottom"
      );
    });
  });

  it("undocks a left-panel command ribbon when dragging it onto the canvas", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector(".canvas-viewport");
    if (!(viewport instanceof HTMLDivElement)) {
      throw new Error("Missing canvas viewport");
    }
    viewport.getBoundingClientRect = () => ({
      x: 320,
      y: 0,
      top: 0,
      left: 320,
      right: 820,
      bottom: 400,
      width: 500,
      height: 400,
      toJSON: () => ({})
    });
    const handle = await view.findByRole("button", { name: "選択操作を移動" });

    fireEvent.pointerDown(handle, { button: 0, clientX: 40, clientY: 360, pointerId: 3 });
    fireEvent.pointerMove(handle, { clientX: 420, clientY: 60, pointerId: 3 });
    fireEvent.pointerUp(handle, { clientX: 420, clientY: 60, pointerId: 3 });

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      const ribbon = settings.ribbons.find((item: { id: string }) => item.id === "selection-actions");
      expect(ribbon).toMatchObject({ dock: "canvas", x: 100, y: 60 });
    });
  });

  it("dispatches commands from command ribbon buttons", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.commandRibbonSettings.v1",
      JSON.stringify({
        version: 1,
        ribbons: [
          {
            id: "custom",
            label: "Custom",
            x: 80,
            y: 24,
            orientation: "horizontal",
            iconSize: 16,
            buttons: [
              {
                id: "line",
                commandId: "addLine",
                icon: "slash",
                label: "Line",
                showLabel: true
              }
            ]
          }
        ]
      })
    );
    const initialCount = useCadStore.getState().elements.length;
    const view = render(<AppLayout />);
    const button = await view.findByRole("button", { name: "Line" });

    fireEvent.click(button);

    expect(useCadStore.getState().elements).toHaveLength(initialCount + 1);
  });

  it("saves command ribbon icon size from settings dialog", async () => {
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "作図を移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    const sizeSelect = await view.findByLabelText("アイコンサイズ");
    fireEvent.change(sizeSelect, { target: { value: "24" } });
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons[0].iconSize).toBe(24);
    });
    expect(useCadStore.getState().commandRibbonSettings?.ribbons[0].iconSize).toBe(24);
  });

  it("edits the left-panel docked ribbon placement from settings dialog", async () => {
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "選択操作を移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    const ribbonList = await view.findByRole("listbox", { name: "リボン" });
    fireEvent.click(within(ribbonList).getAllByRole("button", { name: /選択操作/ })[0]);
    fireEvent.change(view.getByLabelText("配置"), { target: { value: "canvas" } });
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      const ribbon = settings.ribbons.find((item: { id: string }) => item.id === "selection-actions");
      expect(ribbon.dock).toBe("canvas");
    });
  });

  it("reorders command ribbons from settings dialog", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.commandRibbonSettings.v1",
      JSON.stringify({
        version: 1,
        ribbons: [
          {
            id: "first",
            label: "First",
            x: 20,
            y: 20,
            orientation: "horizontal",
            iconSize: 16,
            buttons: [
              { id: "line", commandId: "addLine", icon: "slash", label: "Line", showLabel: true }
            ]
          },
          {
            id: "second",
            label: "Second",
            x: 20,
            y: 70,
            orientation: "horizontal",
            iconSize: 16,
            buttons: [
              { id: "curve", commandId: "addBezierCurve", icon: "spline", label: "Curve", showLabel: true }
            ]
          }
        ]
      })
    );
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "Firstを移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    fireEvent.click(await view.findByRole("button", { name: "Firstを下へ" }));
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons.map((ribbon: { id: string }) => ribbon.id)).toEqual([
        "second",
        "first",
        "selection-actions"
      ]);
    });
  });

  it("reorders command ribbon buttons from settings dialog", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.commandRibbonSettings.v1",
      JSON.stringify({
        version: 1,
        ribbons: [
          {
            id: "custom",
            label: "Custom",
            x: 20,
            y: 20,
            orientation: "horizontal",
            iconSize: 16,
            buttons: [
              { id: "line", commandId: "addLine", icon: "slash", label: "Line", showLabel: true },
              { id: "curve", commandId: "addBezierCurve", icon: "spline", label: "Curve", showLabel: true }
            ]
          }
        ]
      })
    );
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "Customを移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    fireEvent.click(await view.findByRole("button", { name: "Lineを後へ" }));
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons[0].buttons.map((button: { id: string }) => button.id)).toEqual([
        "curve",
        "line"
      ]);
    });
  });

  it("changes a ribbon button command and icon from picker controls", async () => {
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "作図を移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    fireEvent.change(await view.findByLabelText("コマンドを検索"), { target: { value: "保存" } });
    fireEvent.click(await view.findByRole("option", { name: "保存を適用" }));
    fireEvent.change(view.getByLabelText("アイコンを検索"), { target: { value: "保存" } });
    fireEvent.click(view.getByRole("button", { name: "保存 アイコン" }));
    fireEvent.change(view.getByLabelText("アイコン色"), { target: { value: "teal" } });
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons[0].buttons[0]).toMatchObject({
        commandId: "saveDocument",
        icon: "save",
        iconColor: "teal",
        label: "保存"
      });
    });
  });

  it("applies a command ribbon command candidate from the keyboard", async () => {
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "作図を移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    const commandSearch = await view.findByLabelText("コマンドを検索");
    fireEvent.change(commandSearch, { target: { value: "保存" } });
    fireEvent.keyDown(commandSearch, { key: "Enter" });
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons[0].buttons[0]).toMatchObject({
        commandId: "saveDocument",
        label: "保存"
      });
    });
  });

  it("adds a command ribbon button from the command candidate add button", async () => {
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "作図を移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    fireEvent.change(await view.findByLabelText("コマンドを検索"), { target: { value: "保存" } });
    fireEvent.click(await view.findByRole("button", { name: "保存を追加" }));
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const settings = JSON.parse(
        window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1") ?? "{}"
      );
      expect(settings.ribbons[0].buttons).toHaveLength(14);
      expect(settings.ribbons[0].buttons[13]).toMatchObject({
        commandId: "saveDocument",
        label: "保存"
      });
    });
  });

  it("keeps command ribbon settings panes independently scrollable", async () => {
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "作図を移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });

    const dialog = await view.findByRole("dialog", { name: "コマンドリボン設定" });
    expect(dialog.querySelector(".command-ribbon-settings-body")).toBeTruthy();
    expect(dialog.querySelector(".command-ribbon-settings-sidebar")).toBeTruthy();
    expect(dialog.querySelector(".command-ribbon-settings-workspace")).toBeTruthy();
    expect(dialog.querySelector(".command-ribbon-settings-inspector")).toBeTruthy();
    expect(dialog.querySelector(".command-ribbon-icon-grid")).toBeTruthy();
    expect(view.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("keeps command ribbon settings unchanged when cancelling edits", async () => {
    const view = render(<AppLayout />);
    await view.findByRole("button", { name: "作図を移動" });

    act(() => {
      dispatchCommand("openCommandRibbonSettings");
    });
    const sizeSelect = await view.findByLabelText("アイコンサイズ");
    fireEvent.change(sizeSelect, { target: { value: "24" } });
    fireEvent.click(view.getByRole("button", { name: "キャンセル" }));

    expect(useCadStore.getState().commandRibbonSettings?.ribbons[0].iconSize).toBe(16);
    expect(window.localStorage.getItem("nuinuiCAD.commandRibbonSettings.v1")).toBeNull();
  });
});
