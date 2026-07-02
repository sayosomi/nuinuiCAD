import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { printablePathsForLayout } from "../print/printGeometry";
import { orientedPaperSize } from "../print/printLayout";
import { currentDocumentSnapshot, useCadDocumentStore } from "../state/cadDocumentStore";
import type { EvaluationResult, PrintLayout } from "../types/geometry";

type ExportPrintPdfInput = {
  path: string;
  layout: PrintLayout;
  paper: {
    widthMm: number;
    heightMm: number;
  };
  paths: ReturnType<typeof printablePathsForLayout>;
};

const ensurePdfFileName = (path: string) =>
  path.toLowerCase().endsWith(".pdf") ? path : `${path}.pdf`;

const exportPrintPdfDialog = (defaultPath: string) =>
  save({
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });

export const exportPrintPdf = async (evaluation: EvaluationResult | undefined) => {
  if (!isTauriRuntime()) {
    throw new Error("PDF出力はTauri版でのみ利用できます。");
  }
  if (!evaluation) {
    throw new Error("評価結果がまだありません。");
  }

  const state = useCadDocumentStore.getState();
  const snapshot = currentDocumentSnapshot(state);
  const path = await exportPrintPdfDialog("pattern-print.pdf");
  if (!path) return;

  const input: ExportPrintPdfInput = {
    path: ensurePdfFileName(path),
    layout: snapshot.printLayout,
    paper: orientedPaperSize(snapshot.printLayout),
    paths: printablePathsForLayout({
      elements: snapshot.elements,
      evaluation,
      layout: snapshot.printLayout
    })
  };

  await invoke("export_print_pdf", { input });
};
