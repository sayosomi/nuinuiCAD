import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";

describe("ShortcutHelpOverlay", () => {
  beforeEach(() => {
    useCadUiStore.setState(initialCadUiState());
  });

  it("labels the active Pick shortcut mode as Pick Mode", () => {
    useCadUiStore.setState({ showShortcutHelp: true });

    render(<ShortcutHelpOverlay isPickMode />);

    expect(screen.getByText("Pick Mode")).toBeInTheDocument();
  });
});
