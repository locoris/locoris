import type { ReactNode } from "react";

import "./MobileGlassHeader.css";

interface MobileGlassHeaderProps {
  title?: ReactNode;
  kicker?: ReactNode;
  titleHidden?: boolean;
  backLabel?: string;
  closeLabel?: string;
  backIcon?: ReactNode;
  closeIcon?: ReactNode;
  className?: string;
  onBack?: () => void;
  onClose?: () => void;
}

export default function MobileGlassHeader({
  title,
  kicker,
  titleHidden = false,
  backLabel,
  closeLabel,
  backIcon,
  closeIcon,
  className,
  onBack,
  onClose
}: MobileGlassHeaderProps) {
  const headerClassName = [
    "mobile-glass-header",
    onBack ? "has-back-action" : "is-root-action",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClassName}>
      {onBack ? (
        <button
          type="button"
          className="mobile-glass-header-button mobile-glass-header-back settings-panel-nav-button"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
        >
          <span aria-hidden="true">{backIcon}</span>
        </button>
      ) : (
        <span className="mobile-glass-header-pad settings-panel-header-pad" aria-hidden="true" />
      )}

      <div className="mobile-glass-header-copy settings-panel-heading">
        {kicker ? <p className="mobile-glass-header-kicker settings-panel-kicker">{kicker}</p> : null}
        {title ? (
          <h2
            className={
              titleHidden
                ? "mobile-glass-header-title panel-title settings-panel-title sr-only"
                : "mobile-glass-header-title panel-title settings-panel-title"
            }
          >
            {title}
          </h2>
        ) : null}
      </div>

      {onClose ? (
        <button
          type="button"
          className="mobile-glass-header-button mobile-glass-header-close settings-panel-nav-button settings-panel-close-button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          <span aria-hidden="true">{closeIcon}</span>
        </button>
      ) : (
        <span className="mobile-glass-header-pad settings-panel-header-pad" aria-hidden="true" />
      )}
    </header>
  );
}
