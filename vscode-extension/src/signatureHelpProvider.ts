import * as vscode from "vscode";
import {
  queryDslSignatureHelp,
  type DslSignatureHelpDocumentation,
  type DslSignatureHelpParameter,
  type DslSignatureHelpQueryResult,
  type DslSignatureHelpSignature
} from "../../src/dsl/dslSignatureHelpQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import {
  createTranslator,
  resolveLocale,
  signatureHelpTranslationCatalog
} from "./localization";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
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

const parameterDocumentation = (
  parameter: DslSignatureHelpParameter,
  translate: ReturnType<typeof createTranslator>
): string | undefined => localizedDocumentation(parameter.documentation, translate);

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
      localizedDocumentation(signature.documentation, translate)
    );
    information.parameters = signature.parameters.map((parameter, index) => new vscode.ParameterInformation(
      labelParts.parameterRanges[index]!,
      parameterDocumentation(parameter, translate)
    ));
    return information;
  });
  const help = new vscode.SignatureHelp();
  help.signatures = signatures;
  help.activeSignature = result.activeSignature;
  help.activeParameter = result.activeParameter ?? signatures[result.activeSignature]?.parameters.length ?? 0;
  return help;
};

export type NuiSignatureHelpSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

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
    const result = queryDslSignatureHelp({
      source,
      position: normalizedOffsetAt(normalizedSource, position),
      semantic: session.signatureHelpSemanticSnapshot(source)
    });
    return result ? projectDslSignatureHelp(result, displayLanguageFor()) : undefined;
  }
});
