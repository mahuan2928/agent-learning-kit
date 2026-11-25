#!/bin/bash
# 否决终止: 测试 (这里是 tsc 类型检查) 没过, 模型想停也不让停
if ! npm test --silent >/dev/null 2>&1; then
  jq -n '{hookSpecificOutput:{hookEventName:"Stop",
          additionalContext:"npm test 未通过, 还不能结束。请先运行 npm test 看错误并修复。"}}'
  exit 2
fi
exit 0
