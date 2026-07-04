import {
  applyNumericExpressionReference,
  closeExpressionInsertTray,
  insertSelectedMeasurement,
  insertNumericExpressionSnippet,
  applyPickedLine,
  applyPickedNumericReference,
  applyPickedPoint,
  applySelectedPickCandidate,
  cancelLinePick,
  cancelNumericReferencePick,
  cancelPointPick,
  selectPickCandidateByOffset,
  selectPickOptionByOffset,
  setMeasurementInsertMode,
  setNumericReferencePickProperty,
  startLineAndPointPick,
  startLineEndpointPairPick,
  startLinePick,
  startMeasurementLinePick,
  startMeasurementPointPick,
  startNumericReferenceInsertPick,
  startNumericReferencePick,
  toggleExpressionInsertTray,
  startPointPick
} from "./pickCommands";
import type { Command, CommandId } from "./commandTypes";

export const pickCommandDefinitions = {
  applyNumericExpressionReference: {
    id: "applyNumericExpressionReference",
    label: "数値参照式を採用",
    run: (context) => applyNumericExpressionReference(context)
  },
  insertNumericExpressionSnippet: {
    id: "insertNumericExpressionSnippet",
    label: "数値式へ挿入",
    run: (context) => insertNumericExpressionSnippet(context)
  },
  toggleExpressionInsertTray: {
    id: "toggleExpressionInsertTray",
    label: "式の挿入候補を開閉",
    run: (context) => toggleExpressionInsertTray(context)
  },
  closeExpressionInsertTray: {
    id: "closeExpressionInsertTray",
    label: "式の挿入候補を閉じる",
    run: () => closeExpressionInsertTray()
  },
  setMeasurementInsertMode: {
    id: "setMeasurementInsertMode",
    label: "挿入する測定を切り替え",
    run: (context) => setMeasurementInsertMode(context)
  },
  startMeasurementPointPick: {
    id: "startMeasurementPointPick",
    label: "測定用の点を選択",
    run: (context) => startMeasurementPointPick(context)
  },
  startMeasurementLinePick: {
    id: "startMeasurementLinePick",
    label: "測定用の線を選択",
    run: (context) => startMeasurementLinePick(context)
  },
  insertSelectedMeasurement: {
    id: "insertSelectedMeasurement",
    label: "選択した測定を式に挿入",
    run: (context) => insertSelectedMeasurement(context)
  },
  startNumericReferencePick: {
    id: "startNumericReferencePick",
    label: "数値選択モードに入る",
    palette: { order: 16, keywords: ["number", "reference", "measurement", "数値", "参照", "選択"] },
    run: () => startNumericReferencePick()
  },
  startNumericReferenceInsertPick: {
    id: "startNumericReferenceInsertPick",
    label: "線・曲線プロパティを式に挿入",
    run: (context) => startNumericReferenceInsertPick(context)
  },
  setNumericReferencePickProperty: {
    id: "setNumericReferencePickProperty",
    label: "数値参照プロパティを切り替え",
    run: (context) => setNumericReferencePickProperty(context)
  },
  applyPickedNumericReference: {
    id: "applyPickedNumericReference",
    label: "選択した数値を設定",
    run: (context) => applyPickedNumericReference(context)
  },
  cancelNumericReferencePick: {
    id: "cancelNumericReferencePick",
    label: "数値選択をキャンセル",
    run: () => cancelNumericReferencePick()
  },
  selectNextPickCandidate: {
    id: "selectNextPickCandidate",
    label: "次の選択候補へ",
    shortcuts: [{ keys: "ArrowDown" }],
    run: () => selectPickCandidateByOffset(1)
  },
  selectPreviousPickCandidate: {
    id: "selectPreviousPickCandidate",
    label: "前の選択候補へ",
    shortcuts: [{ keys: "ArrowUp" }],
    run: () => selectPickCandidateByOffset(-1)
  },
  selectNextPickOption: {
    id: "selectNextPickOption",
    label: "行内の次の候補へ",
    shortcuts: [{ keys: "ArrowRight" }],
    run: () => selectPickOptionByOffset(1)
  },
  selectPreviousPickOption: {
    id: "selectPreviousPickOption",
    label: "行内の前の候補へ",
    shortcuts: [{ keys: "ArrowLeft" }],
    run: () => selectPickOptionByOffset(-1)
  },
  applySelectedPickCandidate: {
    id: "applySelectedPickCandidate",
    label: "選択候補を確定",
    shortcuts: [{ keys: "Enter" }],
    run: () => applySelectedPickCandidate()
  },
  startPointPick: {
    id: "startPointPick",
    label: "点を選択して参照に設定",
    palette: { order: 14 },
    run: (context) => startPointPick(context)
  },
  startLineEndpointPairPick: {
    id: "startLineEndpointPairPick",
    label: "直線の始点と終点を続けて選択",
    run: (context) => startLineEndpointPairPick(context)
  },
  applyPickedPoint: {
    id: "applyPickedPoint",
    label: "選択した点を参照に設定",
    run: (context) => applyPickedPoint(context)
  },
  cancelPointPick: {
    id: "cancelPointPick",
    label: "点選択をキャンセル",
    run: () => cancelPointPick()
  },
  startLinePick: {
    id: "startLinePick",
    label: "線を選択して基準線に追加",
    palette: { order: 15, keywords: ["line", "reference", "base", "基準線", "線", "選択"] },
    run: (context) => startLinePick(context)
  },
  startLineAndPointPick: {
    id: "startLineAndPointPick",
    label: "線と点を続けて選択",
    run: (context) => startLineAndPointPick(context)
  },
  applyPickedLine: {
    id: "applyPickedLine",
    label: "選択した線を基準線に追加",
    run: (context) => applyPickedLine(context)
  },
  cancelLinePick: {
    id: "cancelLinePick",
    label: "線選択をキャンセル",
    run: () => cancelLinePick()
  }
} satisfies Partial<Record<CommandId, Command>>;
