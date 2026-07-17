import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

import "./SettingsPanel.css";
import "./SettingsSurface.css";

interface SettingsSurfaceProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  children: ReactNode;
}

export default function SettingsSurface({
  children,
  className,
  ...props
}: SettingsSurfaceProps) {
  const surfaceRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (surfaceRef.current) {
      surfaceRef.current.scrollTop = 0;
    }
  }, [className]);

  return (
    <section
      ref={surfaceRef}
      className={["settings-panel-shell", "settings-surface", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </section>
  );
}
