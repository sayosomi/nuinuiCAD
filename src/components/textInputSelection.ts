const textInputTypes = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url"
]);

export const isSelectableTextInput = (
  element: EventTarget | null
): element is HTMLInputElement | HTMLTextAreaElement => {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return textInputTypes.has(element.type);
};

export const selectTextInputValue = (
  element: EventTarget | null,
  onSelect?: (selection: { start: number; end: number }) => void
) => {
  if (!isSelectableTextInput(element)) return;

  requestAnimationFrame(() => {
    if (document.activeElement !== element) return;
    element.select();
    onSelect?.({
      start: element.selectionStart ?? 0,
      end: element.selectionEnd ?? element.value.length
    });
  });
};
