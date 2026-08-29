import { useEffect, useRef, type RefObject } from "react";

type MobileEditorFocusRequest = {
  moveToDocumentEnd: boolean;
};

type UseMobileEditorExperienceOptions = {
  enabled: boolean;
  editorPaneRef: RefObject<HTMLElement | null>;
  editorStageRef: RefObject<HTMLElement | null>;
  onRequestEditorFocus: (request: MobileEditorFocusRequest) => void;
};

const MOBILE_SHELL_SELECTOR = '.locoris-adaptive-shell[data-mobile-shell="true"]';
const MOBILE_EDITOR_POPOVER_SELECTOR = [
  ".editor-floating-toolbar-popover",
  ".editor-link-toolbar-popover",
  ".editor-file-panel-popover",
  ".bn-menu-dropdown",
  ".bn-form-popover",
  ".bn-panel-popover",
  ".mantine-Popover-dropdown",
  ".mantine-Menu-dropdown",
  ".mantine-Combobox-dropdown",
  "[data-combobox-dropdown]"
].join(",");
const MOBILE_EDITOR_SUBMENU_SELECTOR = [
  ".bn-menu-dropdown",
  ".bn-form-popover",
  ".bn-panel-popover",
  ".mantine-Popover-dropdown",
  ".mantine-Menu-dropdown",
  ".mantine-Combobox-dropdown",
  "[data-combobox-dropdown]"
].join(",");
const MOBILE_EDITOR_POPOVER_ACTION_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  "[role='button']:not([aria-disabled='true'])",
  "[role='menuitem']:not([aria-disabled='true'])",
  "[role='option']:not([aria-disabled='true'])"
].join(",");
const MOBILE_EDITOR_POPOVER_FIELD_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']"
].join(",");
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
  ".bn-table-cell-handle"
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

function getEditableRoot(target: Element, editorStage: HTMLElement) {
  const closestEditable = target.closest<HTMLElement>("[contenteditable='true']");

  if (closestEditable && editorStage.contains(closestEditable)) {
    return closestEditable;
  }

  return editorStage.querySelector<HTMLElement>(".bn-editor[contenteditable='true'], .ProseMirror[contenteditable='true']");
}

