import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { DocumentDiagnostics } from "./DocumentDiagnostics";

describe("DocumentDiagnostics", () => {
  beforeEach(() => useCadDocumentStore.setState(initialCadDocumentState()));

  it("keeps a compact no-diagnostics indicator in the header", () => {
    render(<DocumentDiagnostics />);
    expect(screen.getByRole("button", { name: "文書診断なし" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes the diagnostic detail popover", () => {
    useCadDocumentStore.setState({
      diagnostics: [
        { severity: "error", line: 4, column: 8, message: "参照先がありません。" },
        { severity: "warning", line: 7, column: 1, message: "評価結果は古い可能性があります。" }
      ]
    });
    render(<DocumentDiagnostics />);

    const button = screen.getByRole("button", { name: "文書診断: エラー 1 件、警告 1 件" });
    fireEvent.click(button);
    expect(screen.getByRole("region", { name: "文書診断" })).toHaveTextContent("4:8 参照先がありません。");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "文書診断" })).not.toBeInTheDocument();
  });
});
