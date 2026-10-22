// The domain model, shared by the server and the web client. Everything that
// crosses the wire is described here as a Zod schema, and both sides derive
// their types from it.
//
// Two views of a session exist:
//   - the full `Session`, which carries the hidden labels (which version is the
//     reference, what was degraded, the talking points). Only the interviewer
//     ever receives it.
//   - the `CandidateSession`, an explicit allow-list projection of the above.
//     The server builds it field by field, so nothing hidden can leak through
//     by accident.
import { z } from "zod";

export const HarnessKind = z.enum(["claude", "codex", "mock"]);
export type HarnessKind = z.infer<typeof HarnessKind>;

/**
 * How the two versions of a round relate to each other.
 *   degraded     the reference implementation vs. a copy with flaws injected
 *   tradeoff     two sound implementations that resolve a design tension differently
 *   both-flawed  two copies of the reference, each with a different injected flaw
 *   control      the same reference on both sides
 */
export const PairKind = z.enum(["degraded", "tradeoff", "both-flawed", "control"]);
export type PairKind = z.infer<typeof PairKind>;

export const Position = z.enum(["a", "b"]);
export type Position = z.infer<typeof Position>;

export const SAMPLE_REPOS = ["bookshelf"] as const;

export const RepoSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sample"), name: z.enum(SAMPLE_REPOS) }),
  z.object({
    kind: z.literal("git"),
    url: z.string().trim().min(1).max(2000),
    ref: z.string().trim().max(200).default(""),
    fullHistory: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("local"),
    path: z.string().trim().min(1).max(1000),
    ref: z.string().trim().max(200).default(""),
  }),
]);
export type RepoSource = z.infer<typeof RepoSource>;

const weight = z.number().int().min(0).max(100);

export const PairMix = z
  .object({ degraded: weight, tradeoff: weight, bothFlawed: weight, control: weight })
  .refine((mix) => mix.degraded + mix.tradeoff + mix.bothFlawed + mix.control > 0, {
    message: "At least one pair type needs a non-zero weight",
  });
export type PairMix = z.infer<typeof PairMix>;

export const DEFAULT_MIX: PairMix = { degraded: 70, tradeoff: 20, bothFlawed: 10, control: 0 };

export const SessionConfig = z.object({
  candidateName: z.string().trim().max(120).default(""),
  title: z.string().trim().min(1).max(160),
  brief: z.string().trim().min(1).max(20_000),
  privateNotes: z.string().max(20_000).default(""),
  repo: RepoSource,
  harness: z.object({
    kind: HarnessKind,
    model: z.string().trim().max(120).default(""),
    effort: z.string().trim().max(40).default(""),
  }),
  commands: z.object({
    setup: z.string().max(4000).default(""),
    check: z.string().max(4000).default(""),
    timeoutSeconds: z.number().int().min(10).max(3600).default(600),
  }),
  mix: PairMix,
  degradations: z.array(z.string().min(1)).min(1),
  requireNote: z.boolean().default(true),
});
export type SessionConfig = z.infer<typeof SessionConfig>;
export type SessionConfigInput = z.input<typeof SessionConfig>;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const ActivityKind = z.enum(["read", "search", "edit", "command", "web", "plan", "other"]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const Activity = z.object({
  at: z.string(),
  kind: ActivityKind,
  label: z.string(),
});
export type Activity = z.infer<typeof Activity>;

export const MessagePart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("activity"), activity: Activity }),
]);
export type MessagePart = z.infer<typeof MessagePart>;

