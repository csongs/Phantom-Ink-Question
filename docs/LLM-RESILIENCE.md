# LLM 呼叫防護政策（429 手冊）

> **地位**：本文件是專案處理 Groq 限速／錯誤的**唯一標準**。任何 agent 改動 LLM 呼叫相關程式前必讀；改動不得違反「硬規則」。
> 平台實測數據見 `docs/GROQ-NOTES.md`；歷史事故見 `docs/FAILURE-LOG.md`。

## 0. 目標（依優先序）

1. **使用者不枯等**：不允許因限速讓使用者盯著轉圈超過 ~5 秒仍無任何回饋。
2. **請求不白白失敗**：能換模型完成的，就不要丟錯誤給使用者。
3. **品質可退讓但要透明**：換到較弱模型可以，但要在進度訊息中講明用了哪個模型。

核心手段：**模型鏈 fallback**。Groq 限速桶每模型獨立（GROQ-NOTES 實測），429 時換模型等於立刻拿到新桶——**換桶永遠優先於等待**。

## 1. 模型鏈（依用途）

```
generator（出題/驗題，json_object 模式）:
  qwen/qwen3-32b → llama-3.3-70b-versatile → qwen/qwen3.6-27b
  → meta-llama/llama-4-scout-17b-16e-instruct → openai/gpt-oss-120b
  （若使用者在設定頁自填 model，把它插到鏈的最前面、去除重複）

solver stage1（注音解讀，純文字模式）:
  qwen/qwen3-32b → qwen/qwen3.6-27b → llama-3.3-70b-versatile
  → meta-llama/llama-4-scout-17b-16e-instruct
  （刻意不含 8b：注音解讀超出 8b 能力，錯誤的解讀會毒害 stage2，寧可報錯）

solver stage2（謎底推理，純文字模式）:
  llama-3.3-70b-versatile → meta-llama/llama-4-scout-17b-16e-instruct
  → qwen/qwen3.6-27b → openai/gpt-oss-120b → llama-3.1-8b-instant
```

排序邏輯（未來調整時沿用同一邏輯）：首位 = 目前驗證過品質的主力；其後按「該任務所需能力 × TPM 大小」排；非 reasoning 模型優先於 reasoning 模型（省 think token）；8b 只當保底。

## 2. 錯誤決策表（收到回應後怎麼做）

| 狀況 | 判定方式 | 動作 |
|---|---|---|
| 429，retry-after ≤ 2s | header `retry-after` 優先；否則 body `try again in X.XXs` | 等它說的時間 +0.5s，**同模型重試一次**（每模型限一次），再失敗→下一個模型 |
| 429，retry-after > 2s | 同上 | **立刻換下一個模型**，不等待。記下 retry-after 供全鏈失敗時用 |
| 413（Request too large） | HTTP 413 或 body 含 `Request too large` | 換**TPM 更大**的下一個模型（跳過更小的）；沒有更大的→報錯：「prompt 過大，請縮短輸入」 |
| 400（參數/模型問題） | HTTP 400 | console.error 完整 body ＋ onEvent 提示，換下一個模型 |
| 404（模型下架） | HTTP 404 | 同上，並在訊息中提醒「模型鏈需要更新，見 GROQ-NOTES 重測方法」 |
| 401 | HTTP 401 | **立刻拋錯**（換模型無意義）：「API key 無效，請到設定頁重新填入」 |
| 5xx / 網路錯誤 | status ≥ 500 或 fetch throw | 換下一個模型 |
| 200 但 content 是空字串 | `choices[0].message.content` falsy | 視同失敗，換下一個模型（歷史上這是 think 吃光預算的症狀，FL-4） |

**全鏈都失敗時**：取所有 429 中最小的 retry-after；≤15s → 等待（進度訊息顯示倒數）後對該模型做最後一次嘗試；>15s 或最後一次也失敗 → 拋出人話錯誤：`所有模型都達到限速上限，最快 X 秒後恢復（模型：yyy）。持續發生請考慮升級 Groq Developer tier（綁卡即 10 倍額度）。`

## 3. 每模型參數適配（MODEL_CONF）

模型鏈切換時**必須**按目標模型調整參數，否則會 400：

| 模型 | TPM | reasoning | 切換到它時的參數調整 |
|---|---|---|---|
| qwen/qwen3-32b | 6000 | ✅ | json_object 時必須 `reasoning_format:'hidden'`；純文字模式不設 |
| qwen/qwen3.6-27b | 8000 | ✅ | 同上；json_object 時可用 `reasoning_effort:'none'` 壓思考 |
| llama-3.3-70b-versatile | 12000 | ❌ | **剝除** reasoning_format / reasoning_effort |
| llama-4-scout-17b-16e-instruct | 30000 | ❌ | 同上 |
| openai/gpt-oss-120b / 20b | 8000 | ✅ | 剝除 reasoning_format，改用 `reasoning_effort:'low'` |
| llama-3.1-8b-instant | 6000 | ❌ | 剝除 reasoning 參數 |

