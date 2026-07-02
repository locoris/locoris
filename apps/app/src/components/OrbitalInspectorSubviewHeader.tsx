import type { ChangeEvent } from "react";
import type { CSSProperties } from "react";

import "./OrbitalInspectorSubviewHeader.css";

export type OrbitalInspectorSubviewScope = "vault" | "project" | "documents";
export type OrbitalInspectorSubviewDocumentFilter = "note" | "canvas";

type InspectorSubviewAction = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

type InspectorSubviewScopeSwitch = {
  value: OrbitalInspectorSubviewScope;
  label: string;
  vaultLabel: string;
  projectLabel: string;
  documentsLabel?: string;
  projectDisabled?: boolean;
  onChange: (scope: OrbitalInspectorSubviewScope) => void;
};

type InspectorSubviewDocumentFilterState = {
  label: string;
  count: number;
  active: boolean;
  onToggle: () => void;
};

type InspectorSubviewHierarchyToggle = {
  label: string;
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

type OrbitalInspectorSubviewHeaderProps = {
  title: string;
  count: number;
  accentColor: string;
  backLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  query: string;
  quickActions?: {
    folder: InspectorSubviewAction;
    note: InspectorSubviewAction;
    canvas: InspectorSubviewAction;
  } | null;
  hierarchyToggle?: InspectorSubviewHierarchyToggle | null;
  scopeSwitch?: InspectorSubviewScopeSwitch | null;
  documentFilters?: Record<OrbitalInspectorSubviewDocumentFilter, InspectorSubviewDocumentFilterState> | null;
  onBack: () => void;
  onQueryChange: (value: string) => void;
};

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M14.6 6.2 8.8 12l5.8 5.8" />
      <path d="M9.4 12h9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <circle cx="10.7" cy="10.7" r="5.8" />
      <path d="m15 15 4.2 4.2" />
    </svg>
  );
}

function HierarchyToggleIcon({ expanded }: { expanded: boolean }) {
  if (expanded) {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M7 6.8h10" />
        <path d="M7 12h10" />
        <path d="M7 17.2h10" />
        <path d="m9.4 4.5-2.2 2.3 2.2 2.3" />
        <path d="m14.6 14.9 2.2 2.3-2.2 2.3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7 6.8h10" />
      <path d="M7 12h10" />
      <path d="M7 17.2h10" />
      <path d="m7.2 4.5 2.2 2.3-2.2 2.3" />
      <path d="m16.8 14.9-2.2 2.3 2.2 2.3" />
    </svg>
  );
}

function HeaderGlyph() {
  return (
    <span className="orbital-inspector-subview-glyph" aria-hidden="true">
      <span className="orbital-inspector-subview-glyph-ring" />
      <span className="orbital-inspector-subview-glyph-ring is-inner" />
      <span className="orbital-inspector-subview-glyph-core" />
    </span>
  );
}

function CreateIcon({ kind }: { kind: "folder" | "note" | "canvas" }) {
  if (kind === "folder") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M3.8 8.4c0-1.4 1.1-2.5 2.5-2.5h3.4l1.5 1.7h6.5c1.4 0 2.5 1.1 2.5 2.5v5.4c0 1.4-1.1 2.5-2.5 2.5H6.3c-1.4 0-2.5-1.1-2.5-2.5V8.4Z" />
        <path d="M16.6 8.5v5.2M14 11.1h5.2" />
      </svg>
    );
  }

  if (kind === "canvas") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <rect x="4.4" y="5.1" width="15.2" height="13.8" rx="3.1" />
        <path d="M8 10.1h5.8M8 13h4.2" />
        <path d="M17 7.8V12M14.9 9.9h4.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7.4 4.7h6.1l3.2 3.1v8.7c0 1.4-1.1 2.5-2.5 2.5H7.4c-1.4 0-2.5-1.1-2.5-2.5V7.2c0-1.4 1.1-2.5 2.5-2.5Z" />
      <path d="M13.5 4.9v3.4h3.1" />
      <path d="M15.7 12v4.2M13.6 14.1h4.2" />
    </svg>
  );
}

function DocumentFilterIcon({ kind }: { kind: OrbitalInspectorSubviewDocumentFilter }) {
  if (kind === "canvas") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <rect x="4.6" y="5.3" width="14.8" height="13.2" rx="3" />
        <path d="M8.2 9.8h7.6M8.2 12.6h4.8M8.2 15.4h6.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7.2 4.5h6.7L18 8.6v9.2c0 1.3-1.1 2.4-2.4 2.4H7.2c-1.3 0-2.4-1.1-2.4-2.4V6.9c0-1.3 1.1-2.4 2.4-2.4Z" />
      <path d="M13.8 4.8v4h4" />
      <path d="M8.2 12h6.9M8.2 14.8h5.7" />
    </svg>
  );
}

