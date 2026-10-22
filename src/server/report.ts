// The interviewer's debrief as a Markdown document: what was asked, what each
// pair really was, what the candidate chose and why, and what to ask next.
import {
  HARNESS_LABELS,
  PAIR_KIND_LABELS,
  type Position,
  type RepoSource,
  type Round,
  type Session,
  type Variant,
} from "../shared/model.js";
import { outcome, variantLabel } from "../shared/outcome.js";
import { redactUrl } from "./workspace.js";

function describeSource(source: RepoSource): string {
  switch (source.kind) {
    case "sample":
      return `Built-in sample: ${source.name}`;
    case "git":
      return `${redactUrl(source.url)}${source.ref === "" ? "" : ` @ ${source.ref}`}`;
    case "local":
      return `Local: ${source.path}${source.ref === "" ? "" : ` @ ${source.ref}`}`;
  }
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function stats(variant: Variant): string {
  const { files, additions, deletions } = variant.stats;
  return `+${String(additions)} −${String(deletions)} in ${String(files)} file${files === 1 ? "" : "s"}`;
}

function roundSection(round: Round): string {
  const lines: string[] = [`## Round ${String(round.number)}`, "", quote(round.request), ""];
  lines.push(`**Pair:** ${PAIR_KIND_LABELS[round.pairKind]} · **Status:** ${round.status}`, "");
  if (round.error !== null) lines.push(`**Error:** ${round.error}`, "");

  const variants = round.variants;
  if (variants !== null) {
    const positions: Position[] = ["a", "b"];
    lines.push("| | Version A | Version B |", "| --- | --- | --- |");
    lines.push(`| What it was | ${variantLabel(variants.a)} | ${variantLabel(variants.b)} |`);
    lines.push(`| Size | ${stats(variants.a)} | ${stats(variants.b)} |`);
    lines.push(`| Checks | ${variants.a.check.status} | ${variants.b.check.status} |`);
    lines.push(
      `| Commit | \`${variants.a.commit.slice(0, 10)}\` | \`${variants.b.commit.slice(0, 10)}\` |`,
      "",
    );

    for (const position of positions) {
      const variant = variants[position];
      if (variant.degradation !== null) {
        lines.push(
          `**Version ${position.toUpperCase()} — ${variant.degradation.name}.** ${variant.degradation.summary}`,
        );
        for (const location of variant.degradation.locations) {
          const where =
            location.line === null ? location.file : `${location.file}:${String(location.line)}`;
          lines.push(`- \`${where}\` — ${location.note}`);
        }
        lines.push("");
      }
      if (variant.stance !== null) {
        lines.push(
          `**Version ${position.toUpperCase()} — ${variant.stance.label}.** ${variant.stance.summary}`,
          "",
        );
      }
    }

    const decision = round.decision;
    if (decision !== null) {
      const choice =
        decision.choice === "reject"
          ? "Rejected both versions"
          : `Chose version ${decision.choice.toUpperCase()}`;
      lines.push(`**Decision:** ${choice} — ${outcome(round)}.`);
      if (decision.tags.length > 0) lines.push(`**Tags:** ${decision.tags.join(", ")}`);
      if (decision.note !== "") lines.push("", quote(decision.note));
      if (decision.edited !== null) {
        lines.push(
          "",
          `**Edited by hand:** ${decision.edited.files.map((file) => `\`${file}\``).join(", ")}`,
        );
      }
      lines.push("");
    }

    const points = [
      ...(variants.a.degradation?.talkingPoints ?? []),
      ...(variants.b.degradation?.talkingPoints ?? []),
      ...(variants.a.stance?.talkingPoints ?? []),
      ...(variants.b.stance?.talkingPoints ?? []),
    ];
    const unique = [...new Set(points)];
    if (unique.length > 0) {
      lines.push("**Talking points**", "", ...unique.map((point) => `- ${point}`), "");
    }
  }
  return lines.join("\n");
}

export function buildReport(session: Session): string {
  const config = session.config;
  const rounds = session.timeline.flatMap((item) => (item.type === "round" ? [item] : []));
  const harness = [
    HARNESS_LABELS[config.harness.kind],
    config.harness.model === "" ? null : config.harness.model,
    config.harness.effort === "" ? null : `${config.harness.effort} effort`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  const lines: string[] = [
    `# ${config.title}`,
    "",
    `- **Candidate:** ${config.candidateName === "" ? "—" : config.candidateName}`,
    `- **Repository:** ${describeSource(config.repo)}`,
    `- **Assistant:** ${harness}`,
    `- **Started:** ${session.startedAt ?? "—"}`,
    `- **Finished:** ${session.finishedAt ?? "—"}`,
    "",
  ];

  if (config.privateNotes.trim() !== "")
    lines.push("## Interviewer notes", "", config.privateNotes.trim(), "");

  lines.push("## Summary", "");
  if (rounds.length === 0) {
    lines.push("No changes were generated.", "");
  } else {
    lines.push("| # | Request | Pair | Outcome |", "| --- | --- | --- | --- |");
    for (const round of rounds) {
      const request = round.request.length > 80 ? `${round.request.slice(0, 79)}…` : round.request;
      lines.push(
        `| ${String(round.number)} | ${escapeCell(request)} | ${PAIR_KIND_LABELS[round.pairKind]} | ${escapeCell(outcome(round))} |`,
      );
    }
    lines.push("");
  }

  for (const round of rounds) lines.push(roundSection(round));

  lines.push("## Conversation", "");
  for (const item of session.timeline) {
    if (item.type === "round") {
      lines.push(`*— Round ${String(item.number)}: ${outcome(item)} —*`, "");
      continue;
    }
    const text = item.parts
      .flatMap((part) => (part.kind === "text" ? [part.text] : []))
      .join("\n\n")
      .trim();
    if (text === "") continue;
    lines.push(`**${item.role === "candidate" ? "Candidate" : "Assistant"}:**`, "", text, "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
