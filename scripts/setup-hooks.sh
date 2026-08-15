#!/bin/sh
# Wires the commit hooks and message template into this clone.
# Run once per clone, including on any machine an agent works from.
#
#   sh scripts/setup-hooks.sh
#
# Git does not version .git/hooks, so a fresh clone has no protection
# until this runs. That is the one weakness of the local-hook approach.

set -e
cd "$(dirname "$0")/.."

chmod +x .githooks/*
git config core.hooksPath .githooks
git config commit.template .gitmessage

echo "Hooks installed."
echo "  core.hooksPath   = $(git config core.hooksPath)"
echo "  commit.template  = $(git config commit.template)"
