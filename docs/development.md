# Development

## Running from source

You'll need Node 22.12 or later and pnpm (`corepack enable` gets you the
version in `package.json`).

```sh
pnpm install
TWOFOLD_ENABLE_MOCK=1 pnpm dev
```

`pnpm dev` starts the API with live reload on `:7777`, the web app (Vite) on
`:5173`, and the three previews on `:7778`–`:7780`. The interviewer sign-in
link is printed when the server starts. Open the app on `:5173`.

Outside the container there's no sandbox: the assistants, git, commands and
terminals all run as you, with your own Claude Code / Codex sign-in, and data
goes to `.twofold-data/`. Fine for development, not for real interviews.

The **mock assistant** (`TWOFOLD_ENABLE_MOCK=1`) makes small, deterministic
changes and answers chat with canned text. It's enough to click through the
whole flow, and it's what most of the tests use.

## Checks

```sh
pnpm check        # all of the below
pnpm format       # prettier --write
pnpm lint         # eslint (strict, type-aware)
pnpm typecheck    # tsc for the server, the web app and the config files
pnpm test         # vitest
pnpm build        # the web app and a single-file server bundle in dist/
```

CI (`.github/workflows/ci.yml`) runs the checks and the build, and builds the
Docker image for amd64 and arm64.

The tests run real git, real shells and real HTTP servers against temporary
directories, with the mock assistant or a scripted one standing in for the real
CLIs. They cover the git plumbing, both CLIs' stream parsers, every kind of
round (including repair, cancellation and failure), decisions and hand edits,
browsing versions in context, the terminal over its WebSocket, the preview
proxy (cookies, WebSockets, revocation), and that nothing hidden reaches the
candidate.

### House rules

The lint setup is deliberately strict (`typescript-eslint` `strictTypeChecked`):

- **No type assertions** (`x as T`). Parse with a Zod schema at the boundary,
  or narrow with checks the compiler can verify. `as const` is fine.
- **Explicit return types** on functions in `src/`.
- No disabling either of these with comments.

Everything that crosses the wire is a Zod schema in
[`src/shared/model.ts`](../src/shared/model.ts), and both sides derive their
types from it.

## How the code is laid out

```
src/
├── shared/              Zod schemas for everything on the wire, shared by both sides
│   ├── model.ts         sessions, rounds, versions, the candidate's projection, terminals, previews
│   └── outcome.ts       how a round's result reads (debrief page and report)
├── server/
│   ├── main.ts          wiring, admin token, graceful shutdown
│   ├── http.ts          Hono routes: interviewer (cookie) and candidate (link token), SSE
│   ├── service.ts       session lifecycle, decisions and hand edits, diffs, code browsing
│   ├── engine/
│   │   ├── rounds.ts    reference → second version → check / repair → coin flip
│   │   ├── chat.ts      the conversation, reset to the merged code each turn
│   │   ├── prompts.ts   everything the assistants are told
│   │   └── catalogue.ts the flaws and trade-offs
│   ├── agents/          Claude Code and Codex adapters (stream parsing), and the mock
│   ├── workspace.ts     clone, worktrees, setup and check commands
│   ├── git.ts           hardened git plumbing
│   ├── process.ts       process runner: sandbox user, clean environment, process-group kill
│   ├── store.ts         sessions in memory, mirrored to one JSON file each
│   ├── terminal.ts      the candidate's shells: PTYs over WebSocket, private copies of the code
│   ├── preview.ts       a browser on the candidate's servers: one proxied origin per target
│   ├── ports.ts         a PORT for each terminal
│   ├── views.ts         the candidate's allow-list projection
│   └── report.ts        the Markdown debrief
└── web/                 React, Tailwind and CodeMirror; xterm.js for the terminal
    ├── pages/candidate/ welcome, workspace (chat, task, code, review, preview, terminal), wrap-up
    ├── pages/admin/     sign-in, sessions, new session, live debrief
    └── components/      review panel, diff and editor views, code browser, terminal
samples/bookshelf/       the built-in sample (a zero-dependency Node API with tests)
docker/twofold.sh        the container's entrypoint and in-container CLI
twofold                  the host CLI (a thin wrapper around docker compose)
```

## A few design notes

- **No database.** A session is one JSON file in the private directory, plus a
  git repository (with worktrees) in the work directory. The UIs get live
  updates over server-sent events.
- **Versions are commits.** Each version is a single commit on top of the
  merged code, built from whatever the assistant left in its worktree. Merging
  just moves the session's head to that commit, and hand edits are a commit on
  top of it.
- **Assistants are CLIs.** Claude Code runs with `-p --output-format
stream-json`, and Codex with `exec --json`. Each adapter turns their event
  stream into chat text and one-line activity ("Read src/app.ts"). Adding
  another assistant means adding one adapter in `src/server/agents/`.
- **Adding a flaw** is one entry in
  [`catalogue.ts`](../src/server/engine/catalogue.ts): a name and description
  for the interviewer, and an instruction for the assistant.
- **A few settings exist only for development and tests:**
  `TWOFOLD_DATA_DIR`, `TWOFOLD_PREVIEW_PORTS` (`0,0,0` picks free ports),
  `TWOFOLD_MOCK_DELAY_MS`, and the sandbox and terminal user ids that the image
  sets (`TWOFOLD_SANDBOX_UID`, `TWOFOLD_TERMINAL_UID`, …). See
  [`src/server/config.ts`](../src/server/config.ts).