export const CheckStatus = z.enum(["passed", "failed", "skipped", "error"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckResult = z.object({
  status: CheckStatus,
  exitCode: z.number().int().nullable(),
  output: z.string(),
  durationMs: z.number().int(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const DiffStats = z.object({
  files: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
});
export type DiffStats = z.infer<typeof DiffStats>;

export const CodeLocation = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  note: z.string(),
});
export type CodeLocation = z.infer<typeof CodeLocation>;

// ---------------------------------------------------------------------------
// The full (interviewer) model
// ---------------------------------------------------------------------------

export const RunPurpose = z.enum(["reference", "degrade", "stance", "repair", "chat"]);
export type RunPurpose = z.infer<typeof RunPurpose>;

export const AgentRun = z.object({
  id: z.string(),
  purpose: RunPurpose,
  label: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum(["running", "done", "failed", "cancelled"]),
  activity: z.array(Activity),
  finalText: z.string(),
  error: z.string().nullable(),
  costUsd: z.number().nullable(),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const VariantRole = z.enum(["reference", "degraded", "stance"]);
export type VariantRole = z.infer<typeof VariantRole>;

export const Variant = z.object({
  commit: z.string(),
  role: VariantRole,
  /** The implementing agent's own one-paragraph account of the change. */
  summary: z.string(),
  degradation: z
    .object({
      id: z.string(),
      name: z.string(),
      summary: z.string(),
      locations: z.array(CodeLocation),
      talkingPoints: z.array(z.string()),
    })
    .nullable(),
  stance: z
    .object({
      tradeoffId: z.string(),
      label: z.string(),
      summary: z.string(),
      talkingPoints: z.array(z.string()),
    })
    .nullable(),
  stats: DiffStats,
  check: CheckResult,
});
export type Variant = z.infer<typeof Variant>;

export const Choice = z.enum(["a", "b", "reject"]);
export type Choice = z.infer<typeof Choice>;

export const Decision = z.object({
  choice: Choice,
  tags: z.array(z.string()),
  note: z.string(),
  edited: z.object({ commit: z.string(), files: z.array(z.string()) }).nullable(),
  decidedAt: z.string(),
});
export type Decision = z.infer<typeof Decision>;

export const RoundStatus = z.enum(["generating", "ready", "decided", "failed", "cancelled"]);
export type RoundStatus = z.infer<typeof RoundStatus>;

export const Round = z.object({
  type: z.literal("round"),
  id: z.string(),
  number: z.number().int(),
  request: z.string(),
  createdAt: z.string(),
  status: RoundStatus,
  /** A neutral, candidate-safe description of what is happening right now. */
  phase: z.string(),
  error: z.string().nullable(),
  pairKind: PairKind,
  baseCommit: z.string(),
  variants: z.object({ a: Variant, b: Variant }).nullable(),
  decision: Decision.nullable(),
  runs: z.array(AgentRun),
});
export type Round = z.infer<typeof Round>;

export const Message = z.object({
  type: z.literal("message"),
  id: z.string(),
  role: z.enum(["candidate", "assistant"]),
  createdAt: z.string(),
  status: z.enum(["streaming", "done", "error"]),
  parts: z.array(MessagePart),
  error: z.string().nullable(),
});
export type Message = z.infer<typeof Message>;

export const TimelineItem = z.discriminatedUnion("type", [Message, Round]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export const SessionStatus = z.enum(["provisioning", "ready", "active", "finished", "failed"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const Session = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  candidateToken: z.string(),
  config: SessionConfig,
  status: SessionStatus,
  statusDetail: z.string(),
  provisionLog: z.string(),
  baseCommit: z.string().nullable(),
  headCommit: z.string().nullable(),
  baseline: CheckResult.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  chat: z.object({
    busy: z.boolean(),
    agentSessionId: z.string().nullable(),
    /** Context the assistant has not been told yet, prepended to the next chat turn. */
    pendingNotices: z.array(z.string()),
  }),
  timeline: z.array(TimelineItem),
});
export type Session = z.infer<typeof Session>;

export const SessionSummary = z.object({
  id: z.string(),
  title: z.string(),
  candidateName: z.string(),
  status: SessionStatus,
  statusDetail: z.string(),
  harness: HarnessKind,
  rounds: z.number().int(),
  decided: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const AdminSessionView = z.object({
  session: Session,
  candidateUrl: z.string(),
});
export type AdminSessionView = z.infer<typeof AdminSessionView>;

// ---------------------------------------------------------------------------
// The candidate's projection
// ---------------------------------------------------------------------------

export const CandidateVariant = z.object({
  stats: DiffStats,
  check: z.object({ status: CheckStatus, output: z.string() }),
});
export type CandidateVariant = z.infer<typeof CandidateVariant>;

export const CandidateRound = z.object({
  type: z.literal("round"),
  id: z.string(),
  number: z.number().int(),
  request: z.string(),
  createdAt: z.string(),
  status: RoundStatus,
  phase: z.string(),
  error: z.string().nullable(),
  variants: z.object({ a: CandidateVariant, b: CandidateVariant }).nullable(),
  decision: z
    .object({
      choice: Choice,
      tags: z.array(z.string()),
      note: z.string(),
      editedFiles: z.array(z.string()),
      decidedAt: z.string(),
    })
    .nullable(),
});
export type CandidateRound = z.infer<typeof CandidateRound>;

export const CandidateTimelineItem = z.discriminatedUnion("type", [Message, CandidateRound]);
export type CandidateTimelineItem = z.infer<typeof CandidateTimelineItem>;

export const CandidateSession = z.object({
  id: z.string(),
  title: z.string(),
  candidateName: z.string(),
  brief: z.string(),
  status: SessionStatus,
  assistant: z.string(),
  requireNote: z.boolean(),
  hasCheck: z.boolean(),
  chatBusy: z.boolean(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  timeline: z.array(CandidateTimelineItem),
});
export type CandidateSession = z.infer<typeof CandidateSession>;

// ---------------------------------------------------------------------------
// Code browsing and diffs
// ---------------------------------------------------------------------------

export const FileChange = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
  tooLarge: z.boolean(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type FileChange = z.infer<typeof FileChange>;

export const VariantFiles = z.object({ files: z.array(FileChange) });
export type VariantFiles = z.infer<typeof VariantFiles>;

export const TreeEntry = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["dir", "file"]),
  /** When browsing a version: how this entry differs from the merged code. */
  change: z.enum(["added", "modified", "renamed", "contains"]).nullable(),
});
export type TreeEntry = z.infer<typeof TreeEntry>;

export const TreeListing = z.object({ entries: z.array(TreeEntry) });
export type TreeListing = z.infer<typeof TreeListing>;

/**
 * Lines a version changed, in the version's own line numbers. A deletion sits
 * between lines: `from` is the line above it (0 when it is at the very top).
 */
export const LineChange = z.object({
  kind: z.enum(["added", "modified", "deleted"]),
  from: z.number().int(),
  to: z.number().int(),
});
export type LineChange = z.infer<typeof LineChange>;

export const FileContent = z.object({
  path: z.string(),
  content: z.string().nullable(),
  binary: z.boolean(),
  tooLarge: z.boolean(),
  /** Present when browsing a version: what it changed in this file. */
  changes: z.array(LineChange).nullable(),
});
export type FileContent = z.infer<typeof FileContent>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const ChatRequest = z.object({ text: z.string().trim().min(1).max(20_000) });
export const GenerateRequest = z.object({ request: z.string().trim().min(1).max(20_000) });

export const DecisionRequest = z.object({
  choice: Choice,
  tags: z.array(z.string().max(60)).max(12).default([]),
  note: z.string().trim().max(5000).default(""),
  edits: z
    .array(z.object({ path: z.string().min(1).max(1000), content: z.string().max(2_000_000) }))
    .max(100)
    .default([]),
});
export type DecisionRequest = z.infer<typeof DecisionRequest>;
export type DecisionRequestInput = z.input<typeof DecisionRequest>;

export const LoginRequest = z.object({ token: z.string().min(1).max(500) });

// ---------------------------------------------------------------------------
// Catalogue and environment, as the interviewer sees them
// ---------------------------------------------------------------------------

export const DegradationCategory = z.enum([
  "design",
  "maintainability",
  "correctness",
  "performance",
  "testing",
]);
export type DegradationCategory = z.infer<typeof DegradationCategory>;

export const DegradationInfo = z.object({
  id: z.string(),
  name: z.string(),
  category: DegradationCategory,
  description: z.string(),
});
export type DegradationInfo = z.infer<typeof DegradationInfo>;

export const TradeoffInfo = z.object({
  id: z.string(),
  name: z.string(),
  left: z.string(),
  right: z.string(),
});
export type TradeoffInfo = z.infer<typeof TradeoffInfo>;

export const HarnessStatus = z.object({
  kind: HarnessKind,
  label: z.string(),
  installed: z.boolean(),
  authenticated: z.boolean(),
  detail: z.string(),
  models: z.array(z.string()),
  efforts: z.array(z.string()),
});
export type HarnessStatus = z.infer<typeof HarnessStatus>;

export const Environment = z.object({
  version: z.string(),
  harnesses: z.array(HarnessStatus),
  degradations: z.array(DegradationInfo),
  tradeoffs: z.array(TradeoffInfo),
  samples: z.array(
    z.object({ name: z.string(), title: z.string(), brief: z.string(), check: z.string() }),
  ),
  localRepos: z.array(z.string()),
  justificationTags: z.array(z.string()),
});
export type Environment = z.infer<typeof Environment>;

export const JUSTIFICATION_TAGS = [
  "Readability",
  "Simplicity",
  "Correctness",
  "Fits the codebase",
  "Maintainability",
  "Error handling",
  "Testing",
  "Performance",
  "Security",
  "Scope",
] as const;

export const HARNESS_LABELS: Record<HarnessKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  mock: "Mock assistant",
};

export const PAIR_KIND_LABELS: Record<PairKind, string> = {
  degraded: "Reference vs. degraded",
  tradeoff: "Trade-off",
  "both-flawed": "Both flawed",
  control: "Control (identical)",
};
