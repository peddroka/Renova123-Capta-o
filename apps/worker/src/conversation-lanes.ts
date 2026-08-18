export type LaneJob = { id: string; conversationKey: string | null };

/** Keeps one real execution per conversation without reserving global slots for waiters. */
export class ConversationLanes {
  private readonly active = new Set<string>();

  tryStart(key: string | null) {
    if (!key) return true;
    if (this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }

  finish(key: string | null) {
    if (key) this.active.delete(key);
  }

  has(key: string) { return this.active.has(key); }
  size() { return this.active.size; }
}
