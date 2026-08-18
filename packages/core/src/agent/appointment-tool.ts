import type { AiDecision } from "@renova123/shared";
export class AppointmentTool {
  validate(decision: AiDecision, availableSlots: string[]) {
    if (!decision.shouldScheduleDemo || !decision.appointmentData) return { valid: !decision.shouldScheduleDemo, appointment: null };
    const match = availableSlots.find((slot) => new Date(slot).getTime() === new Date(decision.appointmentData!.startsAt).getTime());
    return { valid: Boolean(match), appointment: match ? decision.appointmentData : null };
  }
}
