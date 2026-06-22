import type { CadElement, CadElementType, ElementId } from "../types/geometry";
import { createCadElementId } from "./cadIds";
import { makeUniqueElementName } from "./elementNames";
import { referenceAnchor } from "./pointAnchors";

type CreateCadElementOptions = {
  createId?: (type: CadElementType) => ElementId;
};

export const createCadElement = (
  type: CadElementType,
  elements: CadElement[],
  options: CreateCadElementOptions = {}
): CadElement => {
  const createId = options.createId ?? createCadElementId;
  const points = elements.filter(
    (element) =>
      element.type === "freePoint" ||
      element.type === "offsetPoint" ||
      element.type === "polarOffsetPoint" ||
      element.type === "divisionPoint" ||
      element.type === "lineDivisionPoint"
  );
  const firstPointId = points[0]?.id ?? "";
  const secondPointId = points[1]?.id ?? firstPointId;
  const thirdPointId = points[2]?.id ?? secondPointId;
  const lineLikeElements = elements.filter(
    (element) =>
      element.type === "line" ||
      element.type === "arcLine" ||
      element.type === "threePointArcLine" ||
      element.type === "bezierCurve" ||
      element.type === "offsetLine"
  );
  const uniqueName = (elementId: ElementId, requestedName: string) =>
    makeUniqueElementName({
      elements,
      elementId,
      requestedName,
      fallbackBaseName: requestedName
    });

  switch (type) {
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
  }
};
