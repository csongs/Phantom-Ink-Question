# BACKLOG（待辦與已知風險）

> **用法**：使用者說「做點有用的事」或你完成主要任務還有餘裕時，從最高優先未完成項挑。開工前把該項改成「🔧 進行中＋日期」，完成改「✅＋日期＋一行結果」；新發現的問題照同格式補進來。
> 來源：2026-07-09 全面 review（Fable 5）。當時的重點放在 LLM/429 軸線與制度建立；UI 模組（game.ts、questionSetup.ts、groupPaste.ts、hostCommands.ts、bopomofo.ts）只做了淺層檢視，那邊可能還有未記錄的問題。

## P1（高價值）

- [ ] **啟用 simulatePlayer 前必須先重新設計它的呼叫量**。現況：每題×每格注音揭露都打一次 LLM（`generator.ts` `simulatePlayer` 內層迴圈），10 題×10 格 = 最多上百個請求，free tier 必炸。目前 `skipSimulation` 預設 true 所以沒事，**在重構完成前不准把它打開**。方向：一題一個請求（模型自己決定要開幾格）、或限制 revealStep 上限、或整組一次模擬。驗收：模擬一組 10 題的總請求數 ≤ 15。
- [ ] **README.md 過時**：還在講 Python 用法與「七題由難到易」（已被 raccoon 原則 1 推翻，見 `docs/QUESTION-QUALITY.md`）。改成：web/ 為主體、指令、CLAUDE.md 路由入口。驗收：README 內容與現狀一致、不再出現由難到易。
- [ ] **`memory/user_design_intent.md` 含過時的難度遞增描述**：檔案開頭加一行「⚠️ 難度遞增部分已被取代，以 docs/QUESTION-QUALITY.md 為準」（改前先備份到 `_backups/`）。
- [ ] **觀察 generator 鏈首選是否該換**：目前出題預設仍以 qwen3-32b（6000 TPM，隱藏思考不可關）打頭，理由是 prompt 品質驗證過。若使用者回報「出題常常換到備援模型」或品質可接受，考慮把 `CHAINS.generator` 首位改為 llama-3.3-70b-versatile（12000 TPM、無思考、json 穩定）。改前先跟使用者確認品質偏好，並小規模對比兩者出題品質。

## P2（中價值）

- [ ] **HF backend 沒有任何限速/重試處理**（`hf.ts`）：HF router 也會 429。若使用者實際在用 HF 再處理；方向與 Groq 相同（至少加 retry-after 尊重）。
- [ ] **bundle 過大警告**（1.57MB，主因 opencc-js）：`vite build` 每次都警告。方向：dynamic import zhconv/opencc、或 manualChunks。驗收：無 500kB 警告或警告閾值有意識地調高並註明理由。
- [ ] **設定畫面顯示模型鏈資訊**：目前 Model 欄是自由文字，使用者不知道 fallback 鏈存在。加一行說明文字或下拉選單（值 = `CHAINS` 的 key）。
- [ ] **fallback 事件的可觀測性**：onEvent 目前只進進度區/console。考慮在結果區顯示「本次由哪個模型完成」，累積幾天使用資料後回頭調整鏈序（支撐 P1 最後一項的決策）。

## P3（低價值/待議）

- [ ] localStorage 設定沒有 schema 版本欄位，未來欄位變動可能讀壞舊資料（目前 try/catch 擋著，最多重設）。
- [ ] `scripts/` 可再加一支 node 冒煙腳本：用 fallback 鏈真打一次迷你出題，部署前跑（需 vite-node 或把 backends 抽成 node 可跑）。
- [ ] 考慮升級 Groq Developer tier（使用者決策；綁卡即約 10 倍額度，見 `docs/GROQ-NOTES.md`）。429 幾乎消失的話，模型鏈退化成保險而不是日常路徑。

## ✅ 已完成

- [x] **2026-07-09 — 429 模型鏈 fallback 全套**：`fallbackGroq.ts`（鏈/決策表/參數適配/token 預算/節流）＋18 個單元測試＋main.ts 接線＋真 API 驗證 7 模型參數組合全 200＋`scripts/measure-groq-limits.mjs`。政策文件 `docs/LLM-RESILIENCE.md`。（本項之前的痛點紀錄見 `docs/FAILURE-LOG.md` FL-3～FL-6。）
- [x] **2026-07-09 — 制度文件建立**：CLAUDE.md 路由＋FAILURE-LOG＋GROQ-NOTES＋LLM-RESILIENCE＋QUESTION-QUALITY＋ENGINEERING＋本檔。

## Review 時觀察到、但不構成待辦的事實

- 出題/驗題 prompt 已對齊 raccoon 五原則，且 `prompts.test.ts` 有回歸測試擋「由難到易」重新混入——這塊是健康的。
- CODE 硬擋（六字/重複/洩底/空回答）＋AI 驗題的分工正確，不要動搖。
- `groq.ts`（單模型 backend）僅測試與 GROQ_DEFAULT_MODEL 常數在用；保留即可，不用急著刪。
- 解題器 stage2 的「謎底與線索回答不共用中文字」規則與 generator 的洩底硬擋互為鏡像，邏輯一致。
