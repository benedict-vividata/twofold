// Everything the agents are told. Kept in one place so the voice is consistent
// and it is easy to review what each role is asked to do.
import type { Session } from "../../shared/model.js";
import type { JsonSchema } from "../agents/types.js";
import type { Degradation, Tradeoff } from "./catalogue.js";

const TRANSCRIPT_BUDGET = 24_000;

const NO_COMMIT =
  "Do not commit, stash, create branches or switch branches; leave your changes in the working tree. Do not leave build output, logs or scratch files behind.";

const NO_META =
  "Never mention interviews, candidates, alternative versions or this tool in code, comments or file names.";

function checkHint(session: Session): string {
  const check = session.config.commands.check.trim();
  return check === ""
    ? "Run the project's tests or type checks if that is quick."
    : `The project's checks run with \`${check}\`; make sure they pass.`;
}

/** The candidate's conversation so far, condensed to text, newest kept when over budget. */
export function transcript(session: Session): string {
  const lines: string[] = [];
  for (const item of session.timeline) {
    if (item.type === "message") {
      const text = item.parts
        .flatMap((part) => (part.kind === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (text === "") continue;
      lines.push(`${item.role === "candidate" ? "Candidate" : "Assistant"}: ${text}`);
    } else if (item.decision !== null) {
      const outcome =
        item.decision.choice === "reject"
          ? `rejected both versions${item.decision.note === "" ? "" : ` (“${item.decision.note}”)`}`
          : "accepted one of the versions; it is now part of the code";
      lines.push(`[Change requested: “${item.request}” — the candidate ${outcome}.]`);
    }
  }
  let text = lines.join("\n\n");
  if (text.length > TRANSCRIPT_BUDGET) {
    text = `[… earlier conversation omitted …]\n${text.slice(text.length - TRANSCRIPT_BUDGET)}`;
  }
  return text === "" ? "(no conversation yet)" : text;
}

function requestBlock(session: Session, request: string): string {
  return [
    "<task_brief>",
    session.config.brief,
    "</task_brief>",
    "",
    "<conversation>",
    transcript(session),
    "</conversation>",
    "",
    "<request>",
    request,
    "</request>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function chatInstructions(session: Session): string {
  return [
    "You are the AI pair-programming assistant inside a coding exercise. You are talking with an engineer who is working on this task:",
    "",
    "<task_brief>",
    session.config.brief,
    "</task_brief>",
    "",
    "The repository in your working directory is their current code, including every change they have accepted so far.",
    "",
    "In this chat you help them understand the codebase, discuss approaches, weigh options and plan. You may read files, search, and run commands that do not modify anything (tests, builds, scripts). Do not edit files here: anything you change in this conversation is discarded.",
    "",
    "When they want code written, they press Generate: that produces two alternative implementations which they review and choose between. You never see those alternatives. If they paste code and ask which version is better, help them reason about the trade-offs, but leave the decision to them.",
    "",
    "Be concise and concrete. Refer to files and line numbers. Use Markdown.",
  ].join("\n");
}

export function chatPrompt(notices: readonly string[], text: string): string {
  if (notices.length === 0) return text;
  const notes = notices.map((notice) => `- ${notice}`).join("\n");
  return `<context_update>\n${notes}\n</context_update>\n\n${text}`;
}

// ---------------------------------------------------------------------------
// Reference implementation
// ---------------------------------------------------------------------------

export const REFERENCE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Two to four sentences: what you changed, and any assumption you made.",
    },
  },
  required: ["summary"],
  additionalProperties: false,
};

export function referenceInstructions(session: Session): string {
  return [
    "You are an expert software engineer making a change to the repository in your working directory, at the request of the engineer you are pairing with. Implement it as well as a strong senior engineer on this codebase would.",
    "",
    "- Read the relevant code first. Follow the existing conventions and reuse existing helpers.",
    "- Make the smallest complete change that fully satisfies the request. Do not refactor unrelated code.",
    "- Add or update tests where the project tests similar code.",
    `- ${checkHint(session)}`,
    "- If the request is ambiguous, pick the most reasonable interpretation, implement it, and state the assumption in your summary.",
    `- ${NO_COMMIT}`,
    `- ${NO_META}`,
    "",
    "Your final answer is a JSON object with a `summary` field.",
  ].join("\n");
}

export function referencePrompt(session: Session, request: string): string {
  return `${requestBlock(session, request)}\n\nImplement the request.`;
}

// ---------------------------------------------------------------------------
// Trade-off sides
// ---------------------------------------------------------------------------

