import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslStatement } from "../dsl/dslTypes";

export type PathReverseMutation = {
  kind: "reverse";
  statementId: string;
  sourceOrder: number;
  targetElementId: ElementId;
  conditionalOwnerStatementIndex?: number;
  conditionalBranch?: "then" | "else";
};

export type PathMutationProgram = { reversals: readonly PathReverseMutation[] };

const isLineLikeElement = (element: CadElement) => [
  "line", "angleLengthLine", "arcLine", "threePointArcLine", "cornerRadiusArcLine",
  "bezierCurve", "offsetLine", "splitLine", "copyLine", "symmetricCopyLine"
].includes(element.type);

export const compilePathMutationProgram = ({
  statements,
  elements,
  elementIdByStatementIndex,
  statementIdByStatementIndex
}: {
  statements: readonly DslStatement[];
  elements: readonly CadElement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  statementIdByStatementIndex: ReadonlyMap<number, string>;
}): { program: PathMutationProgram; diagnostics: DslDiagnostic[] } => {
  const diagnostics: DslDiagnostic[] = [];
  const elementStatementIndex = new Map<ElementId, number>([...elementIdByStatementIndex].map(([index, id]) => [id, index]));
  const reversals: PathReverseMutation[] = [];
  for (const [sourceOrder, statement] of statements.entries()) {
    if (statement.kind !== "reverse") continue;
    const enclosing = statement.enclosing;
    const owner = enclosing ? statements[enclosing.statementIndex] : undefined;
    if (owner?.kind === "element" && owner.type === "forGroup") {
      diagnostics.push({ severity: "error", line: statement.line, column: 1, message: "reverse は for ブロック内では使えません。", code: "reverse-in-for" });
      continue;
    }
    const candidates = elements.filter((element) => element.name === statement.name && (elementStatementIndex.get(element.id) ?? Infinity) < sourceOrder);
    const target = candidates.at(-1);
    if (!target) {
      diagnostics.push({ severity: "error", line: statement.line, column: 1, message: `reverse の対象「${statement.name}」は、この文より前にある線でなければなりません。`, code: "reverse-target" });
      continue;
    }
    if (!isLineLikeElement(target)) {
      diagnostics.push({ severity: "error", line: statement.line, column: 1, message: `reverse の対象「${statement.name}」は線または曲線にしてください。`, code: "reverse-not-path" });
      continue;
    }
    // Reconciled documents provide a durable statement identity. The fallback
    // keeps standalone parser/compiler consumers evaluable without inventing
    // an element identity for this non-element statement.
    const statementId = statementIdByStatementIndex.get(sourceOrder) ?? `reverse:${sourceOrder}`;
    reversals.push({
      kind: "reverse",
      statementId,
      sourceOrder,
      targetElementId: target.id,
      ...(owner?.kind === "element" && owner.type === "conditionalGroup"
        ? { conditionalOwnerStatementIndex: enclosing!.statementIndex, conditionalBranch: enclosing!.branch }
        : {})
    });
  }
  return { program: { reversals }, diagnostics };
};
