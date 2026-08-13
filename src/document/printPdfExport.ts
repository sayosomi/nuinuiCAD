import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { printableItemsForLayout } from "../print/printGeometry";
import { activePrintLayout, orientedPaperSize, resolvePrintLayout } from "../print/printLayout";
import { useCadDocumentStore } from "../state/cadDocumentStore";
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
  const layout = activePrintLayout(state.printLayouts, state.activePrintLayoutId);
  const numericBindingLookup = {
    numericBindings: state.doc.numericBindings,
    byKey: state.doc.statementMap.byKey,
    bindingVersions: state.doc.bindingVersions
  };
  const resolvedLayout = resolvePrintLayout({
    layout,
    elements: state.elements,
    evaluation,
    numericBindingLookup
  });
  const path = await exportPrintPdfDialog(defaultPrintPdfPath({
    layoutName: layout.name,
    documentPath: state.currentFilePath
  }));
  if (!path) return;

  const items = printableItemsForLayout({
    elements: state.elements,
    evaluation,
    layout,
    visibilityProfiles: state.visibilityProfiles,
    activeVisibilityProfileId: state.activeVisibilityProfileId,
    groupPrintEnabledLookup: {
      propertyBindings: state.doc.propertyBindings,
      byElementId: state.doc.statementMap.byElementId
    },
    printLayoutNumericBindingLookup: numericBindingLookup
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
