import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { printablePathsForLayout } from "../print/printGeometry";
import { resolvePrintLayout } from "../print/printLayout";
import { currentDocumentSnapshot, useCadDocumentStore } from "../state/cadDocumentStore";
import { defaultPrintExportFileName, defaultPrintExportPath } from "./printExportFileName";
import type { EvaluationResult } from "../types/geometry";

type ExportPrintSvgInput = {
  path: string;
  canvas: {
    widthMm: number;
    heightMm: number;
  };
  paths: ReturnType<typeof printablePathsForLayout>;
};

const ensureSvgFileName = (path: string) =>
  path.toLowerCase().endsWith(".svg") ? path : `${path}.svg`;

export const defaultPrintSvgFileName = ({
  layoutName,
  documentPath
}: {
  layoutName: string;
  documentPath: string | null;
}) => defaultPrintExportFileName({ layoutName, documentPath, extension: "svg" });

export const defaultPrintSvgPath = ({
  layoutName,
  documentPath
}: {
  layoutName: string;
  documentPath: string | null;
}) => defaultPrintExportPath({ layoutName, documentPath, extension: "svg" });

const exportPrintSvgDialog = (defaultPath: string) =>
  save({
    defaultPath,
    filters: [{ name: "SVG", extensions: ["svg"] }]
  });

export const exportPrintSvg = async (evaluation: EvaluationResult | undefined) => {
  if (!isTauriRuntime()) {
    throw new Error("SVG出力はTauri版でのみ利用できます。");
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
  const path = await exportPrintSvgDialog(defaultPrintSvgPath({
    layoutName: snapshot.printLayout.name,
    documentPath: state.currentFilePath
  }));
  if (!path) return;

  const input: ExportPrintSvgInput = {
    path: ensureSvgFileName(path),
    canvas: {
      widthMm: resolvedLayout.svgCanvasWidthMm,
      heightMm: resolvedLayout.svgCanvasHeightMm
    },
    paths: printablePathsForLayout({
      elements: snapshot.elements,
      evaluation,
      layout: snapshot.printLayout
    })
  };

  await invoke("export_print_svg", { input });
};
