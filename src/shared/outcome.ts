// How a round's result reads to the interviewer. Shared by the debrief page
// and the Markdown report so the two always agree.
import type { Round, Variant } from "./model.js";

export function variantLabel(variant: Variant): string {
  switch (variant.role) {
    case "reference":
      return "Reference";
    case "degraded":
      return `Degraded — ${variant.degradation?.name ?? "unspecified"}`;
    case "stance":
      return `Trade-off — ${variant.stance?.label ?? "stance"}`;
  }
}

/** One line on what the choice means, for the summary table. */
export function outcome(round: Round): string {
  const decision = round.decision;
  if (decision === null || round.variants === null) {
    return round.status === "ready" ? "Awaiting decision" : round.status;
  }
  if (decision.choice === "reject") return "Rejected both";
  const chosen = round.variants[decision.choice];
  const edited = decision.edited === null ? "" : ", then edited it";
  switch (round.pairKind) {
    case "degraded":
      return `${chosen.role === "reference" ? "Chose the reference" : "Chose the degraded version"}${edited}`;
    case "both-flawed":
      return `Chose the version with “${chosen.degradation?.name ?? "?"}”${edited}`;
    case "tradeoff":
      return `Chose “${chosen.stance?.label ?? "?"}”${edited}`;
    case "control":
      return `Chose ${decision.choice.toUpperCase()} of two identical versions${edited}`;
  }
}
