import type { DslCompletionSemanticSnapshot } from "@nuinuicad/nui-language";
import {
  isDslTypoSuggestionDiagnosticCode,
  queryDslTypoSuggestions
} from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import {
  toCompilerDiagnostic,
  type CompilerDiagnostic
} from "./compilerDiagnostics";

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

  void displayLanguage;
  const suffixCandidateByDiagnostic = new Map<string, string>();

  for (const diagnostic of dslDiagnosticsFor(semantic)) {
    if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) continue;
    const result = queryDslTypoSuggestions({ source, diagnostic, semantic });
    if (!result || result.candidates.length !== 1) continue;
    const projected = toCompilerDiagnostic(semantic.sourceText ?? source.normalizedSource, diagnostic);
    if (!projected || !isDslTypoSuggestionDiagnosticCode(projected.code)) continue;
    suffixCandidateByDiagnostic.set(
      diagnosticKey(projected),
      result.candidates[0]!.label
    );
  }

  return baseDiagnostics.map((diagnostic) => {
    if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) return diagnostic;
    const candidate = suffixCandidateByDiagnostic.get(diagnosticKey(diagnostic));
    return candidate
      ? {
          ...diagnostic,
          suffixPresentation: {
            key: "typoSuggestion.diagnosticSuffix",
            parameters: { candidate }
          }
        }
      : diagnostic;
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
