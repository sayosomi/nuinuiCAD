import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DslDiagnostic } from "../dsl/dslTypes";
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

  it("merges compile, BindingIssue, and runtime diagnostics in that fixed order", () => {
    useCadDocumentStore.setState({
      diagnostics: [{ severity: "error", line: 1, column: 1, message: "compile" }],
      bindingIssueDiagnostics: [{ severity: "error", line: 2, column: 1, message: "binding-issue", code: "duplicate-binding" }]
    });
    const runtimeDiagnostics: DslDiagnostic[] = [
      { severity: "error", line: 3, column: 1, message: "runtime", code: "poisoned-binding", origin: "runtime" }
    ];
    render(<DocumentDiagnostics runtimeDiagnostics={runtimeDiagnostics} />);
    fireEvent.click(screen.getByRole("button", { name: "文書診断: エラー 3 件、警告 0 件" }));
    const region = screen.getByRole("region", { name: "文書診断" });
    const rowTexts = Array.from(region.children).map((child) => child.textContent);
    expect(rowTexts).toEqual(["1:1 compile", "2:1 binding-issue", "3:1 runtime"]);
  });

  it("navigates via onNavigate only for a diagnostic with a resolved navigationTarget", () => {
    const onNavigate = vi.fn();
    useCadDocumentStore.setState({
      bindingIssueDiagnostics: [
        {
          severity: "error",
          line: 5,
          column: 1,
          message: "重複しています",
          code: "duplicate-binding",
          bindingId: "binding:x",
          navigationTarget: { kind: "binding", bindingId: "binding:x" }
        }
      ]
    });
    render(<DocumentDiagnostics onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /文書診断/ }));
    const row = screen.getByRole("button", { name: "5:1 重複しています" });
    fireEvent.click(row);
    expect(onNavigate).toHaveBeenCalledWith({ kind: "binding", bindingId: "binding:x" });
  });

  it("renders a diagnostic without a navigationTarget as plain text, not a clickable row, even when onNavigate is supplied", () => {
    const onNavigate = vi.fn();
    useCadDocumentStore.setState({
      diagnostics: [{ severity: "error", line: 6, column: 1, message: "位置なし" }]
    });
    render(<DocumentDiagnostics onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /文書診断/ }));
    expect(screen.queryByRole("button", { name: "6:1 位置なし" })).not.toBeInTheDocument();
    expect(screen.getByText("6:1 位置なし").tagName).toBe("P");
  });
});
