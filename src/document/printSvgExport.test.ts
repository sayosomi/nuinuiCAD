import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { defaultPrintSvgFileName, defaultPrintSvgPath, exportPrintSvg } from "./printSvgExport";

const tauriCoreMock = vi.hoisted(() => ({ invoke: vi.fn() }));
const dialogMock = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
};

describe("printSvgExport", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    tauriCoreMock.invoke.mockReset();
    dialogMock.save.mockReset();
    setTauriRuntime();
  });

  it("uses the pattern file name and print layout name for the default SVG file name", () => {
    expect(defaultPrintSvgFileName({
      layoutName: "袖のみ",
      documentPath: "/tmp/pattern.nui"
    })).toBe("pattern_袖のみ.svg");
  });

  it("uses the pattern file directory for the default SVG path", () => {
    expect(defaultPrintSvgPath({
      layoutName: "袖のみ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("/tmp/basic bodice_袖のみ.svg");
  });

  it("falls back to layout when the print layout name is blank", () => {
    expect(defaultPrintSvgFileName({
      layoutName: " ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("basic bodice_layout.svg");
  });

  it("uses a generic default for unsaved documents and sanitizes invalid characters", () => {
    expect(defaultPrintSvgFileName({
      layoutName: "front/back:1",
      documentPath: null
    })).toBe("pattern_front_back_1.svg");
    expect(defaultPrintSvgFileName({
      layoutName: "",
      documentPath: null
    })).toBe("pattern_layout.svg");
  });

  it("exports the active layout rather than a legacy layout mirror", async () => {
    const state = useCadDocumentStore.getState();
    const first = { ...DEFAULT_PRINT_LAYOUT, id: "first", name: "First", outputKind: "svg" as const, svgCanvasWidthMm: 200 };
    const active = { ...DEFAULT_PRINT_LAYOUT, id: "active", name: "Active", outputKind: "svg" as const, svgCanvasWidthMm: 333 };
    state.commitDocumentChange({ printLayouts: [first, active], activePrintLayoutId: active.id });
    dialogMock.save.mockResolvedValue("/tmp/export");

    await exportPrintSvg(evaluateElements(useCadDocumentStore.getState().elements));

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("export_print_svg", expect.objectContaining({
      input: expect.objectContaining({
        path: "/tmp/export.svg",
        canvas: expect.objectContaining({ widthMm: 333 })
      })
    }));
  });
});
