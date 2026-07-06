import { numericValueExpression } from "../geometry/numericExpressions";
import type {
  CadElement,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import type { SerializeDslOptions } from "./dslTypes";

const quote = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;

const numeric = (value: NumericValue) => numericValueExpression(value);

const anchor = (value: PointAnchor | null | undefined) => {
  if (!value) return "none";
  if (value.mode === "reference") return value.pointId;
  if (value.mode === "derived") return `${value.elementId}.${value.pointKey}`;
  return `(${numeric(value.x)}, ${numeric(value.y)})`;
};

const endpoint = (value: LineEndpointReference) =>
  `${value.lineId}.${value.endpointKey}`;

const baseAttrs = (element: CadElement, options: SerializeDslOptions) => [
  ...(options.includeIds === false ? [] : [`id=${element.id}`]),
  ...(element.visible ? [] : ["visible=false"]),
  ...(element.enabled ? [] : ["enabled=false"]),
  ...(element.colorId ? [`color=${element.colorId}`] : []),
  ...(element.parentGroupId ? [`parent=${element.parentGroupId}`] : []),
  ...(element.conditionalBranch ? [`branch=${element.conditionalBranch}`] : [])
];

const elementLine = (element: CadElement, options: SerializeDslOptions, attrs: string[] = []) =>
  [
    "element",
    element.name || element.id,
    `type=${element.type}`,
    ...baseAttrs(element, options),
    ...attrs
  ].join(" ");

export const serializeElementsToDsl = (
  elements: CadElement[],
  options: SerializeDslOptions = {}
) => elements.map((element) => {
  const attrs = baseAttrs(element, options);
  switch (element.type) {
    case "group":
      return ["group", element.name || element.id, ...attrs, `expanded=${element.expanded}`].join(" ");
    case "variable":
      return ["var", element.name || element.id, "=", numeric(element.expression), ...attrs].join(" ");
    case "freePoint":
      return ["point", element.name || element.id, "=", `(${numeric(element.x)}, ${numeric(element.y)})`, ...attrs].join(" ");
    case "offsetPoint":
      return [
        "point",
        element.name || element.id,
        "=",
        "offset",
        anchor(element.fromPoint),
        `dx=${numeric(element.dx)}`,
        `dy=${numeric(element.dy)}`,
        ...attrs
      ].join(" ");
    case "polarOffsetPoint":
      return [
        "point",
        element.name || element.id,
        "=",
        "polar",
        anchor(element.fromPoint),
        `angle=${numeric(element.angleDeg)}`,
        `distance=${numeric(element.distance)}`,
        ...attrs
      ].join(" ");
    case "line":
      return ["line", element.name || element.id, "=", anchor(element.startPoint), "->", anchor(element.endPoint), ...attrs].join(" ");
    case "angleLengthLine":
      return [
        "line",
        element.name || element.id,
        "=",
        "from",
        anchor(element.startPoint),
        `angle=${numeric(element.angleDeg)}`,
        `length=${numeric(element.length)}`,
        ...attrs
      ].join(" ");
    case "arcLine":
      return [
        "arc",
        element.name || element.id,
        `center=${anchor(element.centerPoint)}`,
        `radius=${numeric(element.radius)}`,
        `start=${numeric(element.startAngleDeg)}`,
        `end=${numeric(element.endAngleDeg)}`,
        ...attrs
      ].join(" ");
    case "text":
      return [
        "text",
        element.name || element.id,
        "=",
        quote(element.text),
        `at=${anchor(element.anchor)}`,
        `size=${numeric(element.fontSize)}`,
        ...attrs
      ].join(" ");
    case "divisionPoint":
      return elementLine(element, options, [
        `startPoint=${anchor(element.startPoint)}`,
        `endPoint=${anchor(element.endPoint)}`,
        `placementMode=${element.placementMode}`,
        `distance=${numeric(element.distance)}`,
        `ratio=${numeric(element.ratio)}`
      ]);
    case "lineDivisionPoint":
      return elementLine(element, options, [
        `endpoint=${endpoint(element.endpoint)}`,
        `placementMode=${element.placementMode}`,
        `distance=${numeric(element.distance)}`,
        `ratio=${numeric(element.ratio)}`
      ]);
    case "intersectionPoint":
      return elementLine(element, options, [
        `line1Id=${element.line1Id}`,
        `line2Id=${element.line2Id}`,
        `intersectionIndex=${numeric(element.intersectionIndex)}`,
        `useExtensions=${element.useExtensions}`
      ]);
    case "lineTangentOffsetPoint":
      return elementLine(element, options, [
        `baseLineId=${element.baseLineId}`,
        `basePoint=${anchor(element.basePoint)}`,
        `tangentAngleDeg=${numeric(element.tangentAngleDeg)}`,
        `distance=${numeric(element.distance)}`
      ]);
    case "cornerRadiusArcLine":
      return elementLine(element, options, [
        `endpoint1=${endpoint(element.endpoint1)}`,
        `endpoint2=${endpoint(element.endpoint2)}`,
        `radius=${numeric(element.radius)}`,
        `intersectionIndex=${numeric(element.intersectionIndex)}`
      ]);
    case "edge":
      return elementLine(element, options, [
        `endpoint1=${endpoint(element.endpoint1)}`,
        `endpoint2=${endpoint(element.endpoint2)}`,
        `intersectionIndex=${numeric(element.intersectionIndex)}`
      ]);
    case "extendTrim":
      return elementLine(element, options, [
        `endpoint=${endpoint(element.endpoint)}`,
        `point=${anchor(element.point)}`
      ]);
    case "bezierCurve":
      return elementLine(element, options, [
        `startPoint=${anchor(element.startPoint)}`,
        `startHandleAngleDeg=${numeric(element.startHandleAngleDeg)}`,
        `startHandleLength=${numeric(element.startHandleLength)}`,
        `endPoint=${anchor(element.endPoint)}`,
        `endHandleAngleDeg=${numeric(element.endHandleAngleDeg)}`,
        `endHandleLength=${numeric(element.endHandleLength)}`
      ]);
    case "offsetLine":
      return elementLine(element, options, [
        `baseLineIds=[${element.baseLineIds.join(",")}]`,
        `offset=${numeric(element.offset)}`,
        `side=${element.side}`,
        `closed=${element.closed}`
      ]);
    case "splitLine":
      return elementLine(element, options, [
        `baseLineId=${element.baseLineId}`,
        `splitPoint=${anchor(element.splitPoint)}`
      ]);
    case "copyLine":
    case "move":
      return elementLine(element, options, [
        `startPoint=${anchor(element.startPoint)}`,
        `endPoint=${anchor(element.endPoint)}`,
        `scale=${numeric(element.scale)}`,
        `angleDeg=${numeric(element.angleDeg)}`,
        `mirrorX=${element.mirrorX}`,
        `baseLineIds=[${element.baseLineIds.join(",")}]`
      ]);
    case "symmetricCopyLine":
    case "symmetricMove":
      return elementLine(element, options, [
        `axisPoint1=${anchor(element.axisPoint1)}`,
        `axisPoint2=${anchor(element.axisPoint2)}`,
        `baseLineIds=[${element.baseLineIds.join(",")}]`
      ]);
    case "threePointArcLine":
      return elementLine(element, options, [
        `point1=${anchor(element.point1)}`,
        `point2=${anchor(element.point2)}`,
        `point3=${anchor(element.point3)}`,
        `startAngleDeg=${numeric(element.startAngleDeg)}`,
        `endAngleDeg=${numeric(element.endAngleDeg)}`
      ]);
    case "conditionalGroup":
      return elementLine(element, options, [
        `condition=${numeric(element.condition)}`,
        `expanded=${element.expanded}`,
        `elseExpanded=${element.elseExpanded}`
      ]);
    case "forGroup":
      return elementLine(element, options, [
        `variableName=${element.variableName}`,
        `start=${numeric(element.start)}`,
        `count=${numeric(element.count)}`,
        `step=${numeric(element.step)}`,
        `expanded=${element.expanded}`,
        `showGenerated=${element.showGenerated}`
      ]);
    case "image":
      return elementLine(element, options, [
        `sourcePath=${quote(element.sourcePath)}`,
        `originPoint=${anchor(element.originPoint)}`,
        `scale=${numeric(element.scale)}`,
        `angleDeg=${numeric(element.angleDeg)}`,
        `mirrorX=${element.mirrorX}`
      ]);
  }
}).join("\n");
