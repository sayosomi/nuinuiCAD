import type { DslDiagnostic } from "../dsl/dslTypes";

const normalizedSourceFor = (sourceText: string): string =>
  sourceText.replace(/\r\n/g, "\n");

export const outputPreviewDiagnosticSourceRangeFor = (
  sourceText: string,
  currentSourceRevision: number | null,
  diagnostic: DslDiagnostic | undefined
): { from: number; to: number } | null => {
  if (!diagnostic) return null;

  const navigationTarget = diagnostic.navigationTarget;
  const physicalSpan = navigationTarget?.kind === "sourceSpan"
    ? navigationTarget.physicalSpan
    : diagnostic.physicalSpan;

  if (
    !physicalSpan ||
    currentSourceRevision === null ||
    physicalSpan.sourceRevision !== currentSourceRevision ||
    physicalSpan.segments.length !== 1
  ) return null;

  const segment = physicalSpan.segments[0];
  const normalizedSource = normalizedSourceFor(sourceText);

  if (
    !segment ||
    !Number.isInteger(segment.from) ||
    !Number.isInteger(segment.to) ||
    segment.from < 0 ||
    segment.to <= segment.from ||
    segment.to > normalizedSource.length
  ) return null;

  return { from: segment.from, to: segment.to };
};
