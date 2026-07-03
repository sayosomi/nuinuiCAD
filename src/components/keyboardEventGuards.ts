type ImeKeyboardEvent = {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

export const isImeComposingKeyEvent = (event: ImeKeyboardEvent) =>
  event.isComposing === true ||
  event.nativeEvent?.isComposing === true ||
  event.keyCode === 229 ||
  event.nativeEvent?.keyCode === 229;
