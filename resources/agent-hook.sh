#!/usr/bin/env bash
# Agent Terminal Hook Script
# Usage: agent-hook <waiting|done|running> [optional message/detail]

EVENT="${1:-done}"
DETAIL="${2:-}"
PANEL_ID="${AGENT_TERMINAL_PANEL_ID:-}"
SOCK="${AGENT_TERMINAL_SOCKET:-}"

if [ -z "$SOCK" ]; then
  SOCK=$(ls -t /tmp/myterm-*.sock 2>/dev/null | head -n 1)
fi

if [ -n "$SOCK" ] && [ -S "$SOCK" ]; then
  JSON=$(printf '{"panelId":"%s","event":"%s","detail":"%s"}' "$PANEL_ID" "$EVENT" "$DETAIL")
  curl -s --unix-socket "$SOCK" -X POST http://localhost/event -H "Content-Type: application/json" -d "$JSON" >/dev/null 2>&1
fi
