import { normalizeBrazilianPhone } from "@renova123/core";

export const CONTROLLED_OUTREACH_TEST_PHONE = "5582988543864";

export function isOperationalTestMode(globalPause: unknown, onlineOnly: boolean, configuredPhone: string | undefined) {
  return globalPause === true && onlineOnly && configuredPhone === CONTROLLED_OUTREACH_TEST_PHONE;
}

export function operationalTestDestination(phone: unknown, configuredPhone: string | undefined) {
  const normalized = normalizeBrazilianPhone(String(phone ?? ""));
  return {
    normalizedPhone: normalized.normalized ?? String(phone ?? ""),
    allowed: configuredPhone === CONTROLLED_OUTREACH_TEST_PHONE
      && normalized.valid
      && normalized.normalized === CONTROLLED_OUTREACH_TEST_PHONE,
  };
}

export function isControlledOutreachTestJob(phone: unknown, onlineOnly: boolean, configuredPhone: string | undefined) {
  return onlineOnly && operationalTestDestination(phone, configuredPhone).allowed;
}
