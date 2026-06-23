import {
  applyNumericExpressionReference,
  applyPickedLine,
  applyPickedNumericReference,
  applyPickedPoint,
  applySelectedPickCandidate,
  cancelLinePick,
  cancelNumericReferencePick,
  cancelPointPick,
  selectPickCandidateByOffset,
  selectPickOptionByOffset,
  startLinePick,
  startNumericReferencePick,
  startPointPick
} from "./pickCommands";
import type { Command, CommandId } from "./commandTypes";

export const pickCommandDefinitions = {
  applyNumericExpressionReference: {
    id: "applyNumericExpressionReference",
    label: "数値参照式を採用",
    run: (context) => applyNumericExpressionReference(context)
  },
  startNumericReferencePick: {
    id: "startNumericReferencePick",
    label: "数値選択モードに入る",
    run: () => startNumericReferencePick()
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
    run: () => selectPickCandidateByOffset(1)
  },
  selectPreviousPickCandidate: {
    id: "selectPreviousPickCandidate",
    label: "前の選択候補へ",
    run: () => selectPickCandidateByOffset(-1)
  },
  selectNextPickOption: {
    id: "selectNextPickOption",
    label: "行内の次の候補へ",
    run: () => selectPickOptionByOffset(1)
  },
  selectPreviousPickOption: {
    id: "selectPreviousPickOption",
    label: "行内の前の候補へ",
    run: () => selectPickOptionByOffset(-1)
  },
  applySelectedPickCandidate: {
    id: "applySelectedPickCandidate",
    label: "選択候補を確定",
    run: () => applySelectedPickCandidate()
  },
  startPointPick: {
    id: "startPointPick",
    label: "点を選択して参照に設定",
    run: () => startPointPick()
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
    run: () => startLinePick()
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
