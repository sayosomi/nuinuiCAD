import { parameterPickCommandId, type ParameterPickCommandId } from "../commands/parameterPickCommand";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { resolveParameterValueSpan } from "../dsl/dslParameterSpans";
import type { CadElement } from "../types/geometry";

export type SourceEditorPickSelection = {
  parameterKey: string;
  commandId: ParameterPickCommandId;
};

/**
 * Identifies a Canvas-pickable parameter only when the selection is exactly its
 * complete live DSL span. Partial, non-pickable, && ambiguous selections return null.
 */
export const resolveSourceEditorPickSelection = ({
  lineText,
  selection,
  element,
  committedLineText,
}: {
  lineText: string;
  selection: { start: number; end: number };
  element: CadElement;
  committedLineText?: string;
}): SourceEditorPickSelection | null => {
  if (selection.start >= selection.end) return null;
  const target = getParameterDefinitions(element)
    .map((definition) => ({
      definition,
      span: resolveParameterValueSpan(lineText, element, definition.key, { committedLineText }),
    }))
    .find(({ span }) =>
      span !== null &&
      selection.start === span.start &&
      selection.end === span.end,
    );
  if (!target) return null;

  const commandId = parameterPickCommandId(target.definition.kind);
  return commandId ? { parameterKey: target.definition.key, commandId } : null;
};
