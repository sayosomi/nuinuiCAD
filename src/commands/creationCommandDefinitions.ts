import {
  addCornerRadiusArcLine,
  addElement,
  addIntersectionPoint,
  addLineDivisionPoint,
  addLineTangentOffsetPoint,
  addOffsetLine
} from "./elementCreationCommands";
import {
  addBezierIntermediatePoint,
  addNumericVariable,
  deleteBezierIntermediatePoint,
  deleteNumericVariable
} from "./parameterCommands";
import type { Command, CommandId } from "./commandTypes";

export const creationCommandDefinitions = {
  addFreePoint: {
    id: "addFreePoint",
    label: "free point を追加",
    run: () => addElement("freePoint")
  },
  addOffsetPoint: {
    id: "addOffsetPoint",
    label: "offset point を追加",
    run: () => addElement("offsetPoint")
  },
  addPolarOffsetPoint: {
    id: "addPolarOffsetPoint",
    label: "polar offset point を追加",
    run: () => addElement("polarOffsetPoint")
  },
  addDivisionPoint: {
    id: "addDivisionPoint",
    label: "点間分点を追加",
    run: () => addElement("divisionPoint")
  },
  addLineDivisionPoint: {
    id: "addLineDivisionPoint",
    label: "線上分点を追加",
    run: () => addLineDivisionPoint()
  },
  addIntersectionPoint: {
    id: "addIntersectionPoint",
    label: "交点を追加",
    run: () => addIntersectionPoint()
  },
  addLineTangentOffsetPoint: {
    id: "addLineTangentOffsetPoint",
    label: "線上オフセット点を追加",
    run: () => addLineTangentOffsetPoint()
  },
  addLine: {
    id: "addLine",
    label: "line を追加",
    run: () => addElement("line")
  },
  addArcLine: {
    id: "addArcLine",
    label: "円弧線を追加",
    run: () => addElement("arcLine")
  },
  addThreePointArcLine: {
    id: "addThreePointArcLine",
    label: "三点円弧線を追加",
    run: () => addElement("threePointArcLine")
  },
  addCornerRadiusArcLine: {
    id: "addCornerRadiusArcLine",
    label: "角R円弧線を追加",
    run: () => addCornerRadiusArcLine()
  },
  addBezierCurve: {
    id: "addBezierCurve",
    label: "Bezier curve を追加",
    run: () => addElement("bezierCurve")
  },
  addOffsetLine: {
    id: "addOffsetLine",
    label: "オフセット線を追加",
    run: () => addOffsetLine()
  },
  addNumericVariable: {
    id: "addNumericVariable",
    label: "共通変数を追加",
    run: () => addNumericVariable()
  },
  deleteNumericVariable: {
    id: "deleteNumericVariable",
    label: "共通変数を削除",
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierNumericVariable: {
    id: "addBezierNumericVariable",
    label: "曲線の共通変数を追加",
    run: () => addNumericVariable()
  },
  deleteBezierNumericVariable: {
    id: "deleteBezierNumericVariable",
    label: "曲線の共通変数を削除",
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierIntermediatePoint: {
    id: "addBezierIntermediatePoint",
    label: "曲線の中間点を追加",
    run: () => addBezierIntermediatePoint()
  },
  deleteBezierIntermediatePoint: {
    id: "deleteBezierIntermediatePoint",
    label: "曲線の中間点を削除",
    run: (context) => deleteBezierIntermediatePoint(context?.intermediatePointId)
  }
} satisfies Partial<Record<CommandId, Command>>;
