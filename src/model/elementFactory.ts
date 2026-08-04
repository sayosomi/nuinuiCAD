import type { CadElement, CadElementType, ElementId } from "../types/geometry";
import { createCadElementId } from "./cadIds";
import { makeUniqueElementName, withCreatedElementName } from "./elementNames";
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
      element.type === "angleLengthLine" ||
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

  const element = ((): CadElement => {
  switch (type) {
    case "group": {
      const groupCount = elements.filter((element) => element.type === "group").length;
      const id = createId(type);
      return {
        id,
        name: uniqueName(id, `グループ${groupCount + 1}`),
        type,
        activity: "visible",
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      };
    }
    case "conditionalGroup": {
      const conditionalCount = elements.filter((element) => element.type === "conditionalGroup").length;
      const id = createId(type);
      return {
        id,
        name: uniqueName(id, `ifブロック${conditionalCount + 1}`),
        type,
        activity: "visible",
        condition: 1,
      };
    }
    case "forGroup": {
      const forCount = elements.filter((element) => element.type === "forGroup").length;
      const id = createId(type);
      return {
        id,
        name: uniqueName(id, `forブロック${forCount + 1}`),
        type,
        activity: "visible",
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        showGenerated: false
      };
    }
    case "text": {
      const textCount = elements.filter((element) => element.type === "text").length;
      const id = createId(type);
      return {
        id,
        name: uniqueName(id, `テキスト${textCount + 1}`),
        type,
        activity: "visible",
        numericVariables: [],
        text: "テキスト",
        anchor: null,
        fontSize: 3
      };
    }
    case "freePoint": {
      const id = createId(type);
      const requestedName = `点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        activity: "visible",
        x: 0,
        y: 0
      };
    }
    case "offsetPoint": {
      const id = createId(type);
      const requestedName = `オフセット点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        activity: "visible",
        fromPoint: referenceAnchor(firstPointId),
        fromPointId: firstPointId,
        dx: 0,
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
        activity: "visible",
        fromPoint: referenceAnchor(firstPointId),
        fromPointId: firstPointId,
        angleDeg: 0,
        distance: 0
      };
    }
    case "divisionPoint": {
      const id = createId(type);
      const requestedName = `分点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        activity: "visible",
        numericVariables: [],
        numericParameterSteps: { ratio: 0.01 },
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId),
        placement: { kind: "ratio", value: 0.5 }
      };
    }
    case "lineDivisionPoint": {
      const id = createId(type);
      const requestedName = `線上分点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        activity: "visible",
        numericVariables: [],
        numericParameterSteps: { ratio: 0.01 },
        endpoint: {
          lineId: lineLikeElements[0]?.id ?? "",
          endpointKey: "start"
        },
        placement: { kind: "ratio", value: 0.5 }
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
        activity: "visible",
        numericVariables: [],
        line1Id: lineLikeElements[0]?.id ?? "",
        line2Id: lineLikeElements[1]?.id ?? lineLikeElements[0]?.id ?? "",
        intersectionIndex: 0,
        useExtensions: true
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
        activity: "visible",
        numericVariables: [],
        baseLineId: baseLine?.id ?? "",
        basePoint: baseLine ? derivedAnchor(baseLine.id, "start") : referenceAnchor(firstPointId),
        tangentAngleDeg: 0,
        distance: 0
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
        activity: "visible",
        numericVariables: [],
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId)
      };
    }
    case "angleLengthLine": {
      const id = createId(type);
      const lineCount = elements.filter((element) => element.type === "angleLengthLine").length;
      const requestedName = `角度距離線${lineCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        activity: "visible",
        numericVariables: [],
        startPoint: firstPointId ? referenceAnchor(firstPointId) : { mode: "coordinate", x: 0, y: 0 },
        angleDeg: 0,
        length: 100
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
        activity: "visible",
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
        activity: "visible",
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
        activity: "visible",
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
        activity: "visible",
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
        activity: "visible",
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
        activity: "visible",
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
        activity: "visible",
        numericVariables: [],
        baseLineIds: lineLikeElements[0] ? [lineLikeElements[0].id] : [],
        offset: 10,
        side: "right",
        closed: false,
        suppressTrimWarnings: false
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
        activity: "visible",
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
        activity: "visible",
        numericVariables: [],
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId),
        scale: 1,
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
        activity: "visible",
        numericVariables: [],
        startPoint: referenceAnchor(firstPointId),
        endPoint: referenceAnchor(secondPointId),
        scale: 1,
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
        activity: "visible",
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
        activity: "visible",
        numericVariables: [],
        axisPoint1: referenceAnchor(firstPointId),
        axisPoint2: referenceAnchor(secondPointId),
        baseLineIds: lineLikeElements[0] ? [lineLikeElements[0].id] : []
      };
    }
    case "image": {
      const id = createId(type);
      const imageCount = elements.filter((element) => element.type === "image").length;
      const requestedName = `画像${imageCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        activity: "visible",
        numericVariables: [],
        numericParameterSteps: { scale: 0.01 },
        sourcePath: "",
        originPoint: { mode: "coordinate", x: 0, y: 0 },
        naturalWidthPx: 1,
        naturalHeightPx: 1,
        sourceDpi: 300,
        targetPixelsPerMm: 300 / 25.4,
        scale: 1,
        angleDeg: 0,
        mirrorX: false
      };
    }
  }
  })();
  return withCreatedElementName(element, elements, referenceElements);
};
