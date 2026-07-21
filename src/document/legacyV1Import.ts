import {
  compileDslDocument,
  LEGACY_IMPORT_DSL_MAJOR_VERSION,
  serializeDocumentToDsl,
  type DslDocumentData
} from "../dsl/dslDocument";
import { parseLegacyV1Document } from "./legacyDsl/parseLegacyV1Document";

export type LegacyV1ImportResult =
  | { ok: true; sourceText: string }
  | { ok: false; message: string };

const errorSummary = (diagnostics: readonly { severity: string; line: number; column: number; message: string }[]) => {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const summary = errors
    .slice(0, 3)
    .map((diagnostic) => `${diagnostic.line}行${diagnostic.column}列: ${diagnostic.message}`)
    .join("\n");
  return errors.length > 3 ? `${summary}\nほか${errors.length - 3}件のエラー` : summary;
};

/**
 * Converts one valid v1 source document to canonical v2 text.
 *
 * This is deliberately the only product caller of the frozen legacy facade.
 * Do not add v1 grammar support back to the live DSL parser/compiler.
 */
export const importLegacyV1Document = (source: string): LegacyV1ImportResult => {
  const legacy = parseLegacyV1Document(source);
  const legacyErrors = legacy.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (legacyErrors.length > 0) {
    return {
      ok: false,
      message: `nui 1 文書を変換できません。\n${errorSummary(legacyErrors)}`
    };
  }

  const document: DslDocumentData = {
    elements: legacy.elements,
    palette: legacy.palette,
    visibilityRoles: legacy.visibilityRoles,
    visibilityProfiles: legacy.visibilityProfiles,
    activeVisibilityProfileId: legacy.activeVisibilityProfileId,
    printLayouts: legacy.printLayouts,
    activePrintLayoutId: legacy.activePrintLayoutId,
    evaluationLimitIndex: legacy.evaluationLimitIndex
  };
  const sourceText = serializeDocumentToDsl(document, LEGACY_IMPORT_DSL_MAJOR_VERSION);
  const compiled = compileDslDocument(sourceText);
  const v2Errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (v2Errors.length > 0) {
    return {
      ok: false,
      message: `nui 1 文書の変換結果を検証できません。\n${errorSummary(v2Errors)}`
    };
  }

  return { ok: true, sourceText };
};
