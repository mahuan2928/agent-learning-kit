#!/bin/bash
# §1.5 例 1 — 阻断。退出码 2 = 这次调用不许发生, 任何权限模式都绕不过。
CMD=$(jq -r '.tool_input.command // empty')
if echo "$CMD" | grep -qE 'rm +-[a-zA-Z]*r'; then
  jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",
          permissionDecisionReason:"递归删除已被 hook 阻断。重试不会成功, 请改用其他方式或询问用户。"}}'
  exit 2
fi
exit 0
