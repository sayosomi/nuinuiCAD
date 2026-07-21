import type { DslDiagnostic } from "./dslTypes";

/** 現在パース・シリアライズ可能な `nui <major>` の集合。 */
export type DslMajorVersion = 2 | 3;

export const SUPPORTED_DSL_MAJOR_VERSIONS: readonly DslMajorVersion[] = [2, 3];

/**
 * 新規文書の既定major。typed-variables activation task(52)より前は2のまま
 * 変えない — このtaskでの変更対象ではない。
 */
export const NEW_DOCUMENT_DSL_MAJOR_VERSION: DslMajorVersion = 2;

/**
 * legacy JSON importer / v1 importerが出力するmajor。新規文書既定とは値が
 * 同じでも意味は別で、52での既定変更に追従させない。
 */
export const LEGACY_IMPORT_DSL_MAJOR_VERSION: DslMajorVersion = 2;

export const isSupportedDslMajorVersion = (value: number): value is DslMajorVersion =>
  (SUPPORTED_DSL_MAJOR_VERSIONS as readonly number[]).includes(value);

/** 07/10がv3専用構文をv2文書へ書いたときに使う feature-gate診断。 */
export const TYPED_SYNTAX_REQUIRES_NUI3_CODE = "typed-syntax-requires-nui3";

export const requireDslMajorVersionForFeature = (
  majorVersion: DslMajorVersion,
  requiredMajor: DslMajorVersion,
  line: number,
  featureLabel: string
): DslDiagnostic | null => {
  if (majorVersion >= requiredMajor) return null;
  return {
    severity: "error",
    line,
    column: 1,
    code: TYPED_SYNTAX_REQUIRES_NUI3_CODE,
    message: `${featureLabel} は nui ${requiredMajor} 以降でのみ使用できます(現在: nui ${majorVersion})。`
  };
};
