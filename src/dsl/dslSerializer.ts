import { numericValueExpression } from "../geometry/numericExpressions";
import type {
  CadElement,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import type { SerializeDslOptions } from "./dslTypes";
import { formatDslName, quoteDslString } from "./dslTokens";

const numeric = (value: NumericValue) => numericValueExpression(value);
const elementName = (element: CadElement) => formatDslName(element.name || element.id);

const anchor = (value: PointAnchor | null | undefined) => {
  if (!value) return "none";
  if (value.mode === "reference") return value.pointId;
  if (value.mode === "derived") return `${value.elementId}.${value.pointKey}`;
  return `(${numeric(value.x)}, ${numeric(value.y)})`;
};

const endpoint = (value: LineEndpointReference) =>
  `${value.lineId}.${value.endpointKey}`;

const intermediatePoints = (element: Extract<CadElement, { type: "bezierCurve" }>) =>
  element.intermediatePoints.length === 0
    ? []
    : [
        `intermediates=[${
          element.intermediatePoints.map((point) => [
            anchor(point.point),
            numeric(point.handleAngleDeg),
            numeric(point.incomingHandleLength),
            numeric(point.outgoingHandleLength),
            point.id
          ].join(":")).join(";")
        }]`
      ];

const baseAttrs = (element: CadElement, options: SerializeDslOptions) => [
  ...(options.includeIds === false ? [] : [`id=${element.id}`]),
  ...(element.locked ? ["locked=true"] : []),
  ...(element.visible ? [] : ["visible=false"]),
  ...(element.enabled ? [] : ["enabled=false"]),
  ...(element.colorId ? [`color=${element.colorId}`] : []),
  ...(element.parentGroupId ? [`parent=${element.parentGroupId}`] : []),
  ...(element.conditionalBranch ? [`branch=${element.conditionalBranch}`] : []),
  ...(element.type === "group" && element.visibilityRoleIds?.length
    ? [`roles=[${element.visibilityRoleIds.join(",")}]`]
    : [])
];

const elementLine = (element: CadElement, options: SerializeDslOptions, attrs: string[] = []) =>
  [
    "element",
    elementName(element),
    `type=${element.type}`,
    ...baseAttrs(element, options),
    ...attrs
  ].join(" ");

export const serializeElementsToDsl = (
  elements: CadElement[],
  options: SerializeDslOptions = {}
) => [
  ...visibilitySettingsDsl(options),
  ...elements.map((element) => {
  const attrs = baseAttrs(element, options);
  switch (element.type) {
    case "group":
      return ["group", elementName(element), ...attrs, `expanded=${element.expanded}`].join(" ");
    case "variable":
      return ["var", elementName(element), "=", numeric(element.expression), ...attrs].join(" ");
    case "freePoint":
      return ["point", elementName(element), "=", `(${numeric(element.x)}, ${numeric(element.y)})`, ...attrs].join(" ");
    case "offsetPoint":
      return [
        "point",
        elementName(element),
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
        elementName(element),
        "=",
        "polar",
        anchor(element.fromPoint),
        `angle=${numeric(element.angleDeg)}`,
        `distance=${numeric(element.distance)}`,
        ...attrs
      ].join(" ");
    case "line":
      return ["line", elementName(element), "=", anchor(element.startPoint), "->", anchor(element.endPoint), ...attrs].join(" ");
    case "angleLengthLine":
      return [
        "line",
        elementName(element),
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
        elementName(element),
        `center=${anchor(element.centerPoint)}`,
        `radius=${numeric(element.radius)}`,
        `start=${numeric(element.startAngleDeg)}`,
        `end=${numeric(element.endAngleDeg)}`,
        ...attrs
      ].join(" ");
    case "text":
      return [
        "text",
        elementName(element),
        "=",
        quoteDslString(element.text),
        `at=${anchor(element.anchor)}`,
        `size=${numeric(element.fontSize)}`,
        ...attrs
      ].join(" ");
    case "divisionPoint":
      return [
        "point",
        elementName(element),
        "=",
        "between",
        anchor(element.startPoint),
        anchor(element.endPoint),
        element.placementMode === "distance"
          ? `distance=${numeric(element.distance)}`
          : `ratio=${numeric(element.ratio)}`,
        ...attrs
      ].join(" ");
    case "lineDivisionPoint":
      return [
        "point",
        elementName(element),
        "=",
        "on",
        endpoint(element.endpoint),
        element.placementMode === "distance"
          ? `distance=${numeric(element.distance)}`
          : `ratio=${numeric(element.ratio)}`,
        ...attrs
      ].join(" ");
    case "intersectionPoint":
      return [
        "point",
        elementName(element),
        "=",
        "intersection",
        element.line1Id,
        element.line2Id,
        `index=${numeric(element.intersectionIndex)}`,
        `extensions=${element.useExtensions}`,
        ...attrs
      ].join(" ");
    case "lineTangentOffsetPoint":
      return [
        "point",
        elementName(element),
        "=",
        "tangentOffset",
        element.baseLineId,
        `base=${anchor(element.basePoint)}`,
        `angle=${numeric(element.tangentAngleDeg)}`,
        `distance=${numeric(element.distance)}`,
        ...attrs
      ].join(" ");
    case "cornerRadiusArcLine":
      return [
        "arc",
        elementName(element),
        "=",
        "corner",
        endpoint(element.endpoint1),
        endpoint(element.endpoint2),
        `radius=${numeric(element.radius)}`,
        `index=${numeric(element.intersectionIndex)}`,
        ...attrs
      ].join(" ");
    case "edge":
      return elementLine(element, options, [
        `endpoint1=${endpoint(element.endpoint1)}`,
        `endpoint2=${endpoint(element.endpoint2)}`,
        `intersectionIndex=${numeric(element.intersectionIndex)}`
      ]);
    case "extendTrim":
      return [
        "line",
        elementName(element),
        "=",
        "extend",
        endpoint(element.endpoint),
        `to=${anchor(element.point)}`,
        ...attrs
      ].join(" ");
    case "bezierCurve":
      return [
        "curve",
        elementName(element),
        "=",
        anchor(element.startPoint),
        "->",
        anchor(element.endPoint),
        `startAngle=${numeric(element.startHandleAngleDeg)}`,
        `startLength=${numeric(element.startHandleLength)}`,
        `endAngle=${numeric(element.endHandleAngleDeg)}`,
        `endLength=${numeric(element.endHandleLength)}`,
        ...intermediatePoints(element),
        ...attrs
      ].join(" ");
    case "offsetLine":
      return [
        "line",
        elementName(element),
        "=",
        "offset",
        `[${element.baseLineIds.join(",")}]`,
        `distance=${numeric(element.offset)}`,
        `side=${element.side}`,
        `closed=${element.closed}`,
        ...attrs
      ].join(" ");
    case "splitLine":
      return [
        "line",
        elementName(element),
        "=",
        "split",
        element.baseLineId,
        `at=${anchor(element.splitPoint)}`,
        ...attrs
      ].join(" ");
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
      return [
        "arc",
        elementName(element),
        "=",
        "through",
        anchor(element.point1),
        anchor(element.point2),
        anchor(element.point3),
        `start=${numeric(element.startAngleDeg)}`,
        `end=${numeric(element.endAngleDeg)}`,
        ...attrs
      ].join(" ");
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
        `sourcePath=${quoteDslString(element.sourcePath)}`,
        `originPoint=${anchor(element.originPoint)}`,
        `scale=${numeric(element.scale)}`,
        `angleDeg=${numeric(element.angleDeg)}`,
        `mirrorX=${element.mirrorX}`
      ]);
  }
  })
].join("\n");

