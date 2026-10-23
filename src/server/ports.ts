import type { TerminalTarget } from "../shared/model.js";

/**
 * Gives every terminal its own `PORT` for servers it starts. All terminals share
 * the container's network, so version A and version B can't both listen on
 * 3000; with a port each, a server that honours `PORT` just works, and the
 * preview knows where to find it.
 */
export class AppPorts {
  private readonly assigned = new Map<string, number>();
  private next: number;

  constructor(
    private readonly first = 41000,
    private readonly last = 44999,
  ) {
    this.next = first;
  }

  portFor(sessionId: string, target: TerminalTarget): number {
    const key = `${sessionId}:${target}`;
    const existing = this.assigned.get(key);
    if (existing !== undefined) return existing;
    const taken = new Set(this.assigned.values());
    for (let attempt = 0; attempt <= this.last - this.first; attempt += 1) {
      const candidate = this.next;
      this.next = this.next >= this.last ? this.first : this.next + 1;
      if (!taken.has(candidate)) {
        this.assigned.set(key, candidate);
        return candidate;
      }
    }
    throw new Error("No free ports for terminals");
  }

  release(sessionId: string): void {
    for (const key of [...this.assigned.keys()]) {
      if (key.startsWith(`${sessionId}:`)) this.assigned.delete(key);
    }
  }
}
