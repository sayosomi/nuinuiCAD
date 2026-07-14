import {
  cancelCommandLineSession,
  confirmCommandLineSession,
  startCommandLineCreation
} from "./commandLineSessionCommands";
import type { CadElementType } from "../types/geometry";
import type { Command, CommandId } from "./commandTypes";

/** @deprecated Every temporary command below is absorbed by its add* counterpart in Phase 4g. */
const temporaryCreationCommand = (
  id: CommandId,
  type: CadElementType,
  label: string,
  order: number
): Command => ({
  id,
  label,
  palette: { order, keywords: ["command line", "コマンドライン", label] },
  flushPolicy: "editor-owned",
  run: (context) => startCommandLineCreation(type, context)
});

export const commandLineCommandDefinitions = {
  commandLineAddFreePoint: temporaryCreationCommand("commandLineAddFreePoint", "freePoint", "コマンドラインで free point を作成", 1.1),
  commandLineAddOffsetPoint: temporaryCreationCommand("commandLineAddOffsetPoint", "offsetPoint", "コマンドラインで offset point を作成", 2.1),
  commandLineAddPolarOffsetPoint: temporaryCreationCommand("commandLineAddPolarOffsetPoint", "polarOffsetPoint", "コマンドラインで polar offset point を作成", 3.1),
  commandLineAddDivisionPoint: temporaryCreationCommand("commandLineAddDivisionPoint", "divisionPoint", "コマンドラインで点間分点を作成", 4.1),
  commandLineAddLineDivisionPoint: temporaryCreationCommand("commandLineAddLineDivisionPoint", "lineDivisionPoint", "コマンドラインで線上分点を作成", 5.1),
  commandLineAddIntersectionPoint: temporaryCreationCommand("commandLineAddIntersectionPoint", "intersectionPoint", "コマンドラインで交点を作成", 6.1),
  commandLineAddLineTangentOffsetPoint: temporaryCreationCommand("commandLineAddLineTangentOffsetPoint", "lineTangentOffsetPoint", "コマンドラインで線上オフセット点を作成", 7.1),
  commandLineAddLine: temporaryCreationCommand("commandLineAddLine", "line", "コマンドラインで line を作成", 8.1),
  commandLineAddAngleLengthLine: temporaryCreationCommand("commandLineAddAngleLengthLine", "angleLengthLine", "コマンドラインで角度距離線を作成", 8.6),
  commandLineAddArcLine: temporaryCreationCommand("commandLineAddArcLine", "arcLine", "コマンドラインで円弧線を作成", 9.1),
  commandLineAddThreePointArcLine: temporaryCreationCommand("commandLineAddThreePointArcLine", "threePointArcLine", "コマンドラインで三点円弧線を作成", 10.1),
  commandLineAddCornerRadiusArcLine: temporaryCreationCommand("commandLineAddCornerRadiusArcLine", "cornerRadiusArcLine", "コマンドラインで角R円弧線を作成", 11.1),
  commandLineAddEdge: temporaryCreationCommand("commandLineAddEdge", "edge", "コマンドラインでエッジを作成", 12.1),
  commandLineAddExtendTrim: temporaryCreationCommand("commandLineAddExtendTrim", "extendTrim", "コマンドラインで延長短縮を作成", 13.1),
  commandLineAddBezierCurve: temporaryCreationCommand("commandLineAddBezierCurve", "bezierCurve", "コマンドラインでBezier curveを作成", 14.1),
  commandLineAddOffsetLine: temporaryCreationCommand("commandLineAddOffsetLine", "offsetLine", "コマンドラインでオフセット線を作成", 15.1),
  commandLineAddCopyLine: temporaryCreationCommand("commandLineAddCopyLine", "copyLine", "コマンドラインでコピー線を作成", 16.1),
  commandLineAddSymmetricCopyLine: temporaryCreationCommand("commandLineAddSymmetricCopyLine", "symmetricCopyLine", "コマンドラインで対称コピー線を作成", 17.1),
  commandLineAddMove: temporaryCreationCommand("commandLineAddMove", "move", "コマンドラインで移動を作成", 18.1),
  commandLineAddSymmetricMove: temporaryCreationCommand("commandLineAddSymmetricMove", "symmetricMove", "コマンドラインで対称移動を作成", 19.1),
  commandLineAddSplitLine: temporaryCreationCommand("commandLineAddSplitLine", "splitLine", "コマンドラインで分割線を作成", 20.1),
  commandLineAddVariable: temporaryCreationCommand("commandLineAddVariable", "variable", "コマンドラインで変数を作成", 21.6),
  commandLineAddText: temporaryCreationCommand("commandLineAddText", "text", "コマンドラインでテキストを作成", 21.8),
  cancelCommandLineSession: {
    id: "cancelCommandLineSession",
    label: "コマンドライン作成をキャンセル",
    flushPolicy: "editor-owned",
    run: () => cancelCommandLineSession()
  },
  confirmCommandLineSession: {
    id: "confirmCommandLineSession",
    label: "コマンドライン作成を確定",
    flushPolicy: "editor-owned",
    run: (context) => confirmCommandLineSession(context)
  }
} satisfies Partial<Record<CommandId, Command>>;
