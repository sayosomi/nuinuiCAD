import type { DslCompletionSemanticSnapshot } from "../../src/dsl/dslCompletionQuery";
import {
  isDslTypoSuggestionDiagnosticCode,
  queryDslTypoSuggestions
} from "../../src/dsl/dslTypoSuggestionQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { DslDiagnostic } from "../../src/dsl/dslTypes";
import {
  toCompilerDiagnostic,
  type CompilerDiagnostic
} from "./compilerDiagnostics";
import { createTranslator, resolveLocale } from "./localization";
import { typoSuggestionTranslationCatalog } from "./typoSuggestionLocalization";

let displayLanguageFor: (() => string) | undefined;

export const configureNuiTypoDiagnosticPresentation = (provider: () => string): void => {
  displayLanguageFor = provider;
};

const configuredDisplayLanguage = (): string => {
  if (!displayLanguageFor) return "en";
  try {
    return displayLanguageFor();
  } catch {
    // Host mocks and partial adapters may omit vscode.env; presentation must fail closed to English.
    return "en";
  }
};

const dslDiagnosticsFor = (semantic: DslCompletionSemanticSnapshot): readonly DslDiagnostic[] =>
  semantic.compiled
    ? [
        ...semantic.compiled.diagnostics,
        ...(semantic.compiled.bindingIssueDiagnostics ?? [])
      ]
    : [];

const diagnosticKey = (diagnostic: Pick<CompilerDiagnostic, "code" | "range">): string =>
  `${String(diagnostic.code)}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.line}:${diagnostic.range.end.character}`;

export const projectCompilerDiagnosticsWithTypoSuggestions = (
  baseDiagnostics: readonly CompilerDiagnostic[],
  source: SourceSnapshot,
  semantic: DslCompletionSemanticSnapshot,
  displayLanguage: string
): CompilerDiagnostic[] => {
  if (!semantic.compiled) return [...baseDiagnostics];

  const translate = createTranslator(typoSuggestionTranslationCatalog, resolveLocale(displayLanguage));
  const suffixByDiagnostic = new Map<string, string>();

  for (const diagnostic of dslDiagnosticsFor(semantic)) {
    if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) continue;
    const result = queryDslTypoSuggestions({ source, diagnostic, semantic });
    if (!result || result.candidates.length !== 1) continue;
    const projected = toCompilerDiagnostic(semantic.sourceText ?? source.normalizedSource, diagnostic);
    if (!projected || !isDslTypoSuggestionDiagnosticCode(projected.code)) continue;
    suffixByDiagnostic.set(
      diagnosticKey(projected),
      translate("typoSuggestion.diagnosticSuffix", { candidate: result.candidates[0]!.label })
    );
  }

  return baseDiagnostics.map((diagnostic) => {
    if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) return diagnostic;
    const suffix = suffixByDiagnostic.get(diagnosticKey(diagnostic));
    return suffix ? { ...diagnostic, message: `${diagnostic.message} ${suffix}` } : diagnostic;
  });
};

export const projectConfiguredCompilerDiagnosticsWithTypoSuggestions = (
  baseDiagnostics: readonly CompilerDiagnostic[],
  source: SourceSnapshot,
  semantic: DslCompletionSemanticSnapshot
): CompilerDiagnostic[] =>
  displayLanguageFor
    ? projectCompilerDiagnosticsWithTypoSuggestions(baseDiagnostics, source, semantic, configuredDisplayLanguage())
    : [...baseDiagnostics];
