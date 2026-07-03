import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { printablePathsForLayout } from "../print/printGeometry";
import { orientedPaperSize, resolvePrintLayout } from "../print/printLayout";
import { currentDocumentSnapshot, useCadDocumentStore } from "../state/cadDocumentStore";
import { fileNameFromPath } from "./documentFormat";
import type { EvaluationResult } from "../types/geometry";
import type { ResolvedPrintLayout } from "../print/printLayout";

type ExportPrintPdfInput = {
  path: string;
  layout: ResolvedPrintLayout;
  paper: {
    widthMm: number;
    heightMm: number;
  };
  paths: ReturnType<typeof printablePathsForLayout>;
};

const ensurePdfFileName = (path: string) =>
  path.toLowerCase().endsWith(".pdf") ? path : `${path}.pdf`;

const sanitizePdfBaseName = (name: string) => {
  const sanitized = Array.from(name.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || /[<>:"/\\|?*]/.test(character) ? "_" : character;
  }).join("");
  return sanitized.length > 0 ? sanitized : "pattern-print";
};

export const defaultPrintPdfFileName = ({
  layoutName,
  documentPath
}: {
  layoutName: string;
  documentPath: string | null;
}) => {
  const trimmedLayoutName = layoutName.trim();
  if (trimmedLayoutName.length > 0) {
    return `${sanitizePdfBaseName(trimmedLayoutName)}.pdf`;
  }
  if (!documentPath) return "pattern-print.pdf";
  return `${sanitizePdfBaseName(fileNameFromPath(documentPath).replace(/\.nuinui\.json$/i, ""))}.pdf`;
};

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
  const resolvedLayout = resolvePrintLayout({
    layout: snapshot.printLayout,
    elements: snapshot.elements,
    evaluation
  });
  const path = await exportPrintPdfDialog(defaultPrintPdfFileName({
    layoutName: snapshot.printLayout.name,
    documentPath: state.currentFilePath
  }));
  if (!path) return;

  const input: ExportPrintPdfInput = {
    path: ensurePdfFileName(path),
    layout: resolvedLayout,
    paper: orientedPaperSize(resolvedLayout),
    paths: printablePathsForLayout({
      elements: snapshot.elements,
      evaluation,
      layout: snapshot.printLayout
    })
  };

  await invoke("export_print_pdf", { input });
};
