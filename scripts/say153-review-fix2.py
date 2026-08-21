from pathlib import Path

path = Path("mcp-server/src/documentSnapshot.ts")
text = path.read_text()
old = '''const diagnosticDto = (
  diagnostic: DslDiagnostic,
  currentSourceRevision: number,
  normalizedSource: string,
  lineStarts: readonly number[]
): DiagnosticDto => ({
  ...diagnostic,
  sourceRevision: diagnostic.sourceRevision ?? currentSourceRevision,
  ...(diagnostic.physicalSpan
    ? { range: rangeDto(diagnostic.physicalSpan, normalizedSource, lineStarts) }
    : {}),
  ...(diagnostic.relatedInformation
    ? {
        relatedInformation: diagnostic.relatedInformation.map((related) => ({
          ...related,
          range: rangeDto(related.physicalSpan, normalizedSource, lineStarts)
        }))
      }
    : {})
});'''
new = '''const diagnosticDto = (
  diagnostic: DslDiagnostic,
  currentSourceRevision: number,
  normalizedSource: string,
  lineStarts: readonly number[]
): DiagnosticDto => {
  const { relatedInformation, sourceRevision, ...rest } = diagnostic;
  return {
    ...rest,
    sourceRevision: sourceRevision ?? currentSourceRevision,
    ...(diagnostic.physicalSpan
      ? { range: rangeDto(diagnostic.physicalSpan, normalizedSource, lineStarts) }
      : {}),
    ...(relatedInformation
      ? {
          relatedInformation: relatedInformation.map((related) => ({
            ...related,
            range: rangeDto(related.physicalSpan, normalizedSource, lineStarts)
          }))
        }
      : {})
  };
};'''
if text.count(old) != 1:
    raise SystemExit(f"diagnosticDto correction target count={text.count(old)}")
path.write_text(text.replace(old, new, 1))
