import * as vscode from "vscode";
import {
  queryDslSignatureHelp,
  type DslSignatureHelpDocumentation,
  type DslSignatureHelpParameter,
  type DslSignatureHelpQueryResult,
  type DslSignatureHelpSignature
} from "../../src/dsl/dslSignatureHelpQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import { resolveLocale, type SupportedLocale } from "./localization";
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
  locale: SupportedLocale
): string | undefined => {
  if (!documentation) return undefined;
  return locale === "ja" ? documentation.ja ?? documentation.en : documentation.en;
};

const parameterLabel = (
  parameter: DslSignatureHelpParameter,
  signature: DslSignatureHelpSignature
): string => {
  const type = parameter.type ?? "";
  const optional = parameter.optional ? "?" : "";
  const prefix = signature.callingStyle === "positional"
    ? optional
    : `${parameter.name}${optional}${type ? ": " : ""}`;
  const defaultValue = parameter.defaultValue === undefined ? "" : ` = ${parameter.defaultValue}`;
  const allowedValues = parameter.allowedValues && parameter.allowedValues.length > 0
    ? ` [${parameter.allowedValues.join(" / ")}]`
    : "";
  return `${prefix}${type}${defaultValue}${allowedValues}`;
};

const parameterDocumentation = (
  parameter: DslSignatureHelpParameter,
  locale: SupportedLocale
): string | undefined => localizedDocumentation(parameter.documentation, locale);

const signatureLabel = (
  signature: DslSignatureHelpSignature
): string => `${signature.name}(${signature.parameters.map((parameter) => parameterLabel(parameter, signature)).join(", ")})${signature.returnType ? ` -> ${signature.returnType}` : ""}`;

export const projectDslSignatureHelp = (
  result: DslSignatureHelpQueryResult,
  displayLanguage: string
): vscode.SignatureHelp => {
  const locale = resolveLocale(displayLanguage);
  const signatures = result.signatures.map((signature) => {
    const information = new vscode.SignatureInformation(
      signatureLabel(signature),
      localizedDocumentation(signature.documentation, locale)
    );
    information.parameters = signature.parameters.map((parameter) => new vscode.ParameterInformation(
      parameterLabel(parameter, signature),
      parameterDocumentation(parameter, locale)
    ));
    return information;
  });
  const help = new vscode.SignatureHelp();
  help.signatures = signatures;
  help.activeSignature = result.activeSignature;
  if (result.activeParameter !== undefined) help.activeParameter = result.activeParameter;
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
