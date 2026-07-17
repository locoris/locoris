import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import MobileGlassHeader from "./MobileGlassHeader";
import SettingsSurface from "./SettingsSurface";
import "./SettingsSubpageLayer.css";

interface SettingsSubpageLayerProps {
  title: ReactNode;
  kicker?: ReactNode;
  closeLabel: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  onClose: () => void;
}

type SettingsSubpageMotionState = "entering" | "open" | "exiting";

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

export default function SettingsSubpageLayer({
  title,
  kicker,
  closeLabel,
  children,
  className,
  contentClassName,
  onClose
}: SettingsSubpageLayerProps) {
  const [motionState, setMotionState] = useState<SettingsSubpageMotionState>("entering");
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMotionState("open"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  const requestClose = useCallback(() => {
    if (motionState === "exiting") {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }

    setMotionState("exiting");
    closeTimerRef.current = window.setTimeout(onClose, 220);
  }, [motionState, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      requestClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  const layer = (
    <div
      className={[
        "settings-subpage-layer",
        `is-${motionState}`,
        className ?? ""
      ].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <button
        type="button"
        className="settings-subpage-backdrop"
        aria-label={closeLabel}
        onClick={requestClose}
      />
      <SettingsSurface className="settings-subpage-surface">
        <MobileGlassHeader
          className="settings-panel-header settings-subpage-header is-root-action"
          kicker={kicker}
          title={title}
          closeLabel={closeLabel}
          closeIcon={<CloseGlyph />}
          onClose={requestClose}
        />
        <div
          className={["settings-subpage-content", contentClassName ?? ""]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
      </SettingsSurface>
    </div>
  );

  if (typeof document === "undefined") {
    return layer;
  }

  return createPortal(layer, document.body);
}