export const STANCE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Two to four sentences: what you changed and how the stance shaped it.",
    },
    talking_points: {
      type: "array",
      items: { type: "string" },
      description: "Two or three short questions a reviewer could ask about this trade-off.",
    },
  },
  required: ["summary", "talking_points"],
  additionalProperties: false,
};

export function stanceInstructions(
  session: Session,
  tradeoff: Tradeoff,
  side: "left" | "right",
): string {
  const stance = side === "left" ? tradeoff.leftInstruction : tradeoff.rightInstruction;
  return [
    referenceInstructions(session).replace(
      "Your final answer is a JSON object with a `summary` field.",
      "",
    ),
    "Design stance for this change — follow it consistently, while still writing good code:",
    stance,
    "Do not mention the stance in code or comments.",
    "",
    "Your final answer is a JSON object with `summary` and `talking_points` fields.",
  ].join("\n");
}

export function stancePrompt(session: Session, request: string, side: "left" | "right"): string {
  // The side marker lets two otherwise identical prompts differ, which keeps
  // any caching or deterministic behaviour from collapsing them into one.
  return `${requestBlock(session, request)}\n\nImplement the request. (stance-${side === "left" ? "a" : "b"})`;
}

// ---------------------------------------------------------------------------
// Degraded alternative
// ---------------------------------------------------------------------------

/**
 * The ids are deliberately not listed in the schema: Claude Code takes it on
 * the command line, where any process in the container could read it. The
 * menu lives in the instructions, and the server checks the answer.
 */
export const DEGRADE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    degradation: {
      type: "string",
      description: "The id of the flaw you applied, exactly as written in your instructions.",
    },
    summary: {
      type: "string",
      description: "One or two sentences for a reviewer: what the flaw is and where.",
    },
    locations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: ["integer", "null"] },
          note: { type: "string" },
        },
        required: ["file", "line", "note"],
        additionalProperties: false,
      },
    },
    talking_points: {
      type: "array",
      items: { type: "string" },
      description: "Two or three short questions a reviewer could ask about this flaw.",
    },
  },
  required: ["degradation", "summary", "locations", "talking_points"],
  additionalProperties: false,
};

export function degradeInstructions(session: Session, options: readonly Degradation[]): string {
  const menu = options
    .map(
      (entry, index) =>
        `${String(index + 1)}. \`${entry.id}\` — ${entry.name}: ${entry.instruction}`,
    )
    .join("\n");
  return [
    "You help build code-review exercises. The working directory contains a change that was just made for the request below (shown as a diff against the previous code). Rewrite that change into a weaker version: one that still works, but that a careful senior engineer would push back on in review because of one specific flaw.",
    "",
    "Apply exactly one of these flaws — the first one in the list that fits this change naturally:",
    menu,
    "",
    "Rules:",
    "- Work on the change itself: the files and lines in the diff. Leave unrelated code alone.",
    "- The result must still do what the request asked, and the existing tests must still pass. " +
      checkHint(session),
    "- It must read as an honest attempt by a competent but less careful engineer. No comments, names or text that hint at the flaw; match the surrounding style; no deliberate typos or absurdities.",
    "- Keep the size of the change comparable to the original unless the flaw itself makes it larger or smaller.",
    `- ${NO_COMMIT}`,
    `- ${NO_META}`,
    "",
    "Your final answer is a JSON object: `degradation` (the id you applied), `summary`, `locations` (where the flaw can be seen, with line numbers in the new code where possible) and `talking_points`.",
  ].join("\n");
}

export function degradePrompt(session: Session, request: string, diff: string): string {
  return [
    requestBlock(session, request),
    "",
    "<change_to_rewrite>",
    diff,
    "</change_to_rewrite>",
    "",
    "Rewrite the change in the working tree as instructed.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Repair after a failing check
// ---------------------------------------------------------------------------

export const REPAIR_SCHEMA: JsonSchema = {
  type: "object",
  properties: { summary: { type: "string", description: "One sentence: what you fixed." } },
  required: ["summary"],
  additionalProperties: false,
};

export function repairInstructions(preserve: string | null): string {
  return [
    "The change in the working tree makes the project's checks fail. Fix the failure with the smallest possible edit while keeping the intent of the change.",
    preserve === null
      ? ""
      : `This version was written with a deliberate characteristic that must survive the fix: ${preserve} Do not otherwise improve or clean up the code.`,
    NO_COMMIT,
    NO_META,
    "Your final answer is a JSON object with a `summary` field.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function repairPrompt(command: string, output: string): string {
  return [
    `The check command \`${command}\` failed. Its output:`,
    "",
    "```",
    output.slice(-12_000),
    "```",
    "",
    "Fix it.",
  ].join("\n");
}