export default function OrbitalInspectorSubviewHeader({
  title,
  count,
  accentColor,
  backLabel,
  searchLabel,
  searchPlaceholder,
  query,
  quickActions,
  hierarchyToggle,
  scopeSwitch,
  documentFilters,
  onBack,
  onQueryChange
}: OrbitalInspectorSubviewHeaderProps) {
  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(event.target.value);
  };

  return (
    <section
      className="orbital-inspector-subview-top orbital-inspector-subview-card"
      style={{ "--inspector-subview-accent": accentColor } as CSSProperties}
    >
      <div className="orbital-inspector-subview-head">
        <button
          type="button"
          className="orbital-inspector-subview-back"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
        >
          <BackIcon />
        </button>

        <HeaderGlyph />

        <div className="orbital-inspector-subview-titleblock">
          <h2 className="orbital-inspector-subview-title">{title}</h2>
          <span className="orbital-inspector-subview-count">{count}</span>
        </div>

        {quickActions || hierarchyToggle ? (
          <div
            className="orbital-inspector-subview-actions"
            aria-label={quickActions?.folder.label ?? hierarchyToggle?.label}
          >
            {hierarchyToggle ? (
              <button
                type="button"
                className={`orbital-inspector-subview-action orbital-inspector-subview-hierarchy-toggle ${
                  hierarchyToggle.expanded ? "is-expanded" : ""
                }`}
                onClick={hierarchyToggle.onToggle}
                disabled={hierarchyToggle.disabled}
                aria-label={hierarchyToggle.label}
                title={hierarchyToggle.label}
              >
                <HierarchyToggleIcon expanded={hierarchyToggle.expanded} />
              </button>
            ) : null}

            {quickActions ? (
              <>
                <button
                  type="button"
                  className="orbital-inspector-subview-action"
                  onClick={quickActions.folder.onClick}
                  disabled={quickActions.folder.disabled}
                  aria-label={quickActions.folder.label}
                  title={quickActions.folder.label}
                >
                  <CreateIcon kind="folder" />
                </button>
                <button
                  type="button"
                  className="orbital-inspector-subview-action"
                  onClick={quickActions.note.onClick}
                  disabled={quickActions.note.disabled}
                  aria-label={quickActions.note.label}
                  title={quickActions.note.label}
                >
                  <CreateIcon kind="note" />
                </button>
                <button
                  type="button"
                  className="orbital-inspector-subview-action"
                  onClick={quickActions.canvas.onClick}
                  disabled={quickActions.canvas.disabled}
                  aria-label={quickActions.canvas.label}
                  title={quickActions.canvas.label}
                >
                  <CreateIcon kind="canvas" />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {scopeSwitch ? (
        <div
          className={`orbital-inspector-subview-scope ${
            scopeSwitch.documentsLabel ? "has-documents" : ""
          }`}
          role="group"
          aria-label={scopeSwitch.label}
        >
          <button
            type="button"
            className={scopeSwitch.value === "vault" ? "is-active" : ""}
            onClick={() => scopeSwitch.onChange("vault")}
            aria-pressed={scopeSwitch.value === "vault"}
          >
            {scopeSwitch.vaultLabel}
          </button>
          <button
            type="button"
            className={scopeSwitch.value === "project" ? "is-active" : ""}
            onClick={() => scopeSwitch.onChange("project")}
            aria-pressed={scopeSwitch.value === "project"}
            disabled={scopeSwitch.projectDisabled}
          >
            {scopeSwitch.projectLabel}
          </button>
          {scopeSwitch.documentsLabel ? (
            <button
              type="button"
              className={scopeSwitch.value === "documents" ? "is-active" : ""}
              onClick={() => scopeSwitch.onChange("documents")}
              aria-pressed={scopeSwitch.value === "documents"}
            >
              {scopeSwitch.documentsLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={`orbital-inspector-subview-controls ${documentFilters ? "has-filters" : ""}`}>
        <label className="orbital-inspector-subview-search" aria-label={searchLabel}>
          <span className="orbital-inspector-subview-search-icon">
            <SearchIcon />
          </span>
          <input value={query} onChange={handleQueryChange} placeholder={searchPlaceholder} />
        </label>

        {documentFilters ? (
          <div className="orbital-inspector-subview-filterrow" aria-label={searchLabel}>
            {(["note", "canvas"] as const).map((kind) => {
              const filter = documentFilters[kind];

              return (
                <button
                  key={kind}
                  type="button"
                  className={`orbital-inspector-subview-filter is-${kind} ${filter.active ? "is-active" : ""}`}
                  onClick={filter.onToggle}
                  aria-pressed={filter.active}
                >
                  <span className="orbital-inspector-subview-filter-icon">
                    <DocumentFilterIcon kind={kind} />
                  </span>
                  <span className="orbital-inspector-subview-filter-label">{filter.label}</span>
                  <span className="orbital-inspector-subview-filter-count">{filter.count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
