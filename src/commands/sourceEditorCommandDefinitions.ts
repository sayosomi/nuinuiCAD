import { sourceEditSession } from "../editor/sourceEditSession";
import type { Command, CommandId } from "./commandTypes";

export const sourceEditorCommandDefinitions = {
  stepSourceValueForward: {
    id: "stepSourceValueForward",
    label: "Source Editorの値を次へ",
    palette: { order: 49, keywords: ["source", "value", "step", "次", "値", "増やす"] },
    flushPolicy: "editor-owned",
    run: () => sourceEditSession.stepValue(1)
  },
  stepSourceValueBackward: {
    id: "stepSourceValueBackward",
    label: "Source Editorの値を前へ",
    palette: { order: 50, keywords: ["source", "value", "step", "前", "値", "減らす"] },
    flushPolicy: "editor-owned",
    run: () => sourceEditSession.stepValue(-1)
  },
  startCanvasPickFromSourceSelection: {
    id: "startCanvasPickFromSourceSelection",
    label: "選択中の値をCanvasで選択",
    palette: { order: 17, keywords: ["source", "canvas", "pick", "value", "参照", "選択", "キャンバス"] },
    run: () => sourceEditSession.startPickFromSelection()
  }
} satisfies Partial<Record<CommandId, Command>>;
