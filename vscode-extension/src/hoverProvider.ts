import * as vscode from "vscode";
import {
  queryDslGeometryHoverDeclarationRange,
  queryDslGeometryHoverTarget
} from "../../src/dsl/dslHoverQuery";
import { queryDslThemeRoleColors } from "../../src/dsl/dslThemeRoleColorQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import {
  geometryHoverMarkdown,
  geometryHoverPresentation,
  geometryHoverUnavailablePresentation,
  type GeometryHoverPresentation,
  type GeometryHoverReference
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

export const nuiHoverRevealSourceReferenceCommand = "nuinuiCAD.hover.revealSourceReference";

export type NuiHoverRevealSourceReferenceArgs = {
  documentUri: string;
  documentVersion: number;
  from: number;
  to: number;
  expectedText: string;
};

export type NuiHoverSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
export type NuiHoverRuntimeEvaluationService = Pick<NuiRuntimeEvaluationService, "evaluateCurrent">;

const currentTargetFor = (
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

export const nuiHoverReferenceCommandUri = (
  args: NuiHoverRevealSourceReferenceArgs
): string => `command:${nuiHoverRevealSourceReferenceCommand}?${encodeURIComponent(JSON.stringify([args]))}`;

const referenceHrefFor = ({
  document,
  source,
  session,
  reference
}: {
  document: vscode.TextDocument;
  source: SourceSnapshot;
  session: NuiLanguageAnalysisSession;
  reference: GeometryHoverReference;
}): string | null => {
  const semantic = session.hoverSemanticSnapshot(source);
  if (!semantic) return null;
  const range = queryDslGeometryHoverDeclarationRange({
    source,
    elementId: reference.elementId,
    semantic
  });
  if (!range) return null;
  const expectedText = source.normalizedSource.slice(range.from, range.to);
  if (!expectedText) return null;
  return nuiHoverReferenceCommandUri({
    documentUri: document.uri.toString(),
    documentVersion: document.version,
    from: range.from,
    to: range.to,
    expectedText
  });
};

const isNuiHoverRevealSourceReferenceArgs = (
  value: unknown
): value is NuiHoverRevealSourceReferenceArgs => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NuiHoverRevealSourceReferenceArgs>;
  return typeof candidate.documentUri === "string" &&
    typeof candidate.documentVersion === "number" &&
    Number.isInteger(candidate.documentVersion) &&
    typeof candidate.from === "number" &&
    Number.isInteger(candidate.from) &&
    typeof candidate.to === "number" &&
    Number.isInteger(candidate.to) &&
    typeof candidate.expectedText === "string" &&
    candidate.expectedText.length > 0;
};

export const currentNuiHoverReferenceRange = (
  document: vscode.TextDocument,
  args: NuiHoverRevealSourceReferenceArgs
): vscode.Range | null => {
  if (
    document.uri.scheme !== "file" ||
    !document.fileName.endsWith(".nui") ||
    document.uri.toString() !== args.documentUri ||
    document.version !== args.documentVersion ||
    !Number.isInteger(args.from) ||
    !Number.isInteger(args.to) ||
    args.from < 0 ||
    args.to <= args.from
  ) return null;

  const rawSource = document.getText();
  const normalizedSource = normalizedSourceFor(rawSource);
  if (
    args.to > normalizedSource.length ||
    normalizedSource.slice(args.from, args.to) !== args.expectedText
  ) return null;
  return vscodeRangeForNormalized(document, rawSource, { from: args.from, to: args.to });
};

export const revealNuiHoverSourceReference = async (
  value: unknown
): Promise<void> => {
  if (!isNuiHoverRevealSourceReferenceArgs(value)) return;
  const args = value;
  const document = vscode.workspace.textDocuments.find((candidate) =>
    candidate.uri.toString() === args.documentUri
  );
  if (!document) return;
  const range = currentNuiHoverReferenceRange(document, args);
  if (!range) return;

  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const currentRange = currentNuiHoverReferenceRange(document, args);
  if (!currentRange) return;
  editor.selection = new vscode.Selection(currentRange.start, currentRange.end);
  editor.revealRange(currentRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
};

export const createNuiHoverProvider = (
  sessionFor: NuiHoverSessionFor,
  runtimeEvaluation: NuiHoverRuntimeEvaluationService
): vscode.HoverProvider => ({
  provideHover: async (document, position, token) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;
    if (token.isCancellationRequested) return undefined;

    const rawSource = document.getText();
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const normalizedOffset = normalizedOffsetFromRaw(rawSource, document.offsetAt(position));
    const source: SourceSnapshot = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: session.getSourceRevision()
    };
    const themeRole = queryDslThemeRoleColors({
      source,
      semantic: session.themeRoleColorSemanticSnapshot(source)
    }).find(({ range }) => normalizedOffset >= range.from && normalizedOffset < range.to);
    if (themeRole) {
      return new vscode.Hover(
        new vscode.MarkdownString(
          `Theme role: ${themeRole.role}\n\nFollows the current Canvas theme. Choosing a color in the color picker converts this role to a fixed #RRGGBB color.`
        ),
        vscodeRangeForNormalized(document, rawSource, themeRole.range)
      );
    }

    const current = currentTargetFor(rawSource, session, normalizedOffset);
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
    const latest = currentTargetFor(latestRawSource, session, normalizedOffset);
    if (!latest ||
      latest.source.sourceRevision !== current.source.sourceRevision ||
      !sameTarget(latest.target, current.target)) return undefined;

    let presentation: GeometryHoverPresentation;
    if (!snapshot) {
      const semanticElement = latest.target.elementId;
      const currentCompiled = session.hoverSemanticSnapshot(latest.source)?.compiled;
      const element = currentCompiled?.document?.elements.find((candidate) => candidate.id === semanticElement);
      if (!element) return undefined;
      presentation = geometryHoverUnavailablePresentation(element);
    } else {
      const element = snapshot.compiled.document.elements.find((candidate) => candidate.id === latest.target.elementId);
      if (!element) return undefined;
      presentation = geometryHoverPresentation(element, snapshot.evaluation);
    }

    const markdown = new vscode.MarkdownString(geometryHoverMarkdown(
      presentation,
      (reference) => referenceHrefFor({
        document,
        source: latest.source,
        session,
        reference
      })
    ));
    markdown.isTrusted = { enabledCommands: [nuiHoverRevealSourceReferenceCommand] };
    return new vscode.Hover(
      markdown,
      vscodeRangeForNormalized(document, latestRawSource, latest.target.range)
    );
  }
});
