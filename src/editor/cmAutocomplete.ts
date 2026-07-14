import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { dslCompletionContextAt } from "../dsl/dslCompletionContext";
import { dslCompletionMetadataForType } from "../dsl/dslCompletionMetadata";
import { dslReferenceCompletionOptions } from "../dsl/dslCompletionCandidates";
import type { CadElement } from "../types/geometry";
import type { StatementRangeIndex } from "./statementRangeIndex";

type DslAutocompleteOptions = {
  elements: () => readonly CadElement[];
  statementRanges: () => StatementRangeIndex;
  isComposing: () => boolean;
};

const statementElementIdsByLiveLine = (context: CompletionContext, ranges: StatementRangeIndex) => {
  const result = new Map<number, string>();
  for (const range of ranges.values()) {
    const line = context.state.doc.lineAt(range.from);
    if (line.from === range.from) result.set(line.number, range.elementId);
  }
  return result;
};

export const createDslCompletionSource = (options: DslAutocompleteOptions): CompletionSource => (context) => {
  if (options.isComposing() || context.view?.compositionStarted) return null;
  const line = context.state.doc.lineAt(context.pos);
  const localPos = context.pos - line.from;
  const completionContext = dslCompletionContextAt(line.text, localPos);
  if (!completionContext) return null;

  let completions: Completion[];
  if (completionContext.kind === "keyword") {
    completions = completionContext.options.map((label) => ({ label, type: "keyword" }));
  } else if (completionContext.kind === "attribute") {
    completions = dslCompletionMetadataForType(completionContext.elementType).attributes
      .map((parameter) => parameter.key)
      .filter((key, index, all) => all.indexOf(key) === index)
      .map((key) => ({ label: key, apply: `${key}=`, type: "property" }));
  } else if (completionContext.parameter.definition.kind === "choice") {
    completions = (completionContext.parameter.definition.choiceOptions ?? []).map((label) => ({ label, type: "enum" }));
  } else {
    completions = dslReferenceCompletionOptions({
      source: context.state.doc.toString(),
      cursorLine: line.number,
      kind: completionContext.parameter.definition.kind,
      statementElementIds: statementElementIdsByLiveLine(context, options.statementRanges()),
      elements: options.elements()
    }).map((option) => ({ label: option.label, detail: option.detail, type: "variable" }));
  }
  if (completions.length === 0 && !context.explicit) return null;
  return {
    from: line.from + completionContext.from,
    to: line.from + completionContext.to,
    options: completions,
    validFor: /^[^\s#]*$/
  };
};

/** Main-editor-only CM wiring. Context and candidate generation stay CM-free. */
export const dslAutocompleteExtension = (options: DslAutocompleteOptions): Extension[] => [
  autocompletion({ override: [createDslCompletionSource(options)] }),
  keymap.of(completionKeymap)
];
