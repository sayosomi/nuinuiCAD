import { createModifierAuthoringIndex } from "./dslModifierAuthoringIndex";
import {
  parseModifierColorValue,
  type ModifierAuthoringTokenKind
} from "./dslModifierAuthoring";
import type { CompiledDslDocument } from "./dslDocument";
import type { DrawingModifierThemeRole } from "../types/geometry";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";

export type DslThemeRoleColor = {
  role: DrawingModifierThemeRole;
  range: { from: number; to: number };
};

export type DslThemeRoleColorSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
};

export type DslThemeRoleColorQueryInput = {
  source: SourceSnapshot;
  semantic?: DslThemeRoleColorSemanticSnapshot;
};

const semanticSourceText = (semantic: DslThemeRoleColorSemanticSnapshot): string | undefined =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const exactSemantic = (
  source: SourceSnapshot,
  semantic: DslThemeRoleColorSemanticSnapshot | undefined
): semantic is DslThemeRoleColorSemanticSnapshot & { compiled: CompiledDslDocument } => Boolean(
  semantic?.compiled &&
  semantic.sourceRevision === source.sourceRevision &&
  semanticSourceText(semantic) === source.normalizedSource
);

const isThemeRoleToken = (kind: ModifierAuthoringTokenKind): kind is "themeRole" => kind === "themeRole";

/** Exact-current modifier theme-role color tokens. Invalid and fixed colors fail closed. */
export const queryDslThemeRoleColors = ({
  source,
  semantic
}: DslThemeRoleColorQueryInput): readonly DslThemeRoleColor[] => {
  if (!exactSemantic(source, semantic)) return [];

  const index = createModifierAuthoringIndex(semantic.compiled);
  return index.properties.flatMap((property) => {
    if (property.key !== "color") return [];
    return property.tokens.flatMap((token) => {
      if (!isThemeRoleToken(token.kind)) return [];
      const value = source.normalizedSource.slice(token.range.from, token.range.to);
      const parsed = parseModifierColorValue(value);
      return "value" in parsed && parsed.value.kind === "themeRole"
        ? [{ role: parsed.value.role, range: token.range }]
        : [];
    });
  });
};
