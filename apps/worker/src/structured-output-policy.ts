export const STRUCTURED_OUTPUT_MAX_ATTEMPTS = 2;

export type StructuredOutputFailurePlan = {
  disposition: "retry" | "review_required";
  lifecycle: "retrying" | "failed_final";
  terminal: boolean;
};

export function structuredOutputFailurePlan(attempts: number): StructuredOutputFailurePlan {
  return attempts < STRUCTURED_OUTPUT_MAX_ATTEMPTS
    ? { disposition: "retry", lifecycle: "retrying", terminal: false }
    : { disposition: "review_required", lifecycle: "failed_final", terminal: true };
}

export function structuredOutputDisposition(attempts: number): "retry" | "review_required" {
  return structuredOutputFailurePlan(attempts).disposition;
}