export function placeMobileCaretFromPoint(editable: HTMLElement, x: number, y: number) {
  const documentWithCaretApi = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let range: Range | null = null;
  const caretPosition = documentWithCaretApi.caretPositionFromPoint?.(x, y);

  if (caretPosition && editable.contains(caretPosition.offsetNode)) {
    range = document.createRange();
    range.setStart(caretPosition.offsetNode, caretPosition.offset);
    range.collapse(true);
  } else {
    const caretRange = documentWithCaretApi.caretRangeFromPoint?.(x, y) ?? null;
    if (caretRange && editable.contains(caretRange.startContainer)) {
      range = caretRange;
    }
  }

  if (!range) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

type MobileEditorTap = {
  time: number;
  x: number;
  y: number;
};

export function isRepeatedMobileEditorTap(
  previous: MobileEditorTap | null,
  current: MobileEditorTap,
  maximumDelay = 420,
  maximumDistance = 24
) {
  return Boolean(
    previous &&
      current.time - previous.time <= maximumDelay &&
      Math.hypot(current.x - previous.x, current.y - previous.y) <= maximumDistance
  );
}

type MobileSelectionToolbarPlacement = {
  selectionTop: number;
  selectionBottom: number;
  toolbarHeight: number;
  safeTop: number;
  safeBottom: number;
  gap?: number;
};

type MobilePopoverPlacement = {
  anchorTop: number;
  anchorRight: number;
  anchorBottom: number;
  anchorLeft: number;
  popoverWidth: number;
  popoverHeight: number;
  viewportTop: number;
  viewportRight: number;
  viewportBottom: number;
  viewportLeft: number;
  gap?: number;
  margin?: number;
};

type MobilePopoverPosition = {
  top: number;
  left: number;
  maxHeight: number;
  placement: "above" | "below";
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

export function resolveMobilePopoverPosition({
  anchorTop,
  anchorRight,
  anchorBottom,
  anchorLeft,
  popoverWidth,
  popoverHeight,
  viewportTop,
  viewportRight,
  viewportBottom,
  viewportLeft,
  gap = 8,
  margin = 8
}: MobilePopoverPlacement): MobilePopoverPosition {
  const safeTop = viewportTop + margin;
  const safeRight = viewportRight - margin;
  const safeBottom = viewportBottom - margin;
  const safeLeft = viewportLeft + margin;
  const availableAbove = Math.max(0, anchorTop - gap - safeTop);
  const availableBelow = Math.max(0, safeBottom - anchorBottom - gap);
  const placement =
    availableBelow >= Math.min(popoverHeight, 160) || availableBelow >= availableAbove
      ? "below"
      : "above";
  const maxHeight = placement === "below" ? availableBelow : availableAbove;
  const renderedHeight = Math.min(popoverHeight, maxHeight);
  const renderedWidth = Math.min(popoverWidth, Math.max(0, safeRight - safeLeft));
  const preferredLeft =
    anchorLeft + renderedWidth <= safeRight
      ? anchorLeft
      : anchorRight - renderedWidth;
  const left = Math.min(
    Math.max(safeLeft, preferredLeft),
    Math.max(safeLeft, safeRight - renderedWidth)
  );
  const top =
    placement === "below"
      ? anchorBottom + gap
      : Math.max(safeTop, anchorTop - gap - renderedHeight);

  return { top, left, maxHeight, placement };
}

export default function useMobileEditorExperience({
  enabled,
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

    if (!enabled || !editorPane || !editorStage || !mobileShell) {
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
    let submenuFrame = 0;
    let submenuTimer = 0;
    let lastPopoverAnchorRect: DOMRect | null = null;
    let syntheticPopoverClick = false;
    let suppressedNativeClickTarget: HTMLElement | null = null;
    let suppressNativeClickUntil = 0;
    let pointerStart: { x: number; y: number } | null = null;
    let pointerEditableRoot: HTMLElement | null = null;
    let pointerStartedWithEditorFocus = false;
    let lastEditorTap: MobileEditorTap | null = null;
    let mobileActionStart: {
      action: HTMLElement;
      x: number;
      y: number;
    } | null = null;
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

    const clearSubmenuPosition = (submenu: HTMLElement) => {
      submenu.classList.remove("locoris-mobile-editor-submenu");
      submenu.removeAttribute("data-mobile-placement");
      submenu.style.removeProperty("--locoris-mobile-editor-submenu-top");
      submenu.style.removeProperty("--locoris-mobile-editor-submenu-left");
      submenu.style.removeProperty("--locoris-mobile-editor-submenu-max-height");
    };

    const positionEditorSubmenus = () => {
      submenuFrame = 0;
      const anchorRect = lastPopoverAnchorRect;

      if (!anchorRect) {
        return;
      }

      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportRight = viewportLeft + (visualViewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);

      document.querySelectorAll<HTMLElement>(MOBILE_EDITOR_SUBMENU_SELECTOR).forEach((submenu) => {
        if (submenu.getClientRects().length === 0) {
          clearSubmenuPosition(submenu);
          return;
        }

        const submenuRect = submenu.getBoundingClientRect();

        if (submenuRect.width <= 0 || submenuRect.height <= 0) {
          return;
        }

        const position = resolveMobilePopoverPosition({
          anchorTop: anchorRect.top,
          anchorRight: anchorRect.right,
          anchorBottom: anchorRect.bottom,
          anchorLeft: anchorRect.left,
          popoverWidth: submenuRect.width,
          popoverHeight: submenuRect.height,
          viewportTop,
          viewportRight,
          viewportBottom,
          viewportLeft
        });

        submenu.classList.add("locoris-mobile-editor-submenu");
        submenu.dataset.mobilePlacement = position.placement;
        submenu.style.setProperty("--locoris-mobile-editor-submenu-top", px(position.top));
        submenu.style.setProperty("--locoris-mobile-editor-submenu-left", px(position.left));
        submenu.style.setProperty(
          "--locoris-mobile-editor-submenu-max-height",
          px(position.maxHeight)
        );
      });
    };

    const scheduleSubmenuPosition = (delay = 0) => {
      window.clearTimeout(submenuTimer);

      if (delay > 0) {
        submenuTimer = window.setTimeout(() => scheduleSubmenuPosition(), delay);
        return;
      }

      if (submenuFrame) {
        window.cancelAnimationFrame(submenuFrame);
      }

      submenuFrame = window.requestAnimationFrame(positionEditorSubmenus);
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
      scheduleSubmenuPosition();
    };

    const scheduleViewportSync = (keepCaretVisible = false) => {
      viewportShouldKeepCaretVisible ||= keepCaretVisible;

      if (viewportFrame) {
        window.cancelAnimationFrame(viewportFrame);
      }

      viewportFrame = window.requestAnimationFrame(syncVisualViewport);
    };

    const handleEditorPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) {
        return;
      }

      pointerStart = { x: event.clientX, y: event.clientY };
      pointerEditableRoot = null;
      pointerStartedWithEditorFocus = false;

      if (event.target.closest(EDITOR_INTERACTIVE_SELECTOR)) {
        return;
      }

      const editorBody = event.target.closest(".bn-editor, .ProseMirror");
      if (!editorBody) {
        return;
      }

      const editable = getEditableRoot(event.target, editorStage);
      if (!editable) {
        return;
      }

      pointerEditableRoot = editable;
      pointerStartedWithEditorFocus = document.activeElement === editable;

      if (!pointerStartedWithEditorFocus) {
        // Focus inside the original touch gesture so iOS opens the keyboard on the
        // first tap. Placing the range from the touch coordinates avoids BlockNote's
        // default focus command moving the caret to the previous cursor position.
        editable.focus({ preventScroll: true });
        placeMobileCaretFromPoint(editable, event.clientX, event.clientY);
        scheduleViewportSync(true);
      }
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
      const editable = pointerEditableRoot;
      const startedWithFocus = pointerStartedWithEditorFocus;
      pointerEditableRoot = null;
      pointerStartedWithEditorFocus = false;

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
        const currentTap = {
          time: performance.now(),
          x: event.clientX,
          y: event.clientY
        };
        const repeatedTap = isRepeatedMobileEditorTap(lastEditorTap, currentTap);
        lastEditorTap = currentTap;

        if (editable && !startedWithFocus) {
          editable.focus({ preventScroll: true });
          placeMobileCaretFromPoint(editable, event.clientX, event.clientY);
        } else if (editable && !repeatedTap) {
          // A programmatic focus restored after a sheet closes does not always make
          // the next iOS tap move the caret. Keep single taps deterministic while
          // leaving repeated taps to Safari's native word/paragraph selection.
          placeMobileCaretFromPoint(editable, event.clientX, event.clientY);
        }
        scheduleCaretVisibility(60);
        return;
      }

      focusRequestRef.current({ moveToDocumentEnd: true });
      scheduleCaretVisibility(80);
    };

    const handleEditorPointerCancel = () => {
      pointerStart = null;
      pointerEditableRoot = null;
      pointerStartedWithEditorFocus = false;
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

    const handlePopoverPointerDown = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const popover = event.target.closest<HTMLElement>(MOBILE_EDITOR_POPOVER_SELECTOR);
      const action = event.target.closest<HTMLElement>(MOBILE_EDITOR_POPOVER_ACTION_SELECTOR);

      if (
        !action ||
        (!popover && !editorPane.contains(action)) ||
        (popover && !popover.contains(action)) ||
        action.closest("[data-mobile-editor-press='true']") ||
        action.matches(MOBILE_EDITOR_POPOVER_FIELD_SELECTOR)
      ) {
        return;
      }

      lastPopoverAnchorRect = action.getBoundingClientRect();

      if (event.pointerType === "mouse") {
        if (popover) {
          scheduleSubmenuPosition(42);
        }
        return;
      }

      if (!popover) {
        mobileActionStart = {
          action,
          x: event.clientX,
          y: event.clientY
        };
        return;
      }

      // BlockNote and Mantine normally move focus before their click handlers run.
      // On iOS that closes the selection and makes the first tap a no-op. Activate
      // the control while the current editor selection is still intact.
      event.preventDefault();
      event.stopPropagation();
      suppressedNativeClickTarget = action;
      suppressNativeClickUntil = performance.now() + 720;
      syntheticPopoverClick = true;
      action.click();
      syntheticPopoverClick = false;
      scheduleToolbarPosition();
      scheduleSubmenuPosition();
      scheduleSubmenuPosition(42);
    };

    const handleMobileActionPointerUp = (event: PointerEvent) => {
      const start = mobileActionStart;
      mobileActionStart = null;

      if (
        !start ||
        event.pointerType === "mouse" ||
        !(event.target instanceof Node) ||
        !start.action.contains(event.target) ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressedNativeClickTarget = start.action;
      suppressNativeClickUntil = performance.now() + 720;
      syntheticPopoverClick = true;
      start.action.click();
      syntheticPopoverClick = false;
    };

    const handleMobileActionPointerCancel = () => {
      mobileActionStart = null;
    };

    const handlePopoverClick = (event: MouseEvent) => {
      if (
        syntheticPopoverClick ||
        performance.now() > suppressNativeClickUntil ||
        !(event.target instanceof Node) ||
        !suppressedNativeClickTarget?.contains(event.target)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      suppressedNativeClickTarget = null;
      suppressNativeClickUntil = 0;
    };

    const toolbarObserver = new MutationObserver((records) => {
      const floatingUiWasAdded = records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof Element &&
            (node.matches(MOBILE_EDITOR_POPOVER_SELECTOR) ||
              Boolean(node.querySelector(MOBILE_EDITOR_POPOVER_SELECTOR)))
        )
      );

      if (floatingUiWasAdded) {
        scheduleToolbarPosition();
        scheduleToolbarPosition(36);
        scheduleSubmenuPosition();
        scheduleSubmenuPosition(42);
      }
    });

    syncVisualViewport();
    toolbarObserver.observe(document.body, { childList: true, subtree: true });
    visualViewport?.addEventListener("resize", handleViewportResize);
    visualViewport?.addEventListener("scroll", handleViewportScroll);
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("orientationchange", handleViewportResize);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePopoverPointerDown, true);
    document.addEventListener("pointerup", handleMobileActionPointerUp, true);
    document.addEventListener("pointercancel", handleMobileActionPointerCancel, true);
    document.addEventListener("click", handlePopoverClick, true);
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
      document.removeEventListener("pointerdown", handlePopoverPointerDown, true);
      document.removeEventListener("pointerup", handleMobileActionPointerUp, true);
      document.removeEventListener("pointercancel", handleMobileActionPointerCancel, true);
      document.removeEventListener("click", handlePopoverClick, true);
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
      window.cancelAnimationFrame(submenuFrame);
      window.clearTimeout(caretTimer);
      window.clearTimeout(toolbarTimer);
      window.clearTimeout(submenuTimer);
      delete editorPane.dataset.mobileKeyboard;

      document.querySelectorAll<HTMLElement>(MOBILE_EDITOR_SUBMENU_SELECTOR).forEach(
        clearSubmenuPosition
      );

      previousProperties.forEach((value, property) => {
        if (value) {
          documentRoot.style.setProperty(property, value);
        } else {
          documentRoot.style.removeProperty(property);
        }
      });
    };
  }, [editorPaneRef, editorStageRef, enabled]);
}
