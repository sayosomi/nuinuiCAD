import { dslLineLabeledValueSpans } from "./dslValueSpans";
import { recordFields, recordRemainder, recordSpans } from "./dslParameterSpanScanner";
import { unquoteDslString } from "./dslTokens";
import { localNumericReferenceOptions, type NumericReferenceOption } from "../geometry/numericReferenceOptions";
import type { CadElement, ElementId } from "../types/geometry";

const recordNameText = (lineText: string, record: { start: number; end: number }) => {
  const nameField = recordFields(lineText, record)[0];
  return nameField ? unquoteDslString(lineText.slice(nameField.start, nameField.end)) : "";
};

/**
 * Live-buffer candidates for an element's own local `vars=[name:expr;...]` list,
 * for a cursor position inside one record's expression field on `lineText`.
 * Only ever offers candidates from the SAME element's own numericVariables —
 * matching evaluateLocalVariables (src/geometry/evaluationContext.ts), which
 * builds a fresh per-element map never shared across elements.
 *
 * The candidate `@id` values are the stable, already-committed ids from
 * `element.numericVariables` (a live, uncommitted `vars=[...]` list has no ids of
 * its own yet). This requires correlating the live record being edited, and each
 * earlier live record, against the committed list by NAME — the same approach
 * dslParameterSpans.ts's resolveVariableValueSpan already uses for the reverse
 * lookup (committed variable -> its own span). When the statement this line
 * belongs to has never been compiled (`elementId` has no match in `elements`),
 * there is no stable id to insert at all, so this returns []  — a real,
 * documented limitation (not a silent guess), matching the same degradation
 * dslReferenceCompletionOptions already accepts for other never-compiled
 * statements.
 */
export const dslLocalVariableCompletionOptions = ({
  lineText,
  pos,
  elementId,
  elements
}: {
  lineText: string;
  pos: number;
  elementId: ElementId | undefined;
  elements: readonly CadElement[];
}): NumericReferenceOption[] => {
  if (!elementId) return [];
  const element = elements.find((item) => item.id === elementId);
  if (!element) return [];

  const varsSpan = dslLineLabeledValueSpans(lineText).find((span) => span.source === "attr" && span.key === "vars");
  if (!varsSpan) return [];
  const records = recordSpans(lineText, varsSpan);
  if (!records) return [];
  const currentRecord = records.find((record) => pos >= record.start && pos <= record.end);
  if (!currentRecord) return [];
  const expressionSpan = recordRemainder(lineText, currentRecord, 1);
  if (!expressionSpan || pos < expressionSpan.start || pos > expressionSpan.end) return [];

  const localVariables = element.numericVariables ?? [];
  const currentName = recordNameText(lineText, currentRecord);
  const matches = currentName ? localVariables.filter((variable) => variable.name === currentName) : [];
  // A live record whose name matches exactly one committed local variable is
  // "editing that variable" (bounded to entries before it); otherwise (a
  // brand-new record, a renamed one, or an ambiguous duplicate name) this is
  // treated as appending after every already-committed local variable, the
  // same fallback availableNumericVariableReferenceOptions uses when no
  // parameterKey match is found.
  const localVariableLimit = matches.length === 1
    ? localVariables.findIndex((variable) => variable.id === matches[0].id)
    : localVariables.length;

  return localNumericReferenceOptions({ element, localVariableLimit });
};
