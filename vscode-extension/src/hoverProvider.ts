import * as vscode from "vscode";
import { queryDslGeometryHoverTarget } from "../../src/dsl/dslHoverQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import {
  geometryHoverMarkdown,
  geometryHoverPresentation,
  type GeometryHoverPresentation
} from "../../src/geometry/geometryHoverPresentation";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import type { NuiRuntimeEvaluationService } from "./runtimeEvaluationService";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const nuiHoverSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export type NuiHoverSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
export type NuiHoverRuntimeEvaluationService = Pick<NuiRuntimeEvaluationService, "evaluateCurrent">;

const unavailablePresentation = (heading: string): GeometryHoverPresentation => ({
  heading,
  statuses: [],
  availability: { kind: "unavailable" }
});

const currentTargetFor = (
  document: vscode.TextDocument,
  rawSource: string,
  session: NuiLanguageAnalysisSession,
  normalizedOffset: number
) => {
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);
  const source: SourceSnapshot = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: session.getSourceRevision()
  };
  const semantic = session.hoverSemanticSnapshot(source);
  if (!semantic) return null;
  const target = queryDslGeometryHoverTarget({ source, position: normalizedOffset, semantic });
  return target ? { source, target } : null;
};

const sameTarget = (
  left: { elementId: string; range: { from: number; to: number } },
  right: { elementId: string; range: { from: number; to: number } }
): boolean => left.elementId === right.elementId &&
  left.range.from === right.range.from &&
  left.range.to === right.range.to;

export const createNuiHoverProvider = (
  sessionFor: NuiHoverSessionFor,
  runtimeEvaluation: NuiHoverRuntimeEvaluationService
): vscode.HoverProvider => ({
  provideHover: async (document, position, token) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;
    if (token.isCancellationRequested) return undefined;

    const rawSource = document.getText();
    const session = sessionFor(document);
    const normalizedOffset = normalizedOffsetFromRaw(rawSource, document.offsetAt(position));
    const current = currentTargetFor(document, rawSource, session, normalizedOffset);
    if (!current) return undefined;

    const documentKey = document.uri.toString();
    const documentVersion = document.version;
    const snapshot = await runtimeEvaluation.evaluateCurrent({
      documentKey,
      documentVersion,
      source: current.source,
      session,
      isCancelled: () => token.isCancellationRequested
    });
    if (token.isCancellationRequested) return undefined;

    const latestRawSource = document.getText();
    if (document.version !== documentVersion || latestRawSource !== rawSource) return undefined;
    const latest = currentTargetFor(document, latestRawSource, session, normalizedOffset);
    if (!latest ||
      latest.source.sourceRevision !== current.source.sourceRevision ||
      !sameTarget(latest.target, current.target)) return undefined;

    let presentation: GeometryHoverPresentation;
    if (!snapshot) {
      const semanticElement = latest.target.elementId;
      const currentCompiled = session.hoverSemanticSnapshot(latest.source)?.compiled;
      const element = currentCompiled?.document?.elements.find((candidate) => candidate.id === semanticElement);
      if (!element) return undefined;
      presentation = unavailablePresentation(`${element.name} · ${element.type}`);
    } else {
      const element = snapshot.compiled.document.elements.find((candidate) => candidate.id === latest.target.elementId);
      if (!element) return undefined;
      presentation = geometryHoverPresentation(element, snapshot.evaluation);
    }

    const markdown = new vscode.MarkdownString(geometryHoverMarkdown(presentation));
    markdown.isTrusted = false;
    return new vscode.Hover(
      markdown,
      vscodeRangeForNormalized(document, latestRawSource, latest.target.range)
    );
  }
});
