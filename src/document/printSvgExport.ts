import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { printablePathsForLayout } from "../print/printGeometry";
import { resolvePrintLayout } from "../print/printLayout";
import { currentDocumentSnapshot, useCadDocumentStore } from "../state/cadDocumentStore";
import { fileNameFromPath } from "./documentFormat";
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

const sanitizeSvgBaseName = (name: string) => {
  const sanitized = Array.from(name.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || /[<>:"/\\|?*]/.test(character) ? "_" : character;
  }).join("");
  return sanitized.length > 0 ? sanitized : "pattern-svg";
};

export const defaultPrintSvgFileName = ({
  layoutName,
  documentPath
}: {
  layoutName: string;
  documentPath: string | null;
}) => {
  const trimmedLayoutName = layoutName.trim();
  if (trimmedLayoutName.length > 0) {
    return `${sanitizeSvgBaseName(trimmedLayoutName)}.svg`;
  }
  if (!documentPath) return "pattern-svg.svg";
  return `${sanitizeSvgBaseName(fileNameFromPath(documentPath).replace(/\.nuinui\.json$/i, ""))}.svg`;
};

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
  const path = await exportPrintSvgDialog(defaultPrintSvgFileName({
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
