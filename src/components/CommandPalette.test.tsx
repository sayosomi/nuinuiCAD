import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import { CommandPalette } from "./CommandPalette";

const resetStore = () => {
  useCadStore.setState({
    showShortcutSettings: false,
    shortcutSettings: { version: 1, overrides: [] },
    shortcutSettingsLoading: false,
    shortcutSettingsError: null,
    showShortcutHelp: false,
    showCommandPalette: true,
    showCanvasPointNames: true,
    showCanvasGeometryNames: false,
    showCanvasPoints: true,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
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
      target: { value: "元に戻す" }
    });

    const undoOption = screen.getByRole("option", { name: /元に戻すMod\+z/ });
    expect(within(undoOption).getByText("Mod+z")).toBeInTheDocument();
  });

  it("shows user-customized shortcuts in command candidates", () => {
    useCadStore.setState({
      shortcutSettings: {
        version: 1,
        overrides: [
          {
            bindingId: "normal.undo",
            chords: [{ key: "k", mod: true, alt: true, shift: false }]
          }
        ]
      }
    });

    render(<CommandPalette commandContext={{}} />);

    fireEvent.change(screen.getByLabelText("コマンドを検索"), {
      target: { value: "元に戻す" }
    });

    const undoOption = screen.getByRole("option", { name: /元に戻すMod\+Alt\+k/ });
    expect(within(undoOption).getByText("Mod+Alt+k")).toBeInTheDocument();
    expect(within(undoOption).queryByText("Mod+z")).not.toBeInTheDocument();
  });

  it("lists the Source Editor Canvas-pick command and its configured shortcut", () => {
    render(<CommandPalette commandContext={{}} />);

    fireEvent.change(screen.getByLabelText("コマンドを検索"), {
      target: { value: "Canvasで選択" }
    });

    const option = screen.getByRole("option", { name: /選択中の値をCanvasで選択Mod\+Shift\+p/ });
    expect(within(option).getByText("Mod+Shift+p")).toBeInTheDocument();
  });
});
