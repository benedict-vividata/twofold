import type { SessionStatus } from "../../../shared/model";
import { Badge, Dot, type Tone } from "../../components/ui";

const STATUS: Record<SessionStatus, { label: string; tone: Tone }> = {
  provisioning: { label: "Preparing", tone: "info" },
  ready: { label: "Waiting for candidate", tone: "neutral" },
  active: { label: "In progress", tone: "ok" },
  finished: { label: "Finished", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }): React.JSX.Element {
  const { label, tone } = STATUS[status];
  return (
    <Badge
      tone={tone}
      icon={
        <Dot
          tone={tone === "neutral" ? "neutral" : tone}
          pulse={status === "active" || status === "provisioning"}
        />
      }
    >
      {label}
    </Badge>
  );
}