## 4. Token 預算規則

1. 呼叫前用 `estimateTokens()` 估 prompt（中文字數 × 1.7 ＋ 英文 words × 1.3 ＋ 50）。
2. 鐵律：`est_prompt + max_tokens ≤ 該模型 TPM × 0.8`。超標時自動把 max_tokens 下修；下修後 < 256 → 這個模型直接跳過（除非它已是鏈上 TPM 最大者，則以 256 硬試）。
3. 呼叫端沒給 max_tokens 的（如 checkAnswerLocale，刻意讓 reasoning 跑完）：保持不設，但若 est_prompt 本身 > TPM × 0.8 → 跳到更大 TPM 的模型。
4. **改 prompt 的人負責重新估算**。現行各呼叫點預算（2026-07-09）：

| 呼叫點 | max_tokens | 模式 |
|---|---|---|
| solver stage1（解讀） | 2048 | 純文字 |
| solver stage2（猜謎底） | 4096 | 純文字 |
| generateAnswer | 1024 | json_object+hidden |
| checkAnswerLocale | 不設（刻意） | json_object+hidden |
| designQuestions / fixQuestions / fillForcedReplies | 不設 | json_object+hidden |
| reviewQuestions | 1024 | json_object+hidden |
| inferCategory | 20 | 純文字 |

## 5. 節流（丟請求前）

- 同一模型兩次呼叫間隔 ≥ 3000ms（per-model，不是全域——不同模型桶獨立，跨模型只需 ≥ 300ms 全域間隔防瞬間連發）。
- 禁止並行呼叫（本 app 全部循序 await，維持此慣例）。

## 6. 使用者體驗規則

- 每次「換模型」都要透過 onEvent 回報一行進度，格式：`⚠️ <舊模型> 達到限速，改用 <新模型>⋯⋯`。
- 等待重試時要顯示秒數：`⏳ 限速中，X 秒後自動重試⋯⋯`。
- 最終失敗的錯誤訊息必須包含：哪些模型試過、最快幾秒後恢復、升級 tier 的建議（見 §2 末）。
- 成功但用的是鏈上第 3 位之後的模型時，提示品質可能下降。

## 7. 實作狀態（更動程式後就地更新這張表）

- [x] `web/src/backends/fallbackGroq.ts` — GroqFallbackBackend（模型鏈、決策表、參數適配、token 預算、節流、onEvent）（2026-07-09）
- [x] `web/src/backends/fallbackGroq.test.ts` — 注入假 fetch/sleep 的 18 個單元測試，涵蓋決策表每一列（2026-07-09）
- [x] `web/src/main.ts` 接線 — generator（buildBackend + progressLog）與 solver（兩條鏈 + status 顯示）皆改用 GroqFallbackBackend（2026-07-09）
- [x] `scripts/measure-groq-limits.mjs` — 限速重測腳本（2026-07-09）
- [x] `npm test` 141/141、`npm run build` 全綠（2026-07-09）
- [x] 真 API 驗證：鏈上 7 個模型 × 各自適配參數（json_object／reasoning_format hidden／reasoning_effort low）全部回 200（2026-07-09）

備註：舊的單模型 `GroqBackend`（`groq.ts`）保留供測試與相容；新程式一律用 FallbackBackend（硬規則 1）。
- 舊 `GroqBackend`（單模型）保留給「使用者指定 HF backend」以外的相容用途與測試；新程式一律用 FallbackBackend。

## 8. 給未來 agent 的硬規則

1. **MUST**：新增任何 Groq 呼叫一律經由 `GroqFallbackBackend`；不准另寫裸 fetch、不准 new 單模型 GroqBackend（除非在測試裡）。
2. **MUST**：改 prompt / max_tokens 前，用 §4 公式重估預算並更新 §4 的表。
3. **MUST**：改模型鏈前先跑 `node scripts/measure-groq-limits.mjs` 確認模型還在、限速沒變，並同步更新 GROQ-NOTES 的表。
4. **NEVER**：429 時 sleep 超過 2 秒還留在同一個模型上（違反本文件核心原則「換桶優先於等待」）。
5. **NEVER**：把 reasoning_format / reasoning_effort 原樣送給表 §3 說不支援的模型。
6. **NEVER**：對可程式判定的品質規則（字數、重複、洩底）靠 AI 驗題把關——用 CODE 硬擋（FL-1 教訓）。
7. 動完 LLM 相關程式，跑 `cd web && npm test`；遇到新失敗照 FAILURE-LOG 規則記錄。
