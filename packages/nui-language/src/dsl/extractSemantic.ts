import type { DslSpan, DslStatement } from "./dslTypes";
import type { ModuleGeometryReferenceSemantic, ModuleGeometryReferenceSite, ModuleGeometryValueSemantic } from "./moduleSemanticTypes";

/** Build one member's immutable construction with the ordinary lexical geometry
 * resolver. Its drawable source is that value occurrence, never the original. */
export const analyzeExtractMember = (
  statement: Extract<DslStatement, { kind: "element" }>,
  statementIndex: number,
  statementId: string,
  ownerIndex: number | null,
  ownerId: string | null,
  resolve: (source: string, span: DslSpan, expected: "point" | "path") => ModuleGeometryReferenceSemantic
): { value: ModuleGeometryValueSemantic; sites: ModuleGeometryReferenceSite[] } => {
  const arg = (key: string) => statement.attrs.find(a => a.key === key)?.value ?? "";
  const span = (key: string) => statement.payloadSpans[key] ?? statement.keywordSpan;
  const source = resolve(arg("source"), span("source"), "path");
  const bound = (key: "left" | "right") => {
    const raw = arg(key);
    return raw === "start" || raw === "end" ? raw : resolve(raw, span(key), "point");
  };
  const left = bound("left"), right = bound("right");
  const value: ModuleGeometryValueSemantic = {
    statementId, statementIndex, name: statement.name, declaredInterfaceType: "path", declaredValueType: { kind: "path" },
    ownerModuleDefinitionStatementId: ownerId, ownerModuleDefinitionStatementIndex: ownerIndex,
    exported: false, initializer: null, valueExpression: null, backingTarget: null,
    construction: { kind: "extractInterval", span: { start: span("left").start, end: span("right").end }, source, left, right }
  };
  const own: ModuleGeometryReferenceSemantic = {
    source: arg("source"), span: span("source"), expectedGeometryKind: "line", role: "lineReference", coordinate: null, resolution: "resolved",
    target: { kind: "geometryValue", statementId, statementIndex, declaredInterfaceType: "path", backingTarget: null,
      ownerModuleDefinitionStatementId: ownerId, ownerModuleDefinitionStatementIndex: ownerIndex }
  };
  const sites: ModuleGeometryReferenceSite[] = [{ parameterKey: "source", span: span("source"), reference: own, runtimeOnly: true }];
  for (const reference of [source, ...typeof left === "string" ? [] : [left], ...typeof right === "string" ? [] : [right]]) sites.push({ parameterKey: null, span: reference.span, reference });
  return { value, sites };
};
