import type { CadElement, CadElementType, ElementId } from "../types/geometry";
import { createCadElementId } from "./cadIds";
import { makeUniqueElementName } from "./elementNames";
import { derivedAnchor, referenceAnchor } from "./pointAnchors";

type CreateCadElementOptions = {
  createId?: (type: CadElementType) => ElementId;
  referenceElements?: CadElement[];
};

export const createCadElement = (
  type: CadElementType,
  elements: CadElement[],
  options: CreateCadElementOptions = {}
): CadElement => {
  const createId = options.createId ?? createCadElementId;
  const referenceElements = options.referenceElements ?? elements;
  const points = referenceElements.filter(
    (element) =>
      element.type === "freePoint" ||
      element.type === "offsetPoint" ||
      element.type === "polarOffsetPoint" ||
      element.type === "divisionPoint" ||
      element.type === "lineDivisionPoint" ||
      element.type === "intersectionPoint" ||
      element.type === "lineTangentOffsetPoint"
  );
  const firstPointId = points[0]?.id ?? "";
  const secondPointId = points[1]?.id ?? firstPointId;
  const thirdPointId = points[2]?.id ?? secondPointId;
  const lineLikeElements = referenceElements.filter(
    (element) =>
      element.type === "line" ||
      element.type === "arcLine" ||
      element.type === "threePointArcLine" ||
      element.type === "cornerRadiusArcLine" ||
      element.type === "bezierCurve" ||
      element.type === "offsetLine" ||
      element.type === "splitLine" ||
      element.type === "copyLine" ||
      element.type === "symmetricCopyLine"
  );
  const uniqueName = (elementId: ElementId, requestedName: string) =>
    makeUniqueElementName({
      elements,
      elementId,
      requestedName,
      fallbackBaseName: requestedName
    });

  switch (type) {
    case "group": {
      const groupCount = elements.filter((element) => element.type === "group").length;
      const id = createId(type);
      return {
        id,
        name: uniqueName(id, `グループ${groupCount + 1}`),
        type,
        visible: true,
        enabled: true,
        expanded: true
      };
    }
    case "variable": {
      const variableCount = elements.filter((element) => element.type === "variable").length;
      const id = createId(type);
      return {
        id,
        name: uniqueName(id, `変数${variableCount + 1}`),
        type,
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: 0,
        point1: referenceAnchor(firstPointId),
        point2: referenceAnchor(secondPointId),
        point: referenceAnchor(firstPointId),
        lineId: lineLikeElements[0]?.id ?? ""
      };
    }
    case "freePoint": {
      const id = createId(type);
      const requestedName = `点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        x: 80 + points.length * 20,
        y: 80 + points.length * 20
      };
    }
    case "offsetPoint": {
      const id = createId(type);
      const requestedName = `オフセット点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        fromPoint: referenceAnchor(firstPointId),
        fromPointId: firstPointId,
        dx: 30,
        dy: 0
      };
    }
    case "polarOffsetPoint": {
      const id = createId(type);
      const requestedName = `角度距離点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        fromPoint: referenceAnchor(firstPointId),
        fromPointId: firstPointId,
        angleDeg: 0,
        distance: 30
      };
    }
    case "divisionPoint": {
      const id = createId(type);
      const requestedName = `分点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        numericParameterSteps: { ratio: 0.01 },
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId),
        placementMode: "ratio",
        distance: 30,
        ratio: 0.5
      };
    }
    case "lineDivisionPoint": {
      const id = createId(type);
      const requestedName = `線上分点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        numericParameterSteps: { ratio: 0.01 },
        endpoint: {
          lineId: lineLikeElements[0]?.id ?? "",
          endpointKey: "start"
        },
        placementMode: "ratio",
        distance: 30,
        ratio: 0.5
      };
    }
    case "intersectionPoint": {
      const id = createId(type);
      const intersectionCount = elements.filter((element) => element.type === "intersectionPoint").length;
      const requestedName = `交点${intersectionCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        line1Id: lineLikeElements[0]?.id ?? "",
        line2Id: lineLikeElements[1]?.id ?? lineLikeElements[0]?.id ?? "",
        intersectionIndex: 0,
        useExtensions: false
      };
    }
    case "lineTangentOffsetPoint": {
      const id = createId(type);
      const pointCount = elements.filter((element) => element.type === "lineTangentOffsetPoint").length;
      const requestedName = `線上オフセット点${pointCount + 1}`;
      const baseLine = lineLikeElements[0];
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        baseLineId: baseLine?.id ?? "",
        basePoint: baseLine ? derivedAnchor(baseLine.id, "start") : referenceAnchor(firstPointId),
        tangentAngleDeg: 0,
        distance: 30
      };
    }
    case "line": {
      const id = createId(type);
      const lineCount = elements.filter((element) => element.type === "line").length;
      const requestedName = `直線${lineCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId)
      };
    }
    case "arcLine": {
      const id = createId(type);
      const arcCount = elements.filter((element) => element.type === "arcLine").length;
      const requestedName = `円弧線${arcCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        centerPoint: referenceAnchor(firstPointId),
        radius: 30,
        startAngleDeg: 0,
        endAngleDeg: 90
      };
    }
    case "threePointArcLine": {
      const id = createId(type);
      const arcCount = elements.filter((element) => element.type === "threePointArcLine").length;
      const requestedName = `三点円弧線${arcCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        point1: referenceAnchor(firstPointId),
        point2: referenceAnchor(secondPointId),
        point3: referenceAnchor(thirdPointId),
        startAngleDeg: 0,
        endAngleDeg: 90
      };
    }
    case "cornerRadiusArcLine": {
      const id = createId(type);
      const arcCount = elements.filter((element) => element.type === "cornerRadiusArcLine").length;
      const firstLine = lineLikeElements[0];
      const secondLine = lineLikeElements.find((element) => element.id !== firstLine?.id) ?? firstLine;
      const requestedName = `角R円弧線${arcCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        endpoint1: {
          lineId: firstLine?.id ?? "",
          endpointKey: "start"
        },
        endpoint2: {
          lineId: secondLine?.id ?? "",
          endpointKey: "start"
        },
        radius: 10,
        intersectionIndex: 0
      };
    }
    case "edge": {
      const id = createId(type);
      const edgeCount = elements.filter((element) => element.type === "edge").length;
      const firstLine = lineLikeElements[0];
      const secondLine = lineLikeElements.find((element) => element.id !== firstLine?.id) ?? firstLine;
      const requestedName = `エッジ${edgeCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        endpoint1: {
          lineId: firstLine?.id ?? "",
          endpointKey: "start"
        },
        endpoint2: {
          lineId: secondLine?.id ?? "",
          endpointKey: "start"
        },
        intersectionIndex: 0
      };
    }
    case "extendTrim": {
      const id = createId(type);
      const extendTrimCount = elements.filter((element) => element.type === "extendTrim").length;
      const requestedName = `延長短縮${extendTrimCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        endpoint: {
          lineId: lineLikeElements[0]?.id ?? "",
          endpointKey: "start"
        },
        point: referenceAnchor(firstPointId)
      };
    }
    case "bezierCurve": {
      const id = createId(type);
      const curveCount = elements.filter((element) => element.type === "bezierCurve").length;
      const requestedName = `曲線${curveCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        startPoint: referenceAnchor(firstPointId),
        startHandleAngleDeg: 0,
        startHandleLength: 30,
        intermediatePoints: [],
        endPoint: referenceAnchor(secondPointId),
        endHandleAngleDeg: 0,
        endHandleLength: 30
      };
    }
    case "offsetLine": {
      const id = createId(type);
      const offsetLineCount = elements.filter((element) => element.type === "offsetLine").length;
      const requestedName = `オフセット線${offsetLineCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        baseLineIds: lineLikeElements[0] ? [lineLikeElements[0].id] : [],
        offset: 10,
        side: "right",
        closed: false
      };
    }
    case "splitLine": {
      const id = createId(type);
      const splitLineCount = elements.filter((element) => element.type === "splitLine").length;
      const requestedName = `分割線${splitLineCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        baseLineId: lineLikeElements[0]?.id ?? "",
        splitPoint: referenceAnchor(firstPointId)
      };
    }
    case "copyLine": {
      const id = createId(type);
      const copyLineCount = elements.filter((element) => element.type === "copyLine").length;
      const requestedName = `コピー線${copyLineCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId),
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: lineLikeElements[0] ? [lineLikeElements[0].id] : []
      };
    }
    case "move": {
      const id = createId(type);
      const moveCount = elements.filter((element) => element.type === "move").length;
      const requestedName = `移動${moveCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId),
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: lineLikeElements[0] ? [lineLikeElements[0].id] : []
      };
    }
    case "symmetricCopyLine": {
      const id = createId(type);
      const symmetricCopyLineCount = elements.filter((element) => element.type === "symmetricCopyLine").length;
      const requestedName = `対称コピー線${symmetricCopyLineCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        axisPoint1: referenceAnchor(firstPointId),
        axisPoint2: referenceAnchor(secondPointId),
        baseLineIds: lineLikeElements[0] ? [lineLikeElements[0].id] : []
      };
    }
    case "symmetricMove": {
      const id = createId(type);
      const symmetricMoveCount = elements.filter((element) => element.type === "symmetricMove").length;
      const requestedName = `対称移動${symmetricMoveCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        numericVariables: [],
        axisPoint1: referenceAnchor(firstPointId),
        axisPoint2: referenceAnchor(secondPointId),
        baseLineIds: lineLikeElements[0] ? [lineLikeElements[0].id] : []
      };
    }
  }
};
