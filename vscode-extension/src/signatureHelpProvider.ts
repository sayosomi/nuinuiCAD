import * as vscode from "vscode";
import {
  queryDslSignatureHelp,
  type DslSignatureHelpDocumentation,
  type DslSignatureHelpParameter,
  type DslSignatureHelpQueryResult,
  type DslSignatureHelpSemanticSnapshot,
  type DslSignatureHelpSignature
} from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import { selectModuleDocumentationMarkdown } from "@nuinuicad/nui-language";
import {
  createTranslator,
  resolveLocale,
  signatureHelpTranslationCatalog
} from "./localization";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";
import { activeVscodeMultiDocumentHost } from "./multiDocumentHost";
import { normalizedOffsetAt } from "./sourceOffsetAdapter";

export const nuiSignatureHelpSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export const nuiSignatureHelpTriggerCharacters = ["(", ",", ":"] as const;

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const localizedDocumentation = (
  documentation: DslSignatureHelpDocumentation | undefined,
  translate: ReturnType<typeof createTranslator>
): string | undefined => {
  if (!documentation) return undefined;
  return translate(documentation.key, documentation.parameters);
};

const parameterLabel = (
  parameter: DslSignatureHelpParameter,
  signature: DslSignatureHelpSignature
): string => {
  const type = parameter.type ?? "";
  const optional = parameter.optional ? "?" : "";
  const prefix = signature.callingStyle === "positional"
    ? optional
    : `${parameter.name}${optional}:`;
  const defaultValue = parameter.defaultValue === undefined ? "" : ` = ${parameter.defaultValue}`;
  const allowedValues = parameter.allowedValues && parameter.allowedValues.length > 0
    ? ` [${parameter.allowedValues.join(" / ")}]`
    : "";
  const renderedType = type
    ? signature.callingStyle === "positional" ? type : ` ${type}`
    : "";
  return `${prefix}${renderedType}${defaultValue}${allowedValues}`;
};

const authoredDocumentation = (
  documentation: DslSignatureHelpSignature["authoredDocumentation"],
  displayLanguage: string
): vscode.MarkdownString | undefined => {
  const markdown = selectModuleDocumentationMarkdown(documentation, displayLanguage);
  if (markdown === null) return undefined;
  const result = new vscode.MarkdownString(markdown);
  result.isTrusted = false;
  result.supportHtml = false;
  return result;
};

const parameterDocumentation = (
  parameter: DslSignatureHelpParameter,
  translate: ReturnType<typeof createTranslator>,
  displayLanguage: string
): string | vscode.MarkdownString | undefined =>
  authoredDocumentation(parameter.authoredDocumentation, displayLanguage)
    ?? localizedDocumentation(parameter.documentation, translate);

const signatureLabelParts = (
  signature: DslSignatureHelpSignature
): { label: string; parameterRanges: readonly [number, number][] } => {
  let label = `${signature.name}(`;
  const parameterRanges: [number, number][] = [];
  signature.parameters.forEach((parameter, index) => {
    if (index > 0) label += ", ";
    const start = label.length;
    label += parameterLabel(parameter, signature);
    parameterRanges.push([start, label.length]);
  });
  label += ")";
  if (signature.returnType) label += ` -> ${signature.returnType}`;
  return { label, parameterRanges };
};

export const projectDslSignatureHelp = (
  result: DslSignatureHelpQueryResult,
  displayLanguage: string
): vscode.SignatureHelp => {
  const translate = createTranslator(signatureHelpTranslationCatalog, resolveLocale(displayLanguage));
  const signatures = result.signatures.map((signature) => {
    const labelParts = signatureLabelParts(signature);
    const information = new vscode.SignatureInformation(
      labelParts.label,
      authoredDocumentation(signature.authoredDocumentation, displayLanguage)
        ?? localizedDocumentation(signature.documentation, translate)
    );
    information.parameters = signature.parameters.map((parameter, index) => new vscode.ParameterInformation(
      labelParts.parameterRanges[index]!,
      parameterDocumentation(parameter, translate, displayLanguage)
    ));
    return information;
  });
  const help = new vscode.SignatureHelp();
  help.signatures = signatures;
  help.activeSignature = result.activeSignature;
  help.activeParameter = result.activeParameter ?? signatures[result.activeSignature]?.parameters.length ?? 0;
  return help;
};

export type NuiSignatureHelpSessionFor = (document: vscode.TextDocument) => NuiLanguageSession;

export const createNuiSignatureHelpProvider = (
  sessionFor: NuiSignatureHelpSessionFor,
  displayLanguageFor: () => string = () => vscode.env?.language ?? "en"
): vscode.SignatureHelpProvider => ({
  provideSignatureHelp: (document, position) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

    const rawSource = document.getText();
    const normalizedSource = normalizedSourceFor(rawSource);
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const source: SourceSnapshot = {
      normalizedSource,
      sourceRevision: session.getSourceRevision()
    };
    const provideFor = (querySource: SourceSnapshot, semanticSource?: DslSignatureHelpSemanticSnapshot) => {
      if (!semanticSource) {
        const result = session.signatureHelp(normalizedOffsetAt(normalizedSource, position));
        return result ? projectDslSignatureHelp(result, displayLanguageFor()) : undefined;
      }
      const result = queryDslSignatureHelp({
        source: querySource,
        position: normalizedOffsetAt(querySource.normalizedSource, position),
        semantic: semanticSource
      });
      return result ? projectDslSignatureHelp(result, displayLanguageFor()) : undefined;
    };

    const multiDocument = activeVscodeMultiDocumentHost();
    if (!multiDocument) {
      const result = session.signatureHelp(normalizedOffsetAt(normalizedSource, position));
      return result ? projectDslSignatureHelp(result, displayLanguageFor()) : undefined;
    }
    return multiDocument.languageSemanticSnapshotFor(document).then((snapshot) =>
      snapshot
        ? provideFor({ normalizedSource: snapshot.sourceText, sourceRevision: snapshot.sourceRevision }, snapshot)
        : provideFor(source)
    );
  }
});
