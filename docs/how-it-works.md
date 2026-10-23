# How it works

- [A session, start to finish](#a-session-start-to-finish)
- [The candidate's workspace](#the-candidates-workspace)
- [How a pair of versions is made](#how-a-pair-of-versions-is-made)
- [The flaws](#the-flaws)
- [The debrief](#the-debrief)

## A session, start to finish

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

1. **You set up a session**: a candidate name, a task brief, a repository, and
   optionally a setup command (`npm ci`) and a check command (`npm test`).
   Twofold fetches the repository, runs setup, and runs the check once on the
   untouched code as a baseline. Then it gives you a private link for the
   candidate.
2. **The candidate opens the link.** A welcome page explains the format, then
   they're in the workspace.
3. **They work through the task** by talking to the assistant and pressing
   **Generate** whenever they want code written. Each time, two versions
   arrive. They merge one (optionally editing it first), or reject both, and
   explain why. A merged version becomes the starting point for their next
   request.
4. **You watch live**, or come back afterwards. Either way, you get the
   debrief.

## The candidate's workspace

The assistant chat sits on the left. On the right are tabs, plus a terminal
that opens along the bottom.

### Assistant

A conversation with Claude Code or Codex. It can read the code and run commands
such as tests or scripts to answer questions, but anything it changes on disk is
thrown away before the next message: code only changes through **Generate**.

When they press **Generate** (or ⌘/Ctrl+Enter), the request and the
conversation so far go to the assistant, and a minute or two later two versions
appear. The candidate can keep chatting in the meantime.

The assistant **never sees the two versions**. It's told only that a version was
merged, or that both were rejected and why. If the candidate pastes code in and
asks which is better, it's told to help them reason about it but leave the call
to them.

### Task

The brief, as you wrote it.

### Code

A browser for the code as it stands, including everything they've merged.

While two versions are waiting for a decision, a **None / A / B** switch shows
the whole codebase with either version applied. Changed files are marked in the
tree (**A** added, **M** modified), and VS Code-style marks in the margin show
the lines the version added or changed (green) and where it removed lines
(red), without touching the code itself.

### Review

The two versions of the latest change, side by side as diffs, each with its
check result. From here the candidate can:

- **Merge A** or **Merge B**, optionally choosing **Edit before merging** to
  change the version in the browser first. Their edits are committed on top.
- **Reject both**.
- Jump to any file **in context**: it opens in the Code tab with that version
  applied, scrolled to the first change.

Every decision takes optional tags (_Readability_, _Fits the codebase_,
_Correctness_…) and a written reason. The reason is required by default and
always required for a rejection.

### Terminal

A real shell (Ctrl+`). There's one on the merged code and, while a pair is
pending, one on each version.

- Each one works on **its own copy** of that code: a fresh repository with a
  single commit, so `git diff` shows exactly what they've changed there, and
  the setup command has already been run.
- Changes made in a terminal **aren't part of the submission**. They're for
  trying things out.
- Shells survive a page reload. When the merged code changes, the terminal
  offers to restart on the new code. The A and B terminals close once the pair
  is decided.
- **Nothing typed in a terminal is recorded** or shown to the interviewer.

The image includes Node 24 (npm, pnpm, yarn), Python 3 (`uv`, pip, venv), a C
toolchain, git, curl, jq, ripgrep, `nano` and `vim`. The terminal can reach the
internet, so `npm install` and friends work. To add other languages, see
[setup](setup.md#toolchains).

### Preview

A browser on whatever server they start in a terminal: one for the merged code
and, while a pair is pending, one for each version.

Each terminal has its own `PORT` variable set (its banner says which), so the
versions can run side by side. Most servers honour `PORT`. For one that
doesn't, the candidate types its port into the preview's address bar. Each
preview is served from its own origin, so apps that use absolute paths,
client-side routing or live reload work unchanged. It can also open in a new
tab.

## How a pair of versions is made

```
request ──▶ reference implementation ──▶ check ─(fail)─▶ one repair ─┐
                │                                                    │
                └──▶ (depending on the pair kind) ──▶ second version ─┴──▶ coin flip ──▶ A / B
```

Each round's kind of pair is drawn at random, using weights you set per
session:

| Pair                       | A and B are…                                                               | Default |
| -------------------------- | -------------------------------------------------------------------------- | ------: |
| **Reference vs. degraded** | the assistant's best version, and a copy with one flaw worked in           |     70% |
| **Trade-off**              | two sound versions that resolve a design tension differently               |     20% |
| **Both flawed**            | two copies of the best version, each with a _different_ flaw               |     10% |
| **Control**                | the same version twice. Does the candidate notice, or invent a difference? |      0% |

**The reference** is written by the assistant with instructions to do the job
the way a strong senior engineer on this codebase would: follow its
conventions, reuse its helpers, make the smallest complete change, and add
tests where the project has them.

**A degraded version** starts from the reference. A second run gets the change
as a diff plus a shuffled menu of the flaws you've enabled, and applies the
first one that fits the change naturally. It's told to:

- keep the change working and the tests passing;
- match the surrounding style and keep the change a similar size;
- leave no comment or name that hints at the flaw.

It also reports what it did, the exact lines involved, and two or three
questions an interviewer could ask. Flaws used in recent rounds go to the back
of the menu, so they vary.

**Trade-off pairs** come from two independent runs, each given one side of a
design tension:

| Trade-off               | One side…                                          | The other…                                        |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Minimal vs. extensible  | does the simplest thing that satisfies the request | leaves one modest extension point                 |
| Explicit vs. DRY        | prefers local, readable code, even if it repeats   | factors shared logic into helpers                 |
| Defensive vs. lean      | validates and handles errors at every boundary     | validates once at the edge, keeps the core lean   |
| Clarity vs. performance | optimises for readability                          | optimises for runtime efficiency where it matters |

**Checks.** If you set a check command, every version is run against it. If one
fails (and the untouched code passed), the assistant gets one attempt to fix
it, and a degraded version must keep its flaw while it's fixed. The candidate
sees each version's result.

**Blind.** Both versions are committed with the same message, author and
timestamp, and which one is A is a coin flip. The candidate's progress messages
are neutral and don't reveal which side is being worked on. See
[what is kept from whom](security.md).

## The flaws

You choose which of these a weaker version may use, per session. They live in
[`src/server/engine/catalogue.ts`](../src/server/engine/catalogue.ts).

| Category            | Flaw                         | What it looks like                                                                      |
| ------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| **Design**          | Premature abstraction        | An interface, factory or config layer for a problem with one concrete case              |
|                     | Leaky abstraction            | Callers reach into internals, or internals are handed out                               |
|                     | Logic in the wrong layer     | Business rules in a handler, formatting in the data layer, validation scattered around  |
|                     | Hidden shared state          | Module-level mutable state or caches that quietly couple callers                        |
| **Maintainability** | Duplicated logic             | Re-implements something the codebase already has, or copies a block into several places |
|                     | Ignores conventions          | Works, but in a different style from everything around it                               |
|                     | God function                 | One long function that parses, validates, computes and formats                          |
|                     | Magic values and loose types | Magic strings and numbers, boolean flags, untyped bags of values                        |
|                     | Debris and noise             | Commented-out code, leftover debug output, comments that narrate the code               |
| **Correctness**     | Swallowed errors             | Broad catches and silent defaults, so failures go unnoticed                             |
|                     | Missing edge case            | One realistic edge case left unhandled                                                  |
|                     | Trusts its input             | Skipped validation, string-built queries, a missing authorisation check                 |
| **Performance**     | Needless work                | Queries in a loop, quadratic scans, loading everything to use a little                  |
| **Testing**         | Weak tests                   | Tests that pass but prove little                                                        |

## The debrief

The interviewer's session page updates live, and shows the whole conversation
with each round in place. For every round:

- the request, and what kind of pair it turned out to be;
- what each version really was (_Reference_, _Duplicated logic_, _Minimal_…),
  its size and its check result;
- **where the flaw is**: file, line and a short note;
- what the candidate chose, any hand edits, their tags and their reasons;
- **questions to ask**, e.g. "Two code paths now compute the same page; which
  one would you delete?";
- the generation log: every agent run, its steps, how long it took and what it
  cost.

**View versions** opens exactly what the candidate saw, with the labels
revealed. **Report** downloads it all as Markdown, ready to share.
