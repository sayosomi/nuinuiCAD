import { makeNumericExpression, normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import { createCadElementId } from "../model/cadIds";
import { createCadElement } from "../model/elementFactory";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import { normalizePrintLayout } from "../print/printLayout";
import type {
  CadElement,
  CadElementType,
  ElementId,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { isElementDslStatement, parseDsl } from "./dslParser";
import {
  createNameIndex,
  resolveAnchor,
  resolveEndpoint,
  resolveId,
  type NameIndex
} from "./dslReferences";
import type { CompileDslContext, CompileDslResult, DslAttribute, DslDiagnostic, DslStatement } from "./dslTypes";
import { splitDslList, splitDslRecords, unquoteDslString } from "./dslTokens";

const attr = (attrs: DslAttribute[], key: string) =>
  attrs.find((item) => item.key === key)?.value;

const statementType = (statement: DslStatement): CadElementType => {
  if (statement.kind === "element") return statement.type ?? "group";
  if (statement.kind === "variable") return "variable";
  return statement.kind as CadElementType;
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

const booleanValue = (value: string) =>
  ["true", "1", "yes", "on"].includes(value.toLowerCase())
    ? true
    : ["false", "0", "no", "off"].includes(value.toLowerCase())
      ? false
      : null;

const roleIdByToken = (roles: VisibilityRole[], token: string) => {
  const normalized = unquoteDslString(token);
  return roles.find((role) => role.id === normalized || role.name === normalized)?.id ?? normalized;
};

const profileIdByToken = (profiles: VisibilityProfile[], token: string) => {
  const normalized = unquoteDslString(token);
  return profiles.find((profile) => profile.id === normalized || profile.name === normalized)?.id ?? normalized;
};

const outputKind = (value: string) => value === "svg" ? "svg" : "pdf";

const normalizeExpression = (source: string, elements: CadElement[], currentElement?: CadElement) =>
  makeNumericExpression(normalizeNumericExpressionInput(source, elements, [], currentElement));

const parameterAlias = (element: CadElement, key: string) => {
  if (key === "index") return "intersectionIndex";
  if (key === "extensions") return "useExtensions";
  if (key === "distance" && (element.type === "divisionPoint" || element.type === "lineDivisionPoint")) {
    return "distance";
  }
  if (element.type === "lineTangentOffsetPoint" && key === "angle") return "tangentAngleDeg";
  if (element.type === "bezierCurve") {
    if (key === "startAngle") return "startHandleAngleDeg";
    if (key === "startLength") return "startHandleLength";
    if (key === "endAngle") return "endHandleAngleDeg";
    if (key === "endLength") return "endHandleLength";
  }
  if (element.type === "threePointArcLine") {
    if (key === "start") return "startAngleDeg";
    if (key === "end") return "endAngleDeg";
  }
  if (element.type === "cornerRadiusArcLine" && key === "index") return "intersectionIndex";
  return key;
};

const withPlacementMode = (element: CadElement, attrs: DslAttribute[]): CadElement => {
  if (element.type !== "divisionPoint" && element.type !== "lineDivisionPoint") return element;
  if (attrs.some((item) => item.key === "distance")) return { ...element, placementMode: "distance" };
  if (attrs.some((item) => item.key === "ratio")) return { ...element, placementMode: "ratio" };
  return element;
};

const parseIntermediatePoints = (
  value: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  numeric: (source: string) => ReturnType<typeof normalizeExpression>,
  currentElement?: CadElement
): Extract<CadElement, { type: "bezierCurve" }>["intermediatePoints"] =>
  splitDslRecords(value).map((record) => {
    const parts = record.split(":").map((item) => item.trim());
    const [pointToken, angle = "0", incoming = "30", outgoing = "30", id] = parts;
    return {
      id: id || createCadElementId("bezierCurve"),
      point: resolveAnchor(pointToken || "none", index, line, diagnostics, numeric, currentElement),
      handleAngleDeg: numeric(angle),
      incomingHandleLength: numeric(incoming),
      outgoingHandleLength: numeric(outgoing)
    };
  });

const applyCommonAttributes = (
  element: CadElement,
  attrs: DslAttribute[],
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[],
  visibilityRoles: VisibilityRole[] = []
) => {
  const parentAttr = attr(attrs, "parent");
  let next = parentAttr
    ? { ...element, parentGroupId: resolveId(parentAttr, index, line, diagnostics, element) }
    : element;
  const numeric = (source: string) => normalizeExpression(source, elementsForExpressions, next);
  const skip = new Set(["id", "type", "angle", "at", "center", "end", "size", "start"]);

  for (const { key, value } of attrs) {
    const parameterKey = parameterAlias(next, key);
    if (skip.has(key) && parameterKey === key) continue;
    if (key === "parent") continue;
    if (key === "branch") {
      next = { ...next, conditionalBranch: value === "else" ? "else" : "then" };
      continue;
    }
    if (key === "color") {
      next = { ...next, colorId: value };
      continue;
    }
    if (key === "roles" && next.type === "group") {
      next = {
        ...next,
        visibilityRoleIds: splitDslList(value).map((roleToken) =>
          roleIdByToken(visibilityRoles, roleToken)
        )
      };
      continue;
    }
    if (next.type === "bezierCurve" && key === "intermediates") {
      next = {
        ...next,
        intermediatePoints: parseIntermediatePoints(value, index, line, diagnostics, numeric, next)
      };
      continue;
    }

    const definition = findParameterDefinition(next, parameterKey);
    if (definition?.kind === "boolean") {
      const parsed = booleanValue(value);
      if (parsed === null) diagnostics.push(diagnostic(line, `${parameterKey} は true/false で指定してください。`));
      next = setParameterValue(next, parameterKey, parsed ?? false);
      continue;
    }
    if (definition?.kind === "number") {
      next = setParameterValue(next, parameterKey, numeric(value));
      continue;
    }
    if (definition?.kind === "reference") {
      next = setParameterValue(next, parameterKey, value === "none" ? null : resolveAnchor(value, index, line, diagnostics, numeric, next));
      continue;
    }
    if (definition?.kind === "lineEndpointReference") {
      next = setParameterValue(next, parameterKey, resolveEndpoint(value, index, line, diagnostics, next));
      continue;
    }
    if (definition?.kind === "lineReference") {
      next = setParameterValue(next, parameterKey, resolveId(value, index, line, diagnostics, next));
      continue;
    }
    if (definition?.kind === "lineReferenceList") {
      next = setParameterValue(next, parameterKey, splitDslList(value).map((item) => resolveId(item, index, line, diagnostics, next)));
      continue;
    }
    if (definition?.kind === "choice" || definition?.kind === "text" || definition?.kind === "color") {
      next = setParameterValue(next, parameterKey, value);
      continue;
    }

    const parsedBoolean = booleanValue(value);
    const rawValue = parsedBoolean ?? (/^-?\d+(\.\d+)?$/.test(value) ? numeric(value) : value);
    next = { ...next, [parameterKey]: rawValue } as CadElement;
  }
  return next;
};

const applyStatement = (
  element: CadElement,
  statement: DslStatement,
  index: NameIndex,
  diagnostics: DslDiagnostic[],
  elementsForExpressions: CadElement[],
  visibilityRoles: VisibilityRole[] = []
) => {
  const parentAttr = attr(statement.attrs, "parent");
  let next = {
    ...element,
    name: attr(statement.attrs, "name") ?? statement.name,
    ...(parentAttr ? { parentGroupId: resolveId(parentAttr, index, statement.line, diagnostics, element) } : {})
  };
  const numeric = (source: string) => normalizeExpression(source, elementsForExpressions, next);
  const anchor = (source: string) => resolveAnchor(source, index, statement.line, diagnostics, numeric, next);

  if (statement.kind === "variable" && next.type === "variable") {
    next = { ...next, valueMode: "expression", expression: numeric(statement.expression) };
  }
  if (statement.kind === "freePoint" && next.type === "freePoint") {
    next = { ...next, x: numeric(statement.x), y: numeric(statement.y) };
  }
  if (statement.kind === "offsetPoint" && next.type === "offsetPoint") {
    next = { ...next, fromPoint: anchor(statement.from), dx: numeric(attr(statement.attrs, "dx") ?? "0"), dy: numeric(attr(statement.attrs, "dy") ?? "0") };
  }
  if (statement.kind === "polarOffsetPoint" && next.type === "polarOffsetPoint") {
    next = {
      ...next,
      fromPoint: anchor(statement.from),
      angleDeg: numeric(attr(statement.attrs, "angle") ?? attr(statement.attrs, "angleDeg") ?? "0"),
      distance: numeric(attr(statement.attrs, "distance") ?? "0")
    };
  }
  if (statement.kind === "line" && next.type === "line") {
    next = { ...next, startPoint: anchor(statement.start), endPoint: anchor(statement.end) };
  }
  if (statement.kind === "angleLengthLine" && next.type === "angleLengthLine") {
    next = {
      ...next,
      startPoint: anchor(statement.start),
      angleDeg: numeric(attr(statement.attrs, "angle") ?? attr(statement.attrs, "angleDeg") ?? "0"),
      length: numeric(attr(statement.attrs, "length") ?? "0")
    };
  }
  if (statement.kind === "arcLine" && next.type === "arcLine") {
    next = {
      ...next,
      centerPoint: anchor(statement.center),
      radius: numeric(attr(statement.attrs, "radius") ?? "0"),
      startAngleDeg: numeric(attr(statement.attrs, "start") ?? attr(statement.attrs, "startAngleDeg") ?? "0"),
      endAngleDeg: numeric(attr(statement.attrs, "end") ?? attr(statement.attrs, "endAngleDeg") ?? "90")
    };
  }
  if (statement.kind === "text" && next.type === "text") {
    const at = attr(statement.attrs, "at") ?? attr(statement.attrs, "anchor");
    next = {
      ...next,
      text: statement.text,
      anchor: at ? anchor(at) : next.anchor,
      fontSize: numeric(attr(statement.attrs, "size") ?? attr(statement.attrs, "fontSize") ?? "3")
    };
  }

  return withPlacementMode(
    applyCommonAttributes(
      next,
      statement.attrs,
      index,
      statement.line,
      diagnostics,
      elementsForExpressions,
      visibilityRoles
    ),
    statement.attrs
  );
};

const applyVisibilitySettings = ({
  statements,
  context,
  diagnostics
}: {
  statements: DslStatement[];
  context: CompileDslContext;
  diagnostics: DslDiagnostic[];
}) => {
  let visibilityRoles = [...(context.visibilityRoles ?? [])];
  let visibilityProfiles = [...(context.visibilityProfiles ?? [])];
  let activeVisibilityProfileId = context.activeVisibilityProfileId;
  let printLayouts = context.printLayouts?.map((layout) => ({ ...layout })) ?? undefined;

  const upsertRole = (statement: Extract<DslStatement, { kind: "role" }>) => {
    const id = attr(statement.attrs, "id") ?? statement.name;
    const name = attr(statement.attrs, "name") ?? statement.name;
    const existing = visibilityRoles.find((role) => role.id === id || role.name === statement.name);
    if (existing) {
      visibilityRoles = visibilityRoles.map((role) =>
        role.id === existing.id ? { ...role, name } : role
      );
      return;
    }
    visibilityRoles = [...visibilityRoles, { id, name }];
  };

  const upsertProfile = (statement: Extract<DslStatement, { kind: "view" }>) => {
    const id = attr(statement.attrs, "id") ?? statement.name;
    const name = attr(statement.attrs, "name") ?? statement.name;
    const existing = visibilityProfiles.find((profile) => profile.id === id || profile.name === statement.name);
    const defaultAttr = attr(statement.attrs, "default") ?? attr(statement.attrs, "defaultRoleVisible");
    const defaultRoleVisible =
      defaultAttr === undefined
        ? existing?.defaultRoleVisible ?? true
        : booleanValue(defaultAttr) ?? true;
    const roleVisibility = { ...(existing?.roleVisibility ?? {}) };

    for (const { key, value } of statement.attrs) {
      if (key === "id" || key === "name" || key === "default" || key === "defaultRoleVisible") continue;
      const roleId = roleIdByToken(visibilityRoles, key);
      if (!visibilityRoles.some((role) => role.id === roleId)) {
        diagnostics.push(diagnostic(statement.line, `未定義の表示ロールです: ${key}`));
        continue;
      }
      const parsed = booleanValue(value);
      if (parsed === null) {
        diagnostics.push(diagnostic(statement.line, `${key} は true/false で指定してください。`));
        continue;
      }
      roleVisibility[roleId] = parsed;
    }

    const profile = { id, name, defaultRoleVisible, roleVisibility };
    visibilityProfiles = existing
      ? visibilityProfiles.map((item) => item.id === existing.id ? { ...profile, id: existing.id } : item)
      : [...visibilityProfiles, profile];
  };

  for (const statement of statements) {
    if (statement.kind === "role") upsertRole(statement);
  }
  for (const statement of statements) {
    if (statement.kind === "view") upsertProfile(statement);
  }
  for (const statement of statements) {
    if (statement.kind === "activeView") {
      const profileId = profileIdByToken(visibilityProfiles, statement.name);
      if (visibilityProfiles.some((profile) => profile.id === profileId)) {
        activeVisibilityProfileId = profileId;
      } else {
        diagnostics.push(diagnostic(statement.line, `未定義の表示プロファイルです: ${statement.name}`));
      }
    }
    if (statement.kind === "printLayout" && printLayouts) {
      const profileToken = attr(statement.attrs, "visibilityView") ?? attr(statement.attrs, "visibilityProfile");
      const profileId = profileToken ? profileIdByToken(visibilityProfiles, profileToken) : undefined;
      if (profileToken && !visibilityProfiles.some((profile) => profile.id === profileId)) {
        diagnostics.push(diagnostic(statement.line, `未定義の表示プロファイルです: ${profileToken}`));
        continue;
      }
      const existing = printLayouts.find((layout) => layout.id === statement.name || layout.name === statement.name);
      const nextLayout = normalizePrintLayout({
        ...(existing ?? {}),
        id: existing?.id ?? attr(statement.attrs, "id") ?? statement.name,
        name: attr(statement.attrs, "name") ?? existing?.name ?? statement.name,
        outputKind: attr(statement.attrs, "output")
          ? outputKind(attr(statement.attrs, "output") ?? "pdf")
          : existing?.outputKind,
        visibilityProfileId: profileId ?? existing?.visibilityProfileId
      }, context.elements, visibilityProfiles);
      printLayouts = existing
        ? printLayouts.map((layout) => layout.id === existing.id ? nextLayout : layout)
        : [...printLayouts, nextLayout];
    }
  }

  return {
    visibilityRoles,
    visibilityProfiles,
    activeVisibilityProfileId,
    printLayouts
  };
};

export const compileDslToElements = (source: string, context: CompileDslContext): CompileDslResult => {
  const parsed = parseDsl(source);
  if (parsed.diagnostics.some((item) => item.severity === "error")) {
    return {
      elements: context.elements,
      selectedElementId: null,
      selectedElementIds: [],
      visibilityRoles: context.visibilityRoles,
      visibilityProfiles: context.visibilityProfiles,
      activeVisibilityProfileId: context.activeVisibilityProfileId,
      printLayouts: context.printLayouts,
      diagnostics: parsed.diagnostics,
      changedCount: 0
    };
  }

  const diagnostics: DslDiagnostic[] = [...parsed.diagnostics];
  const visibilitySettings = applyVisibilitySettings({
    statements: parsed.statements,
    context,
    diagnostics
  });
  const documentMode = context.mode === "document";
  const existing = documentMode ? [] : context.elements;
  const elementStatements = parsed.statements.filter(isElementDslStatement);
  const statementsWithIds = elementStatements.map((statement) => {
    const type = statementType(statement);
    return {
      statement,
      type,
      id: attr(statement.attrs, "id") ?? existing.find((element) => element.name === statement.name && element.type === type)?.id
    };
  });
  const createdIds = new Map<DslStatement, ElementId>();
  for (const item of statementsWithIds) {
    createdIds.set(item.statement, item.id ?? createCadElement(item.type, existing).id);
  }

  let placeholderElements = statementsWithIds.map(({ statement, type }) => ({
    ...createCadElement(type, existing, { createId: () => createdIds.get(statement) ?? "" }),
    name: statement.name
  }));
  const preliminaryIndex = createNameIndex([...existing, ...placeholderElements]);
  placeholderElements = placeholderElements.map((element, index) => {
    const parentToken = attr(statementsWithIds[index].statement.attrs, "parent");
    return parentToken
      ? {
          ...element,
          parentGroupId: resolveId(parentToken, preliminaryIndex, statementsWithIds[index].statement.line, diagnostics, element)
        }
      : element;
  });
  const index = createNameIndex([...existing, ...placeholderElements]);
  const elementsForExpressions = [...existing, ...placeholderElements];

  const updates = new Map<ElementId, CadElement>();
  const insertions: CadElement[] = [];
  for (const { statement, type } of statementsWithIds) {
    if (statement.kind === "element" && !statement.type) continue;
    const id = createdIds.get(statement) ?? createCadElement(type, existing).id;
    const current = existing.find((element) => element.id === id);
    const base = current ?? createCadElement(type, [...existing, ...insertions], { createId: () => id });
    const compiled = applyStatement(
      base,
      statement,
      index,
      diagnostics,
      elementsForExpressions,
      visibilitySettings.visibilityRoles
    );
    if (current) {
      updates.set(id, compiled);
    } else {
      insertions.push(compiled);
    }
  }

  const insertionIndex = documentMode
    ? 0
    : Math.min(Math.max(context.insertionIndex ?? existing.length, 0), existing.length);
  const updatedExisting = existing.map((element) => updates.get(element.id) ?? element);
  const elements = [
    ...updatedExisting.slice(0, insertionIndex),
    ...insertions,
    ...updatedExisting.slice(insertionIndex)
  ];
  const selectedElementIds = [...updates.keys(), ...insertions.map((element) => element.id)];

  return {
    elements,
    selectedElementId: selectedElementIds[0] ?? null,
    selectedElementIds,
    ...visibilitySettings,
    diagnostics,
    changedCount: selectedElementIds.length
  };
};
