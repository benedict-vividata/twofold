// Projections of a session for the people who see it. The candidate's view is
// built field by field from an allow-list: hidden labels never get copied in,
// so they can never be sent by accident.
import {
  HARNESS_LABELS,
  type CandidateRound,
  type CandidateSession,
  type CandidateVariant,
  type Round,
  type Session,
  type SessionSummary,
  type Variant,
} from "../shared/model.js";

function candidateVariant(variant: Variant): CandidateVariant {
  return {
    stats: { ...variant.stats },
    check: { status: variant.check.status, output: variant.check.output },
  };
}

function candidateRound(round: Round): CandidateRound {
  return {
    type: "round",
    id: round.id,
    number: round.number,
    request: round.request,
    createdAt: round.createdAt,
    status: round.status,
    phase: round.phase,
    error: round.error,
    variants:
      round.variants === null || (round.status !== "ready" && round.status !== "decided")
        ? null
        : { a: candidateVariant(round.variants.a), b: candidateVariant(round.variants.b) },
    decision:
      round.decision === null
        ? null
        : {
            choice: round.decision.choice,
            tags: [...round.decision.tags],
            note: round.decision.note,
            editedFiles: round.decision.edited?.files ?? [],
            decidedAt: round.decision.decidedAt,
          },
  };
}

export function toCandidateSession(session: Session, terminalAvailable = false): CandidateSession {
  return {
    id: session.id,
    title: session.config.title,
    candidateName: session.config.candidateName,
    brief: session.config.brief,
    status: session.status,
    assistant: HARNESS_LABELS[session.config.harness.kind],
    requireNote: session.config.requireNote,
    hasCheck: session.config.commands.check.trim() !== "",
    terminal: session.config.allowTerminal && terminalAvailable,
    chatBusy: session.chat.busy,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    timeline: session.timeline.map((item) =>
      item.type === "message"
        ? {
            type: "message",
            id: item.id,
            role: item.role,
            createdAt: item.createdAt,
            status: item.status,
            parts: item.parts.map((part) =>
              part.kind === "text"
                ? { kind: "text", text: part.text }
                : { kind: "activity", activity: { ...part.activity } },
            ),
            error: item.error,
          }
        : candidateRound(item),
    ),
  };
}

export function toSummary(session: Session): SessionSummary {
  const rounds = session.timeline.filter((item) => item.type === "round");
  return {
    id: session.id,
    title: session.config.title,
    candidateName: session.config.candidateName,
    status: session.status,
    statusDetail: session.statusDetail,
    harness: session.config.harness.kind,
    rounds: rounds.length,
    decided: rounds.filter((round) => round.status === "decided").length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
