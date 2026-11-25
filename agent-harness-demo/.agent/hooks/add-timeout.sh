#!/bin/bash
# §1.5 例 2 — 改写入参。hook 独有能力, allow/deny 做不到。
CMD=$(jq -r '.tool_input.command // empty')
case "$CMD" in timeout*) exit 0 ;; esac
jq -n --arg c "timeout 300 $CMD" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",
    updatedInput:{command:$c}}}'
