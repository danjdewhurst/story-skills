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
# [branch] defaults to work/<issue-key>. A rerun for an issue whose worktree
# holds a different branch fails rather than hand back the wrong branch.
#
# The worktree goes to <instance>/workspaces/<agent-id>/worktrees/<repo>-<issue-key>,
# where <instance> is $PAPERCLIP_WORKSPACE_CWD up to its last `projects`
# folder, in any letter case. Set ISSUE_WORKTREE_ROOT to use
# $ISSUE_WORKTREE_ROOT/<agent-id>/<repo>-<issue-key> instead; a checkout under
# no `projects` folder must. A worktree is never put inside the checkout.
#
set -euo pipefail

REPO=${1:?repo directory name under the shared checkout, or '.' if the checkout is itself the repo}
ISSUE=${2:?issue key, e.g. FOR-123}
BRANCH=${3:-}
BASE=${4:-}

: "${PAPERCLIP_WORKSPACE_CWD:?run this inside a Paperclip heartbeat}"
: "${PAPERCLIP_AGENT_ID:?run this inside a Paperclip heartbeat}"

if [ -z "$BRANCH" ]; then
  BRANCH="work/$(printf '%s' "$ISSUE" | tr '[:upper:]' '[:lower:]')"
fi

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

# A worktree inside the checkout shows up in its `git status`, which then
# fails the release preflight, so worktrees live outside it. Paperclip keeps
# project checkouts under <instance>/projects/ and agent workspaces under
# <instance>/workspaces/; any other layout must name the folder outright.
if [ -n "${ISSUE_WORKTREE_ROOT:-}" ]; then
  WT="$ISSUE_WORKTREE_ROOT/$PAPERCLIP_AGENT_ID/$SLUG-$ISSUE"
else
  INSTANCE_ROOT=${PAPERCLIP_WORKSPACE_CWD%/[Pp][Rr][Oo][Jj][Ee][Cc][Tt][Ss]/*}
  if [ "$INSTANCE_ROOT" = "$PAPERCLIP_WORKSPACE_CWD" ]; then
    echo "issue-worktree: $PAPERCLIP_WORKSPACE_CWD is not under a 'projects' folder, so there is no workspaces folder beside it" >&2
    echo "issue-worktree: set ISSUE_WORKTREE_ROOT to a folder outside the checkout to hold your worktrees" >&2
    exit 1
  fi
  WT="$INSTANCE_ROOT/workspaces/$PAPERCLIP_AGENT_ID/worktrees/$SLUG-$ISSUE"
fi
case "$WT" in
  /*) ;;
  *) WT="$PWD/$WT" ;;
esac

# A path with symlinks resolved as far as it exists, so a linked folder
# cannot hide that it leads into the checkout.
physical() {
  local dir=$1 rest=
  while [ ! -d "$dir" ]; do
    rest="/$(basename "$dir")$rest"
    dir=$(dirname "$dir")
  done
  printf '%s%s\n' "$(CDPATH='' cd -- "$dir" && pwd -P)" "$rest"
}

CHECKOUT=$(physical "$PAPERCLIP_WORKSPACE_CWD")
case "$(physical "$WT")/" in
  "$CHECKOUT"/*)
    echo "issue-worktree: $WT is inside the shared checkout $PAPERCLIP_WORKSPACE_CWD" >&2
    echo "issue-worktree: set ISSUE_WORKTREE_ROOT to a folder outside the checkout to hold your worktrees" >&2
    exit 1
    ;;
esac

# The branch a worktree holds. HEAD is detached while a rebase is stopped,
# so read the branch the rebase will move instead.
held_branch() {
  (
    CDPATH='' cd -- "$1" || exit
    git symbolic-ref --quiet --short HEAD 2>/dev/null && exit
    for state in rebase-merge rebase-apply; do
      head=$(git rev-parse --git-path "$state/head-name")
      if [ -f "$head" ]; then
        sed 's|^refs/heads/||' "$head"
        exit
      fi
    done
  )
}

# Already provisioned on an earlier heartbeat for this issue: reuse it, but
# only on the branch asked for, or the agent would commit to the wrong one.
if [ -e "$WT/.git" ]; then
  HELD=$(held_branch "$WT" || true)
  if [ "$HELD" != "$BRANCH" ]; then
    if [ -n "$HELD" ]; then
      echo "issue-worktree: $WT already holds branch '$HELD', not '$BRANCH'" >&2
      echo "issue-worktree: pass '$HELD' to keep working there, or remove that worktree first" >&2
    else
      echo "issue-worktree: $WT has a detached HEAD, not branch '$BRANCH'" >&2
      echo "issue-worktree: check out '$BRANCH' there, or remove that worktree first" >&2
    fi
    exit 1
  fi
  echo "$WT"
  exit 0
fi

git -C "$SHARED" worktree prune >&2
git -C "$SHARED" fetch --quiet origin

if [ -z "$BASE" ]; then
  BASE=$(git -C "$SHARED" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
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
