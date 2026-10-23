# Twofold

**A technical interview for the age of coding agents.**

The candidate gets a real repository, a task, and an AI coding assistant to work
with. They can talk to it as much as they like. But every time they ask it to
write code, they get **two versions** of the change, A and B, and have to pick
the one they would merge (editing it first if they want) or reject both, and
say why.

One version is usually the assistant's best effort. The other works and passes
the tests, but has a flaw a careful reviewer would catch: an abstraction nobody
needed, logic in the wrong layer, duplicated code, a missing edge case, an
error that gets swallowed. Some rounds are two sound designs that trade off
differently; some have a flaw on both sides.

Twofold doesn't produce a score. It produces a **debrief**: every prompt, both
versions of every change, what each one really was, what the candidate chose
and their reasons, and questions to ask about each round. That record is what
the follow-up conversation with the interviewer is built on.

```
 candidate                                 interviewer
 ─────────                                 ───────────
 talks to the assistant ──────────────┐    sees the whole conversation, live
 presses Generate                     │
   ├─ A  (reference)    ┐ shuffled    ├──▶ sees which version was which,
   └─ B  (one flaw)     ┘ blind       │    where the flaw is, and what to ask
 merges one / edits / rejects both    │
 explains the call ───────────────────┘    downloads a Markdown report
```

---

## Quick start

You need Docker with Compose v2 and a **Claude** (Pro/Max/Team/Enterprise) or
**ChatGPT** subscription. Nothing else: the image includes Node, Python, git and
both agent CLIs, and builds for x86-64 and ARM (Linux, macOS, Windows).

```sh
git clone <this repo> twofold && cd twofold
./twofold up               # builds the image, starts it, prints your sign-in link
./twofold login claude     # or: ./twofold login codex
```

Open the sign-in link, create a session (the built-in **Bookshelf** sample is
preselected, with a ready-made task), and open the candidate link it gives you
in another window to try both sides.

| Command                         | What it does                                                 |
| ------------------------------- | ------------------------------------------------------------ |
| `./twofold up`                  | Build if needed, start in the background, print sign-in link |
| `./twofold url`                 | Print the interviewer sign-in link again                     |
| `./twofold login claude\|codex` | Sign an assistant in with your subscription                  |
| `./twofold status`              | Show whether each assistant is signed in                     |
| `./twofold logs`                | Follow the server log                                        |
| `./twofold down`                | Stop. Sessions and sign-ins are kept                         |
| `./twofold update`              | Rebuild with the latest Claude Code and Codex CLIs           |
| `./twofold reset`               | Delete every session (sign-ins are kept)                     |
| `./twofold shell`               | A shell as the sandbox user, for debugging                   |

<details>
<summary><strong>Windows without bash</strong></summary>

Every command is a thin wrapper around Docker Compose:

```powershell
docker compose up -d --build
docker compose exec twofold twofold url
docker compose run --rm --no-deps twofold login claude
docker compose run --rm --no-deps twofold status
docker compose logs -f twofold
docker compose down
```

</details>

### Signing the assistants in

Both assistants run on **your subscription**, not an API key.

- **Claude Code**: `./twofold login claude` prints a link. Open it, approve, and
  paste the code back. Alternatively, run `claude setup-token` on any machine
  with a browser and put the token in `.env` as `CLAUDE_CODE_OAUTH_TOKEN`.
- **Codex**: `./twofold login codex` uses the device-code flow. Open the link,
  enter the code.

Sign-ins live in Docker volumes (`claude-home`, `codex-home`), so they survive
restarts and rebuilds. They are never mounted from your host.

---

## Running an interview

### 1. Set up a session

The new-session form asks for:

- **Candidate and task.** The candidate sees a title and a Markdown brief. A
  brief with a little deliberate ambiguity gives you more to talk about.
- **Repository.** The built-in sample, any git URL (a branch, tag or commit),
  or a repository you've put in `./repos`. Twofold fetches it once; every
  version is a commit on top of it.
- **Setup and check commands.** _Setup_ (e.g. `npm ci`, `uv sync`) runs once per
  workspace. _Check_ (e.g. `npm test`) runs on every version. If a version
  fails the check, the assistant gets one chance to fix it before the candidate
  sees it. A degraded version must keep its flaw while it is fixed.
