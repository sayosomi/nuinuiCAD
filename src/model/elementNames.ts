import { elementTypeLabels } from "../types/geometry";
import type { CadElement, CadElementType, ElementId, PointAnchor } from "../types/geometry";

const defaultNameBases: Record<CadElementType, string> = {
  group: "グループ",
  conditionalGroup: "ifブロック",
  forGroup: "forブロック",
  freePoint: "点",
  offsetPoint: "オフセット点",
  polarOffsetPoint: "角度距離点",
  divisionPoint: "分点",
  lineDivisionPoint: "線上分点",
  intersectionPoint: "交点",
  lineTangentOffsetPoint: "線上オフセット点",
  line: "直線",
  angleLengthLine: "角度距離線",
  arcLine: "円弧線",
  threePointArcLine: "三点円弧線",
  cornerRadiusArcLine: "角R円弧線",
  edge: "エッジ",
  extendTrim: "延長短縮",
  bezierCurve: "曲線",
  offsetLine: "オフセット線",
  splitLine: "分割線",
  copyLine: "コピー線",
  symmetricCopyLine: "対称コピー線",
  move: "移動",
  symmetricMove: "対称移動",
  image: "画像",
  text: "テキスト"
};

const normalizeName = (name: string, fallbackBaseName: string) => {
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName : fallbackBaseName;
};

export const fallbackElementName = (type: CadElementType) => defaultNameBases[type];

const ROOT_NAMESPACE = "__root__";

const namespaceKey = (parentGroupId: ElementId | undefined) => parentGroupId ?? ROOT_NAMESPACE;

export type ElementNameToken = { token: string; element: CadElement };

export type ElementNameContext = {
  elements: CadElement[];
  elementsById: Map<ElementId, CadElement>;
  childrenByNamespace: Map<string, Map<string, CadElement[]>>;
  qualifiedNameById: Map<ElementId, string>;
  tokensByNamespaceKey: Map<string, ElementNameToken[]>;
};

const parentGroupIdForElement = (
  elementsById: Map<ElementId, CadElement>,
  elementId: ElementId | undefined
) => elementId ? elementsById.get(elementId)?.parentGroupId : undefined;

const groupPathForElement = (
  element: CadElement,
  elementsById: Map<ElementId, CadElement>
) => {
  const path: CadElement[] = [];
  const visited = new Set<ElementId>();
  let parentId = element.parentGroupId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = elementsById.get(parentId);
    if (!parent) break;
    path.unshift(parent);
    parentId = parent.parentGroupId;
  }
  return path;
};

const namespaceChainForElement = (
  element: Pick<CadElement, "parentGroupId"> | undefined,
  elementsById: Map<ElementId, CadElement>
) => {
  const chain: Array<ElementId | undefined> = [];
  const visited = new Set<ElementId>();
  let namespaceId = element?.parentGroupId;
  while (namespaceId && !visited.has(namespaceId)) {
    chain.push(namespaceId);
    visited.add(namespaceId);
    namespaceId = elementsById.get(namespaceId)?.parentGroupId;
  }
  chain.push(undefined);
  return chain;
};

export type ElementNameResolution =
  | { status: "resolved"; element: CadElement }
  | { status: "missing" }
  | { status: "ambiguous"; name: string; elements: CadElement[] };

export type ElementNamePath = {
  absolute: boolean;
  parts: string[];
};

const elementById = (elements: CadElement[]) =>
  new Map(elements.map((element) => [element.id, element]));

const buildChildrenByNamespace = (elements: CadElement[]) => {
  const childrenByNamespace = new Map<string, Map<string, CadElement[]>>();
  for (const element of elements) {
    const name = element.name.trim();
    if (!name) continue;
    const key = namespaceKey(element.parentGroupId);
    const names = childrenByNamespace.get(key) ?? new Map<string, CadElement[]>();
    names.set(name, [...(names.get(name) ?? []), element]);
    childrenByNamespace.set(key, names);
  }
  return childrenByNamespace;
};

