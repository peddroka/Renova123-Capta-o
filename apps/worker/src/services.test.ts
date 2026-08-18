import { describe, expect, it, vi } from "vitest";
import { AIResponseWorker, AppointmentWorker, dispatchJobs, FollowUpWorker, InboundMessageWorker, MaintenanceWorker, MediaWorker, OutreachWorker } from "./services.js";

describe("worker em mock mode", () => {
  it("mantém sete serviços independentes e despacho explícito", async () => {
    const handler = vi.fn(async () => undefined);
    const services = [new OutreachWorker(handler), new InboundMessageWorker(handler), new AIResponseWorker(handler), new FollowUpWorker(handler), new MediaWorker(handler), new AppointmentWorker(handler), new MaintenanceWorker(handler)];
    expect(services.map((service) => service.name)).toEqual(["OutreachWorker", "InboundMessageWorker", "AIResponseWorker", "FollowUpWorker", "MediaWorker", "AppointmentWorker", "MaintenanceWorker"]);
    const job = { id: "job-1", type: "outreach", payload: {}, attempts: 1 };
    const outreach = services.filter((service) => service.accepts(job));
    expect(outreach).toHaveLength(1);
    await outreach[0]!.process(job);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("processes different leads in parallel and serializes the same lead", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    const jobs = [
      { id: "a1", type: "inbound_reply", payload: { phone: "1" }, attempts: 1 },
      { id: "a2", type: "inbound_reply", payload: { phone: "1" }, attempts: 1 },
      { id: "b1", type: "inbound_reply", payload: { phone: "2" }, attempts: 1 },
    ];
    await dispatchJobs(jobs, async (job) => {
      started.push(job.id);
      await new Promise((resolve) => setTimeout(resolve, job.id === "b1" ? 5 : 15));
      finished.push(job.id);
    }, (job) => String(job.payload.phone));
    expect(started.slice(0, 2).sort()).toEqual(["a1", "b1"].sort());
    expect(finished.indexOf("a1")).toBeLessThan(finished.indexOf("a2"));
  });
});
