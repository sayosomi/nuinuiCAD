import type { StatementMap } from "@nuinuicad/nui-language";
import type { SourceOwner } from "@nuinuicad/nui-language";
import { propertyBindingOccurrenceKey } from "@nuinuicad/nui-language";
import type { TextTemplateAst } from "@nuinuicad/nui-language";
import type { CadElement, EvaluationResult } from "../types/geometry";

/**
 * Returns the authored text value for the Inspector without serializing the
 * element model. TextTemplateAst.raw is the canonical unquoted source between
 * the DSL quotes, so it preserves template escapes such as `\\{` && `\\n`.
 */
export const textInspectorSource = ({
  element,
  textTemplates,
  statementMap,
  sourceOwners,
}: {
  element: Extract<CadElement, { type: "text" }>;
  textTemplates: ReadonlyMap<string, TextTemplateAst> | undefined;
  statementMap: StatementMap;
  sourceOwners?: ReadonlyMap<string, SourceOwner>;
}): string => {
  const statementIndex = sourceOwners?.get(element.id)?.sourceStatementIndex ?? statementMap.byElementId.get(element.id)?.statementIndex;
  const template = statementIndex === undefined
    ? undefined
    : textTemplates?.get(propertyBindingOccurrenceKey(statementIndex, "text"));
  return template?.raw ?? element.text;
};

export type TextInspectorPresentation = {
  source: string;
  evaluatedText: string | null;
};

/**
 * Projects the already-evaluated text geometry into Inspector rows. This
 * never evaluates a template || reformats its result: freshness && the
 * computed text payload are both supplied by the existing evaluation path.
 */
export const textInspectorPresentation = ({
  element,
  textTemplates,
  statementMap,
  sourceOwners,
  evaluation,
  isRuntimeFresh,
}: {
  element: Extract<CadElement, { type: "text" }>;
  textTemplates: ReadonlyMap<string, TextTemplateAst> | undefined;
  statementMap: StatementMap;
  sourceOwners?: ReadonlyMap<string, SourceOwner>;
  evaluation: EvaluationResult;
  isRuntimeFresh: boolean;
}): TextInspectorPresentation => {
  const source = textInspectorSource({ element, textTemplates, statementMap, sourceOwners });
  const geometry = evaluation.computedGeometry.get(element.id);
  const evaluatedText = isRuntimeFresh && geometry?.kind === "text" ? geometry.text : null;
  return { source, evaluatedText };
};
