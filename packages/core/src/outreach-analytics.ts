import type { OutreachAnalytics, OutreachAnalyticsLead, OutreachHourMetric } from "@renova123/shared";

export const OUTREACH_ANALYTICS_TIMEZONE = "America/Maceio";
export const OUTREACH_ANALYTICS_MIN_SAMPLE = 10;

function localHour(value: string, timezone: string) {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }).format(new Date(value));
  return Number(hour) === 24 ? 0 : Number(hour);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2));
}

export function aggregateOutreachByHour(leads: OutreachAnalyticsLead[], timezone = OUTREACH_ANALYTICS_TIMEZONE): OutreachAnalytics {
  const hours: OutreachHourMetric[] = Array.from({ length: 15 }, (_, index) => {
    const hour = index + 8;
    const sentLeads = leads.filter((lead) => lead.initialOutreachSentAt && localHour(lead.initialOutreachSentAt, timezone) === hour);
    const respondedLeads = sentLeads.filter((lead) => lead.firstInboundAt);
    const qualifiedLeads = sentLeads.filter((lead) => lead.qualifiedAt);
    const responseTimes = respondedLeads.flatMap((lead) => {
      const sent = Date.parse(lead.initialOutreachSentAt!);
      const inbound = Date.parse(lead.firstInboundAt!);
      return Number.isFinite(sent) && Number.isFinite(inbound) && inbound >= sent ? [(inbound - sent) / 60_000] : [];
    });
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      sent: sentLeads.length,
      responded: respondedLeads.length,
      responseRate: sentLeads.length ? respondedLeads.length / sentLeads.length : 0,
      qualified: qualifiedLeads.length,
      qualificationRate: sentLeads.length ? qualifiedLeads.length / sentLeads.length : 0,
      medianMinutesToFirstResponse: median(responseTimes),
    };
  });
  const best = (field: "responseRate" | "qualificationRate") => {
    const candidates = hours.filter((hour) => hour.sent >= OUTREACH_ANALYTICS_MIN_SAMPLE);
    return candidates.length ? candidates.reduce((winner, current) => current[field] > winner[field] ? current : winner).hour : null;
  };
  return { timezone, hours, bestResponseHour: best("responseRate"), bestQualificationHour: best("qualificationRate"), minimumSampleSize: OUTREACH_ANALYTICS_MIN_SAMPLE, totalSample: hours.reduce((sum, hour) => sum + hour.sent, 0) };
}
