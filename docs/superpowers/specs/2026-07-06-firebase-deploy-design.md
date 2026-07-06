# Phantom Ink — Firebase 部署設計

## 背景

現有專案（`generator.py`、`game.py`、`bopomofo.py`、`backends.py` 等）是純 Python，設計給 Google Colab / Jupyter Notebook 使用：
- `generator.py`：三階段 AI 生成 pipeline（出題 → 驗題 → 模擬玩家），支援 Groq 與 Hugging Face Inference API 兩種 LLM 後端
- `game.py`：Wordle 風格互動遊戲，目前只能透過 `display(HTML(...))` 在 Colab 呈現，或用 `play_game()` 跑 CLI 模式
- `bopomofo.py` / `utils.py`：注音轉換（`pypinyin`）與簡轉繁（`zhconv`）

目標：讓使用者可以透過瀏覽器直接玩這個遊戲，並部署到 Firebase。

## 可行性結論

**可行。** 整個應用可以做成 100% 靜態網站，部署到 **Firebase Hosting 免費（Spark）方案**，不需要 Cloud Functions、Cloud Run、Firestore 或 Auth。

關鍵決策：**BYOK（Bring Your Own Key）架構** — 使用者自行輸入 Groq 或 Hugging Face 的免費 API Key，瀏覽器直接呼叫對應的 REST API 生成題目。這避免了「Cloud Functions 呼叫外部網路必須升級到 Blaze 付費方案」的限制，也不需要在後端保管任何金鑰。

風險點：Groq 與 HF Inference API 是否允許瀏覽器直接呼叫（CORS）。兩者官方都有提供瀏覽器端可用的 Playground/Widget，因此推斷可行，但**部署前需用真實 Key 手動驗證一次**，這是本設計唯一無法用單元測試涵蓋的風險。

## 使用者體驗範圍

- 完整流程：使用者在網頁上即時觸發 LLM 生成七〜十題問答（出題 → 驗題 → 模擬），生成完直接進入 Wordle 風格猜謎遊戲
- 不需要帳號系統、不需要保存遊戲紀錄或排行榜 — 純單局進行，關頁即消失
- 兩種 LLM backend（Groq / HF）都要支援，讓使用者自行於設定畫面切換

## 架構

```
使用者瀏覽器
  ├─ index.html (Vite build 產物)
  ├─ 設定畫面：輸入 API Key + 選 backend (Groq/HF) + 選 model
  │    → 存在 localStorage（不上傳任何後端，key 只留在使用者自己瀏覽器）
  ├─ generator/ (從 generator.py 移植)
  │    ├─ backends：groq.ts / hf.ts（直接 fetch 各自 REST API）
  │    ├─ pipeline：design → review → simulate，含重試/局部修正邏輯
  │    ├─ bopomofo.ts（用 pinyin-pro 取代 pypinyin）
  │    └─ zhconv.ts（用 opencc-js 取代 zhconv）
  └─ game/ （沿用 game.py 現有的 Wordle 風格 HTML/CSS/JS，改寫成 TS 模組）
       └─ 遊戲狀態純前端記憶體，不需要資料庫

Firebase 專案
  └─ Firebase Hosting only（靜態檔案，無 Functions、無 Firestore、無 Auth）
```

三階段生成 pipeline（出題→驗題→模擬）完全在使用者瀏覽器內執行，每一步都是對 Groq/HF 的直接 API 呼叫。沒有任何伺服器端程式碼跑在 Firebase 上。

## 專案結構

新增一個 `web/` 目錄，跟現有 Python 專案並存，不修改任何現有 Python 檔案：

```
web/
├── index.html
├── vite.config.ts
├── package.json
├── firebase.json          # Hosting 設定，public: "web/dist"
├── .firebaserc
└── src/
    ├── main.ts             # 進入點，畫面切換（設定畫面 ↔ 遊戲畫面）
    ├── settings.ts         # API Key / backend / model 輸入與 localStorage 存取
    ├── backends/
    │   ├── groq.ts         # 對應 backends.py 的 GroqBackend
    │   └── hf.ts           # 對應 backends.py 的 HFInferenceBackend
    ├── generator/
    │   ├── models.ts       # 對應 models.py 的型別（TS interface 取代 pydantic）
    │   ├── prompts.ts      # 對應 prompts.py 的文字模板
    │   └── generator.ts    # 對應 generator.py 的三階段 pipeline + 重試邏輯
    ├── bopomofo.ts         # 對應 bopomofo.py，改用 pinyin-pro
    ├── zhconv.ts           # 對應 utils.py 的簡轉繁部分，改用 opencc-js
    └── game.ts             # 對應 game.py 的 play_colab_game HTML 樣板，改寫成 TS + DOM 操作
```

**移植原則：**
- 邏輯逐檔對應，維持既有的中文命名習慣與三階段流程設計（核心約束照搬，見 `memory/user_design_intent.md`）
- pydantic 的驗證改用手寫的 TS 型別 + 簡單的執行期檢查，不引入 zod 等額外套件（YAGNI）
- `game.py` 現有的 HTML/CSS Wordle 樣式直接複製沿用，只把資料來源從「Python 產生後注入模板字串」改成「TS 直接操作 DOM」

## 資料流

1. 使用者進入網站 → 若 localStorage 沒有 API Key，顯示設定畫面
2. 使用者輸入 Key + 選 backend（Groq/HF）+ 選 model → 存 localStorage → 進入主畫面
3. 使用者輸入謎底（或選「AI 自動出謎底」）→ 呼叫 `generator.ts` 跑三階段 pipeline
4. Pipeline 直接 fetch Groq/HF API → 得到 `QuestionSet` → 轉注音 → 進入 Wordle 玩法（沿用 `game.py` 邏輯）

## 錯誤處理

對應現有 Python 版行為：
- API Key 無效 / 額度用盡 → 顯示明確錯誤訊息，導回設定畫面重新輸入
- JSON 解析失敗、題目不合格 → 沿用現有重試機制（`max_retries`、局部修正邏輯 `_fix_questions`）
- CORS 被擋（若 Groq/HF 政策有變動）→ 顯示「此瀏覽器無法直接連線 API」的錯誤提示，作為已知風險的 fallback 訊息

## 安全性 / 隱私

- API Key 只存在使用者自己瀏覽器的 localStorage，不會送到 Firebase 或任何第三方伺服器
- 畫面上需明確告知使用者「Key 只留在本機瀏覽器」，並提醒不要在公用電腦上使用

## 測試策略

- `bopomofo.ts`、`zhconv.ts` 的轉換結果對照 Python 版現有測試（`test_bopomofo.py`）的案例，確保輸出一致
- Pipeline 邏輯（重試、局部修正、洩題檢查）用假的 backend（回傳固定 JSON）做單元測試，不需要真的打 API
- 部署前手動用真實 Groq Key 跑一次完整流程，確認 CORS 沒問題（唯一無法純靠單元測試驗證的風險點）

## 部署步驟

```
cd web
npm install && npm run build
firebase deploy --only hosting
```

## 範圍之外（Out of scope）

- 帳號系統、遊戲紀錄保存、排行榜（使用者明確表示不需要）
- 任何伺服器端程式碼（Cloud Functions/Cloud Run）— BYOK 架構下不需要
- 現有 Python/Notebook 工作流程不受影響，兩者並存
