# syntax=docker/dockerfile:1
#
# Twofold: one image with the web app, git, common language toolchains and both
# coding-agent CLIs. Multi-arch (amd64 and arm64), so it runs the same on Linux,
# macOS (Docker Desktop / OrbStack / Colima) and Windows (Docker Desktop, WSL2).
#
# Two identities inside the container:
#   root   runs the web server; owns /data/private (sessions and their hidden labels)
#   agent  uid 10001; runs everything that touches a candidate's code: the agent
#          CLIs, git, and the setup and check commands. It cannot read /data/private.

ARG NODE_VERSION=24

# --------------------------------------------------------------------------- #
# Build the web app and the server bundle.
# --------------------------------------------------------------------------- #
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build

# --------------------------------------------------------------------------- #
# Runtime.
# --------------------------------------------------------------------------- #
FROM node:${NODE_VERSION}-bookworm-slim

# Pin these for reproducible images; `./twofold update` rebuilds with the latest.
ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
# Extra Debian packages for the repositories you interview on, e.g.
#   EXTRA_APT_PACKAGES="golang-go default-jdk-headless cargo"
ARG EXTRA_APT_PACKAGES=""

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git openssh-client tini procps less jq ripgrep \
        build-essential python3 python3-venv python3-pip python3-dev \
        ${EXTRA_APT_PACKAGES} \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /uvx /usr/local/bin/

RUN npm install -g \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force \
    && corepack enable

RUN groupadd --gid 10001 agent \
    && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash agent \
    # Workspaces are created by the server and used by the sandbox user.
    && git config --system --add safe.directory '*' \
    && git config --system init.defaultBranch main \
    && git config --system advice.detachedHead false

WORKDIR /opt/twofold
COPY --from=build /src/dist ./dist
COPY samples ./samples
COPY --chmod=0755 docker/twofold.sh /usr/local/bin/twofold

ENV TWOFOLD_HOST=0.0.0.0 \
    TWOFOLD_PORT=7777 \
    TWOFOLD_DATA_DIR=/data \
    TWOFOLD_REPOS_DIR=/repos \
    TWOFOLD_SAMPLES_DIR=/opt/twofold/samples \
    TWOFOLD_STATIC_DIR=/opt/twofold/dist/web \
    TWOFOLD_SANDBOX_UID=10001 \
    TWOFOLD_SANDBOX_GID=10001 \
    TWOFOLD_SANDBOX_HOME=/home/agent \
    CLAUDE_CONFIG_DIR=/home/agent/.claude \
    CODEX_HOME=/home/agent/.codex \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    npm_config_cache=/home/agent/.cache/npm \
    UV_CACHE_DIR=/home/agent/.cache/uv

VOLUME ["/data"]
EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -fsS http://127.0.0.1:7777/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/twofold"]
CMD ["serve"]
