import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_CANVAS_VIEWPORT, DEFAULT_PRINT_PREVIEW_WINDOW, useCadStore } from "../state/useCadStore";
import { ShortcutSettingsDialog } from "./ShortcutSettingsDialog";

const resetStore = () => {
  useCadStore.setState({
    palette: defaultDocumentPalette(),
    showShortcutSettings: true,
    showPaletteSettings: false,
    showSelectionColorPicker: false,
    shortcutSettings: { version: 1, overrides: [] },
    shortcutSettingsLoading: false,
    shortcutSettingsError: null,
    showShortcutHelp: false,
    showCommandPalette: false,
    showPrintLayout: false,
    showPrintPreviewWindow: false,
    showCanvasPointNames: true,
    showCanvasGeometryNames: false,
    showCanvasPoints: true,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
  });
};

// ShortcutSettingsDialog defers its initial search-field focus to a real
// requestAnimationFrame (which itself schedules a second, nested frame via
// selectTextInputValue). trackAnimationFrames wraps the real rAF - it never
// runs a callback early || synchronously - so it can count every frame that
// gets scheduled, including ones registered from inside another frame's own
// callback, && flush() only resolves once all of them have actually fired.
const trackAnimationFrames = () => {
  let pendingFrames = 0;
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const spy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingFrames += 1;
    return nativeRequestAnimationFrame((time) => {
      pendingFrames -= 1;
      callback(time);
    });
  });
  const flush = async () => {
    await act(async () => {
      while (pendingFrames > 0) {
        await new Promise<void>((resolve) => nativeRequestAnimationFrame(() => resolve()));
      }
    });
  };
  return { flush, restore: () => spy.mockRestore() };
};

const renderDialog = async () => {
  const frames = trackAnimationFrames();
  render(<ShortcutSettingsDialog />);
  try {
    await frames.flush();
  } finally {
    frames.restore();
  }
};

const rowForCommand = (label: string) => {
  const labelElement = screen.getByText(label);
  const row = labelElement.closest(".shortcut-settings-row");
  if (!row) throw new Error(`Missing row for ${label}`);
  return row as HTMLElement;
};

beforeEach(() => {
  resetStore();
  window.localStorage.clear();
});

describe("ShortcutSettingsDialog", () => {
  it("focuses the command search field when opened", async () => {
    await renderDialog();

    await waitFor(() =>
      expect(screen.getByLabelText("ショートカット設定を検索")).toHaveFocus()
    );
  });

  it("does not focus the search field until the deferred frame actually runs", async () => {
    const frames = trackAnimationFrames();
    try {
      render(<ShortcutSettingsDialog />);
      const input = screen.getByLabelText("ショートカット設定を検索");
      expect(input).not.toHaveFocus();

      await frames.flush();
      expect(input).toHaveFocus();
    } finally {
      frames.restore();
    }
  });

  it("filters commands by recorded shortcut key", async () => {
    await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });

    expect(screen.getByText("フォーカス横断 / saveDocument")).toBeInTheDocument();
    expect(screen.queryByText("free point を追加")).not.toBeInTheDocument();
    expect(screen.getByLabelText("検索中のショートカットキー")).toHaveTextContent("Mod+s");
  });

  it("filters commands by shortcuts added in the current draft", async () => {
    await renderDialog();

    const pointRow = rowForCommand("free point を追加");
    fireEvent.click(within(pointRow).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });
    // persistSettings kicks off a multi-step (catch/then/then/catch/finally)
    // save promise chain here. A macrotask tick guarantees every microtask
    // in that chain has drained before we continue, so it can't settle
    // later, outside any act(), during a subsequent test.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "p" });

    expect(screen.getByText("free point を追加")).toBeInTheDocument();
    expect(screen.queryByText("line を追加")).not.toBeInTheDocument();
  });

  it("cancels shortcut key search recording with Escape", async () => {
    await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "キーで検索" })).toBeInTheDocument();
    expect(screen.queryByLabelText("検索中のショートカットキー")).not.toBeInTheDocument();
    expect(screen.getByText("free point を追加")).toBeInTheDocument();
  });

  it("combines command text and shortcut key filters", async () => {
    await renderDialog();

    fireEvent.change(screen.getByLabelText("ショートカット設定を検索"), {
      target: { value: "名前" }
    });
    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });

    expect(screen.getByText("名前を付けて保存")).toBeInTheDocument();
    expect(screen.queryByText("全体 / saveDocument")).not.toBeInTheDocument();
  });

  it("records and auto-saves a shortcut for a command without a default", async () => {
    await renderDialog();

    const row = rowForCommand("free point を追加");
    fireEvent.click(within(row).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.shortcutSettings.v1") ?? "{}")).toEqual({
        version: 1,
        overrides: [
          {
            bindingId: "normal.addFreePoint",
            chords: [{ key: "p", mod: false, alt: false, shift: false }]
          }
        ]
      })
    );
  });

  it("keeps auto-saved shortcuts after closing and reopening the dialog", async () => {
    await renderDialog();

    const row = rowForCommand("グループを追加");
    fireEvent.click(within(row).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "g", metaKey: true, altKey: true });

    await waitFor(() =>
      expect(useCadStore.getState().shortcutSettings.overrides).toEqual([
        {
          bindingId: "normal.addGroup",
          chords: [{ key: "g", mod: true, alt: true, shift: false }]
        }
      ])
    );

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    act(() => { useCadStore.setState({ showShortcutSettings: true }); });

    await waitFor(() =>
      expect(within(rowForCommand("グループを追加")).getByText("Mod+Alt+g")).toBeInTheDocument()
    );
  });

  it("does not auto-save conflicting shortcuts", async () => {
    await renderDialog();

    const pointRow = rowForCommand("free point を追加");
    fireEvent.click(within(pointRow).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.shortcutSettings.v1") ?? "{}")).toEqual({
        version: 1,
        overrides: [
          {
            bindingId: "normal.addFreePoint",
            chords: [{ key: "p", mod: false, alt: false, shift: false }]
          }
        ]
      })
    );

    const lineRow = rowForCommand("line を追加");
    fireEvent.click(within(lineRow).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });

    expect(screen.getByText("1件のキー重複があります。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.shortcutSettings.v1") ?? "{}")).toEqual({
      version: 1,
      overrides: [
        {
          bindingId: "normal.addFreePoint",
          chords: [{ key: "p", mod: false, alt: false, shift: false }]
        }
      ]
    });
  });
});
