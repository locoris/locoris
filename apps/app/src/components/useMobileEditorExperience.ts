import { useEffect, useRef, type RefObject } from "react";

type MobileEditorFocusRequest = {
  moveToDocumentEnd: boolean;
};

type UseMobileEditorExperienceOptions = {
  editorPaneRef: RefObject<HTMLElement | null>;
  editorStageRef: RefObject<HTMLElement | null>;
  onRequestEditorFocus: (request: MobileEditorFocusRequest) => void;
};

const MOBILE_SHELL_SELECTOR = '.locoris-adaptive-shell[data-mobile-shell="true"]';
const MOBILE_EDITOR_VIEWPORT_PROPERTIES = [
  "--locoris-mobile-editor-viewport-top",
  "--locoris-mobile-editor-viewport-left",
  "--locoris-mobile-editor-viewport-width",
  "--locoris-mobile-editor-viewport-height",
  "--locoris-mobile-editor-keyboard-inset"
] as const;
const EDITOR_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='menu']",
  "[role='dialog']",
  ".bn-side-menu",
  ".bn-table-handle",
  ".bn-table-cell-handle",
  ".tableWrapper-inner",
  ".table-widgets-container"
].join(",");

function getSelectionElement(selection: Selection) {
  const focusNode = selection.focusNode;

  if (focusNode instanceof Element) {
    return focusNode;
  }

  return focusNode?.parentElement ?? null;
}

function getCaretRect(selection: Selection) {
  if (selection.rangeCount === 0) {
    return null;
  }

  const rangeRect = selection.getRangeAt(0).getBoundingClientRect();

  if (rangeRect.width > 0 || rangeRect.height > 0) {
    return rangeRect;
  }

  return getSelectionElement(selection)?.getBoundingClientRect() ?? null;
}

