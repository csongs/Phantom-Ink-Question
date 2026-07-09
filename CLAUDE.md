# Phantom-Ink-Question — Agent 入口路由

「靈媒遊戲」題目生成＋解題輔助。真正的 app 在 `web/`（Vite + TS + vitest）；根目錄 Python 檔是早期原型，僅供參考。與使用者溝通一律用中文。

## 按任務跳轉（先讀對應文件再動手）

| 你要做的事 | 必讀 |
|---|---|
| 改任何 LLM/Groq 呼叫、prompt、max_tokens、模型 | `docs/LLM-RESILIENCE.md`（政策＋硬規則）、`docs/FAILURE-LOG.md`（踩過的坑） |
| 查 Groq 模型/限速/headers/金鑰 | `docs/GROQ-NOTES.md`（含實測數據與重測腳本） |
| 改出題/驗題規則或相關 prompt | `docs/QUESTION-QUALITY.md`（需求方 raccoon 的五原則，凌駕一般直覺） |
| 跑起來/測試/找檔案/驗收 | `docs/ENGINEERING.md` |
| 找下一件該做的事、看已知風險 | `docs/BACKLOG.md` |
| 任何失敗發生後 | 照 `docs/FAILURE-LOG.md` 開頭的規則追加紀錄（必做） |

## 硬規則（違反 = 做錯，沒有例外）

1. 呼叫 Groq 一律經由 `web/src/backends/fallbackGroq.ts` 的 `GroqFallbackBackend`；不准另寫裸 fetch，不准在測試以外 new 單模型 `GroqBackend`。
2. 429 時換模型（換桶），不准 sleep >2 秒後重試同模型。完整決策表在 `docs/LLM-RESILIENCE.md` §2。
3. API key 只存在使用者的 localStorage 或本機環境變數 `GROQ_API_KEY`；**絕不**寫進 repo 任何檔案。
4. 不要自動 `git push`；commit 可以，push 由使用者決定（`memory/feedback_git_push.md`）。
5. 可程式判定的品質規則（回答 ≤6 中文字、重複、洩漏謎底字）用 CODE 硬擋，不交給 AI 驗題。
6. 改動 `web/src` 後必跑 `cd web && npm test`；改 LLM 相關再加跑 `npm run build`。
7. 遇到本專案的新失敗（API/額度/品質/建置），收工前寫進 `docs/FAILURE-LOG.md`，否則任務不算完成。
8. 新增文件後回來本表加一行路由；修改既有檔案前先在 `_backups/` 留副本。

## 其他既有知識

- `memory/user_design_intent.md` — 出題系統三階段設計（出題→驗題→模擬）與核心約束。
- `docs/superpowers/plans/`、`specs/` — 歷次功能的規劃文件（描述當時的計畫，未必等於現狀；以程式碼為準）。
