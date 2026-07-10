import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { printableItemsForLayout } from "../print/printGeometry";
import { orientedPaperSize, resolvePrintLayout } from "../print/printLayout";
import { currentDocumentSnapshot, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { defaultPrintExportFileName, defaultPrintExportPath } from "./printExportFileName";
import type { EvaluationResult } from "../types/geometry";
import type { ResolvedPrintLayout } from "../print/printLayout";

type ExportPrintPdfInput = {
  path: string;
  layout: ResolvedPrintLayout;
  paper: {
    widthMm: number;
    heightMm: number;
  };
  paths: ReturnType<typeof printableItemsForLayout>["paths"];
  texts: ReturnType<typeof printableItemsForLayout>["texts"];
};

const ensurePdfFileName = (path: string) =>
  path.toLowerCase().endsWith(".pdf") ? path : `${path}.pdf`;

export const defaultPrintPdfFileName = ({
  layoutName,
  documentPath
}: {
  layoutName: string;
  documentPath: string | null;
}) => defaultPrintExportFileName({ layoutName, documentPath, extension: "pdf" });

export const defaultPrintPdfPath = ({
  layoutName,
  documentPath
}: {
  layoutName: string;
  documentPath: string | null;
}) => defaultPrintExportPath({ layoutName, documentPath, extension: "pdf" });

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
  const snapshot = currentDocumentSnapshot(state, useCadUiStore.getState());
  const resolvedLayout = resolvePrintLayout({
    layout: snapshot.printLayout,
    elements: snapshot.elements,
    evaluation
  });
  const path = await exportPrintPdfDialog(defaultPrintPdfPath({
    layoutName: snapshot.printLayout.name,
    documentPath: state.currentFilePath
  }));
  if (!path) return;

  const items = printableItemsForLayout({
    elements: snapshot.elements,
    evaluation,
    layout: snapshot.printLayout,
    visibilityProfiles: snapshot.visibilityProfiles,
    activeVisibilityProfileId: snapshot.activeVisibilityProfileId
  });
  const input: ExportPrintPdfInput = {
    path: ensurePdfFileName(path),
    layout: resolvedLayout,
    paper: orientedPaperSize(resolvedLayout),
    paths: items.paths,
    texts: items.texts
  };

  await invoke("export_print_pdf", { input });
};
