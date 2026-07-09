# 工程常識（跑起來、找檔案、驗收）

> 新 session 第一次動手前掃一遍。與使用者溝通一律中文；commit message 沿用現有風格（英文 conventional commits：`feat:`/`fix:`/`docs:`/`refactor:`）。

## 專案地圖

```
web/                     ← 真正的 app（Vite + TypeScript + vitest，純前端、無伺服器）
  src/main.ts            ← UI 入口：設定畫面、遊戲畫面、解題器；backend 的建構與接線在這
  src/backends/
    fallbackGroq.ts      ← ★ Groq 模型鏈 fallback（所有 Groq 呼叫的唯一入口，硬規則）
    groq.ts              ← 舊單模型 backend（保留給測試/相容，新程式不要用）
    hf.ts                ← HuggingFace backend（使用者可在設定選）
    shared.ts            ← LLMBackend 介面、extractJson
  src/generator/
    generator.ts         ← 出題三階段流程 + CODE 品質硬擋（六字/重複/洩底）
    prompts.ts           ← 出題/驗題/模擬所有 prompt 與題庫 QUESTION_BANK
    models.ts            ← 型別
  src/solver.ts          ← 解題器（兩階段：注音解讀 → 謎底推理）
  src/bopomofo.ts        ← 注音轉換；zhconv.ts ← 簡繁/標點轉換
  src/settings.ts        ← localStorage 設定（key: phantom-ink-settings）
  src/game.ts, questionSetup.ts, groupPaste.ts, hostCommands.ts ← 遊戲/設定 UI 模組
scripts/measure-groq-limits.mjs ← Groq 限速重測（GROQ_API_KEY 環境變數，已設在本機）
docs/                    ← 制度文件（入口見根目錄 CLAUDE.md 的路由表）
memory/                  ← 早期 session 留下的專案記憶（user_design_intent、git push 規則）
*.py（根目錄）           ← Python 原型，僅供考古，不要再改
_backups/                ← 改檔前的備份（已 gitignore）
```

## 指令（都在 `web/` 下執行）

```bash
npm run dev      # 開發伺服器（瀏覽器開 http://localhost:5173）
npm test         # vitest 全套（~90 秒；141+ 例）
npm run build    # tsc --noEmit 型別檢查 + vite build（驗收必跑）
npm run preview  # 預覽 build 產物
```

部署：Firebase Hosting（`web/firebase.json`，public=dist）。`npm run build` 後 `firebase deploy`（需使用者登入過 firebase CLI；背景見 `docs/superpowers/specs/2026-07-06-firebase-deploy-design.md`）。**不要主動部署，問過使用者。**

## 驗收清單（Definition of Done）

1. `cd web && npm test` 全綠。
2. 動過 LLM／型別相關 → `npm run build` 也要綠。
3. 動過 LLM 呼叫 → 對照 `docs/LLM-RESILIENCE.md` §8 硬規則逐條自查。
4. 動過出題/驗題 prompt → 對照 `docs/QUESTION-QUALITY.md` 五原則自查。
5. 遇到新失敗 → 寫入 `docs/FAILURE-LOG.md`（格式在該檔開頭）。
6. UI 層改動盡量手動驗證：`npm run dev` 後走一次「設定 → 生成題組 → 開始遊戲」或解題器貼上進度。
7. commit 可以做（訊息英文、附 Co-Authored-By），**push 一律由使用者決定**（`memory/feedback_git_push.md`）。

## 慣例與注意

- **語言**：UI 文字、錯誤訊息、進度訊息全部繁體中文（臺灣用語）；程式註解英文（沿用現狀）。
- **無框架**：UI 是手寫 DOM（`innerHTML` + `escapeHtml`），不要引入 React/Vue。
- **金鑰**：使用者的 Groq/HF key 存 localStorage，由使用者在設定頁自己貼；本機腳本用 `GROQ_API_KEY` 環境變數。絕不寫進 repo。
- **測試風格**：vitest + `vi.stubGlobal('fetch', ...)` 或建構子注入（`fallbackGroq.test.ts` 的 `makeBackend` 是範本——sleep/now/fetch 全注入，測試不等真計時器）。
- **已知地雷**：
  - 對含 CJK 字元的檔案用 Edit 工具可能因編碼正規化而 match 失敗 → 改用 python 腳本按行改（見 FAILURE-LOG 若再遇到請記錄細節）。
  - Windows 終端 cp950：python `print()` 中文可能炸，改 `sys.stdout.write` 或避免印 CJK。
  - vite build 有 500kB chunk 警告（opencc-js 大）→ 既有狀況，見 BACKLOG，不是你弄壞的。
