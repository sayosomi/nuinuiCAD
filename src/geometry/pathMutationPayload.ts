import type { CadElement, ElementId } from "../types/geometry";
import type { PathMutationProgram } from "./pathMutationProgram";

type StatementInfo = { statementIndex: number };

export type RustPathMutationPayload = {
  elementSourceOrders: readonly { elementId: ElementId; sourceOrder: number }[];
  reversals: readonly {
    statementId: string;
    sourceOrder: number;
    targetElementId: ElementId;
    conditionalOwnerElementId?: ElementId;
    conditionalBranch?: "then" | "else";
  }[];
};

/**
 * Projects the compiled path-mutation program into Rust's JSON boundary.
 * The compiler deliberately stores conditional ownership as a source index;
 * Rust receives a resolved element id and never needs to reconstruct DSL
 * nesting from source text.
 */
export const buildRustPathMutationPayload = (
  program: PathMutationProgram,
  elements: readonly CadElement[],
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined
): RustPathMutationPayload => {
  if (!statementInfoByElementId) {
    throw new Error("buildRustPathMutationPayload: missing compiled element statement positions");
  }
  const elementIdByStatementIndex = new Map<number, ElementId>();
  const elementSourceOrders = elements.map((element) => {
    const statement = statementInfoByElementId.get(element.id);
    if (!statement) {
      throw new Error(`buildRustPathMutationPayload: no compiled statement position for ${element.id}`);
    }
    elementIdByStatementIndex.set(statement.statementIndex, element.id);
    return { elementId: element.id, sourceOrder: statement.statementIndex };
  });
  return {
    elementSourceOrders,
    reversals: program.reversals.map((reversal) => {
      if (reversal.conditionalOwnerStatementIndex === undefined) {
        return {
          statementId: reversal.statementId,
          sourceOrder: reversal.sourceOrder,
          targetElementId: reversal.targetElementId
        };
      }
      const conditionalOwnerElementId = elementIdByStatementIndex.get(reversal.conditionalOwnerStatementIndex);
      if (!conditionalOwnerElementId || !reversal.conditionalBranch) {
        throw new Error(`buildRustPathMutationPayload: unresolved conditional owner for ${reversal.statementId}`);
      }
      return {
        statementId: reversal.statementId,
        sourceOrder: reversal.sourceOrder,
        targetElementId: reversal.targetElementId,
        conditionalOwnerElementId,
        conditionalBranch: reversal.conditionalBranch
      };
    })
  };
};
