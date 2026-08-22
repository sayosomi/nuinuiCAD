import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { AutomationDocument } from "../../src/document/automationDocument";
import { compileDslDocument, type CompiledDslDocument } from "../../src/dsl/dslDocument";
import type { DslDiagnostic, DslDiagnosticRelatedInformation, DslStatement } from "../../src/dsl/dslTypes";
import type { DslPhysicalSpan, SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { CadElement, ElementId } from "../../src/types/geometry";

export type SourcePositionDto = {
  offset: number;
  line: number;
  column: number;
};

export type SourceRangeSegmentDto = {
  from: SourcePositionDto;
  to: SourcePositionDto;
};

export type SourceRangeDto = {
  sourceRevision: number;
  segments: SourceRangeSegmentDto[];
};

export const SOURCE_POSITION_INDEXING = {
  offset: "zero-based UTF-16 code units in CRLF-normalized source",
  line: "one-based",
  column: "one-based UTF-16 code units in CRLF-normalized source"
} as const;

export type DiagnosticDto = Omit<DslDiagnostic, "sourceRevision" | "relatedInformation"> & {
  sourceRevision: number;
  range?: SourceRangeDto;
  relatedInformation?: Array<DslDiagnosticRelatedInformation & {
    range: SourceRangeDto;
  }>;
};

export type DeclarationSummaryDto = {
  kind: DslStatement["kind"];
  name: string | null;
  from: number;
  to: number;
  line: number;
  endLine: number;
  elementType?: string | null;
  category?: string;
  construction?: string;
  bindingKind?: "const" | "let";
  moduleName?: string;
};

export type ElementSummaryDto = Pick<CadElement, "id" | "name" | "type" | "activity"> & {
  parentGroupId?: string;
};

export type FreshNuiDocumentSnapshot = {
  path: string;
  sourceIdentity: {
    algorithm: "sha256";
    hash: string;
    byteLength: number;
    normalizedLength: number;
  };
  source: SourceSnapshot;
  currentCompiled: CompiledDslDocument;
  compileStatus: "valid" | "warning" | "fatal";
  currentSemanticsAvailable: boolean;
  automationRevision: number;
  automationCompiledRevision: number;
  lineStarts: readonly number[];
};

export type DocumentInspectDto = {
  path: string;
  sourceIdentity: FreshNuiDocumentSnapshot["sourceIdentity"];
  lifecycle: {
    sourceRevision: number;
    automationRevision: number;
    automationCompiledRevision: number;
    currentCompiledSourceRevision: number;
  };
  compileStatus: "valid" | "warning" | "fatal";
  currentSemantics: {
    available: boolean;
    sourceRevision: number | null;
  };
  diagnostics: {
    compile: DiagnosticDto[];
    binding: DiagnosticDto[];
  };
  summary: {
    declarations: DeclarationSummaryDto[];
    elements: ElementSummaryDto[];
  };
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const stableSnapshotElementId = (
  sourceHash: string,
  statementIndex: number,
  elementType: string
): ElementId => `${elementType}-mcp-${sourceHash}-${statementIndex}`;

const stableSnapshotStatementId = (
  sourceHash: string,
  statementIndex: number
): string => `statement:mcp:${sourceHash}:${statementIndex}`;

const recompileWithStableSnapshotIds = (
  sourceText: string,
  sourceHash: string,
  compiled: CompiledDslDocument
): CompiledDslDocument => {
  if (!compiled.document || !compiled.statementMap) return compiled;

  const elementTypeById = new Map(
    compiled.document.elements.map((element) => [element.id, element.type] as const)
  );
  const assignedElementIds = new Map<number, ElementId>();
  const assignedStatementIds = new Map<number, string>();

  for (const statementIndex of compiled.statementMap.statementIdByStatementIndex?.keys() ?? []) {
    assignedStatementIds.set(statementIndex, stableSnapshotStatementId(sourceHash, statementIndex));
  }
  for (const [statementIndex, currentElementId] of compiled.statementMap.elementIdByStatementIndex) {
    const stableElementId = stableSnapshotElementId(
      sourceHash,
      statementIndex,
      elementTypeById.get(currentElementId) ?? "element"
    );
    assignedElementIds.set(statementIndex, stableElementId);
    assignedStatementIds.set(statementIndex, stableElementId);
  }

  return compileDslDocument(sourceText, {
    assignedElementIds,
    assignedStatementIds,
    sourceRevision: compiled.spans.sourceMap.sourceRevision
  });
};

const compileStatusFor = (compiled: CompiledDslDocument): "valid" | "warning" | "fatal" => {
  if (!compiled.document || !compiled.statementMap) return "fatal";
  return compiled.diagnostics.some((item) => item.severity === "warning") ? "warning" : "valid";
};

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const positionAt = (
  lineStarts: readonly number[],
  sourceLength: number,
  offset: number
): SourcePositionDto => {
  const bounded = Math.max(0, Math.min(offset, sourceLength));
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= bounded) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] ?? 0;
  return {
    offset: bounded,
    line: lineIndex + 1,
    column: bounded - lineStart + 1
  };
};

const rangeDto = (
  span: DslPhysicalSpan,
  normalizedSource: string,
  lineStarts: readonly number[]
): SourceRangeDto => ({
  sourceRevision: span.sourceRevision,
  segments: span.segments.map((segment) => ({
    from: positionAt(lineStarts, normalizedSource.length, segment.from),
    to: positionAt(lineStarts, normalizedSource.length, segment.to)
  }))
});

