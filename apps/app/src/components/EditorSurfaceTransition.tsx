import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref
} from "react";

import type { Note } from "../types";
import "./EditorSurfaceTransition.css";

const EDITOR_EXIT_DURATION_MS = 230;

interface EditorSurfaceSnapshot {
  accentColor: string;
  canvasFullscreen: boolean;
  content: ReactNode;
  contentKey: string;
  mode: Note["contentType"];
  title: string;
}

interface EditorSurfaceTransitionProps {
  open: boolean;
  mode: Note["contentType"] | null;
  contentKey: string | null;
  title: string;
  accentColor: string;
  canvasFullscreen: boolean;
  modalRef: Ref<HTMLDivElement>;
  children: ReactNode;
  labels: {
    openCanvas: string;
    openNote: string;
    enterFullscreen: string;
    exitFullscreen: string;
    closeEditor: string;
  };
  onClose: () => void;
  onToggleCanvasFullscreen: () => void;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export default function EditorSurfaceTransition({
  open,
  mode,
  contentKey,
  title,
  accentColor,
  canvasFullscreen,
  modalRef,
  children,
  labels,
  onClose,
  onToggleCanvasFullscreen
}: EditorSurfaceTransitionProps) {
  const snapshotRef = useRef<EditorSurfaceSnapshot | null>(null);
  const [keepMounted, setKeepMounted] = useState(open);

  if (open && mode && contentKey && children) {
    snapshotRef.current = {
      accentColor,
      canvasFullscreen,
      content: children,
      contentKey,
      mode,
      title
    };
  }

  useEffect(() => {
    if (open) {
      setKeepMounted(true);
      return;
    }

    if (!keepMounted) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => setKeepMounted(false),
      prefersReducedMotion() ? 16 : EDITOR_EXIT_DURATION_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [keepMounted, open]);

  const snapshot = snapshotRef.current;
  const shouldRender = Boolean(snapshot && (open || keepMounted));

  if (!shouldRender || !snapshot) {
    return null;
  }

  const isCanvas = snapshot.mode === "canvas";
  const isCanvasFullscreen = snapshot.canvasFullscreen;
  const phaseClassName = open ? "is-entering" : "is-exiting";

  return (
    <div
      className={`orbital-modal-layer orbital-editor-modal-layer editor-surface-transition ${
        isCanvas ? "is-canvas-mode" : "is-note-mode"
      } ${isCanvasFullscreen ? "is-canvas-fullscreen" : ""} ${phaseClassName}`}
      role="dialog"
      aria-modal="true"
      aria-label={snapshot.title || (isCanvas ? labels.openCanvas : labels.openNote)}
      aria-hidden={open ? undefined : true}
    >
      <button
        type="button"
        className="orbital-modal-dim editor-surface-transition-dim"
        aria-label={labels.closeEditor}
        onClick={onClose}
        disabled={!open}
      />
      <div
        ref={modalRef}
        className={`orbital-modal-window orbital-editor-modal-window editor-surface-transition-window ${
          isCanvas ? "is-canvas-mode" : "is-note-mode"
        } ${isCanvasFullscreen ? "is-canvas-fullscreen" : ""}`}
        style={
          {
            "--editor-modal-accent": snapshot.accentColor
          } as CSSProperties
        }
      >
        <div
          className={`orbital-editor-topbar ${isCanvas ? "is-canvas-mode" : "is-note-mode"}`}
          aria-label={isCanvas ? labels.openCanvas : labels.openNote}
        >
          <div
            className={`orbital-editor-topactions ${isCanvas ? "is-canvas-mode" : "is-note-mode"}`}
          >
            {isCanvas ? (
              <button
                type="button"
                className="toolbar-action orbital-toolbar-action"
                onClick={onToggleCanvasFullscreen}
              >
                {isCanvasFullscreen ? labels.exitFullscreen : labels.enterFullscreen}
              </button>
            ) : null}
            <button
              type="button"
              className="toolbar-action danger orbital-editor-close-action"
              onClick={onClose}
              aria-label={labels.closeEditor}
              title={labels.closeEditor}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        <div
          className={`orbital-editor-scroll ${isCanvas ? "is-canvas-mode" : "is-note-mode"}`}
        >
          <div
            key={`${snapshot.mode}-${snapshot.contentKey}`}
            className={`editor-surface-transition-content ${
              isCanvas ? "is-canvas-mode" : "is-note-mode"
            }`}
          >
            {snapshot.content}
          </div>
        </div>
      </div>
    </div>
  );
}
