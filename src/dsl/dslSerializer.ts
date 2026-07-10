import { numericValueExpression } from "../geometry/numericExpressions";
import {
  createElementNameContext,
  elementQualifiedNameParts,
  resolveElementName
} from "../model/elementNames";
import { pointAnchorForElement } from "../model/pointAnchors";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { formatNumericValueForDsl } from "./dslExpressionFormat";
import { formatDslReferencePath, formatDslReferenceToken } from "./dslReferenceTokens";
import type { SerializeDslOptions } from "./dslTypes";
import { formatDslName, quoteDslString } from "./dslTokens";

// 要素→DSL文の変換は、参照の書き方(生ID or 解決可能な名前トークン)を
// DslSerializerRefs として注入する。serializeElementsToDsl(DslPanelの
// フラットな書き出し形式)は従来どおり生ID参照で、バイト互換を維持する。
export type DslSerializerRefs = {
  token: (id: ElementId, source: CadElement) => string;
  anchor: (value: PointAnchor | null | undefined, source: CadElement) => string;
  endpoint: (value: LineEndpointReference, source: CadElement) => string;
  numeric: (value: NumericValue, source: CadElement) => string;
  name: (element: CadElement) => string;
  baseAttrs: (element: CadElement) => string[];
  includeRecordIds: boolean;
};

const commonBaseAttrs = (element: CadElement, includeParameterSteps = false) => [
  ...(element.locked ? ["locked=true"] : []),
  ...(element.visible ? [] : ["visible=false"]),
  ...(element.enabled ? [] : ["enabled=false"]),
  ...(element.colorId ? [`color=${element.colorId}`] : []),
  ...(includeParameterSteps && element.numericParameterSteps && Object.keys(element.numericParameterSteps).length > 0
    ? [`steps=[${Object.entries(element.numericParameterSteps)
        .map(([key, value]) => `${key}:${value}`)
        .join(";")}]`]
    : []),
  ...(element.type === "group" && element.visibilityRoleIds?.length
    ? [`roles=[${element.visibilityRoleIds.join(",")}]`]
    : [])
];

const flatAnchor = (value: PointAnchor | null | undefined) => {
  if (!value) return "none";
  if (value.mode === "reference") return value.pointId;
  if (value.mode === "derived") return `${value.elementId}.${value.pointKey}`;
  return `(${numericValueExpression(value.x)}, ${numericValueExpression(value.y)})`;
};

const flatRefs = (options: SerializeDslOptions): DslSerializerRefs => ({
  token: (id) => id,
  anchor: (value) => flatAnchor(value),
  endpoint: (value) => `${value.lineId}.${value.endpointKey}`,
  numeric: (value) => numericValueExpression(value),
  name: (element) => formatDslName(element.name || element.id),
  baseAttrs: (element) => [
    ...(options.includeIds === false ? [] : [`id=${element.id}`]),
    ...commonBaseAttrs(element),
    ...(element.parentGroupId ? [`parent=${element.parentGroupId}`] : []),
    ...(element.conditionalBranch ? [`branch=${element.conditionalBranch}`] : [])
  ],
  includeRecordIds: true
});

// 文書グラマー用: 参照を解決可能な名前トークンで書き、id= / parent= /
// branch= を出力しない(構造は後続のブロックシリアライザが担う)。
// 参照先が無名・消滅している場合は生IDトークンのまま出力し、決して例外を
// 投げない(再パース時に明示的な依存診断になる)。
export const documentDslRefs = (elements: CadElement[]): DslSerializerRefs => {
  const nameContext = createElementNameContext(elements);
  const elementsById = nameContext.elementsById;
  const token = (id: ElementId, source: CadElement) => {
    const target = elementsById.get(id);
    if (!target || !target.name.trim()) return formatDslReferenceToken(id);
    const resolution = resolveElementName({ token: target.name, elements, currentElement: source, context: nameContext });
    if (resolution.status === "resolved" && resolution.element.id === id) {
      return formatDslName(target.name);
    }
    return formatDslReferencePath({
      absolute: false,
      segments: elementQualifiedNameParts(target, elements, nameContext)
    });
  };
  const numeric = (value: NumericValue, source: CadElement) =>
    formatNumericValueForDsl(value, elements, source.numericVariables ?? [], source, nameContext);
  return {
    token,
    anchor: (value, source) => {
      if (!value) return "none";
      if (value.mode === "reference") return token(value.pointId, source);
      if (value.mode === "derived") return `${token(value.elementId, source)}.${value.pointKey}`;
      return `(${numeric(value.x, source)}, ${numeric(value.y, source)})`;
    },
    endpoint: (value, source) => `${token(value.lineId, source)}.${value.endpointKey}`,
    numeric,
    // 無名要素は名前トークンを一切出力しない(空文字列)。ID
    // フォールバックは「参照される側」(token関数)のみの役割で、
    // 「文自身の名前」には適用しない — さもないと無名要素が
    // 「IDという名前を持つ要素」として再パースされてしまう。
    name: (element) => (element.name.trim() ? formatDslName(element.name) : ""),
    baseAttrs: (element) => commonBaseAttrs(element, true),
    includeRecordIds: false
  };
};

