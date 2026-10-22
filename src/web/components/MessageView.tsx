import { CircleAlert } from "lucide-react";
import type { Activity, Message } from "../../shared/model";
import { ActivityGroup } from "./Activity";
import { Markdown } from "./Markdown";
import { Spinner } from "./ui";

type Block = { kind: "text"; text: string } | { kind: "activity"; items: Activity[] };

/** Groups consecutive activity parts so a long tool run reads as one block. */
function blocks(message: Message): Block[] {
  const out: Block[] = [];
  for (const part of message.parts) {
    const last = out.at(-1);
    if (part.kind === "text") out.push({ kind: "text", text: part.text });
    else if (last?.kind === "activity") last.items.push(part.activity);
    else out.push({ kind: "activity", items: [part.activity] });
  }
  return out;
}

export function MessageView({
  message,
  compact = false,
}: {
  message: Message;
  compact?: boolean;
}): React.JSX.Element {
  if (message.role === "candidate") {
    const text = message.parts
      .flatMap((part) => (part.kind === "text" ? [part.text] : []))
      .join("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-3 px-3.5 py-2 text-[13.5px] leading-relaxed">
          {text}
        </div>
      </div>
    );
  }

  const content = blocks(message);
  return (
    <div className="flex flex-col gap-2.5">
      {content.map((block, index) =>
        block.kind === "text" ? (
          <Markdown key={index} className={compact ? "text-[13px]" : "text-[13.5px]"}>
            {block.text}
          </Markdown>
        ) : (
          <ActivityGroup key={index} items={block.items} />
        ),
      )}
      {message.status === "streaming" && (
        <div className="flex items-center gap-2 text-[12px] text-faint">
          <Spinner className="size-3" /> Working…
        </div>
      )}
      {message.status === "error" && (
        <div className="flex items-start gap-2 text-[12.5px] text-bad">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{message.error ?? "Something went wrong."}</span>
        </div>
      )}
      {message.status === "done" && message.error !== null && (
        <div className="text-[12px] text-faint">{message.error}</div>
      )}
    </div>
  );
}
