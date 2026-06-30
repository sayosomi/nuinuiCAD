import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import { ShortcutSettingsDialog } from "./ShortcutSettingsDialog";

const resetStore = () => {
  useCadStore.setState({
    showShortcutSettings: true,
    shortcutSettings: { version: 1, overrides: [] },
    shortcutSettingsLoading: false,
    shortcutSettingsError: null,
    showShortcutHelp: false,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT
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
  it("records and saves a shortcut for a command without a default", async () => {
    render(<ShortcutSettingsDialog />);

    const row = rowForCommand("free point を追加");
    fireEvent.click(within(row).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

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

  it("blocks saving conflicting shortcuts", () => {
    render(<ShortcutSettingsDialog />);

    const pointRow = rowForCommand("free point を追加");
    fireEvent.click(within(pointRow).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });

    const lineRow = rowForCommand("line を追加");
    fireEvent.click(within(lineRow).getByText("キー追加"));
    fireEvent.keyDown(window, { key: "p" });

    expect(screen.getByText("1件のキー重複があります。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
