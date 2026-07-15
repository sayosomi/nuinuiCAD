import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { defaultPrintPdfFileName, defaultPrintPdfPath, exportPrintPdf } from "./printPdfExport";

const tauriCoreMock = vi.hoisted(() => ({ invoke: vi.fn() }));
const dialogMock = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
};

describe("printPdfExport", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    tauriCoreMock.invoke.mockReset();
    dialogMock.save.mockReset();
    setTauriRuntime();
  });

  it("uses the pattern file name and print layout name for the default PDF file name", () => {
    expect(defaultPrintPdfFileName({
      layoutName: "袖のみ",
      documentPath: "/tmp/pattern.nui"
    })).toBe("pattern_袖のみ.pdf");
  });

  it("uses the pattern file directory for the default PDF path", () => {
    expect(defaultPrintPdfPath({
      layoutName: "袖のみ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("/tmp/basic bodice_袖のみ.pdf");
  });

  it("falls back to layout when the print layout name is blank", () => {
    expect(defaultPrintPdfFileName({
      layoutName: " ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("basic bodice_layout.pdf");
  });

  it("uses a generic default for unsaved documents and sanitizes invalid characters", () => {
    expect(defaultPrintPdfFileName({
      layoutName: "front/back:1",
      documentPath: null
    })).toBe("pattern_front_back_1.pdf");
    expect(defaultPrintPdfFileName({
      layoutName: "",
      documentPath: null
    })).toBe("pattern_layout.pdf");
  });

  it("exports the active layout rather than a legacy layout mirror", async () => {
    const state = useCadDocumentStore.getState();
    const first = { ...DEFAULT_PRINT_LAYOUT, id: "first", name: "First", columns: 1 };
    const active = { ...DEFAULT_PRINT_LAYOUT, id: "active", name: "Active", columns: 3 };
    state.commitDocumentChange({ printLayouts: [first, active], activePrintLayoutId: active.id });
    dialogMock.save.mockResolvedValue("/tmp/export");

    await exportPrintPdf(evaluateElements(useCadDocumentStore.getState().elements));

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("export_print_pdf", expect.objectContaining({
      input: expect.objectContaining({
        path: "/tmp/export.pdf",
        layout: expect.objectContaining({ columns: 3 })
      })
    }));
  });
});
