import type { TFunction } from "i18next";
import type { HostedCloudEntitlement } from "../types";

export function getCloudAccessPresentation(
  entitlement: HostedCloudEntitlement | null | undefined,
  formatDate: (timestamp: number | null | undefined) => string | null,
  t: TFunction,
  now = Date.now()
) {
  if (!entitlement) {
    return { expired: false, statusLabel: t("webAccess.authCheckingTitle"), periodLabel: "—", renewalLabel: null, notice: undefined, tone: "default" as const };
  }
  const subscription = entitlement.subscription;
  const periodEnd = subscription ? subscription.currentPeriodEnd : entitlement?.effectiveUntil ?? entitlement?.trialEndsAt;
  const periodDate = formatDate(periodEnd);
  const reason = entitlement?.reason ?? "";
  const canWrite = entitlement?.capabilities.canWriteSync ?? false;
  const protectedReason = ["SUBSCRIPTION_BLOCKED", "SUBSCRIPTION_REFUNDED", "SUBSCRIPTION_PAST_DUE"].includes(reason) || entitlement?.status === "blocked";
  const expired = !protectedReason && (["SUBSCRIPTION_PERIOD_ENDED", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_CANCELED"].includes(reason)
    || entitlement?.status === "expired"
    || Boolean(subscription && periodEnd && periodEnd <= now && !canWrite && entitlement?.status !== "grace"));
  const status = expired ? "expired" : entitlement?.status ?? "unknown";
  const blocked = status === "blocked";
  const renewalLabel = subscription?.currentPeriodEnd === null
    ? t("settings.accountCloudPeriodNoExpiry")
    : subscription?.autoRenew
      ? t("settings.accountCloudManualRenewal", { days: subscription.renewalPeriodDays })
      : subscription?.provider === "manual"
        ? t("settings.accountCloudManualRenewalOff")
        : subscription?.cancelAtPeriodEnd
          ? t("settings.accountCloudRenewalOff")
          : subscription ? t("settings.accountCloudProviderRenewal") : null;
  let periodLabel = periodDate ? t("settings.accountCloudPeriodUntil", { date: periodDate }) : t("settings.accountCloudPeriodNoExpiry");
  let notice: string | undefined;
  if (expired && periodDate) {
    periodLabel = t("settings.accountCloudExpiredOn", { date: periodDate });
    notice = t("settings.accountCloudExpiredNotice", { plan: entitlement?.plan.name, date: periodDate });
  } else if (status === "grace" && formatDate(entitlement?.graceEndsAt)) {
    periodLabel = t("settings.accountCloudGraceUntil", { date: formatDate(entitlement?.graceEndsAt) });
    notice = t("settings.accountCloudGraceNotice", { date: formatDate(entitlement?.graceEndsAt) });
  } else if (blocked) {
    notice = t("sync.cloudAccountBlocked");
  } else if (status === "past_due") {
    notice = t("sync.cloudSubscriptionPastDue");
  } else if (reason === "SUBSCRIPTION_REFUNDED") {
    notice = t("settings.accountCloudRefundedNotice");
  } else if (reason === "NO_CLOUD_PLAN") {
    notice = t("settings.accountCloudFreeNotice");
  } else if (!canWrite && entitlement) {
    notice = t("settings.accountCloudReadOnlyDescription");
  } else if (canWrite && periodEnd && !subscription?.autoRenew && periodEnd - now <= 7 * 86400000) {
    notice = t("settings.accountCloudExpiringNotice", { days: Math.max(1, Math.ceil((periodEnd - now) / 86400000)), date: periodDate });
  }
  const retention = entitlement?.retention;
  if (reason === "TRIAL_EXPIRED_READ_ONLY") {
    periodLabel = t("settings.accountCloudReadOnlyUntil", { date: formatDate(retention?.readOnlyUntil) });
    notice = t("settings.accountCloudTrialReadOnlyNotice", { date: formatDate(retention?.readOnlyUntil) });
  } else if (reason === "TRIAL_ARCHIVED") {
    periodLabel = t("settings.accountCloudArchivedUntil", { date: formatDate(retention?.archiveUntil) });
    notice = t("settings.accountCloudTrialArchiveNotice", { date: formatDate(retention?.archiveUntil) });
  } else if (reason === "TRIAL_RETENTION_EXPIRED") {
    periodLabel = t("settings.accountCloudRetentionEndedOn", { date: formatDate(retention?.archiveUntil) });
    notice = t("settings.accountCloudTrialRetentionExpiredNotice");
  } else if (status === "trialing") {
    notice = t("settings.accountCloudTrialNotice", { date: periodDate });
  }
  const statusLabel = expired ? t("settings.accountCloudExpiredTitle")
    : blocked ? t("settings.accountCloudBlockedTitle")
    : status === "grace" ? t("settings.accountCloudGraceTitle")
    : status === "trialing" ? t("settings.accountCloudTrialTitle")
    : canWrite ? t("settings.accountCloudReady") : t("settings.accountCloudReadOnlyTitle");
  const tone = blocked ? "error" as const : expired || !canWrite || notice ? "warning" as const : "success" as const;
  return { expired, statusLabel, periodLabel, renewalLabel, notice, tone };
}
