export function groqAttemptModels(input: { primaryModel: string | null; fallbackModel: string | null; circuitOpen: boolean; sharedQuotaBlocked?: boolean }) {
  if (input.circuitOpen || input.sharedQuotaBlocked) return [];
  return [...new Set([input.primaryModel, input.fallbackModel].filter((model): model is string => Boolean(model)))];
}

export function isSharedGroqQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\borganization\b|tokens per (?:minute|day)|\bTP[MD]\b|shared quota|org_/i.test(message);
}

export function providerPoolRetrySeconds(...cooldownSeconds: number[]) {
  const known = cooldownSeconds.filter((value) => Number.isFinite(value) && value > 0);
  return known.length ? Math.max(1, Math.min(...known)) : 60;
}

export function eligibleProviderOrder<T extends string>(providers: Array<{ provider: T; eligible: boolean }>) {
  const seen = new Set<T>();
  return providers.filter(({ provider, eligible }) => eligible && !seen.has(provider) && Boolean(seen.add(provider))).map(({ provider }) => provider);
}