const buildQualifiedNameById = (
  elements: CadElement[],
  elementsById: Map<ElementId, CadElement>
) => {
  const qualifiedNameById = new Map<ElementId, string>();
  const pathNamesById = new Map<ElementId, string[]>();
  const visiting = new Set<ElementId>();

  const pathNames = (element: CadElement): string[] => {
    const cached = pathNamesById.get(element.id);
    if (cached) return cached;
    if (visiting.has(element.id)) return [element.name].filter(Boolean);
    visiting.add(element.id);
    const parent = element.parentGroupId ? elementsById.get(element.parentGroupId) : undefined;
    const value = [...(parent ? pathNames(parent) : []), element.name].filter(Boolean);
    visiting.delete(element.id);
    pathNamesById.set(element.id, value);
    return value;
  };

  const qualifiedName = (element: CadElement): string => {
    const value = pathNames(element).join("::") || element.id;
    qualifiedNameById.set(element.id, value);
    return value;
  };

  for (const element of elements) qualifiedName(element);
  return qualifiedNameById;
};

export const createElementNameContext = (elements: CadElement[]): ElementNameContext => {
  const elementsById = elementById(elements);
  return {
    elements,
    elementsById,
    childrenByNamespace: buildChildrenByNamespace(elements),
    qualifiedNameById: buildQualifiedNameById(elements, elementsById),
    tokensByNamespaceKey: new Map()
  };
};

const elementsNamedInNamespace = (
  elements: CadElement[],
  namespaceId: ElementId | undefined,
  name: string
) => elements.filter((element) =>
  element.parentGroupId === namespaceId &&
  element.name.trim() === name
);

