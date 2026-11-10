import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import type {
  DependencyError,
  ElementId,
  GeometryValueEvaluationError
} from "../types/geometry";

type RuntimeDrawableDiagnostic = DslDiagnostic & {
  origin: "runtime";
  elementId: ElementId;
};

type RuntimeGeometryValueDiagnostic = DslDiagnostic & {
  origin: "runtime";
  elementId?: never;
  bindingId?: never;
  physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]>;
  exactSpanOnly: true;
  navigationTarget: { kind: "sourceSpan"; physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]> };
};

export type RuntimeGeometryDiagnostic = RuntimeDrawableDiagnostic | RuntimeGeometryValueDiagnostic;

/**
 * Project current geometry-evaluation failures onto their authored source
 * statements so host adapters can present them through the same runtime
 * diagnostic layer as scalar evaluation failures.
 *
 * Runtime elements without a current authored owner fail closed: a diagnostic
 * with a guessed or stale source location is worse than omitting that row.
 */
export const runtimeGeometryDiagnostics = (input: {
  errors?: readonly DependencyError[];
  geometryValueErrors?: readonly GeometryValueEvaluationError[];
  compiledDocument: CompiledDslDocument;
}): readonly RuntimeGeometryDiagnostic[] => {
  const statementMap = input.compiledDocument.statementMap;
  if (!statementMap) return [];

  const drawableDiagnostics = (input.errors ?? []).flatMap((error): RuntimeDrawableDiagnostic[] => {
    const owner = sourceOwnerForRuntimeElementId(
      {
        statementMap,
        moduleMaterialization: input.compiledDocument.moduleMaterialization
      },
      error.elementId
    );
    if (!owner) return [];

    const sourceElementId = statementMap.elementIdByStatementIndex.get(owner.sourceStatementIndex);
    return [{
      severity: "error" as const,
      line: owner.statement.line,
      column: 1,
      message: error.message,
      sourceRevision: owner.statement.sourceRevision,
      origin: "runtime" as const,
      elementId: error.elementId,
      statementIndex: owner.sourceStatementIndex,
      ...(sourceElementId
        ? { navigationTarget: { kind: "element" as const, elementId: sourceElementId } }
        : {})
    }];
  });

  const geometryValueDiagnostics = (input.geometryValueErrors ?? []).flatMap((error): RuntimeGeometryValueDiagnostic[] => {
    const statementIndex = statementMap.statementIndexByStatementId?.get(error.occurrence.sourceStatementId);
    if (statementIndex === undefined) return [];
    const statement = input.compiledDocument.statements[statementIndex];
    const part = statement?.kind === "element" ? statement.extractPart : undefined;
    const head = part && input.compiledDocument.statements[part.declarationIndex];
    const boundary = error.extract?.boundary;
    const physicalSpan = head?.kind === "extract" && part
      ? boundary === "left" ? head.parts[part.partIndex]?.leftPhysicalSpan
        : boundary === "right" ? head.parts[part.partIndex]?.rightPhysicalSpan : statement.namePhysicalSpan
      : statement?.kind === "typedDeclaration" ? statement.namePhysicalSpan : undefined;
    if (!physicalSpan?.segments.length) return [];
    const prefix = input.compiledDocument.spans.sourceMap.source.slice(0, physicalSpan.segments[0]!.from);
    return [{
      severity: "error",
      line: prefix.split("\n").length,
      column: prefix.length - prefix.lastIndexOf("\n"),
      message: error.message,
      sourceRevision: statement.sourceRevision,
      physicalSpan,
      exactSpanOnly: true,
      origin: "runtime",
      statementIndex,
      navigationTarget: { kind: "sourceSpan", physicalSpan }
    }];
  });

  return [...drawableDiagnostics, ...geometryValueDiagnostics];
};
