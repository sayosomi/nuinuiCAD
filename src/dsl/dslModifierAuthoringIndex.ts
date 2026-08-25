import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { CompiledDslDocument } from "./dslDocument";
import type { DslSpan } from "./dslTypes";

export type ModifierAuthoringRange = { from: number; to: number };
export type ModifierAuthoringDefinition = { name: string; range: ModifierAuthoringRange; statementIndex: number };
export type ModifierAuthoringReference = {
  name: string;
  range: ModifierAuthoringRange;
  statementIndex: number;
  resolution: "resolved" | "unresolved" | "ambiguous";
};
export type ModifierAuthoringPropertyToken = { kind: string; range: ModifierAuthoringRange };
export type ModifierAuthoringProperty = {
  key: string;
  keyRange: ModifierAuthoringRange;
  valueRange: ModifierAuthoringRange;
  tokens: readonly ModifierAuthoringPropertyToken[];
  statementIndex: number;
};
export type ModifierAuthoringIndex = {
  definitions: readonly ModifierAuthoringDefinition[];
  references: readonly ModifierAuthoringReference[];
  properties: readonly ModifierAuthoringProperty[];
};

const physicalRange = (compiled: CompiledDslDocument, statementIndex: number, span: DslSpan): ModifierAuthoringRange | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  return physical?.segments.length === 1 ? physical.segments[0] ?? null : null;
};

/** Exact-current, source-only modifier semantics. It has no runtime identities or host state. */
export const createModifierAuthoringIndex = (compiled: CompiledDslDocument): ModifierAuthoringIndex => {
  const definitions = compiled.statements.flatMap((statement, statementIndex) => {
    if (statement.kind !== "modifierDefinition" || !statement.name || !statement.nameSpan) return [];
    const range = physicalRange(compiled, statementIndex, statement.nameSpan);
    return range ? [{ name: statement.name, range, statementIndex }] : [];
  });
  const definitionCount = new Map<string, number>();
  for (const definition of definitions) definitionCount.set(definition.name, (definitionCount.get(definition.name) ?? 0) + 1);
  const references = compiled.statements.flatMap((statement, statementIndex) =>
    (statement.modifierNames ?? []).flatMap((name, index) => {
      const span = statement.modifierNameSpans?.[index];
      const range = span ? physicalRange(compiled, statementIndex, span) : null;
      const count = definitionCount.get(name) ?? 0;
      return range ? [{
        name,
        range,
        statementIndex,
        resolution: count === 1 ? "resolved" as const : count === 0 ? "unresolved" as const : "ambiguous" as const
      }] : [];
    })
  );
  const properties = compiled.statements.flatMap((statement, statementIndex) => {
    if (statement.kind !== "modifierProperty") return [];
    const keyRange = physicalRange(compiled, statementIndex, statement.property.keySpan);
    const valueRange = physicalRange(compiled, statementIndex, statement.property.valueSpan);
    if (!keyRange || !valueRange) return [];
    const tokens = (statement.property.authoringTokens ?? []).flatMap((token) => {
      const range = physicalRange(compiled, statementIndex, token.span);
      return range ? [{ kind: token.kind, range }] : [];
    });
    return [{ key: statement.property.key, keyRange, valueRange, tokens, statementIndex }];
  });
  return { definitions, references, properties };
};
