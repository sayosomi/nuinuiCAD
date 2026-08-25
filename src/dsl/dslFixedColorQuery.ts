import { createModifierAuthoringIndex } from "./dslModifierAuthoringIndex";
import type { CompiledDslDocument } from "./dslDocument";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";

export type DslFixedColor = { red: number; green: number; blue: number; alpha: 1 };
export type DslFixedColorRange = { from: number; to: number };
export type DslFixedColorResult = { color: DslFixedColor; hex: string; range: DslFixedColorRange };

export type DslFixedColorSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
};

export type DslFixedColorQueryInput = {
  source: SourceSnapshot;
  semantic?: DslFixedColorSemanticSnapshot;
};

const fixedColor = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

const semanticSourceText = (semantic: DslFixedColorSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (source: SourceSnapshot, semantic: DslFixedColorSemanticSnapshot | undefined) =>
  Boolean(
    semantic?.compiled &&
    semantic.sourceRevision === source.sourceRevision &&
    semanticSourceText(semantic) === source.normalizedSource
  );

const parseFixedColor = (value: string): DslFixedColor | null => {
  const match = fixedColor.exec(value);
  if (!match) return null;
  return {
    red: Number.parseInt(match[1]!, 16) / 255,
    green: Number.parseInt(match[2]!, 16) / 255,
    blue: Number.parseInt(match[3]!, 16) / 255,
    alpha: 1
  };
};

/** Exact-current fixed modifier colors only. Theme-role colors intentionally remain host-owned. */
export const queryDslFixedColors = ({ source, semantic }: DslFixedColorQueryInput): readonly DslFixedColorResult[] => {
  if (!semantic?.compiled || !semanticIsExact(source, semantic)) return [];
  const index = createModifierAuthoringIndex(semantic.compiled);
  return index.properties.flatMap((property) =>
    property.tokens.flatMap((token) => {
      if (token.kind !== "fixedColor") return [];
      const value = source.normalizedSource.slice(token.range.from, token.range.to);
      const color = parseFixedColor(value);
      return color ? [{ color, hex: value, range: token.range }] : [];
    })
  );
};
