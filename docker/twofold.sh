#!/usr/bin/env bash
#
# The container's entrypoint, and a small admin CLI inside it.
#
#   twofold serve            start the web server (the default)
#   twofold url              print the interviewer sign-in link
#   twofold login claude     sign Claude Code in with your Claude subscription
#   twofold login codex      sign Codex in with your ChatGPT plan
#   twofold status           show whether each assistant is signed in
#   twofold shell            a shell as the sandbox user, for debugging
#
# Runs as root. Anything that touches a candidate's code runs as `agent`.
set -euo pipefail

log() { printf '[twofold] %s\n' "$*" >&2; }

as_agent() { exec runuser -u agent -- "$@"; }

# Named volumes come up owned by root; give each its owner back.
#   /data/private    the hidden labels: root only
#   /data/work       the agents' workspaces: not readable by the candidate's terminal
#   /data/terminals  the candidate's own copies of the code
prepare() {
    install -d -m 0700 -o root -g root /data/private
    install -d -m 0750 -o agent -g agent /data/work
    install -d -m 0700 -o candidate -g candidate /data/terminals
    install -d -m 0700 -o agent -g agent /home/agent/.claude /home/agent/.codex /home/agent/.cache
    chown agent:agent /home/agent/.claude /home/agent/.codex /home/agent/.cache
    chmod 0700 /home/agent /home/candidate
}

admin_token() {
    if [[ -n "${TWOFOLD_ADMIN_TOKEN:-}" ]]; then
        printf '%s' "$TWOFOLD_ADMIN_TOKEN"
    elif [[ -s /data/private/admin-token ]]; then
        tr -d '\n' < /data/private/admin-token
    fi
}

mode="${1:-serve}"
shift || true

case "$mode" in
    serve)
        prepare
        exec node /opt/twofold/dist/server.mjs
        ;;
    url)
        token="$(admin_token)"
        if [[ -z "$token" ]]; then
            log "no admin token yet: start the server once, then try again"
            exit 1
        fi
        base="${TWOFOLD_PUBLIC_URL:-http://localhost:${TWOFOLD_PUBLISHED_PORT:-7777}}"
        printf '%s/login#token=%s\n' "${base%/}" "$token"
        ;;
    login)
        prepare
        case "${1:-}" in
            claude)
                log "Signing Claude Code in with your Claude subscription."
                log "Open the link it prints, approve, and paste the code back here."
                as_agent claude auth login --claudeai
                ;;
            codex)
                log "Signing Codex in with your ChatGPT plan (device code flow)."
                as_agent codex login --device-auth
                ;;
            *)
                log "usage: twofold login claude|codex"
                exit 64
                ;;
        esac
        ;;
    status)
        prepare
        runuser -u agent -- sh -c '
            printf "Claude Code: "; claude auth status 2>/dev/null | grep -q "\"loggedIn\": true" && echo "signed in" || echo "not signed in"
            printf "Codex:       "; codex login status >/dev/null 2>&1 && echo "signed in" || echo "not signed in"
        '
        ;;
    shell)
        prepare
        cd /data/work
        as_agent bash -l
        ;;
    *)
        exec "$mode" "$@"
        ;;
esac
