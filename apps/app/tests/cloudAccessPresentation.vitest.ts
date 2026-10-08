import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import en from "../src/locales/en";
import ru from "../src/locales/ru";
import { getCloudAccessPresentation } from "../src/lib/cloudAccessPresentation";
import type { HostedCloudEntitlement } from "../src/types";

const now = Date.UTC(2026, 9, 8);
const expiredAt = Date.UTC(2026, 8, 12);
const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: "ru", fallbackLng: "en", resources: { en: { translation: en.messages }, ru: { translation: ru.messages } }, interpolation: { escapeValue: false } });
});
const limits = { cloudEnabled: true, maxVaults: null, maxSyncTokens: null, storageBytes: null, maxUploadBytes: null, maxJournalEntriesPerVault: null, journalTtlDays: null };
const base: HostedCloudEntitlement = {
  plan: { id: "manual_unlimited", name: "Manual Unlimited", limits }, limits,
  accountStatus: "active", status: "read_only", subscriptionStatus: "active", trialEndsAt: null, effectiveUntil: expiredAt,
  reason: "SUBSCRIPTION_PERIOD_ENDED",
  subscription: { id: "manual", provider: "manual", status: "active", currentPeriodStart: expiredAt - 30 * 86400000, currentPeriodEnd: expiredAt },
  capabilities: { canUseCloud: true, canReadSync: true, canWriteSync: false, canCreateVault: false, canIssueToken: false, canDeleteCloudData: true }
};
const format = (date: number | null | undefined) => date ? new Date(date).toISOString().slice(0, 10) : null;
const present = (entitlement = base) => getCloudAccessPresentation(entitlement, format, i18n.getFixedT("ru"), now);

describe("Cloud access presentation", () => {
  it("explains the screenshot's expired period despite a stored active flag", () => {
    const result = present();
    expect(result.statusLabel).toBe("Тариф истёк");
    expect(result.periodLabel).toBe("Истёк 2026-09-12");
    expect(result.notice).toContain("Manual Unlimited истёк 2026-09-12");
    expect(result.notice).toContain("сохранённые данные можно читать и экспортировать");
    expect(result.renewalLabel).toContain("отключено");
    expect(result.tone).toBe("warning");
  });
  it("does not reuse an old trial expiry for an unlimited manual grant", () => {
    const result = present({ ...base, status: "active", reason: "MANUAL_COMP", effectiveUntil: null, trialEndsAt: expiredAt, subscription: { ...base.subscription!, currentPeriodEnd: null }, capabilities: { ...base.capabilities, canWriteSync: true } });
    expect(result.periodLabel).toBe("Без срока");
    expect(result.expired).toBe(false);
    expect(result.notice).toBeUndefined();
  });
  it("keeps a blocked or refunded subscription distinct from expiry", () => {
    expect(present({ ...base, status: "blocked", reason: "SUBSCRIPTION_BLOCKED" }).statusLabel).toBe("Cloud заблокирован");
    expect(present({ ...base, reason: "SUBSCRIPTION_REFUNDED" }).notice).toContain("Оплата возвращена");
  });
  it("shows the grace deadline instead of saying a writable plan expired", () => {
    const result = present({ ...base, reason: "PERIOD_ENDED_GRACE", status: "grace", graceEndsAt: now + 86400000, capabilities: { ...base.capabilities, canWriteSync: true } });
    expect(result.expired).toBe(false);
    expect(result.periodLabel).toBe("Льготный доступ до 2026-10-09");
  });
  it("warns before expiry only when access is not automatically renewed", () => {
    const future = { ...base, reason: "SUBSCRIPTION_ACTIVE", status: "active", subscription: { ...base.subscription!, currentPeriodEnd: now + 3 * 86400000 }, capabilities: { ...base.capabilities, canWriteSync: true } };
    expect(present(future).notice).toContain("через 3 дн.");
    expect(present({ ...future, subscription: { ...future.subscription, autoRenew: true, renewalPeriodDays: 30 } }).notice).toBeUndefined();
  });
});
