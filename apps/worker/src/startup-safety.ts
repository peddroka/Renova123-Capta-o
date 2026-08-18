type StartupEnv = Record<string, unknown>;

const isTrue = (value: unknown) => value === true || value === "true";

export function assertWorkerStartupAllowed(env: StartupEnv) {
  const real = isTrue(env.REAL_SENDING_ENABLED) && !isTrue(env.SIMULATION_MODE) && isTrue(env.OUTREACH_ENABLED);
  if (real && !isTrue(env.ALLOW_REAL_OUTREACH_DEV) && env.NODE_ENV !== "production" && env.NODE_ENV !== "test") throw new Error("Worker real bloqueado: defina ALLOW_REAL_OUTREACH_DEV=true explicitamente.");
}
