# What is kept from whom

The exercise only works if the candidate can't find out which version is which,
and neither can the assistant they're talking to. This page explains how that's
arranged, and what isn't covered.

## Three users in one container

```
 root       the web server. Owns /data/private: sessions and their hidden labels.
 agent      runs the assistants, git, and the setup and check commands, in
            /data/work. Can't read /data/private.
 candidate  runs the candidate's terminals, on copies of the code in
            /data/terminals. Can read neither /data/private, /data/work,
            nor the assistants' sign-ins.
```

Every process started for `agent` or `candidate` gets an environment built
from scratch, so the admin token and the server's settings never reach them.
The container drops every Linux capability except the few needed to run
processes as those users, and sets `no-new-privileges`.

## What each protection is for

| Concern                                     | How it's handled                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Labels reaching the candidate's browser     | The candidate's API returns an allow-list projection of the session ([`src/server/views.ts`](../src/server/views.ts)), built field by field. A test checks that no hidden field, flaw, summary or commit hash appears in it. Browsing a version takes `a` or `b`, never a commit.                                 |
| The assistant reading the labels            | Sessions live in `/data/private`, which the `agent` user can't read.                                                                                                                                                                                                                                              |
| The candidate's terminal finding the answer | It runs as `candidate` on an exported copy with no history, and can't see the assistants' workspaces in `/data/work`, where the real version folders are.                                                                                                                                                         |
| The assistants' instructions                | They name the flaws to try, so they go in a file only `agent` can read, never on a command line that `ps` would show.                                                                                                                                                                                             |
| Leftover transcripts                        | Runs that write versions keep no session files (`--no-session-persistence` for Claude Code, `--ephemeral` for Codex).                                                                                                                                                                                             |
| Order, timing and metadata                  | A coin flip decides which version is A. Both commits share message, author and date. Progress messages are neutral, and a failure never says which side failed.                                                                                                                                                   |
| Previews reaching Twofold                   | Browsers send a host's cookies to every port on it, so the preview proxy strips every `twofold_*` cookie before a request reaches the candidate's server, and drops any it tries to set. It won't proxy to Twofold's own ports. The API refuses state-changing requests from any other origin, previews included. |
| Repository code attacking the server        | Git runs as `agent`, with hooks and fsmonitor turned off. Paths from the browser are validated and read through git, never straight from disk. Private repository tokens are removed from the clone after fetching.                                                                                               |
| Someone else opening a session              | The candidate's link holds 192 random bits and is scoped to one session. Interviewer pages need the admin token, kept in an HttpOnly cookie. The terminal only accepts connections from Twofold's own pages.                                                                                                      |

## What this doesn't stop

- **Asking another AI.** A candidate can paste both diffs into another tool, or
  into the assistant's own chat. You'll see the latter in the transcript, and
  either makes a good conversation. The terminal can reach the internet, so a
  candidate could also sign in to an AI tool of their own there.
- **The assistant going looking.** The assistant in the chat can read the two
  version folders if it goes looking for them, though not the labels.
- **Watching the process list.** Every user in the container can see it, so a
  candidate who watched it closely while versions were being written could see
  git commands and commit hashes go by.
- **A container escape.** This keeps an honest exercise honest; it isn't
  designed to contain a determined attacker with a kernel exploit.

The terminal also runs whatever the candidate likes, inside the container. Run
interviews on a machine where that's fine, as you would with any coding
exercise.
