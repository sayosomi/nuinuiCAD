import type { DslSpan, DslStatement } from "./dslTypes";
import type { ModuleGeometryReferenceSemantic, ModuleGeometryReferenceSite, ModuleGeometryValueSemantic, ModuleScalarExpressionSemantic, ModuleScalarExpressionSite } from "./moduleSemanticTypes";

/** Build one member's immutable construction with the ordinary lexical geometry
 * resolver. Its drawable source is that value occurrence, never the original. */
export const analyzeExtractMember = (
  statement: Extract<DslStatement, { kind: "element" }>,
  statementIndex: number,
  statementId: string,
  ownerIndex: number | null,
  ownerId: string | null,
  resolve: (source: string, span: DslSpan, expected: "point" | "path", allowCoordinate?: boolean) => ModuleGeometryReferenceSemantic,
  analyzeScalar: (source: string, span: DslSpan, kind: "number" | "boolean") => ModuleScalarExpressionSemantic | null
): { value: ModuleGeometryValueSemantic; sites: ModuleGeometryReferenceSite[]; scalarSites: ModuleScalarExpressionSite[] } => {
  const arg = (key: string) => statement.attrs.find(a => a.key === key)?.value ?? "";
  const span = (key: string) => statement.payloadSpans[key] ?? statement.keywordSpan;
  const source = resolve(arg("source"), span("source"), "path");
  const bound = (key: "left" | "right") => {
    const raw = arg(key);
    return raw === "start" || raw === "end" ? raw : resolve(raw, span(key), "point");
  };
  const scalarSites: ModuleScalarExpressionSite[] = [];
  const scalar = (key: string, fallback: string, kind: "number" | "boolean") => {
    const authored = statement.payloadSpans[key];
    const expression = analyzeScalar(authored ? arg(key) : fallback, span(key), kind);
    if (authored && expression) scalarSites.push({ parameterKey: key, span: authored, expression });
    return expression;
  };
  const references = [source];
  let construction: NonNullable<ModuleGeometryValueSemantic["construction"]>;
  if (statement.extractPart?.declaration === "transformCopy") {
    const startPoint = resolve(arg("startPoint"), span("startPoint"), "point", true);
    const endPoint = statement.payloadSpans.endPoint ? resolve(arg("endPoint"), span("endPoint"), "point", true) : null;
    references.push(startPoint);
    if (endPoint) references.push(endPoint);
    construction = {
      kind: "transformCopy", span: span("source"), source, startPoint, endPoint,
      scale: scalar("scale", "1", "number"),
      angleDeg: scalar("angleDeg", "0", "number"),
      mirrorX: scalar("mirrorX", "false", "boolean")
    };
    for (const reference of [startPoint, endPoint]) {
      for (const [key, expression] of [["x", reference?.coordinate?.x], ["y", reference?.coordinate?.y]] as const) {
        if (expression) scalarSites.push({ parameterKey: key, span: expression.ast.span, expression });
      }
    }
  } else {
    const left = bound("left"), right = bound("right");
    if (typeof left !== "string") references.push(left);
    if (typeof right !== "string") references.push(right);
    construction = { kind: "extractInterval", span: { start: span("left").start, end: span("right").end }, source, left, right };
  }
  const value: ModuleGeometryValueSemantic = {
    statementId, statementIndex, name: statement.name, declaredInterfaceType: "path", declaredValueType: { kind: "path" },
    ownerModuleDefinitionStatementId: ownerId, ownerModuleDefinitionStatementIndex: ownerIndex,
    exported: false, initializer: null, valueExpression: null, backingTarget: null,
    construction
  };
  const own: ModuleGeometryReferenceSemantic = {
    source: arg("source"), span: span("source"), expectedGeometryKind: "line", role: "lineReference", coordinate: null, resolution: "resolved",
    target: { kind: "geometryValue", statementId, statementIndex, declaredInterfaceType: "path", backingTarget: null,
      ownerModuleDefinitionStatementId: ownerId, ownerModuleDefinitionStatementIndex: ownerIndex }
  };
  const sites: ModuleGeometryReferenceSite[] = [{ parameterKey: "source", span: span("source"), reference: own, runtimeOnly: true }];
  for (const reference of references) sites.push({ parameterKey: null, span: reference.span, reference });
  return { value, sites, scalarSites };
};
