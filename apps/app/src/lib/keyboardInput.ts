export type KeyboardCompositionState = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

/** Android WebViews may expose an active IME through either flag or keyCode 229. */
export function isImeCompositionActive(event: KeyboardCompositionState) {
  return Boolean(
    event.isComposing
    || event.nativeEvent?.isComposing
    || event.keyCode === 229
    || event.nativeEvent?.keyCode === 229
  );
}

export function isCommitEnterKey(event: KeyboardCompositionState) {
  return event.key === "Enter" && !isImeCompositionActive(event);
}