const intermediatePoints = (
  element: Extract<CadElement, { type: "bezierCurve" }>,
  refs: DslSerializerRefs
) =>
  element.intermediatePoints.length === 0
    ? []
    : [
        `intermediates=[${
          element.intermediatePoints.map((point) => [
            refs.anchor(point.point, element),
            refs.numeric(point.handleAngleDeg, element),
            refs.numeric(point.incomingHandleLength, element),
            refs.numeric(point.outgoingHandleLength, element),
            ...(refs.includeRecordIds ? [point.id] : [])
          ].join(":")).join(";")
        }]`
      ];

const localVariableAttrs = (element: CadElement, refs: DslSerializerRefs) => {
  if (!element.numericVariables?.length) return [];
  return [
    `vars=[${element.numericVariables.map((variable) =>
      `${formatDslName(variable.name)}:${refs.numeric(variable.value, element)}`
    ).join(";")}]`
  ];
};

const variableModeAttrs = (
  element: Extract<CadElement, { type: "variable" }>,
  refs: DslSerializerRefs
) => {
  if (element.valueMode === "expression") return [];
  const points = element.valueMode === "pointLineDistance"
    ? [
        `point=${refs.anchor(element.point, element)}`,
        `line=${refs.token(element.lineId, element)}`
      ]
    : [
        `point1=${refs.anchor(element.point1, element)}`,
        `point2=${refs.anchor(element.point2, element)}`
      ];
  return [`mode=${element.valueMode}`, ...points];
};

const elementLine = (
  element: CadElement,
  refs: DslSerializerRefs,
  attrs: string[] = []
) =>
  [
    "element",
    refs.name(element),
    `type=${element.type}`,
    ...refs.baseAttrs(element),
    ...attrs
  ].filter(Boolean).join(" ");

