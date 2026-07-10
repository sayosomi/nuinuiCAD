import { useMemo, useRef, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import { availableNumericVariableReferenceOptions } from "../geometry/variableReferenceOptions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { NumericValue } from "../types/geometry";
import {
  NumericParameterEditor,
  PointAnchorParameterEditor
} from "./ParameterEditors";
import { ParameterName } from "./ParameterName";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { NumericVariableSuggestPopover } from "./NumericVariableSuggestPopover";
import {
  filteredNumericVariableSuggestions,
  numericVariableSuggestionMatch,
  replaceNumericVariableSuggestionToken
} from "./numericVariableSuggestion";
import type { CommonEditorProps } from "./parameterEditorShared";

export const TextElementFields = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  const updateElement = useCadDocumentStore((state) => state.updateElement);
  const selectedParameterKey = useCadUiStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadUiStore((state) => state.setSelectedParameterKey);
  const activeExpressionInsertTarget = useCadUiStore((state) => state.activeExpressionInsertTarget);
  const setExpressionInsertInputTarget = useCadUiStore((state) => state.setExpressionInsertInputTarget);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [draftText, setDraftText] = useState<{
    elementId: string;
    sourceText: string;
    text: string;
  } | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const textValue =
    element.type === "text"
      ? draftText?.elementId === element.id && draftText.sourceText === element.text
        ? draftText.text
        : element.text
      : "";
  const commonEditorProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
  const parameterFieldClass = (key: ParameterKey) =>
    `parameter-field ${
      isParameterEditMode && selectedParameterKey === key ? "selected-parameter" : ""
    }`;
  const commitText = (text: string) => updateElement(element.id, { text });
  const expressionInsertTarget = () => ({
    elementId: element.id,
    parameterKey: "text",
    displayedExpression: textareaRef.current?.value ?? textValue,
    selectionStart:
      selectionRef.current?.start ??
      (document.activeElement === textareaRef.current ? textareaRef.current?.selectionStart ?? null : null),
    selectionEnd:
      selectionRef.current?.end ??
      (document.activeElement === textareaRef.current ? textareaRef.current?.selectionEnd ?? null : null)
  });
  const rememberSelection = () => {
    const node = textareaRef.current;
    if (!node) return;
    const nextSelection = {
      start: node.selectionStart ?? node.value.length,
      end: node.selectionEnd ?? node.selectionStart ?? node.value.length
    };
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
    setExpressionInsertInputTarget({
      elementId: element.id,
      parameterKey: "text",
      displayedExpression: node.value,
      selectionStart: nextSelection.start,
      selectionEnd: nextSelection.end
    });
  };
  const variableOptions = useMemo(
    () =>
      availableNumericVariableReferenceOptions({
        element,
        elements,
        parameterKey: "text",
        computedVariables: evaluation?.computedVariables.size
          ? evaluation.computedVariables
          : undefined
      }),
    [element, elements, evaluation]
  );
  const suggestionMatch = numericVariableSuggestionMatch(
    textValue,
    selection?.start ?? null,
    selection?.end ?? null
  );
  const visibleSuggestions = suggestionMatch
    ? filteredNumericVariableSuggestions(variableOptions, suggestionMatch.query)
    : [];
  const selectedSuggestionIndex =
    visibleSuggestions.length === 0
      ? 0
      : Math.min(activeSuggestionIndex, visibleSuggestions.length - 1);
  const isInsideTextExpression = (text: string, position: number) => {
    const before = text.slice(0, position);
    const lastOpen = before.lastIndexOf("{");
    if (lastOpen < 0 || before.lastIndexOf("}") > lastOpen) return false;
    const after = text.slice(position);
    const nextClose = after.indexOf("}");
    const nextOpen = after.indexOf("{");
    return nextClose >= 0 && (nextOpen < 0 || nextClose < nextOpen);
  };
  const applyVariableSuggestion = (option = visibleSuggestions[selectedSuggestionIndex]) => {
    if (element.type !== "text") return;
    if (!suggestionMatch || !option) return;
    const replacement = isInsideTextExpression(textValue, suggestionMatch.tokenStart)
      ? option.displayExpression
      : `{${option.displayExpression}}`;
    const nextText = replaceNumericVariableSuggestionToken(
      textValue,
      suggestionMatch,
      replacement
    );
    const nextSelection = suggestionMatch.tokenStart + replacement.length;
    setDraftText({ elementId: element.id, sourceText: element.text, text: nextText });
    commitText(nextText);
    selectionRef.current = { start: nextSelection, end: nextSelection };
    setSelection(selectionRef.current);
    setExpressionInsertInputTarget({
      elementId: element.id,
      parameterKey: "text",
      displayedExpression: nextText,
      selectionStart: nextSelection,
      selectionEnd: nextSelection
    });
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextSelection, nextSelection);
    });
  };
  const isExpressionInsertOpen =
    activeExpressionInsertTarget?.elementId === element.id &&
    activeExpressionInsertTarget.parameterKey === "text";
  if (element.type !== "text") return null;

  return (
    <>
      <div className={parameterFieldClass("text")} onClick={() => setSelectedParameterKey("text")}>
        <div className="numeric-parameter-header">
          <ParameterName element={element} parameterKey="text" label="テキスト" />
          <div className="numeric-parameter-actions">
            <button
              type="button"
              className={`expression-insert-toggle ${isExpressionInsertOpen ? "active" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedParameterKey("text");
                setExpressionInsertInputTarget(expressionInsertTarget());
                dispatchCommand("toggleExpressionInsertTray", {
                  elementId: element.id,
                  parameterKey: "text"
                });
              }}
            >
              参照を挿入
            </button>
          </div>
        </div>
        <textarea
          className="text-parameter-input"
          ref={(node) => {
            textareaRef.current = node;
            registerParameterControl("text", node);
          }}
          value={textValue}
          rows={3}
          data-text-parameter-key="text"
          data-text-element-id={element.id}
          aria-label={`${element.name} のテキスト`}
          aria-autocomplete={visibleSuggestions.length > 0 ? "list" : undefined}
          aria-expanded={visibleSuggestions.length > 0 ? true : undefined}
          onFocus={() => {
            setSelectedParameterKey("text");
            rememberSelection();
          }}
          onChange={(event) => {
            const nextText = event.target.value;
            const nextSelection = {
              start: event.target.selectionStart ?? nextText.length,
              end: event.target.selectionEnd ?? event.target.selectionStart ?? nextText.length
            };
            setDraftText({ elementId: element.id, sourceText: element.text, text: nextText });
            selectionRef.current = nextSelection;
            setSelection(nextSelection);
            setActiveSuggestionIndex(0);
            setExpressionInsertInputTarget({
              elementId: element.id,
              parameterKey: "text",
              displayedExpression: nextText,
              selectionStart: nextSelection.start,
              selectionEnd: nextSelection.end
            });
          }}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onBlur={(event) => commitText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isImeComposingKeyEvent(event)) return;
            if (visibleSuggestions.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestionIndex((index) => (index + 1) % visibleSuggestions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestionIndex(
                  (index) => (index - 1 + visibleSuggestions.length) % visibleSuggestions.length
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                applyVariableSuggestion();
                return;
              }
            }
            if (event.key === "Escape") {
              setDraftText(null);
              event.currentTarget.blur();
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              commitText(event.currentTarget.value);
              event.currentTarget.blur();
            }
          }}
        />
        <NumericVariableSuggestPopover
          options={visibleSuggestions}
          activeIndex={selectedSuggestionIndex}
          onApply={applyVariableSuggestion}
          onHover={setActiveSuggestionIndex}
        />
      </div>
      <PointAnchorParameterEditor
        {...commonEditorProps}
        parameterKey="anchor"
        label="基準点"
        anchor={element.anchor}
        allowCoordinate
      />
      <NumericParameterEditor
        {...commonEditorProps}
        parameterKey="fontSize"
        label="文字サイズ"
        value={element.fontSize as NumericValue}
        ariaLabel="文字サイズ"
        enableExpressionInsert
      />
    </>
  );
};
