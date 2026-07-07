import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_CANVAS_VIEWPORT, DEFAULT_PRINT_PREVIEW_WINDOW, useCadStore } from "../state/useCadStore";
import { CommandPalette } from "./CommandPalette";

const resetStore = () => {
  useCadStore.setState({
    palette: defaultDocumentPalette(),
    showShortcutSettings: false,
    showPaletteSettings: false,
    showSelectionColorPicker: false,
    shortcutSettings: { version: 1, overrides: [] },
    shortcutSettingsLoading: false,
    shortcutSettingsError: null,
    showShortcutHelp: false,
    showCommandPalette: true,
    showPrintLayout: false,
    showPrintPreviewWindow: false,
    showCanvasElementNames: true,
    showCanvasPoints: true,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
  });
};

beforeEach(() => {
  resetStore();
  window.localStorage.clear();
});

describe("CommandPalette", () => {
  it("shows the current shortcut for command candidates", () => {
    render(<CommandPalette commandContext={{}} />);

    fireEvent.change(screen.getByLabelText("コマンドを検索"), {
      target: { value: "保存" }
    });

    const saveOption = screen.getByRole("option", { name: /保存Mod\+s/ });
    expect(within(saveOption).getByText("Mod+s")).toBeInTheDocument();
  });

  it("shows user-customized shortcuts in command candidates", () => {
    useCadStore.setState({
      shortcutSettings: {
        version: 1,
        overrides: [
          {
            bindingId: "global.saveDocument",
            chords: [{ key: "k", mod: true, alt: true, shift: false }]
          }
        ]
      }
    });

    render(<CommandPalette commandContext={{}} />);

    fireEvent.change(screen.getByLabelText("コマンドを検索"), {
      target: { value: "保存" }
    });

    const saveOption = screen.getByRole("option", { name: /保存Mod\+Alt\+k/ });
    expect(within(saveOption).getByText("Mod+Alt+k")).toBeInTheDocument();
    expect(within(saveOption).queryByText("Mod+s")).not.toBeInTheDocument();
  });
});
