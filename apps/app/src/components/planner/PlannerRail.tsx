import { translateInline } from "../../localization/translateInline";
import { getPlannerViewLabels } from "../../localization/plannerPresentation";
import type { AppLanguage } from "../../types";
import {
  PLANNER_VIEW_IDS,
  type PlannerViewId
} from "../../lib/planner";

interface PlannerRailProps {
  activeViewId: PlannerViewId;
  stats: Record<PlannerViewId, number>;
  language: AppLanguage;
  onViewChange: (viewId: PlannerViewId) => void;
}

const VIEW_ICON_CLASS: Record<PlannerViewId, string> = {
  inbox: "is-inbox",
  today: "is-today",
  overdue: "is-overdue",
  upcoming: "is-upcoming",
  projects: "is-projects",
  habits: "is-habits",
  review: "is-review"
};

export default function PlannerRail({
  activeViewId,
  stats,
  language,
  onViewChange
}: PlannerRailProps) {
  const labels = getPlannerViewLabels(language);

  return (
    <aside className="planner-rail" aria-label={translateInline(language, "plannerRail.plannerSections")}>
      <div className="planner-rail-head">
        <span className="planner-kicker">{translateInline(language, "plannerRail.time")}</span>
        <h2>{translateInline(language, "plannerRail.plan")}</h2>
      </div>

      <nav className="planner-rail-nav">
        {PLANNER_VIEW_IDS.map((viewId) => (
          <button
            key={viewId}
            type="button"
            className={activeViewId === viewId ? "is-active" : ""}
            onClick={() => onViewChange(viewId)}
            aria-pressed={activeViewId === viewId}
          >
            <span className={`planner-rail-icon ${VIEW_ICON_CLASS[viewId]}`} aria-hidden="true" />
            <span>{labels[viewId]}</span>
            <strong>{stats[viewId]}</strong>
          </button>
        ))}
      </nav>
    </aside>
  );
}
