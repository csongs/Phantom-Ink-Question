# BACKLOG（待辦與已知風險）

> **用法**：使用者說「做點有用的事」或你完成主要任務還有餘裕時，從最高優先未完成項挑。開工前把該項改成「🔧 進行中＋日期」，完成改「✅＋日期＋一行結果」；新發現的問題照同格式補進來。
> 來源：2026-07-09 全面 review（Fable 5）。當時的重點放在 LLM/429 軸線與制度建立；UI 模組（game.ts、questionSetup.ts、groupPaste.ts、hostCommands.ts、bopomofo.ts）只做了淺層檢視，那邊可能還有未記錄的問題。

## P1（高價值）

- [ ] **出題者模式（Host Mode）**：開場模式分流＋BOT 指令頁（`/ghostink clue 題目id:N 題組:G 選項:O 注音:X`）＋單題重生候選。**完整規格：`docs/superpowers/plans/2026-07-09-host-mode.md`**（四項關鍵決策已於 2026-07-09 與使用者確認，寫在文件裡，不要重問）。分 3 個 Phase，各自可獨立 commit，照 Phase 順序做。
- [x] **2026-07-09 — simulatePlayer 呼叫量重構**：從每格一請求改為每題一請求（≤11 請求，合規 ≤15）。Prompt 列出所有揭露步驟讓模型自行模擬。
- [x] **2026-07-09 — README.md 更新**：重寫為以 web/ 為主體，移除 Python 用法與「由難到易」描述。備份於 `_backups/README.md.2026-07-09.bak`。
- [x] **2026-07-09 — memory/user_design_intent.md 過時警告**：已加 ⚠️ 提示行，備份到 `_backups/`。
- [ ] **觀察 generator 鏈首選是否該換**：qwen3-32b（6k TPM, reasoning）vs llama-3.3-70b-versatile（12k TPM, non-reasoning, json 穩定）。需使用者確認品質偏好。

## P2（中價值）

- [x] **2026-07-09 — HF backend 加入 429 重試**（hf.ts）：尊重 Retry-After header，最多 3 次重試。
- [x] **2026-07-09 — bundle 大小處理**：opencc-js 改 dynamic import（獨立 chunk），chunkSizeWarningLimit 調至 1300 並註明理由。
- [x] **2026-07-09 — 設定畫面顯示模型鏈資訊**：Model 欄下方顯示 Groq fallback 鏈順序。
- [x] **2026-07-09 — fallback 事件可觀測性**：結果區顯示「本次由哪個模型完成」（generator.llm.lastUsedModel）。

## P3（低價值/待議）

- [x] **2026-07-09 — localStorage schema 版本**：加 schemaVersion 欄位，版本不符自動重置。
- [x] **2026-07-09 — 冒煙測試腳本**：scripts/smoke-test.mts，用 fallback 鏈打一次迷你出題。
- [ ] 考慮升級 Groq Developer tier（使用者決策；綁卡即約 10 倍額度，見 docs/GROQ-NOTES.md）。429 幾乎消失的話，模型鏈退化成保險而不是日常路徑。

## ✅ 已完成

- [x] **2026-07-09 — 429 模型鏈 fallback 全套**：`fallbackGroq.ts`（鏈/決策表/參數適配/token 預算/節流）＋18 個單元測試＋main.ts 接線＋真 API 驗證 7 模型參數組合全 200＋`scripts/measure-groq-limits.mjs`。政策文件 `docs/LLM-RESILIENCE.md`。
- [x] **2026-07-09 — 制度文件建立**：CLAUDE.md 路由＋FAILURE-LOG＋GROQ-NOTES＋LLM-RESILIENCE＋QUESTION-QUALITY＋ENGINEERING＋本檔。