const visibilitySettingsDsl = (options: SerializeDslOptions) => {
  const roles = options.visibilityRoles ?? [];
  const profiles = options.visibilityProfiles ?? [];
  const printLayouts = options.printLayouts ?? [];
  const lines: string[] = [];

  for (const role of roles) {
    lines.push(["role", formatDslName(role.id), `name=${quoteDslString(role.name)}`].join(" "));
  }
  for (const profile of profiles) {
    const roleAttrs = roles.map((role) =>
      `${role.id}=${profile.roleVisibility[role.id] ?? profile.defaultRoleVisible}`
    );
    lines.push([
      "view",
      formatDslName(profile.name || profile.id),
      ...(profile.id === profile.name ? [] : [`id=${formatDslName(profile.id)}`]),
      `default=${profile.defaultRoleVisible}`,
      ...roleAttrs
    ].join(" "));
  }
  if (options.activeVisibilityProfileId) {
    lines.push(["activeView", formatDslName(options.activeVisibilityProfileId)].join(" "));
  }
  for (const layout of printLayouts) {
    if (!layout.visibilityProfileId) continue;
    lines.push([
      "printLayout",
      formatDslName(layout.name.trim() || layout.id),
      `id=${formatDslName(layout.id)}`,
      `output=${layout.outputKind}`,
      `visibilityView=${layout.visibilityProfileId}`
    ].join(" "));
  }
  return lines.length > 0 ? [...lines, ""] : [];
};