const resolveNameSegmentInNamespace = (
  elements: CadElement[],
  namespaceId: ElementId | undefined,
  name: string,
  context?: ElementNameContext
): ElementNameResolution => {
  // context指定時はchildrenByNamespaceのみを信頼する。この索引はミスも
  // 含めて正しい結果を返すため(buildChildrenByNamespaceがelementsNamedInNamespace
  // と同じ条件で構築済み)、ミス時に全要素へフォールバックすると名前解決の
  // 呼び出し毎コストがO(n)化する(namespaceチェーンを辿る過程でミスは
  // 正常系として頻発するため実質O(n^2))。contextなしの互換経路のみ線形スキャン。
  const matches = context
    ? context.childrenByNamespace.get(namespaceKey(namespaceId))?.get(name) ?? []
    : elementsNamedInNamespace(elements, namespaceId, name);
  if (matches.length === 1) return { status: "resolved", element: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", name, elements: matches };
  return { status: "missing" };
};

const resolveQualifiedNameFromNamespace = (
  parts: string[],
  namespaceId: ElementId | undefined,
  elements: CadElement[],
  context?: ElementNameContext
): ElementNameResolution => {
  let currentNamespaceId = namespaceId;
  let resolved: CadElement | null = null;

  for (const [index, part] of parts.entries()) {
    const resolution = resolveNameSegmentInNamespace(elements, currentNamespaceId, part, context);
    if (resolution.status !== "resolved") return resolution;
    resolved = resolution.element;
    if (index < parts.length - 1) {
      currentNamespaceId = resolved.id;
    }
  }

  return resolved ? { status: "resolved", element: resolved } : { status: "missing" };
};

export const resolveElementNamePath = ({
  path,
  elements,
  currentElement,
  context
}: {
  path: ElementNamePath;
  elements: CadElement[];
  currentElement?: Pick<CadElement, "parentGroupId">;
  context?: ElementNameContext;
}): ElementNameResolution => {
  const parts = path.parts.map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { status: "missing" };
  const elementsById = context?.elementsById ?? elementById(elements);
  const directElement = !path.absolute && parts.length === 1
    ? elementsById.get(parts[0])
    : undefined;
  if (directElement) return { status: "resolved", element: directElement };

  if (path.absolute || parts.length > 1) {
    const namespaces = path.absolute
      ? [undefined]
      : namespaceChainForElement(currentElement, elementsById);
    for (const namespaceId of namespaces) {
      const resolution = resolveQualifiedNameFromNamespace(parts, namespaceId, elements, context);
      if (resolution.status === "resolved" || resolution.status === "ambiguous") return resolution;
    }
    return { status: "missing" };
  }

  for (const namespaceId of namespaceChainForElement(currentElement, elementsById)) {
    const resolution = resolveNameSegmentInNamespace(elements, namespaceId, parts[0], context);
    if (resolution.status === "resolved" || resolution.status === "ambiguous") return resolution;
  }
  return { status: "missing" };
};

export const resolveElementName = ({
  token,
  elements,
  currentElement,
  context
}: {
  token: string;
  elements: CadElement[];
  currentElement?: Pick<CadElement, "parentGroupId">;
  context?: ElementNameContext;
}): ElementNameResolution => {
  const trimmedToken = token.trim();
  return resolveElementNamePath({
    path: {
      absolute: trimmedToken.startsWith("::"),
      parts: trimmedToken.replace(/^::/, "").split("::")
    },
    elements,
    currentElement,
    context
  });
};

export const elementQualifiedNameParts = (
  element: CadElement,
  elements: CadElement[],
  context?: ElementNameContext
) => {
  const elementsById = context?.elementsById ?? elementById(elements);
  return [...groupPathForElement(element, elementsById).map((group) => group.name), element.name]
    .filter(Boolean);
};

export const elementQualifiedName = (
  element: CadElement,
  elements: CadElement[],
  context?: ElementNameContext
) => {
  const contextValue = context;
  const cached = contextValue?.qualifiedNameById.get(element.id);
  if (cached !== undefined) return cached;
  return elementQualifiedNameParts(element, elements, contextValue).join("::") || element.id;
};

export const elementNameTokensForContext = ({
  elements,
  currentElement,
  context
}: {
  elements: CadElement[];
  currentElement?: Pick<CadElement, "parentGroupId">;
  context?: ElementNameContext;
}) => {
  const contextValue = context ?? createElementNameContext(elements);
  const cacheKey = namespaceKey(currentElement?.parentGroupId);
  const cached = contextValue.tokensByNamespaceKey.get(cacheKey);
  if (cached) return cached;

  const tokens: ElementNameToken[] = [];
  for (const element of contextValue.elements) {
    if (!element.name.trim()) continue;
    const candidates = new Set([element.name, elementQualifiedName(element, elements, contextValue)]);
    for (const token of candidates) {
      const resolution = resolveElementName({ token, elements, currentElement, context: contextValue });
      if (resolution.status === "resolved" && resolution.element.id === element.id) {
        tokens.push({ token, element });
      }
    }
  }
  const sortedTokens = tokens.sort((a, b) => b.token.length - a.token.length);
  contextValue.tokensByNamespaceKey.set(cacheKey, sortedTokens);
  return sortedTokens;
};

const isPointLikeElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint" ||
  element.type === "divisionPoint" ||
  element.type === "lineDivisionPoint" ||
  element.type === "intersectionPoint" ||
  element.type === "lineTangentOffsetPoint";

const lineNamePrefixes = [
  "直線",
  "曲線",
  "円弧線",
  "三点円弧線",
  "角R円弧線",
  "オフセット線",
  "分割線",
  "コピー線",
  "対称コピー線"
];

const compactName = (name: string) => name.trim().replace(/\s+/g, "");

const stripKnownPrefix = (name: string, prefixes: string[]) => {
  const compact = compactName(name);
  const prefix = prefixes.find((item) => compact.startsWith(item) && compact.length > item.length);
  return prefix ? compact.slice(prefix.length) : compact;
};

const pointToken = (element: CadElement | undefined) =>
  element && isPointLikeElement(element)
    ? stripKnownPrefix(element.name, ["点"])
    : null;

const lineToken = (element: CadElement | undefined) =>
  element ? stripKnownPrefix(element.name, lineNamePrefixes) : null;

const anchorToken = (anchor: PointAnchor | undefined, elementsById: Map<ElementId, CadElement>) => {
  if (!anchor) return null;
  if (anchor.mode === "reference") return pointToken(elementsById.get(anchor.pointId));
  if (anchor.mode === "derived") {
    const source = elementsById.get(anchor.elementId);
    const sourceToken = lineToken(source);
    if (!sourceToken) return null;
    if (anchor.pointKey === "start") return `${sourceToken}始`;
    if (anchor.pointKey === "end") return `${sourceToken}終`;
    return sourceToken;
  }
  return null;
};

const isShortToken = (token: string) => /^[A-Za-z0-9]+$/.test(token) && token.length <= 2;

const joinTokens = (first: string | null, second: string | null) => {
  if (!first || !second) return null;
  if (first === second) return first;
  return isShortToken(first) && isShortToken(second) ? `${first}${second}` : `${first}_${second}`;
};

const linePairToken = (
  firstLineId: ElementId | undefined,
  secondLineId: ElementId | undefined,
  elementsById: Map<ElementId, CadElement>
) => {
  const first = lineToken(firstLineId ? elementsById.get(firstLineId) : undefined);
  const second = lineToken(secondLineId ? elementsById.get(secondLineId) : undefined);
  if (!first || !second) return null;
  return first === second ? first : `${first}_${second}`;
};

const lineListToken = (lineIds: ElementId[] | undefined, elementsById: Map<ElementId, CadElement>) =>
  lineToken(lineIds?.[0] ? elementsById.get(lineIds[0]) : undefined);

const columnName = (index: number) => {
  let value = index;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
};

const fallbackCreatedName = (element: CadElement, elements: CadElement[]) =>
  `${fallbackElementName(element.type)}${elements.filter((item) => item.type === element.type).length + 1}`;

export const createdElementName = ({
  element,
  elements,
  referenceElements = elements
}: {
  element: CadElement;
  elements: CadElement[];
  referenceElements?: CadElement[];
}) => {
  const elementsById = elementById([...elements, ...referenceElements]);
  const fallbackName = fallbackCreatedName(element, elements);
  const name = (() => {
    switch (element.type) {
      case "freePoint":
        return `点${columnName(referenceElements.filter(isPointLikeElement).length + 1)}`;
      case "offsetPoint": {
        const token = pointToken(elementsById.get(element.fromPoint?.mode === "reference" ? element.fromPoint.pointId : element.fromPointId ?? ""));
        return token ? `点${token}オフセット` : fallbackName;
      }
      case "polarOffsetPoint": {
        const token = pointToken(elementsById.get(element.fromPoint?.mode === "reference" ? element.fromPoint.pointId : element.fromPointId ?? ""));
        return token ? `点${token}極座標` : fallbackName;
      }
      case "divisionPoint": {
        const token = joinTokens(anchorToken(element.startPoint, elementsById), anchorToken(element.endPoint, elementsById));
        return token ? `分点${token}` : fallbackName;
      }
      case "lineDivisionPoint": {
        const token = lineToken(elementsById.get(element.endpoint.lineId));
        return token ? `${token}分点` : fallbackName;
      }
      case "intersectionPoint": {
        const token = linePairToken(element.line1Id, element.line2Id, elementsById);
        return token ? `交点${token}` : fallbackName;
      }
      case "lineTangentOffsetPoint": {
        const token = lineToken(elementsById.get(element.baseLineId));
        return token ? `${token}上オフセット点` : fallbackName;
      }
      case "line": {
        const token = joinTokens(anchorToken(element.startPoint, elementsById), anchorToken(element.endPoint, elementsById));
        return token ? `直線${token}` : fallbackName;
      }
      case "angleLengthLine": {
        const token = anchorToken(element.startPoint, elementsById);
        return token ? `${token}方向線` : fallbackName;
      }
      case "arcLine": {
        const token = anchorToken(element.centerPoint, elementsById);
        return token ? `${token}円弧` : fallbackName;
      }
      case "threePointArcLine": {
        const token = joinTokens(anchorToken(element.point1, elementsById), anchorToken(element.point3, elementsById));
        return token ? `円弧${token}` : fallbackName;
      }
      case "cornerRadiusArcLine": {
        const token = linePairToken(element.endpoint1.lineId, element.endpoint2.lineId, elementsById);
        return token ? `${token}角R` : fallbackName;
      }
      case "edge": {
        const token = linePairToken(element.endpoint1.lineId, element.endpoint2.lineId, elementsById);
        return token ? `${token}エッジ` : fallbackName;
      }
      case "extendTrim": {
        const token = lineToken(elementsById.get(element.endpoint.lineId));
        return token ? `${token}延長短縮` : fallbackName;
      }
      case "bezierCurve": {
        const token = joinTokens(anchorToken(element.startPoint, elementsById), anchorToken(element.endPoint, elementsById));
        return token ? `曲線${token}` : fallbackName;
      }
      case "offsetLine": {
        const token = lineListToken(element.baseLineIds, elementsById);
        return token ? `${token}オフセット` : fallbackName;
      }
      case "splitLine": {
        const token = lineToken(elementsById.get(element.baseLineId));
        return token ? `${token}分割` : fallbackName;
      }
      case "copyLine": {
        const token = lineListToken(element.baseLineIds, elementsById);
        return token ? `${token}コピー` : fallbackName;
      }
      case "move": {
        const token = lineListToken(element.baseLineIds, elementsById);
        return token ? `${token}移動` : fallbackName;
      }
      case "symmetricCopyLine": {
        const token = lineListToken(element.baseLineIds, elementsById);
        return token ? `${token}対称コピー` : fallbackName;
      }
      case "symmetricMove": {
        const token = lineListToken(element.baseLineIds, elementsById);
        return token ? `${token}対称移動` : fallbackName;
      }
      default:
        return fallbackName;
    }
  })();

  return makeUniqueElementName({
    elements,
    elementId: element.id,
    requestedName: name,
    fallbackBaseName: fallbackElementName(element.type),
    parentGroupId: element.parentGroupId
  });
};

export const withCreatedElementName = <Element extends CadElement>(
  element: Element,
  elements: CadElement[],
  referenceElements?: CadElement[]
): Element => ({
  ...element,
  name: createdElementName({ element, elements, referenceElements })
});

export const makeUniqueElementName = ({
  elements,
  elementId,
  requestedName,
  fallbackBaseName,
  parentGroupId
}: {
  elements: CadElement[];
  elementId?: ElementId;
  requestedName: string;
  fallbackBaseName: string;
  parentGroupId?: ElementId;
}) => {
  const baseName = normalizeName(requestedName, fallbackBaseName);
  const elementsById = elementById(elements);
  const targetNamespaceKey = namespaceKey(parentGroupId ?? parentGroupIdForElement(elementsById, elementId));
  const usedNames = new Set(
    elements
      .filter((element) => element.id !== elementId)
      .filter((element) => namespaceKey(element.parentGroupId) === targetNamespaceKey)
      .map((element) => element.name.trim())
      .filter(Boolean)
  );

  if (!usedNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (usedNames.has(`${baseName} ${suffix}`)) {
    suffix += 1;
  }

  return `${baseName} ${suffix}`;
};

export const formatReferenceOptionLabel = (element: CadElement, elements?: CadElement[]) => {
  const label = elements ? elementQualifiedName(element, elements) : element.name;
  return `${label} - ${elementTypeLabels[element.type]}`;
};
