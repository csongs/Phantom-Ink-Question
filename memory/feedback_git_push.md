---
name: no-automatic-git-push
description: 不要自動 push 到 GitHub，由使用者決定何時推送
metadata:
  type: feedback
---

不要自動執行 git push。所有 git push 操作必須由使用者明確要求才執行。

**Why:** 使用者希望自己控制推送時機，而不是由 AI 自動推送。
**How to apply:** commit 可以自動做（如果使用者要求），但 push 一定要等使用者說「push」或明確指示要推到 remote。
