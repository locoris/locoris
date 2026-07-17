import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import TransientNotice, { type TransientNoticeTone } from "./TransientNotice";
import "./ActionFeedbackToast.css";

interface ActionFeedbackToastProps {
  anchor: HTMLElement | null;
  tone: TransientNoticeTone;
  children: ReactNode;
  dismissLabel: string;
  onDismiss: () => void;
}

type ToastPosition = {
  left: number;
  top: number;
} | null;

const INTERACTIVE_SELECTOR = "button, [role='button'], a";

/** Keeps feedback at its action origin; a closed sheet falls back to a safe viewport toast. */
export function useActionFeedbackAnchor(scopes: string[]) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const scopeKey = scopes.join("|");

  useEffect(() => {
    const rememberAction = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const action = target.closest(INTERACTIVE_SELECTOR);

      if (!(action instanceof HTMLElement) || !scopes.some((scope) => action.closest(scope))) {
        return;
      }

      setAnchor(action);
    };

    document.addEventListener("pointerdown", rememberAction, true);
    return () => document.removeEventListener("pointerdown", rememberAction, true);
  }, [scopeKey]);

  return anchor;
}

export default function ActionFeedbackToast({
  anchor,
  tone,
  children,
  dismissLabel,
  onDismiss
}: ActionFeedbackToastProps) {
  const toastRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ToastPosition>(null);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const toast = toastRef.current;

      if (!toast || !anchor?.isConnected) {
        setPosition(null);
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const toastRect = toast.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const sideInset = 14;
      const verticalInset = 14;
      const gap = 10;
      const toastWidth = Math.min(toastRect.width, Math.max(0, viewportWidth - sideInset * 2));
      const left = Math.min(
        Math.max(sideInset, anchorRect.left),
        Math.max(sideInset, viewportWidth - sideInset - toastWidth)
      );
      const belowTop = anchorRect.bottom + gap;
      const aboveTop = anchorRect.top - gap - toastRect.height;
      const canFitBelow = belowTop + toastRect.height <= viewportHeight - verticalInset;
      const top = canFitBelow
        ? belowTop
        : Math.max(verticalInset, Math.min(aboveTop, viewportHeight - verticalInset - toastRect.height));

      setPosition({ left, top });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (toastRef.current) {
      observer?.observe(toastRef.current);
    }

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      observer?.disconnect();
    };
  }, [anchor, children]);

  const toast = (
    <div
      ref={toastRef}
      className={`action-feedback-toast${position ? " is-anchored" : ""}`}
      style={position ? { left: position.left, top: position.top } : undefined}
    >
      <TransientNotice tone={tone} dismissLabel={dismissLabel} onDismiss={onDismiss}>
        {children}
      </TransientNotice>
    </div>
  );

  return typeof document === "undefined" ? toast : createPortal(toast, document.body);
}