export const sourceRangeDtoFromOffsets = (
  snapshot: FreshNuiDocumentSnapshot,
  range: { from: number; to: number }
): SourceRangeDto => ({
  sourceRevision: snapshot.source.sourceRevision,
  segments: [{
    from: positionAt(snapshot.lineStarts, snapshot.source.normalizedSource.length, range.from),
    to: positionAt(snapshot.lineStarts, snapshot.source.normalizedSource.length, range.to)
  }]
});

const diagnosticDto = (
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
};

const declarationSummary = (statement: DslStatement): DeclarationSummaryDto | null => {
  if (["version", "set", "atStop", "activeView", "place", "modifierProfileBlock", "modifierProperty", "blockEnd", "blockElse"].includes(statement.kind)) {
    return null;
  }

  const base: DeclarationSummaryDto = {
    kind: statement.kind,
    name: statement.name || null,
    from: statement.documentRange.from,
    to: statement.documentRange.to,
    line: statement.line,
    endLine: statement.endLine
  };

  if (statement.kind === "element") {
    return {
      ...base,
      elementType: statement.type,
      category: statement.category,
      construction: statement.construction
    };
  }
  if (statement.kind === "typedDeclaration") {
    return { ...base, bindingKind: statement.bindingKind };
  }
  if (statement.kind === "moduleInstance") {
    return { ...base, moduleName: statement.moduleName };
  }
  return base;
};

const elementSummary = (element: CadElement): ElementSummaryDto => ({
  id: element.id,
  name: element.name,
  type: element.type,
  activity: element.activity,
  ...(element.parentGroupId ? { parentGroupId: element.parentGroupId } : {})
});

export class DocumentInspectInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentInspectInputError";
  }
}

export const loadFreshNuiDocumentSnapshot = async (
  requestedPath: string,
  operationName = "document_inspect"
): Promise<FreshNuiDocumentSnapshot> => {
  if (!path.isAbsolute(requestedPath)) {
    throw new DocumentInspectInputError(`${operationName} requires an absolute .nui path.`);
  }
  if (path.extname(requestedPath).toLowerCase() !== ".nui") {
    throw new DocumentInspectInputError(`${operationName} accepts only .nui files.`);
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch {
    throw new DocumentInspectInputError(`Document does not exist: ${requestedPath}`);
  }

  const fileStat = await stat(canonicalPath);
  if (!fileStat.isFile()) {
    throw new DocumentInspectInputError(`Document is not a file: ${requestedPath}`);
  }

  const bytes = await readFile(canonicalPath);
  const sourceText = bytes.toString("utf8");
  const normalizedSource = normalizedSourceFor(sourceText);
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const document = AutomationDocument.fromSource(sourceText);
  const state = document.getState();
  const currentCompiled = recompileWithStableSnapshotIds(sourceText, sourceHash, state.currentCompiled);
  const currentSourceRevision = currentCompiled.spans.sourceMap.sourceRevision;
  const compileStatus = compileStatusFor(currentCompiled);
  const currentSemanticsAvailable = compileStatus !== "fatal";

  return {
    path: canonicalPath,
    sourceIdentity: {
      algorithm: "sha256",
      hash: sourceHash,
      byteLength: bytes.byteLength,
      normalizedLength: normalizedSource.length
    },
    source: {
      normalizedSource,
      sourceRevision: currentSourceRevision
    },
    currentCompiled,
    compileStatus,
    currentSemanticsAvailable,
    automationRevision: state.revision,
    automationCompiledRevision: state.compiledRevision,
    lineStarts: lineStartsFor(normalizedSource)
  };
};

export const inspectNuiDocument = async (requestedPath: string): Promise<DocumentInspectDto> => {
  const snapshot = await loadFreshNuiDocumentSnapshot(requestedPath, "document_inspect");
  const {
    currentCompiled,
    source,
    lineStarts,
    currentSemanticsAvailable
  } = snapshot;

  const declarations = currentCompiled.statements
    .map(declarationSummary)
    .filter((item): item is DeclarationSummaryDto => item !== null);

  return {
    path: snapshot.path,
    sourceIdentity: snapshot.sourceIdentity,
    lifecycle: {
      sourceRevision: source.sourceRevision,
      automationRevision: snapshot.automationRevision,
      automationCompiledRevision: snapshot.automationCompiledRevision,
      currentCompiledSourceRevision: currentCompiled.spans.sourceMap.sourceRevision
    },
    compileStatus: snapshot.compileStatus,
    currentSemantics: {
      available: currentSemanticsAvailable,
      sourceRevision: currentSemanticsAvailable
        ? currentCompiled.statementMap!.sourceRevision
        : null
    },
    diagnostics: {
      compile: currentCompiled.diagnostics.map((diagnostic) =>
        diagnosticDto(diagnostic, source.sourceRevision, source.normalizedSource, lineStarts)
      ),
      binding: (currentCompiled.bindingIssueDiagnostics ?? []).map((diagnostic) =>
        diagnosticDto(diagnostic, source.sourceRevision, source.normalizedSource, lineStarts)
      )
    },
    summary: {
      declarations,
      elements: currentSemanticsAvailable
        ? currentCompiled.document!.elements.map(elementSummary)
        : []
    }
  };
};