function px(value: number) {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`;
}

export default function useMobileEditorExperience({
  editorPaneRef,
  editorStageRef,
  onRequestEditorFocus
}: UseMobileEditorExperienceOptions) {
  const focusRequestRef = useRef(onRequestEditorFocus);

  useEffect(() => {
    focusRequestRef.current = onRequestEditorFocus;
  }, [onRequestEditorFocus]);

  useEffect(() => {
    const editorPane = editorPaneRef.current;
    const editorStage = editorStageRef.current;
    const mobileShell = editorPane?.closest(MOBILE_SHELL_SELECTOR);

    if (!editorPane || !editorStage || !mobileShell) {
      return;
    }

    const documentRoot = document.documentElement;
    const previousProperties = new Map(
      MOBILE_EDITOR_VIEWPORT_PROPERTIES.map((property) => [
        property,
        documentRoot.style.getPropertyValue(property)
      ])
    );
    const visualViewport = window.visualViewport;
    let viewportFrame = 0;
    let caretFrame = 0;
    let caretTimer = 0;
    let pointerStart: { x: number; y: number } | null = null;

    const ensureCaretIsVisible = () => {
      caretFrame = 0;
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return;
      }

      const selectionElement = getSelectionElement(selection);

      if (!selectionElement || !editorPane.contains(selectionElement)) {
        return;
      }

      const caretRect = getCaretRect(selection);
      const stageRect = editorStage.getBoundingClientRect();

      if (!caretRect || stageRect.height <= 0) {
        return;
      }

      const topBoundary = stageRect.top + 18;
      const bottomBoundary = stageRect.bottom - 22;
      let delta = 0;

      if (caretRect.bottom > bottomBoundary) {
        delta = caretRect.bottom - bottomBoundary;
      } else if (caretRect.top < topBoundary) {
        delta = caretRect.top - topBoundary;
      }

      if (Math.abs(delta) > 1) {
        editorStage.scrollBy({ top: delta, behavior: "auto" });
      }
    };

    const scheduleCaretVisibility = (delay = 0) => {
      window.clearTimeout(caretTimer);

      if (delay > 0) {
        caretTimer = window.setTimeout(() => scheduleCaretVisibility(), delay);
        return;
      }

      if (caretFrame) {
        window.cancelAnimationFrame(caretFrame);
      }

      caretFrame = window.requestAnimationFrame(ensureCaretIsVisible);
    };

    const syncVisualViewport = () => {
      viewportFrame = 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportWidth = visualViewport?.width ?? window.innerWidth;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const layoutHeight = Math.max(window.innerHeight, documentRoot.clientHeight);
      const keyboardInset = Math.max(0, layoutHeight - viewportTop - viewportHeight);
      const activeElement = document.activeElement;
      const editorHasFocus =
        activeElement instanceof HTMLElement &&
        editorPane.contains(activeElement) &&
        (activeElement.isContentEditable || activeElement.matches("input, textarea"));
      const keyboardOpen =
        editorHasFocus &&
        (keyboardInset > 96 || viewportHeight < Math.max(320, layoutHeight * 0.78));

      documentRoot.style.setProperty("--locoris-mobile-editor-viewport-top", px(viewportTop));
      documentRoot.style.setProperty("--locoris-mobile-editor-viewport-left", px(viewportLeft));
      documentRoot.style.setProperty("--locoris-mobile-editor-viewport-width", px(viewportWidth));
      documentRoot.style.setProperty("--locoris-mobile-editor-viewport-height", px(viewportHeight));
      documentRoot.style.setProperty("--locoris-mobile-editor-keyboard-inset", px(keyboardInset));
      editorPane.dataset.mobileKeyboard = keyboardOpen ? "open" : "closed";

      if (editorHasFocus) {
        scheduleCaretVisibility(48);
      }
    };

    const scheduleViewportSync = () => {
      if (viewportFrame) {
        window.cancelAnimationFrame(viewportFrame);
      }

      viewportFrame = window.requestAnimationFrame(syncVisualViewport);
    };

    const handleEditorPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      pointerStart = { x: event.clientX, y: event.clientY };
    };

    const handleEditorPointerUp = (event: PointerEvent) => {
      const start = pointerStart;
      pointerStart = null;

      if (!start || !(event.target instanceof Element)) {
        return;
      }

      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) {
        return;
      }

      if (event.target.closest(EDITOR_INTERACTIVE_SELECTOR)) {
        return;
      }

      const activeElement = document.activeElement;

      if (
        activeElement instanceof HTMLElement &&
        editorPane.contains(activeElement) &&
        activeElement.isContentEditable
      ) {
        scheduleCaretVisibility(60);
        return;
      }

      const isInsideEditor = Boolean(event.target.closest(".bn-editor"));
      focusRequestRef.current({ moveToDocumentEnd: !isInsideEditor });
      scheduleCaretVisibility(80);
    };

    const handleEditorPointerCancel = () => {
      pointerStart = null;
    };

    const handleFocusChange = () => {
      scheduleViewportSync();
      scheduleCaretVisibility(60);
    };

    const handleSelectionChange = () => scheduleCaretVisibility();

    syncVisualViewport();
    visualViewport?.addEventListener("resize", scheduleViewportSync);
    visualViewport?.addEventListener("scroll", scheduleViewportSync);
    window.addEventListener("resize", scheduleViewportSync);
    window.addEventListener("orientationchange", scheduleViewportSync);
    document.addEventListener("selectionchange", handleSelectionChange);
    editorStage.addEventListener("pointerdown", handleEditorPointerDown, true);
    editorStage.addEventListener("pointerup", handleEditorPointerUp, true);
    editorStage.addEventListener("pointercancel", handleEditorPointerCancel, true);
    editorStage.addEventListener("input", handleFocusChange);
    editorPane.addEventListener("focusin", handleFocusChange);
    editorPane.addEventListener("focusout", handleFocusChange);

    return () => {
      visualViewport?.removeEventListener("resize", scheduleViewportSync);
      visualViewport?.removeEventListener("scroll", scheduleViewportSync);
      window.removeEventListener("resize", scheduleViewportSync);
      window.removeEventListener("orientationchange", scheduleViewportSync);
      document.removeEventListener("selectionchange", handleSelectionChange);
      editorStage.removeEventListener("pointerdown", handleEditorPointerDown, true);
      editorStage.removeEventListener("pointerup", handleEditorPointerUp, true);
      editorStage.removeEventListener("pointercancel", handleEditorPointerCancel, true);
      editorStage.removeEventListener("input", handleFocusChange);
      editorPane.removeEventListener("focusin", handleFocusChange);
      editorPane.removeEventListener("focusout", handleFocusChange);
      window.cancelAnimationFrame(viewportFrame);
      window.cancelAnimationFrame(caretFrame);
      window.clearTimeout(caretTimer);
      delete editorPane.dataset.mobileKeyboard;

      previousProperties.forEach((value, property) => {
        if (value) {
          documentRoot.style.setProperty(property, value);
        } else {
          documentRoot.style.removeProperty(property);
        }
      });
    };
  }, [editorPaneRef, editorStageRef]);
}
