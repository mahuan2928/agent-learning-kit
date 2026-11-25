#!/bin/bash
# 改写入参 (hook 独有): 给每条命令套上 20 秒上限 (比工具自带的 30 秒更严)。模型看不到这一层
CMD=$(jq -r '.tool_input.command // empty')
case "$CMD" in .agent/hooks/with-timeout*) exit 0 ;; esac
jq -n --arg c "$CMD" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",
  updatedInput:{command:(".agent/hooks/with-timeout 20 " + ($c | @sh))}}}'
