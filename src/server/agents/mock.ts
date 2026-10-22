import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessStatus } from "../../shared/model.js";
import { activity } from "./activity.js";
import { AgentError, type AgentResult, type AgentTurn, type Harness } from "./types.js";

/**
 * A deterministic stand-in for a real coding agent, for development, demos and
 * tests. It writes small, plausible TypeScript changes under `twofold-mock/`
 * so the whole flow can be exercised without a subscription.
 */
export class MockHarness implements Harness {
  readonly kind = "mock";
  readonly label = "Mock assistant";

  constructor(private readonly delayMs: number) {}

  async status(): Promise<HarnessStatus> {
    return {
      kind: this.kind,
      label: this.label,
      installed: true,
      authenticated: true,
      detail: "Deterministic fake agent for demos and tests",
      models: [],
      efforts: [],
    };
  }

  private async pause(signal: AbortSignal, factor = 1): Promise<void> {
    const ms = this.delayMs * factor;
    if (ms <= 0) {
      if (signal.aborted) throw new AgentError("Cancelled", "", true);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new AgentError("Cancelled", "", true));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async run(turn: AgentTurn): Promise<AgentResult> {
    const sessionId = turn.resume ?? `mock-${hash(turn.prompt).slice(0, 12)}`;
    if (turn.mode === "chat") return this.chat(turn, sessionId);

    turn.onEvent({ type: "activity", activity: activity("read", "Read README.md") });
    await this.pause(turn.signal);
    turn.onEvent({
      type: "activity",
      activity: activity("search", "Searched for “export function”"),
    });
    await this.pause(turn.signal);

    const request = requestFrom(turn.prompt);
    const slug = slugify(request);
    const relative = path.posix.join("twofold-mock", `${slug}.ts`);
    const file = path.join(turn.cwd, relative);

    switch (turn.purpose) {
      case "reference":
      case "stance": {
        const flavour =
          turn.purpose === "stance" && /stance-b/i.test(turn.prompt) ? "loop" : "slice";
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, referenceSource(request, flavour));
        turn.onEvent({ type: "activity", activity: activity("edit", `Wrote ${relative}`) });
        await this.pause(turn.signal);
        const summary =
          flavour === "loop"
            ? "Implemented pagination with an explicit loop that validates its inputs up front."
            : "Implemented pagination as a small pure helper using Array.slice.";
        return {
          sessionId,
          text: summary,
          structured:
            turn.purpose === "stance"
              ? { summary, talking_points: ["Which reads better to you, and why?"] }
              : { summary },
          costUsd: null,
        };
      }
      case "degrade": {
        const allowed = degradationIds(turn.instructions);
        const chosen = allowed[0] ?? "duplicated-logic";
        const current = await readFile(file, "utf8").catch(() => referenceSource(request, "slice"));
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, `${current}\n${degradedAddition()}`);
        turn.onEvent({ type: "activity", activity: activity("edit", `Edited ${relative}`) });
        await this.pause(turn.signal);
        const line = current.split("\n").length + 2;
        return {
          sessionId,
          text: "Done.",
          structured: {
            degradation: chosen,
            summary:
              "Wrapped the helper in a stateful manager class that re-implements the same slicing.",
            locations: [{ file: relative, line, note: "PaginationManager duplicates paginate()" }],
            talking_points: [
              "Two code paths now compute the same page; which one would you delete?",
              "What does the class buy over the plain function?",
            ],
          },
          costUsd: null,
        };
      }
      case "repair":
      case "chat":
        return {
          sessionId,
          text: "Checked the change; nothing to repair.",
          structured: { summary: "No-op" },
          costUsd: null,
        };
    }
  }

  private async chat(turn: AgentTurn, sessionId: string): Promise<AgentResult> {
    turn.onEvent({ type: "activity", activity: activity("read", "Read README.md") });
    await this.pause(turn.signal);
    const question =
      turn.prompt
        .split("\n")
        .filter((line) => line.trim() !== "")
        .at(-1) ?? "";
    const reply = [
      `Good question. Looking at the code, here is how I would think about “${question.slice(0, 80)}”:`,
      "",
      "1. Keep the change close to the existing route handlers.",
      "2. Validate query parameters at the edge and keep the core pure.",
      "",
      "```ts",
      "export function paginate<T>(items: readonly T[], page: number, size: number): T[] {",
      "  return items.slice((page - 1) * size, page * size);",
      "}",
      "```",
      "",
      "When you're ready, use **Generate** and I'll write it.",
    ].join("\n");
    turn.onEvent({ type: "text", text: reply });
    return { sessionId, text: reply, structured: null, costUsd: null };
  }
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function requestFrom(prompt: string): string {
  const match = /<request>\s*([\s\S]*?)\s*<\/request>/.exec(prompt);
  return (match?.[1] ?? "change").split("\n")[0]?.slice(0, 120) ?? "change";
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug === "" ? "change" : slug;
}

/** The flaw menu, read from the instructions' numbered list: "1. `id` — …". */
function degradationIds(instructions: string): string[] {
  return [...instructions.matchAll(/^\d+\. `([a-z-]+)`/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function referenceSource(request: string, flavour: "slice" | "loop"): string {
  const body =
    flavour === "slice"
      ? [
          "  const start = (options.page - 1) * options.pageSize;",
          "  return items.slice(start, start + options.pageSize);",
        ]
      : [
          "  if (options.page < 1 || options.pageSize < 1) return [];",
          "  const page: T[] = [];",
          "  const start = (options.page - 1) * options.pageSize;",
          "  for (let i = start; i < items.length && page.length < options.pageSize; i++) {",
          "    page.push(items[i] as T);",
          "  }",
          "  return page;",
        ];
  return [
    `// ${request}`,
    "export interface PageOptions {",
    "  page: number;",
    "  pageSize: number;",
    "}",
    "",
    "export function paginate<T>(items: readonly T[], options: PageOptions): T[] {",
    ...body,
    "}",
    "",
  ].join("\n");
}

function degradedAddition(): string {
  return [
    "export class PaginationManager<T> {",
    "  private items: T[] = [];",
    "  public currentPage = 1;",
    "",
    "  constructor(items: T[], public pageSize: number = 20) {",
    "    this.items = items;",
    "  }",
    "",
    "  getPage(page?: number): T[] {",
    "    if (page) this.currentPage = page;",
    "    const start = (this.currentPage - 1) * this.pageSize;",
    "    return this.items.slice(start, start + this.pageSize);",
    "  }",
    "}",
    "",
  ].join("\n");
}
