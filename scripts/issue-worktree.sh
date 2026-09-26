#!/usr/bin/env bash
# issue-worktree.sh — create or reuse a private per-issue git worktree.
#
# The project checkout is shared by every concurrent heartbeat. Running
# `git checkout` there rewrites other agents' in-flight work (see FOR-45).
# This script gives you an isolated working tree that shares the object
# store, so it costs a couple of MB and no extra fetch.
#
# Usage:
#   scripts/issue-worktree.sh <repo-dir> <issue-key> [branch] [base-ref]
#
# Prints ONLY the worktree path on stdout (git chatter goes to stderr). Idempotent and safe to run
# concurrently with other agents. Example:
#
#   WT=$(scripts/issue-worktree.sh cli FOR-123 feat/123-deploy-lock)
#   cd "$WT"
#
set -euo pipefail

REPO=${1:?repo directory name under the shared checkout, or '.' if the checkout is itself the repo}
ISSUE=${2:?issue key, e.g. FOR-123}
BRANCH=${3:-}
BASE=${4:-}

: "${PAPERCLIP_WORKSPACE_CWD:?run this inside a Paperclip heartbeat}"
: "${PAPERCLIP_AGENT_ID:?run this inside a Paperclip heartbeat}"

# Multi-repo projects keep clones beneath the shared checkout (`cli`, `browse`).
# Single-repo projects have the shared checkout be the repo itself: pass '.'.
if [ "$REPO" = "." ]; then
  SHARED="$PAPERCLIP_WORKSPACE_CWD"
  SLUG=$(basename "$PAPERCLIP_WORKSPACE_CWD")
else
  SHARED="$PAPERCLIP_WORKSPACE_CWD/$REPO"
  SLUG="$REPO"
fi

if [ ! -e "$SHARED/.git" ]; then
  echo "issue-worktree: no clone at $SHARED" >&2
  if [ "$REPO" != "." ] && [ -e "$PAPERCLIP_WORKSPACE_CWD/.git" ]; then
    echo "issue-worktree: this project's checkout is itself a repo — pass '.' as the repo argument" >&2
  else
    echo "issue-worktree: clone it there once, then re-run this script" >&2
  fi
  exit 1
fi

INSTANCE_ROOT="${PAPERCLIP_WORKSPACE_CWD%/projects/*}"
WT="$INSTANCE_ROOT/workspaces/$PAPERCLIP_AGENT_ID/worktrees/$SLUG-$ISSUE"

# Already provisioned on an earlier heartbeat for this issue: reuse it.
if [ -e "$WT/.git" ]; then
  echo "$WT"
  exit 0
fi

git -C "$SHARED" worktree prune >&2
git -C "$SHARED" fetch --quiet origin

if [ -z "$BASE" ]; then
  BASE=$(git -C "$SHARED" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
fi

if [ -z "$BRANCH" ]; then
  BRANCH="work/$(printf '%s' "$ISSUE" | tr '[:upper:]' '[:lower:]')"
fi

# Git refuses to check out one branch in two worktrees. If another agent
# holds this branch, say so instead of fighting over it.
if git -C "$SHARED" worktree list --porcelain | grep -qx "branch refs/heads/$BRANCH"; then
  echo "issue-worktree: branch '$BRANCH' is already checked out in another worktree:" >&2
  git -C "$SHARED" worktree list >&2
  echo "issue-worktree: use an issue-specific branch name, or coordinate on the issue." >&2
  exit 1
fi

mkdir -p "$(dirname "$WT")"

if git -C "$SHARED" show-ref --quiet --verify "refs/heads/$BRANCH"; then
  # Local branch already exists (earlier heartbeat, or created in the shared
  # clone before this convention). Check it out as-is; never reset it.
  git -C "$SHARED" worktree add "$WT" "$BRANCH" >&2
elif git -C "$SHARED" show-ref --quiet --verify "refs/remotes/origin/$BRANCH"; then
  # Resuming work already pushed for this issue.
  git -C "$SHARED" worktree add --track -b "$BRANCH" "$WT" "origin/$BRANCH" >&2
else
  git -C "$SHARED" worktree add -b "$BRANCH" "$WT" "$BASE" >&2
fi

echo "$WT"
