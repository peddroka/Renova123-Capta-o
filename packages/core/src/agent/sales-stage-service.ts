import type { LeadStage } from "@renova123/shared";
const terminal = new Set<LeadStage>(["opted_out", "lost", "converted", "won", "blocked", "invalid"]);
export class SalesStageService {
  resolve(current: LeadStage, proposed: LeadStage, flags: { optOut: boolean; handoff: boolean; noInterest: boolean }) {
    if (flags.optOut) return "opted_out" as const;
    if (flags.handoff) return "handoff" as const;
    if (flags.noInterest) return "no_interest" as const;
    if (terminal.has(current) && proposed !== current) return current;
    return proposed;
  }
}
