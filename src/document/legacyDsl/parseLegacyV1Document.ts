import { defaultDocumentPalette } from "../../palette/palette";
import { DEFAULT_VISIBILITY_PROFILE_ID, defaultVisibilityProfile } from "../../model/visibilityProfiles";
import type {
  CadElement,
  DocumentPalette,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { parseDslSnapshot } from "./dslParser";
import type { DslDiagnostic, DslStatement } from "./dslTypes";

// v1 の `.nui` 文書を読むための唯一の外部窓口。C1 が live `src/dsl/` を v2 化した
// 後も、この facade だけは凍結ディレクトリの中身(dslParser/dslCompiler 他)を
// v1 のまま呼び続ける。F1 の open 時変換が本 facade を使う。

export type ParseLegacyV1DocumentResult = {
  elements: CadElement[];
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string;
  evaluationLimitIndex: number;
  diagnostics: DslDiagnostic[];
};

const LEGACY_V1_MAJOR_VERSION = 1;

const versionDiagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

// live `dslDocument.ts` の `validateVersionStatements` と同じ検証だが、v1 専用に
// major を固定している(live 側は C1 で `DSL_VERSION = 2` になるため、そちらには
// 依存しない)。
const validateV1VersionStatements = (statements: DslStatement[]): DslDiagnostic[] => {
  const diagnostics: DslDiagnostic[] = [];
  const versionStatements = statements.filter((statement) => statement.kind === "version");
  const firstStatement = statements[0];

  if (!firstStatement) {
    diagnostics.push(versionDiagnostic(1, "文書が空です。先頭に `nui 1` が必要です。"));
  } else if (firstStatement.kind !== "version") {
    diagnostics.push(versionDiagnostic(firstStatement.line, "文書の先頭は `nui <バージョン>` である必要があります。"));
  } else {
    const value = Number(firstStatement.value.trim());
    if (!Number.isInteger(value) || value <= 0) {
      diagnostics.push(versionDiagnostic(firstStatement.line, `不正なDSLバージョンです: ${firstStatement.value}`));
    } else if (value !== LEGACY_V1_MAJOR_VERSION) {
      diagnostics.push(
        versionDiagnostic(firstStatement.line, `未対応のDSLバージョンです: ${value}(対応: ${LEGACY_V1_MAJOR_VERSION})`)
      );
    }
  }
  for (const extra of versionStatements.slice(1)) {
    diagnostics.push(versionDiagnostic(extra.line, "`nui` は文書の先頭に1つだけ書けます。"));
  }
  return diagnostics;
};

export const parseLegacyV1Document = (source: string): ParseLegacyV1DocumentResult => {
  const normalized = source.replace(/\r\n/g, "\n");
  const parsed = parseDslSnapshot({ normalizedSource: normalized, sourceRevision: 0 });
  // `compileDslToElements` は preparsed 経由で渡した `parsed.diagnostics` を
  // 自身の戻り値にすでに含めて返す(エラー時の早期returnも通常経路も)ため、
  // ここでは version診断だけを別枠に持つ。
  const diagnostics = validateV1VersionStatements(parsed.statements);

  const compiled = compileDslToElements(normalized, {
    elements: [],
    mode: "document",
    preparsed: parsed
  });
  const allDiagnostics = [...diagnostics, ...compiled.diagnostics];

  const visibilityProfiles = compiled.visibilityProfiles?.length
    ? compiled.visibilityProfiles
    : [defaultVisibilityProfile()];
  const printLayouts = compiled.printLayouts ?? [];

  return {
    elements: compiled.elements,
    palette: compiled.palette ?? defaultDocumentPalette(),
    visibilityRoles: compiled.visibilityRoles ?? [],
    visibilityProfiles,
    activeVisibilityProfileId:
      compiled.activeVisibilityProfileId ?? visibilityProfiles[0]?.id ?? DEFAULT_VISIBILITY_PROFILE_ID,
    printLayouts,
    activePrintLayoutId: compiled.activePrintLayoutId ?? printLayouts[0]?.id ?? "",
    evaluationLimitIndex: compiled.evaluationLimitIndex ?? compiled.elements.length,
    diagnostics: allDiagnostics
  };
};