- **Assistant.** Claude Code or Codex, with an optional model and reasoning
  effort.
- **Pairs.** Weights for the kinds of pair a round can be (see below).
- **Flaws.** Which kinds of flaw a weaker version may have.
- **Private notes.** For you only: what to probe, the ambiguity you planted.

Twofold clones the repository, runs setup, and runs the check once on the
untouched code as a baseline. Then it gives you the candidate's link.

### 2. The candidate's side

The candidate sees a welcome page that explains how the exercise works, then a
workspace with:

- **Assistant**: a chat with Claude Code or Codex. It can read the code and run
  commands (tests, scripts) to answer questions. Anything it changes on disk is
  thrown away before the next message.
- **Task**: the brief.
- **Code**: a browser for the code as it stands, including every change the
  candidate has merged. While two versions await a decision, a **None / A / B**
  switch shows the whole codebase with either version applied. Changed files
  are marked in the tree, and VS Code–style gutter marks show which lines the
  version added or changed (green) and where it removed lines (red), without
  touching the code itself.
- **Review**: the two versions of the latest change, side by side as diffs,
  with each version's check result. Each file has an _open in context_ button
  that jumps to it in the Code tab, with that version selected, scrolled to the
  first change.
- **Terminal** (Ctrl+`): a real shell in a panel along the bottom, to run the
tests, start the app and poke at it. There's one on the merged code and,
while a pair is pending, one on each version, each with the setup command
already run. Each works on its own copy of the code: a fresh one-commit git
repository, so `git diff` shows exactly what they changed there. Changes made
  in a terminal aren't part of the submission. Shells survive a page reload.
  When the merged code changes, the terminal offers to restart on the new code.
  **Nothing typed in a terminal is recorded** or shown in the debrief. The
  interviewer can switch the terminal off for a session.

When they press **Generate** (or ⌘/Ctrl+Enter), the request and the
conversation so far go to the assistant, and a few minutes later two versions
appear. They **merge A**, **merge B** (optionally editing that version first,
in the browser), or **reject both**. Every decision takes optional tags
(_Readability_, _Fits the codebase_, …) and a written reason. The reason is
required by default and always required for a rejection. The merged code
becomes the starting point for their next request.

The assistant in the chat never sees the two versions. It hears only that a
version was merged or both were rejected (and why), so the call stays the
candidate's.

### 3. The debrief

The session page updates live. For every round it shows:

- what the request was, and which kind of pair it turned out to be;
- what each version was (_Reference_, _Degraded — Duplicated logic_, _Trade-off
  — Minimal_), its size and its check result;
- **where the flaw is**: file, line and a one-line note, written by the agent
  that introduced it;
- what the candidate chose, any hand edits, their tags and reasons;
- **questions to ask**, e.g. "Two code paths now compute the same page; which
  one would you delete?";
- the full generation log: every agent run, its tool calls, duration and cost.

**View versions** opens exactly what the candidate saw, with the labels
revealed. **Report** downloads all of it as Markdown, ready to share with a
hiring panel.

---

## How a round works

```
request ──▶ reference implementation ──▶ check ─(fail)─▶ one repair ─┐
                │                                                    │
                └──▶ (depending on the pair kind) ──▶ second version ─┴──▶ shuffle ──▶ A / B
```

Each round's pair kind is drawn using the session's weights:

| Pair                       | A and B are…                                                                                                                                         | Default |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------: |
| **Reference vs. degraded** | the best version, and a copy of it with one flaw worked in                                                                                           |     70% |
| **Trade-off**              | two sound versions that resolve a design tension differently (minimal vs. extensible, explicit vs. DRY, defensive vs. lean, clarity vs. performance) |     20% |
| **Both flawed**            | two copies of the reference, each with a _different_ flaw                                                                                            |     10% |
| **Control**                | the same version twice. Does the candidate notice, or invent a difference?                                                                           |      0% |

A **degraded** version is produced by giving the reference change to a second
agent run with a shuffled menu of the enabled flaws. It applies the first one
that fits naturally and reports what it did and where. It is told to keep the
change working, keep the tests passing, match the surrounding style, keep the
size comparable, and leave no comment or name that hints at the flaw. Flaws
used in recent rounds go to the back of the menu.

The flaw catalogue (`src/server/engine/catalogue.ts`):

| Design                | Maintainability              | Correctness       | Performance   | Testing    |
| --------------------- | ---------------------------- | ----------------- | ------------- | ---------- |
| Premature abstraction | Duplicated logic             | Swallowed errors  | Needless work | Weak tests |
| Leaky abstraction     | Ignores conventions          | Missing edge case |               |            |
| Logic in wrong layer  | God function                 | Trusts its input  |               |            |
| Hidden shared state   | Magic values and loose types |                   |               |            |
|                       | Debris and noise             |                   |               |            |

Both versions are committed with the same message, author and timestamp. Which
one is A is decided by a coin flip.

---

## Using your own repository

Any git repository works, including large open-source ones.

- **Public URL**: paste it. Only the chosen ref is fetched, shallowly by
  default. Turn on _Full history_ if you want the assistant to be able to use
  `git log` and `blame`.
- **Private URL**: include a read-only token
  (`https://x-access-token:TOKEN@github.com/org/repo.git`). The remote is
  removed from the clone straight after fetching, and the token is hidden in
  the UI and the report.
- **Local**: put the repository in `./repos/` (it's mounted read-only) and pick
  it from the list.

**Toolchains.** The image has Node 24 (with npm, pnpm and yarn via corepack),
Python 3 with `uv` and pip, git, a C toolchain, and `nano` and `vim` for quick
edits in the terminal. For anything else, add Debian packages at build time:

```sh
# .env
EXTRA_APT_PACKAGES=golang-go default-jdk-headless cargo
```

**Commands** run as the sandbox user, in each worktree, with `CI=1`. Setup runs
once per workspace (there are up to four per session: the chat checkout and
three version slots), so it should be idempotent. If the check needs
dependencies that a change might add, chain them: `npm install && npm test`.

---

## Running a remote interview

By default Twofold listens on `127.0.0.1` only. For a remote candidate, either:

- **Tunnel** (simplest): `cloudflared tunnel --url http://localhost:7777`, or
  ngrok, or Tailscale Funnel. Then set `TWOFOLD_PUBLIC_URL` to the public
  address so candidate links use it.
- **Expose it**: set `TWOFOLD_BIND=0.0.0.0` and put it behind a reverse proxy
  that terminates TLS.

The candidate link is the credential: 192 random bits, scoped to one session.
The interviewer pages need the admin token, which is kept in an HttpOnly cookie
after sign-in.

---

## What is kept from whom

The candidate must not be able to find out which version is which, and the
agents the candidate can talk to must not be able to tell them.

| Concern                                  | Mechanism                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Labels reaching the candidate's browser  | The candidate API is an allow-list projection of the session (`src/server/views.ts`), built field by field. A test asserts that no hidden field, flaw id, summary or commit hash appears in it.                                                                                            |
| An agent reading the labels off disk     | Sessions live in `/data/private` (mode 0700, root). Agents, git, setup and check commands all run as the separate `agent` user and can't read it. Their environment is built from scratch, so the admin token never reaches them either.                                                   |
| The candidate's terminal                 | Runs as a third user, `candidate`, on an exported copy of the code with no history. It can't read `/data/private`, the agents' workspaces in `/data/work` (where the version worktrees are), or the agents' sign-ins. Its environment is built from scratch.                               |
| Instructions visible in the process list | The agents' instructions (which name the flaws to try) go in a file only the agent user can read, never on a command line that `ps` would show.                                                                                                                                            |
| An agent finding a generation transcript | Generation runs keep no session files (`--no-session-persistence`, `--ephemeral`).                                                                                                                                                                                                         |
| Order, timing or metadata giving it away | A coin flip decides A and B. Both commits share message, author and date. The candidate's progress messages are neutral, and failures don't say which side failed.                                                                                                                         |
| Repository code attacking the server     | Git runs with hooks and fsmonitor disabled and as the sandbox user. Paths from the browser are validated and read through `git cat-file`, never the filesystem. The container drops all capabilities except the few needed to run processes as another user, and sets `no-new-privileges`. |

What this **doesn't** stop: a candidate pasting both diffs into another AI tool,
or into the assistant's chat. You'll see the latter in the transcript, and both
make a good conversation. The terminal has internet access, so a candidate
could sign in to an AI tool of their own there. The agent in the chat can read
the two version worktrees if it goes looking for them, but not the labels. The
process list in the container is visible to every user, so a candidate who
watched it closely during generation could see git commands and commit hashes
go by. As always, this keeps an honest exercise honest; it isn't designed to
contain a determined adversary with a container escape.

---

## Configuration

Set in `.env` (see `.env.example`):

| Variable                        | Default     | Effect                                                                                            |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `TWOFOLD_ADMIN_TOKEN`           | generated   | Interviewer sign-in token. Generated and stored on first start when empty                         |
| `TWOFOLD_PORT`                  | `7777`      | Port on the host                                                                                  |
| `TWOFOLD_BIND`                  | `127.0.0.1` | Host interface; `0.0.0.0` to expose it                                                            |
| `TWOFOLD_PUBLIC_URL`            | —           | Base URL for candidate links; defaults to the address you opened the UI on                        |
| `CLAUDE_CODE_OAUTH_TOKEN`       | —           | Alternative to `./twofold login claude` (from `claude setup-token`)                               |
| `CLAUDE_CODE_VERSION`           | `latest`    | Claude Code CLI version baked into the image                                                      |
| `CODEX_VERSION`                 | `latest`    | Codex CLI version baked into the image                                                            |
| `TWOFOLD_AGENT_TIMEOUT_MINUTES` | `30`        | Longest a single agent run may take                                                               |
| `TWOFOLD_REPOS`                 | `./repos`   | Host folder of local repositories, mounted read-only                                              |
| `EXTRA_APT_PACKAGES`            | —           | Extra Debian packages for your repositories' toolchains                                           |
| `TWOFOLD_PASSTHROUGH_ENV`       | —           | Extra env var names passed to agents and commands (set their values in a `compose.override.yaml`) |
| `TWOFOLD_ENABLE_MOCK`           | `0`         | Offer the deterministic mock assistant, for demos without a subscription                          |

---

## Development

```sh
pnpm install
TWOFOLD_ENABLE_MOCK=1 pnpm dev     # API on :7777 (tsx watch) + Vite on :5173
pnpm check                         # prettier, eslint, tsc, vitest
```

`pnpm dev` runs without a container or sandbox user: agents run as you, with
your own Claude Code / Codex sign-in, and data goes to `.twofold-data/`. The
sign-in link is printed on start. The **mock assistant** writes small,
deterministic changes, so the whole flow works with no subscription at all.

```
src/
├── shared/            Zod schemas for everything on the wire, shared by both sides
│   ├── model.ts       sessions, rounds, versions, the candidate's projection
│   └── outcome.ts     how a round's result reads (debrief page and report)
├── server/
│   ├── main.ts        wiring, admin token, graceful shutdown
│   ├── http.ts        Hono routes: interviewer (cookie) and candidate (link token), SSE
│   ├── service.ts     session lifecycle, decisions and hand edits, diffs, code browsing
│   ├── engine/
│   │   ├── rounds.ts  reference → second version → check/repair → shuffle
│   │   ├── chat.ts    the conversation, reset to the merged code each turn
│   │   ├── prompts.ts everything the agents are told
│   │   └── catalogue.ts  flaws and trade-offs
│   ├── agents/        Claude Code and Codex adapters (stream parsing), mock
│   ├── workspace.ts   clone, worktrees, setup/check commands
│   ├── git.ts         hardened git plumbing
│   ├── process.ts     process runner: sandbox user, clean env, process-group kill
│   ├── store.ts       sessions in memory, mirrored to one JSON file each
│   ├── terminal.ts    the candidate's shells: PTYs over WebSocket, private copies of the code
│   ├── views.ts       the candidate's allow-list projection
│   └── report.ts      the Markdown debrief
└── web/               React + Tailwind + CodeMirror
    ├── pages/candidate/   welcome, workspace (chat · task · code · review), wrap-up
    ├── pages/admin/       sign-in, sessions, new session, live debrief
    └── components/        review panel, diff and editor views, code browser
samples/bookshelf/     the built-in sample repository (zero-dependency Node API with tests)
```

There's no database: a session is one JSON file in the private directory, plus
a git repository with worktrees in the work directory. Back up `/data` and
you've backed up everything.
