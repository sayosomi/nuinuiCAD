import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
    showCanvasElementNames: true,
    showCanvasPoints: true,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
  });
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
  it("filters commands by recorded shortcut key", () => {
    render(<ShortcutSettingsDialog />);

    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });

    expect(screen.getByText("全体 / saveDocument")).toBeInTheDocument();
    expect(screen.queryByText("free point を追加")).not.toBeInTheDocument();
    expect(screen.getByLabelText("検索中のショートカットキー")).toHaveTextContent("Mod+s");
  });

  it("filters commands by shortcuts added in the current draft", () => {
    render(<ShortcutSettingsDialog />);

    const pointRow = rowForCommand("free point を追加");
    fireEvent.click(within(pointRow).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });

    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "p" });

    expect(screen.getByText("free point を追加")).toBeInTheDocument();
    expect(screen.queryByText("line を追加")).not.toBeInTheDocument();
  });

  it("cancels shortcut key search recording with Escape", () => {
    render(<ShortcutSettingsDialog />);

    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "キーで検索" })).toBeInTheDocument();
    expect(screen.queryByLabelText("検索中のショートカットキー")).not.toBeInTheDocument();
    expect(screen.getByText("free point を追加")).toBeInTheDocument();
  });

  it("combines command text and shortcut key filters", () => {
    render(<ShortcutSettingsDialog />);

    fireEvent.change(screen.getByLabelText("ショートカット設定を検索"), {
      target: { value: "名前" }
    });
    fireEvent.click(screen.getByRole("button", { name: "キーで検索" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });

    expect(screen.getByText("名前を付けて保存")).toBeInTheDocument();
    expect(screen.queryByText("全体 / saveDocument")).not.toBeInTheDocument();
  });

  it("records and auto-saves a shortcut for a command without a default", async () => {
    render(<ShortcutSettingsDialog />);

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
    render(<ShortcutSettingsDialog />);

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
    useCadStore.setState({ showShortcutSettings: true });

    await waitFor(() =>
      expect(within(rowForCommand("グループを追加")).getByText("Mod+Alt+g")).toBeInTheDocument()
    );
  });

  it("does not auto-save conflicting shortcuts", async () => {
    render(<ShortcutSettingsDialog />);

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
