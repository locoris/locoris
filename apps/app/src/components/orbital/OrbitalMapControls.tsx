import type { ReactNode } from "react";

import "./OrbitalMapControls.css";

type MapControlIconKind = "play" | "pause" | "plan" | "zoom-in" | "zoom-out" | "center" | "reset";

interface OrbitalMapControlsProps {
  label: string;
  motionLabel: string;
  motionIcon: "play" | "pause";
  motionActive: boolean;
  temporalSignalsEnabled: boolean;
  temporalLayerVisible: boolean;
  temporalLabel: string;
  temporalLayerShowLabel: string;
  temporalLayerHideLabel: string;
  zoomOutLabel: string;
  zoomInLabel: string;
  centerSelectionLabel: string;
  resetViewLabel: string;
  onToggleMotion: () => void;
  onToggleTemporalLayer: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onCenterSelection: () => void;
  onResetView: () => void;
}

function MapControlIcon({ kind }: { kind: MapControlIconKind }) {
  return <span className={`orbital-map-control-icon is-${kind}`} aria-hidden="true" />;
}

function MapControlButton({
  icon,
  label,
  active = false,
  children,
  onClick
}: {
  icon: MapControlIconKind;
  label: string;
  active?: boolean;
  children?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="orbital-map-control-button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
    >
      <MapControlIcon kind={icon} />
      {children ? <span className="orbital-map-control-text">{children}</span> : null}
    </button>
  );
}

export default function OrbitalMapControls({
  label,
  motionLabel,
  motionIcon,
  motionActive,
  temporalSignalsEnabled,
  temporalLayerVisible,
  temporalLabel,
  temporalLayerShowLabel,
  temporalLayerHideLabel,
  zoomOutLabel,
  zoomInLabel,
  centerSelectionLabel,
  resetViewLabel,
  onToggleMotion,
  onToggleTemporalLayer,
  onZoomOut,
  onZoomIn,
  onCenterSelection,
  onResetView
}: OrbitalMapControlsProps) {
  return (
    <div className="orbital-map-controls" aria-label={label}>
      <MapControlButton icon={motionIcon} label={motionLabel} active={motionActive} onClick={onToggleMotion}>
        {motionLabel}
      </MapControlButton>
      {temporalSignalsEnabled ? (
        <MapControlButton
          icon="plan"
          label={temporalLayerVisible ? temporalLayerHideLabel : temporalLayerShowLabel}
          active={temporalLayerVisible}
          onClick={onToggleTemporalLayer}
        >
          {temporalLabel}
        </MapControlButton>
      ) : null}
      <MapControlButton icon="zoom-out" label={zoomOutLabel} onClick={onZoomOut} />
      <MapControlButton icon="zoom-in" label={zoomInLabel} onClick={onZoomIn} />
      <MapControlButton icon="center" label={centerSelectionLabel} onClick={onCenterSelection} />
      <MapControlButton icon="reset" label={resetViewLabel} onClick={onResetView} />
    </div>
  );
}
