// Runs the API server (tsx watch) and the Vite dev server side by side, and
// stops both when either exits or on Ctrl-C.
import { spawn } from "node:child_process";

const children = [
  spawn("pnpm", ["dev:server"], { stdio: "inherit", env: process.env }),
  spawn("pnpm", ["dev:web"], { stdio: "inherit", env: process.env }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
