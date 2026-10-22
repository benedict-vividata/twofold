import path from "node:path";
import type { Activity, ActivityKind } from "../../shared/model.js";

function clip(text: string, max = 96): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Shows a path relative to the workspace when it is inside it. */
export function displayPath(filePath: string, cwd: string): string {
  if (!path.isAbsolute(filePath)) return filePath;
  const relative = path.relative(cwd, filePath);
  return relative.startsWith("..") || relative === "" ? path.basename(filePath) : relative;
}

export function activity(kind: ActivityKind, label: string): Activity {
  return { at: new Date().toISOString(), kind, label: clip(label, 140) };
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Turns a Claude Code tool call into a one-line description. */
export function describeClaudeTool(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): Activity | null {
  const file = stringField(input, "file_path") ?? stringField(input, "notebook_path");
  const where = file === null ? "" : displayPath(file, cwd);
  switch (name) {
    case "Read":
      return activity("read", `Read ${where}`);
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return activity("edit", `Edited ${where}`);
    case "Write":
      return activity("edit", `Wrote ${where}`);
    case "Grep": {
      const pattern = stringField(input, "pattern") ?? "";
      return activity("search", `Searched for “${clip(pattern, 60)}”`);
    }
    case "Glob": {
      const pattern = stringField(input, "pattern") ?? "";
      return activity("search", `Listed files matching ${clip(pattern, 60)}`);
    }
    case "LS":
      return activity("search", `Listed ${displayPath(stringField(input, "path") ?? ".", cwd)}`);
    case "Bash": {
      const description = stringField(input, "description");
      const command = stringField(input, "command") ?? "";
      return activity("command", description ?? `Ran ${clip(command, 80)}`);
    }
    case "WebFetch":
      return activity("web", `Fetched ${stringField(input, "url") ?? "a web page"}`);
    case "WebSearch":
      return activity(
        "web",
        `Searched the web for “${clip(stringField(input, "query") ?? "", 60)}”`,
      );
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return activity("plan", "Updated its plan");
    case "Task":
    case "Agent":
      return activity("other", `Delegated: ${stringField(input, "description") ?? "a subtask"}`);
    case "StructuredOutput":
      return null;
    default:
      return activity("other", `Used ${name}`);
  }
}
