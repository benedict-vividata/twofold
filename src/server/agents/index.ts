import type { HarnessKind, HarnessStatus } from "../../shared/model.js";
import type { Config } from "../config.js";
import type { Runner } from "../process.js";
import { ClaudeHarness } from "./claude.js";
import { CodexHarness } from "./codex.js";
import { MockHarness } from "./mock.js";
import type { Harness } from "./types.js";

export class Harnesses {
  private readonly byKind = new Map<HarnessKind, Harness>();
  private cachedStatus: { at: number; value: HarnessStatus[] } | null = null;

  constructor(config: Config, runner: Runner, extra: readonly Harness[] = []) {
    this.byKind.set("claude", new ClaudeHarness(runner, config.claudeBin));
    this.byKind.set("codex", new CodexHarness(runner, config.codexBin));
    if (config.enableMock) this.byKind.set("mock", new MockHarness(config.mockDelayMs));
    for (const harness of extra) this.byKind.set(harness.kind, harness);
  }

  get(kind: HarnessKind): Harness | undefined {
    return this.byKind.get(kind);
  }

  /** Status of every harness; cached briefly because each check spawns the CLIs. */
  async status(force = false): Promise<HarnessStatus[]> {
    if (!force && this.cachedStatus !== null && Date.now() - this.cachedStatus.at < 15_000) {
      return this.cachedStatus.value;
    }
    const value = await Promise.all([...this.byKind.values()].map((harness) => harness.status()));
    this.cachedStatus = { at: Date.now(), value };
    return value;
  }
}
