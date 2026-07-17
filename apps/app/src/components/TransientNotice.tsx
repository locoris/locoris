import type { ReactNode } from "react";

import "./TransientNotice.css";

export type TransientNoticeTone = "success" | "error" | "info";

interface TransientNoticeProps {
  tone: TransientNoticeTone;
  children: ReactNode;
  dismissLabel: string;
  className?: string;
  onDismiss: () => void;
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

export default function TransientNotice({
  tone,
  children,
  dismissLabel,
  className,
  onDismiss
}: TransientNoticeProps) {
  return (
    <div
      className={["transient-notice", `is-${tone}`, className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="transient-notice-mark" aria-hidden="true">
        {tone === "success" ? "✓" : tone === "error" ? "!" : "i"}
      </span>
      <span className="transient-notice-copy">{children}</span>
      <button
        type="button"
        className="transient-notice-dismiss"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={onDismiss}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
