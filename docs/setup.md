# Setup

- [Signing the assistants in](#signing-the-assistants-in)
- [Using your own repository](#using-your-own-repository)
- [Toolchains](#toolchains)
- [Running a remote interview](#running-a-remote-interview)
- [Settings](#settings)
- [Updating, data and backups](#updating-data-and-backups)

## Signing the assistants in

Both assistants run on **your subscription**, not an API key.

- **Claude Code**: `./twofold login claude` prints a link. Open it, approve,
  and paste the code back. Alternatively, run `claude setup-token` on any
  machine with a browser and put the token in `.env` as
  `CLAUDE_CODE_OAUTH_TOKEN`.
- **Codex**: `./twofold login codex` uses the device-code flow. Open the link
  and enter the code.

Sign-ins are kept in Docker volumes (`claude-home`, `codex-home`), so they
survive restarts and rebuilds. They're never mounted from your machine, and the
candidate's terminal can't read them.

`./twofold status` shows whether each one is signed in. So does the strip at
the top of the sessions page; the ↻ button next to it re-checks.

## Using your own repository

Any git repository works, including large open-source ones.

- **Public URL**: paste it, with an optional branch, tag or commit. Only that
  ref is fetched, shallowly by default. Turn on _Full history_ if you want the
  assistant to be able to use `git log` and `git blame`.
- **Private URL**: include a read-only token, e.g.
  `https://x-access-token:TOKEN@github.com/org/repo.git`. The remote is removed
  from the clone straight after fetching, and the token is masked in the UI and
  the report.
- **Local**: put the repository in the `repos/` folder next to `compose.yaml`
  (it's mounted read-only) and pick it from the list.

**Setup and check commands** run inside the container, with `CI=1`:

- _Setup_ (e.g. `npm ci`, `uv sync`) runs once in each workspace: the
  assistant's chat checkout, up to three workspaces for writing versions, and
  each of the candidate's terminals. Make it safe to run more than once.
- _Check_ (e.g. `npm test`) runs on every version, and once on the untouched
  code as a baseline. If the baseline already fails, failing versions aren't
  sent back for repair. If the check needs dependencies that a change might
  add, chain them: `npm install && npm test`.
- Both time out after the limit set on the form (10 minutes by default).

## Toolchains

The image has:

- **Node 24**, with npm, and pnpm and yarn through corepack;
- **Python 3**, with `venv`, `pip` and `uv`;
- a **C toolchain** (gcc, g++, make);
- **git**, curl, jq, ripgrep, less, an ssh client, `nano` and `vim`.

For anything else, add Debian packages at build time, then run `./twofold up`:

```sh
# .env
EXTRA_APT_PACKAGES=golang-go default-jdk-headless cargo
```

They're then available to the assistants, the setup and check commands, and the
candidate's terminal alike.

## Running a remote interview

By default Twofold listens on this machine only (`127.0.0.1`). For a candidate
somewhere else, either:

- **Use a tunnel** (simplest): `cloudflared tunnel --url http://localhost:7777`,
  ngrok, or Tailscale Funnel. Then set `TWOFOLD_PUBLIC_URL` to the public
  address so candidate links use it.
- **Expose it**: set `TWOFOLD_BIND=0.0.0.0` and put it behind a reverse proxy
  that terminates TLS.

**Previews need three more addresses.** Each preview (merged, A, B) is served
from its own origin, which locally means ports 7778, 7779 and 7780. Behind a
tunnel or proxy, give each its own public hostname pointing at those ports, and
list them in `TWOFOLD_PREVIEW_URLS`, in that order. Without them everything
else works, but the preview won't load for a remote candidate.

The candidate's link is their credential: 192 random bits, scoped to one
session. The interviewer pages need the admin token, which is kept in a
browser cookie after sign-in.

## Settings

Put these in a `.env` file next to `compose.yaml` (`.env.example` has them all,
with comments). Run `./twofold up` after changing any.

| Setting                         | Default     | What it does                                                                                             |
| ------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `TWOFOLD_ADMIN_TOKEN`           | generated   | The interviewer sign-in token. One is generated and kept when this is empty                              |
| `TWOFOLD_PORT`                  | `7777`      | The port on your machine                                                                                 |
| `TWOFOLD_BIND`                  | `127.0.0.1` | The interface to listen on; `0.0.0.0` exposes it to your network                                         |
| `TWOFOLD_PUBLIC_URL`            | —           | The address candidates use. Defaults to the address you opened the interviewer pages on                  |
| `TWOFOLD_PREVIEW_URLS`          | —           | Public addresses of the three previews (merged, A, B), when they aren't this host on 7778–7780           |
| `CLAUDE_CODE_OAUTH_TOKEN`       | —           | An alternative to `./twofold login claude`, from `claude setup-token`                                    |
| `CLAUDE_CODE_VERSION`           | `latest`    | The Claude Code version built into the image                                                             |
| `CODEX_VERSION`                 | `latest`    | The Codex version built into the image                                                                   |
| `TWOFOLD_AGENT_TIMEOUT_MINUTES` | `30`        | The longest a single assistant run may take                                                              |
| `TWOFOLD_REPOS`                 | `./repos`   | The folder of local repositories, mounted read-only                                                      |
| `EXTRA_APT_PACKAGES`            | —           | Extra Debian packages for your repositories' toolchains                                                  |
| `TWOFOLD_PASSTHROUGH_ENV`       | —           | Extra variable names passed to the assistants and commands (set their values in `compose.override.yaml`) |
| `TWOFOLD_ENABLE_MOCK`           | `0`         | Offer the mock assistant, for trying Twofold without a subscription                                      |

Some options are set per session on the new-session form instead: the
assistant's model and reasoning effort, the mix of pair kinds, which flaws are
allowed, whether a written justification is required, and whether the
candidate gets a terminal.

## Updating, data and backups

- `./twofold update` rebuilds the image with the latest Claude Code and Codex.
  Pin versions with `CLAUDE_CODE_VERSION` / `CODEX_VERSION` if you'd rather
  not.
- Everything lives in Docker volumes:

  | Volume         | Holds                                                      |
  | -------------- | ---------------------------------------------------------- |
  | `twofold-data` | sessions, their repositories and the candidates' terminals |
  | `claude-home`  | the Claude Code sign-in                                    |
  | `codex-home`   | the Codex sign-in                                          |
  | `agent-cache`  | npm, pip and uv caches, so setup commands get faster       |

  Back up `twofold-data` and you've kept every session. There's no database:
  each session is a JSON file, plus a git repository for its code.

- `./twofold reset` deletes every session but keeps the sign-ins. To delete one
  session, use **Delete** on its page.