export const serializeElementStatement = (
  element: CadElement,
  refs: DslSerializerRefs
): string => {
  const attrs = [...refs.baseAttrs(element), ...localVariableAttrs(element, refs)];
  const name = refs.name(element);
  const anchor = (value: PointAnchor | null | undefined) => refs.anchor(value, element);
  const endpoint = (value: LineEndpointReference) => refs.endpoint(value, element);
  const numeric = (value: NumericValue) => refs.numeric(value, element);
  const token = (id: ElementId) => refs.token(id, element);

  switch (element.type) {
    case "group": {
      const defaultPrintAnchor =
        !element.printAnchor ||
        (element.printAnchor.mode === "coordinate" &&
          element.printAnchor.x === 0 &&
          element.printAnchor.y === 0);
      return [
        "group",
        name,
        ...attrs,
        ...(element.printEnabled ? ["printEnabled=true"] : []),
        ...(defaultPrintAnchor ? [] : [`printAnchor=${anchor(element.printAnchor)}`])
      ].filter(Boolean).join(" ");
    }
    case "variable":
      return [
        "var",
        name,
        "=",
        numeric(element.expression),
        ...variableModeAttrs(element, refs),
        ...(element.scope === "group" ? ["scope=group"] : []),
        ...attrs
      ].filter(Boolean).join(" ");
    case "freePoint":
      return ["point", name, "=", `(${numeric(element.x)}, ${numeric(element.y)})`, ...attrs].filter(Boolean).join(" ");
    case "offsetPoint":
      return [
        "point",
        name,
        "=",
        "offset",
        anchor(pointAnchorForElement(element)),
        `dx=${numeric(element.dx)}`,
        `dy=${numeric(element.dy)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "polarOffsetPoint":
      return [
        "point",
        name,
        "=",
        "polar",
        anchor(pointAnchorForElement(element)),
        `angle=${numeric(element.angleDeg)}`,
        `distance=${numeric(element.distance)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "line":
      return ["line", name, "=", anchor(element.startPoint), "->", anchor(element.endPoint), ...attrs].filter(Boolean).join(" ");
    case "angleLengthLine":
      return [
        "line",
        name,
        "=",
        "from",
        anchor(element.startPoint),
        `angle=${numeric(element.angleDeg)}`,
        `length=${numeric(element.length)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "arcLine":
      return [
        "arc",
        name,
        `center=${anchor(element.centerPoint)}`,
        `radius=${numeric(element.radius)}`,
        `start=${numeric(element.startAngleDeg)}`,
        `end=${numeric(element.endAngleDeg)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "text":
      return [
        "text",
        name,
        "=",
        quoteDslString(element.text),
        `at=${anchor(element.anchor)}`,
        `size=${numeric(element.fontSize)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "divisionPoint":
      return [
        "point",
        name,
        "=",
        "between",
        anchor(element.startPoint),
        anchor(element.endPoint),
        element.placementMode === "distance"
          ? `distance=${numeric(element.distance)}`
          : `ratio=${numeric(element.ratio)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "lineDivisionPoint":
      return [
        "point",
        name,
        "=",
        "on",
        endpoint(element.endpoint),
        element.placementMode === "distance"
          ? `distance=${numeric(element.distance)}`
          : `ratio=${numeric(element.ratio)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "intersectionPoint":
      return [
        "point",
        name,
        "=",
        "intersection",
        token(element.line1Id),
        token(element.line2Id),
        `index=${numeric(element.intersectionIndex)}`,
        `extensions=${element.useExtensions}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "lineTangentOffsetPoint":
      return [
        "point",
        name,
        "=",
        "tangentOffset",
        token(element.baseLineId),
        `base=${anchor(element.basePoint)}`,
        `angle=${numeric(element.tangentAngleDeg)}`,
        `distance=${numeric(element.distance)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "cornerRadiusArcLine":
      return [
        "arc",
        name,
        "=",
        "corner",
        endpoint(element.endpoint1),
        endpoint(element.endpoint2),
        `radius=${numeric(element.radius)}`,
        `index=${numeric(element.intersectionIndex)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "edge":
      return elementLine(element, refs, [
        ...localVariableAttrs(element, refs),
        `endpoint1=${endpoint(element.endpoint1)}`,
        `endpoint2=${endpoint(element.endpoint2)}`,
        `intersectionIndex=${numeric(element.intersectionIndex)}`
      ]);
    case "extendTrim":
      return [
        "line",
        name,
        "=",
        "extend",
        endpoint(element.endpoint),
        `to=${anchor(element.point)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "bezierCurve":
      return [
        "curve",
        name,
        "=",
        anchor(element.startPoint),
        "->",
        anchor(element.endPoint),
        `startAngle=${numeric(element.startHandleAngleDeg)}`,
        `startLength=${numeric(element.startHandleLength)}`,
        `endAngle=${numeric(element.endHandleAngleDeg)}`,
        `endLength=${numeric(element.endHandleLength)}`,
        ...intermediatePoints(element, refs),
        ...attrs
      ].filter(Boolean).join(" ");
    case "offsetLine":
      return [
        "line",
        name,
        "=",
        "offset",
        `[${element.baseLineIds.map(token).join(",")}]`,
        `distance=${numeric(element.offset)}`,
        `side=${element.side}`,
        `closed=${element.closed}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "splitLine":
      return [
        "line",
        name,
        "=",
        "split",
        token(element.baseLineId),
        `at=${anchor(element.splitPoint)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "copyLine":
    case "move":
      return elementLine(element, refs, [
        ...localVariableAttrs(element, refs),
        `startPoint=${anchor(element.startPoint)}`,
        `endPoint=${anchor(element.endPoint)}`,
        `scale=${numeric(element.scale)}`,
        `angleDeg=${numeric(element.angleDeg)}`,
        `mirrorX=${element.mirrorX}`,
        `baseLineIds=[${element.baseLineIds.map(token).join(",")}]`
      ]);
    case "symmetricCopyLine":
    case "symmetricMove":
      return elementLine(element, refs, [
        ...localVariableAttrs(element, refs),
        `axisPoint1=${anchor(element.axisPoint1)}`,
        `axisPoint2=${anchor(element.axisPoint2)}`,
        `baseLineIds=[${element.baseLineIds.map(token).join(",")}]`
      ]);
    case "threePointArcLine":
      return [
        "arc",
        name,
        "=",
        "through",
        anchor(element.point1),
        anchor(element.point2),
        anchor(element.point3),
        `start=${numeric(element.startAngleDeg)}`,
        `end=${numeric(element.endAngleDeg)}`,
        ...attrs
      ].filter(Boolean).join(" ");
    case "conditionalGroup":
      return elementLine(element, refs, [
        ...localVariableAttrs(element, refs),
        `condition=${numeric(element.condition)}`,
      ]);
    case "forGroup":
      return elementLine(element, refs, [
        ...localVariableAttrs(element, refs),
        `variableName=${element.variableName}`,
        `start=${numeric(element.start)}`,
        `count=${numeric(element.count)}`,
        `step=${numeric(element.step)}`,
        `showGenerated=${element.showGenerated}`
      ]);
    case "image":
      return elementLine(element, refs, [
        ...localVariableAttrs(element, refs),
        `sourcePath=${quoteDslString(element.sourcePath)}`,
        `originPoint=${anchor(element.originPoint)}`,
        ...(refs.includeRecordIds ? [] : [
          `naturalWidthPx=${element.naturalWidthPx}`,
          `naturalHeightPx=${element.naturalHeightPx}`,
          `sourceDpi=${element.sourceDpi}`,
          `targetPixelsPerMm=${element.targetPixelsPerMm}`
        ]),
        `scale=${numeric(element.scale)}`,
        `angleDeg=${numeric(element.angleDeg)}`,
        `mirrorX=${element.mirrorX}`
      ]);
  }
};

export const serializeElementsToDsl = (
  elements: CadElement[],
  options: SerializeDslOptions = {}
) => {
  const refs = flatRefs(options);
  return [
    ...visibilitySettingsDsl(options),
    ...elements.map((element) => serializeElementStatement(element, refs))
  ].join("\n");
};

// role/view/activeView の行単位シリアライザ。フラット出力
// (visibilitySettingsDsl)・文書グラマー(dslDocument.ts)・行パッチ
// (src/document/textPatch.ts)から共有される。
export const serializeRoleLine = (role: VisibilityRole): string =>
  ["role", formatDslName(role.id), `name=${quoteDslString(role.name)}`].filter(Boolean).join(" ");

export const serializeViewLine = (profile: VisibilityProfile, roles: VisibilityRole[]): string => {
  const knownRoleIds = new Set(roles.map((role) => role.id));
  const roleAttrs = [
    ...roles.map((role) =>
      `${role.id}=${profile.roleVisibility[role.id] ?? profile.defaultRoleVisible}`
    ),
    ...Object.entries(profile.roleVisibility)
      .filter(([roleId]) => !knownRoleIds.has(roleId))
      .map(([roleId, visible]) => `${roleId}=${visible}`)
  ];
  return [
    "view",
    formatDslName(profile.name || profile.id),
    ...(profile.id === profile.name ? [] : [`id=${formatDslName(profile.id)}`]),
    `default=${profile.defaultRoleVisible}`,
    ...roleAttrs
  ].filter(Boolean).join(" ");
};

export const serializeActiveViewLine = (activeProfileId: string): string =>
  ["activeView", formatDslName(activeProfileId)].filter(Boolean).join(" ");

export const serializeVisibilitySettingsLines = (
  roles: VisibilityRole[],
  profiles: VisibilityProfile[],
  activeProfileId: string | undefined
): string[] => [
  ...roles.map(serializeRoleLine),
  ...profiles.map((profile) => serializeViewLine(profile, roles)),
  ...(activeProfileId ? [serializeActiveViewLine(activeProfileId)] : [])
];

const visibilitySettingsDsl = (options: SerializeDslOptions) => {
  const printLayouts = options.printLayouts ?? [];
  const lines: string[] = [
    ...serializeVisibilitySettingsLines(
      options.visibilityRoles ?? [],
      options.visibilityProfiles ?? [],
      options.activeVisibilityProfileId
    )
  ];
  for (const layout of printLayouts) {
    if (!layout.visibilityProfileId) continue;
    lines.push([
      "printLayout",
      formatDslName(layout.name.trim() || layout.id),
      `id=${formatDslName(layout.id)}`,
      `output=${layout.outputKind}`,
      `visibilityView=${layout.visibilityProfileId}`
    ].filter(Boolean).join(" "));
  }
  return lines.length > 0 ? [...lines, ""] : [];
};
