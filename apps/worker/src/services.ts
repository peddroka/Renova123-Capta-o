import type { QueueJob } from "@renova123/database";

export async function dispatchJobs(jobs: QueueJob[], process: (job: QueueJob) => Promise<void>, keyFor: (job: QueueJob) => string | null) {
  const tails = new Map<string, Promise<void>>();
  await Promise.all(jobs.map(async (job) => {
    const key = keyFor(job);
    const previous = key ? tails.get(key) : undefined;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    if (key) tails.set(key, current);
    if (previous) await previous;
    try { await process(job); } finally { release(); if (key && tails.get(key) === current) tails.delete(key); }
  }));
}

export type JobHandler = (job: QueueJob) => Promise<void>;

abstract class PersistentWorkerService {
  abstract readonly name: string;
  protected abstract readonly types: ReadonlySet<string>;
  constructor(private readonly handler: JobHandler) {}
  accepts(job: QueueJob) { return this.types.has(job.type); }
  process(job: QueueJob) { return this.handler(job); }
}

export class OutreachWorker extends PersistentWorkerService {
  readonly name = "OutreachWorker";
  protected readonly types = new Set(["outreach"]);
}
export class InboundMessageWorker extends PersistentWorkerService {
  readonly name = "InboundMessageWorker";
  protected readonly types = new Set(["opt_out", "evolution_event"]);
}
export class AIResponseWorker extends PersistentWorkerService {
  readonly name = "AIResponseWorker";
  protected readonly types = new Set(["inbound_reply"]);
}
export class DelayedReplyWorker extends PersistentWorkerService {
  readonly name = "DelayedReplyWorker";
  protected readonly types = new Set(["ai_send"]);
}
export class FollowUpWorker extends PersistentWorkerService {
  readonly name = "FollowUpWorker";
  protected readonly types = new Set(["follow_up"]);
}
export class MediaWorker extends PersistentWorkerService {
  readonly name = "MediaWorker";
  protected readonly types = new Set(["send_material"]);
}
export class AppointmentWorker extends PersistentWorkerService {
  readonly name = "AppointmentWorker";
  protected readonly types = new Set(["appointment_reminder"]);
}
export class MaintenanceWorker extends PersistentWorkerService {
  readonly name = "MaintenanceWorker";
  protected readonly types = new Set(["maintenance"]);
}

export type WorkerService = PersistentWorkerService;
