# Twofold

**A technical interview for engineers who work with coding agents.**

The candidate gets a real codebase, a task, and an AI coding assistant. They
can talk to the assistant as much as they like. But every time they ask it to
write code, they get **two versions** of the change. They pick the one they'd
merge (or reject both) and say why.

---

## Why?

**What should a technical interview be testing today?**

For a long time the answer was some version of "can you write this code?"
Reverse a linked list. Find the longest palindrome. Do it on a whiteboard in 45
minutes. That was always a shaky stand-in for the job, and now a coding agent
does it in seconds. Checking whether someone can out-type a machine doesn't
tell you much.

The job has moved. Good engineers now spend more of their day deciding what to
build, steering an agent towards it and reading what comes back, and less of it
typing. Which raises an uncomfortable question: what happens when someone who
isn't very good gets the same tools?

**They get faster.** A weak engineer with an agent can turn out a lot of
plausible-looking code very quickly: abstractions nobody needed, logic copied
into three places, errors quietly swallowed, tests that pass without testing
anything. Every line of it lands in someone else's review queue, and in the
codebase for years after. Volume used to limit itself. It doesn't any more.

The flip side is just as true. **The engineers who get the most out of agents
are the ones with the best judgement.** They ask for the right thing, notice
when the answer is subtly wrong, push back, and leave the code better than they
found it. That's the skill worth hiring for.

**But how do you measure it in an hour?** Watching someone use an agent mostly
shows you the agent. A take-home shows you the result, not the decisions behind
it. And in real life, nobody hands you a diff with a planted bug and asks you to
find it.

**Twofold's answer is to make every change a choice.** The candidate works the
way they would at work: a real repository, a real assistant, a real terminal.
But whenever the assistant writes code, it writes it twice. Usually one version
is its honest best and the other is a copy with one flaw that a good reviewer
would catch: the kind of thing that sails through when everyone's moving fast.
Sometimes both versions are sound and simply make different trade-offs, and
sometimes both have a problem. The candidate merges the one they'd ship (or
neither) and explains the call in their own words.

There's no score at the end. You get a record: what they asked for, what they
were shown, what they chose and why. That's a far better start for the
conversation that actually decides the interview than a pass/fail.

---

## What it's like

**For the candidate:** a workspace in the browser, with:

- 💬 an **assistant** (Claude Code or Codex) to explore the code, discuss
  approaches and plan with;
- 🔀 a **review** screen where each change arrives as **Version A** and
  **Version B**, side by side, with their test results. They merge one,
  optionally editing it first, or reject both, and say why;
- 📂 a **code browser** that can show the whole codebase with A or B applied,
  with changed lines marked in the margin;
- ⌨️ a **terminal**, and a **preview** browser for any server they start, on the
  merged code and on each version.

**For you, the interviewer:**

- 🛠 Set up a session in a couple of minutes from **any git repository**, or the
  built-in sample.
- 👀 Watch the conversation and every round live.
- 🔎 For each round, see **which version was which**, exactly where the flaw is,
  and **questions to ask** about it.
- 📄 Download the whole thing as a **Markdown report** for your hiring panel.

---

## Getting started

**You'll need** [Docker](https://docs.docker.com/get-docker/) (Docker Desktop
is fine) and a **Claude** (Pro, Max, Team or Enterprise) or **ChatGPT**
subscription. Everything else is in the container, and it runs on macOS, Linux
and Windows.

**1. Start it**

```sh
git clone <your copy of this repo> twofold
cd twofold
./twofold up
```

The first build takes a few minutes. When it's done, it prints your
**interviewer sign-in link**. Run `./twofold url` to see it again.

**2. Sign in an assistant**

```sh
./twofold login claude     # or: ./twofold login codex
```

Follow the link it prints and paste the code back. This uses your
subscription, not an API key, and the sign-in survives restarts.

**3. Try both sides**

1. Open the sign-in link and click **New session**. The **Bookshelf** sample (a
   small Node API with a ready-written task) is already filled in, so just
   click **Create session**.
2. Copy the **candidate link** from the session page and open it in a private
   window.
3. Be the candidate for ten minutes: ask the assistant about the code, press
   **Generate**, compare A and B, open a terminal and run `npm test`, merge one.
4. Flip back to the interviewer window and see what it saw: which version was
   which, where the flaw was, and what to ask.

> **No subscription to hand?** Put `TWOFOLD_ENABLE_MOCK=1` in a `.env` file and
> run `./twofold up` again. A built-in mock assistant makes small, predictable
> changes, so you can click through the whole flow for free.

---

## Running a real interview

A few things that make for a good session:

- **Pick a codebase they can get their head around in ten minutes.** One of
  your own small services, or a focused open-source project. Any git URL works;
  see [setup](docs/setup.md#using-your-own-repository).
- **Write a brief with two to four natural steps**, so there are several rounds
  to talk about.
- **Leave one honest ambiguity in it**, such as whether the response format may
  change, and note it in the session's _private notes_. Whether they spot it
  and ask is half the conversation.
- **Set a check command** (e.g. `npm test`). Every version is run against it,
  and the assistant fixes failures before the candidate sees them. A version
  that simply doesn't work teaches you nothing.
- **Allow 60–90 minutes.** Each round takes a minute or two to generate, and
  the candidate can keep chatting meanwhile.
- **Be upfront about the format.** The welcome page explains it, but say it
  too. The only secret is which version is which.
- **Afterwards, start from their reasons.** The suggested questions are a good
  opening. The most revealing rounds are often the trade-offs, and the ones
  where they rejected both.

Nothing the candidate types in the terminal is recorded: only the
conversation, the versions and their decisions.

---

## Everyday commands

| Command                         | What it does                                       |
| ------------------------------- | -------------------------------------------------- |
| `./twofold up`                  | Build if needed, start, and print the sign-in link |
| `./twofold url`                 | Print the interviewer sign-in link                 |
| `./twofold login claude\|codex` | Sign an assistant in with your subscription        |
| `./twofold status`              | Check whether each assistant is signed in          |
| `./twofold logs`                | Follow the server log                              |
| `./twofold down`                | Stop. Sessions and sign-ins are kept               |
| `./twofold update`              | Rebuild with the latest Claude Code and Codex      |
| `./twofold reset`               | Delete every session (sign-ins are kept)           |
| `./twofold shell`               | A shell inside the container, as the agents' user  |

<details>
<summary><strong>On Windows without bash</strong></summary>

Each command is a thin wrapper around Docker Compose:

```powershell
docker compose up -d --build
docker compose exec twofold twofold url
docker compose run --rm --no-deps twofold login claude
docker compose run --rm --no-deps twofold status
docker compose logs -f twofold
docker compose down
```

</details>

---

## Learn more

- **[How it works](docs/how-it-works.md)**: the candidate's workspace, how each
  pair of versions is made, the catalogue of flaws, and what's in the debrief.
- **[Setup](docs/setup.md)**: your own repositories and toolchains, remote
  interviews, every setting.
- **[What is kept from whom](docs/security.md)**: how the candidate (and the
  assistant they talk to) is kept from finding out which version is which, and
  what isn't covered.
- **[Development](docs/development.md)**: running it from source, the tests and
  the code layout.

## Status

Early. It runs end to end with **Claude Code**, including real rounds against
the sample. **Codex** support is written against Codex's documented output but
hasn't been run against the live CLI yet.
