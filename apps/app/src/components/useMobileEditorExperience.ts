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
  "--locoris-mobile-editor-keyboard-inset",
  "--locoris-mobile-editor-selection-toolbar-top",
  "--locoris-mobile-editor-selection-toolbar-bottom"
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

type MobileSelectionToolbarPlacement = {
  selectionTop: number;
  selectionBottom: number;
  toolbarHeight: number;
  safeTop: number;
  safeBottom: number;
  gap?: number;
};

export function resolveMobileSelectionToolbarTop({
  selectionTop,
  selectionBottom,
  toolbarHeight,
  safeTop,
  safeBottom,
  gap = 10
}: MobileSelectionToolbarPlacement) {
  const maximumTop = Math.max(safeTop, safeBottom - toolbarHeight);
  const above = selectionTop - toolbarHeight - gap;
  const below = selectionBottom + gap;

  if (above >= safeTop) {
    return Math.min(above, maximumTop);
  }

  if (below + toolbarHeight <= safeBottom) {
    return Math.max(safeTop, below);
  }

  const availableAbove = Math.max(0, selectionTop - safeTop);
  const availableBelow = Math.max(0, safeBottom - selectionBottom);
  const preferred = availableAbove >= availableBelow ? above : below;

  return Math.min(maximumTop, Math.max(safeTop, preferred));
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
    let viewportShouldKeepCaretVisible = false;
    let caretFrame = 0;
    let caretTimer = 0;
    let toolbarFrame = 0;
    let toolbarTimer = 0;
    let pointerStart: { x: number; y: number } | null = null;
    let suppressCaretUntil = 0;
    let programmaticCaretScroll = false;

    const cancelCaretVisibility = () => {
      window.clearTimeout(caretTimer);
      caretTimer = 0;

      if (caretFrame) {
        window.cancelAnimationFrame(caretFrame);
        caretFrame = 0;
      }
    };

    const markManualScroll = () => {
      suppressCaretUntil = performance.now() + 420;
      cancelCaretVisibility();
    };

    const clearToolbarPosition = () => {
      documentRoot.style.removeProperty("--locoris-mobile-editor-selection-toolbar-top");
      documentRoot.style.removeProperty("--locoris-mobile-editor-selection-toolbar-bottom");
    };

    const positionSelectionToolbar = () => {
      toolbarFrame = 0;
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        clearToolbarPosition();
        return;
      }

      const selectionElement = getSelectionElement(selection);

      if (!selectionElement?.closest(".locoris-editor-surface")) {
        clearToolbarPosition();
        return;
      }

      const toolbar = Array.from(
        document.querySelectorAll<HTMLElement>(".editor-floating-toolbar-popover")
      ).find((element) => element.getClientRects().length > 0);

      if (!toolbar) {
        return;
      }

      const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const stageRect = editorStage.getBoundingClientRect();
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
      const safeTop = Math.max(stageRect.top + 8, viewportTop + 8);
      const safeBottom = Math.min(stageRect.bottom - 8, viewportBottom - 8);

      if (
        selectionRect.height <= 0 ||
        toolbarRect.height <= 0 ||
        safeBottom - safeTop < toolbarRect.height
      ) {
        clearToolbarPosition();
        return;
      }

      const top = resolveMobileSelectionToolbarTop({
        selectionTop: selectionRect.top,
        selectionBottom: selectionRect.bottom,
        toolbarHeight: toolbarRect.height,
        safeTop,
        safeBottom
      });

      documentRoot.style.setProperty(
        "--locoris-mobile-editor-selection-toolbar-top",
        px(top)
      );
      documentRoot.style.setProperty(
        "--locoris-mobile-editor-selection-toolbar-bottom",
        "auto"
      );
    };

    const scheduleToolbarPosition = (delay = 0) => {
      window.clearTimeout(toolbarTimer);

      if (delay > 0) {
        toolbarTimer = window.setTimeout(() => scheduleToolbarPosition(), delay);
        return;
      }

      if (toolbarFrame) {
        window.cancelAnimationFrame(toolbarFrame);
      }

      toolbarFrame = window.requestAnimationFrame(positionSelectionToolbar);
    };

    const ensureCaretIsVisible = () => {
      caretFrame = 0;

      if (
        editorPane.dataset.mobileKeyboard !== "open" ||
        performance.now() < suppressCaretUntil
      ) {
        return;
      }

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
        programmaticCaretScroll = true;
        editorStage.scrollBy({ top: delta, behavior: "auto" });
        window.requestAnimationFrame(() => {
          programmaticCaretScroll = false;
        });
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
      const shouldKeepCaretVisible = viewportShouldKeepCaretVisible;
      viewportShouldKeepCaretVisible = false;
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

      if (shouldKeepCaretVisible && editorHasFocus && keyboardOpen) {
        scheduleCaretVisibility(48);
      }

      scheduleToolbarPosition();
    };

    const scheduleViewportSync = (keepCaretVisible = false) => {
      viewportShouldKeepCaretVisible ||= keepCaretVisible;

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

    const handleEditorPointerMove = (event: PointerEvent) => {
      const start = pointerStart;

      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 9) {
        return;
      }

      markManualScroll();
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

      if (event.target.closest(".bn-editor")) {
        // iOS places the caret and focuses contenteditable correctly on the first tap.
        // Calling editor.focus() here overwrites that native result and makes the next tap
        // look like the first effective interaction.
        scheduleCaretVisibility(60);
        return;
      }

      focusRequestRef.current({ moveToDocumentEnd: true });
      scheduleCaretVisibility(80);
    };

    const handleEditorPointerCancel = () => {
      pointerStart = null;
    };

    const handleFocusIn = () => {
      scheduleViewportSync(true);
      scheduleCaretVisibility(60);
    };

    const handleFocusOut = () => scheduleViewportSync();

    const handleInput = () => {
      scheduleViewportSync(true);
      scheduleCaretVisibility(40);
    };

    const handleSelectionChange = () => {
      scheduleToolbarPosition();
      scheduleToolbarPosition(36);
    };

    const handleEditorScroll = () => {
      if (!programmaticCaretScroll) {
        markManualScroll();
      }

      scheduleToolbarPosition();
    };

    const handleWheel = () => markManualScroll();

    const handleViewportResize = () => scheduleViewportSync(true);
    const handleViewportScroll = () => scheduleViewportSync();

    const toolbarObserver = new MutationObserver((records) => {
      const toolbarWasAdded = records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof Element &&
            (node.matches(".editor-floating-toolbar-popover") ||
              Boolean(node.querySelector(".editor-floating-toolbar-popover")))
        )
      );

      if (toolbarWasAdded) {
        scheduleToolbarPosition();
        scheduleToolbarPosition(36);
      }
    });

    syncVisualViewport();
    toolbarObserver.observe(document.body, { childList: true, subtree: true });
    visualViewport?.addEventListener("resize", handleViewportResize);
    visualViewport?.addEventListener("scroll", handleViewportScroll);
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("orientationchange", handleViewportResize);
    document.addEventListener("selectionchange", handleSelectionChange);
    editorStage.addEventListener("pointerdown", handleEditorPointerDown, true);
    editorStage.addEventListener("pointermove", handleEditorPointerMove, true);
    editorStage.addEventListener("pointerup", handleEditorPointerUp, true);
    editorStage.addEventListener("pointercancel", handleEditorPointerCancel, true);
    editorStage.addEventListener("scroll", handleEditorScroll, { passive: true });
    editorStage.addEventListener("wheel", handleWheel, { passive: true });
    editorStage.addEventListener("input", handleInput);
    editorPane.addEventListener("focusin", handleFocusIn);
    editorPane.addEventListener("focusout", handleFocusOut);

    return () => {
      toolbarObserver.disconnect();
      visualViewport?.removeEventListener("resize", handleViewportResize);
      visualViewport?.removeEventListener("scroll", handleViewportScroll);
      window.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("orientationchange", handleViewportResize);
      document.removeEventListener("selectionchange", handleSelectionChange);
      editorStage.removeEventListener("pointerdown", handleEditorPointerDown, true);
      editorStage.removeEventListener("pointermove", handleEditorPointerMove, true);
      editorStage.removeEventListener("pointerup", handleEditorPointerUp, true);
      editorStage.removeEventListener("pointercancel", handleEditorPointerCancel, true);
      editorStage.removeEventListener("scroll", handleEditorScroll);
      editorStage.removeEventListener("wheel", handleWheel);
      editorStage.removeEventListener("input", handleInput);
      editorPane.removeEventListener("focusin", handleFocusIn);
      editorPane.removeEventListener("focusout", handleFocusOut);
      window.cancelAnimationFrame(viewportFrame);
      window.cancelAnimationFrame(caretFrame);
      window.cancelAnimationFrame(toolbarFrame);
      window.clearTimeout(caretTimer);
      window.clearTimeout(toolbarTimer);
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
