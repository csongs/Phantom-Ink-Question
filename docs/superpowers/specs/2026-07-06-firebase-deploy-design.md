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
  │    ├─ bopomofo.ts（用 pinyin-pro + pinyin-to-zhuyin 取代 pypinyin，見下方「已驗證的函式庫細節」）
  │    └─ zhconv.ts（用 opencc-js 取代 zhconv）
  └─ game/ （沿用 game.py 現有的 Wordle 風格 HTML/CSS/JS，改寫成 TS 模組）
       └─ 遊戲狀態純前端記憶體，不需要資料庫

Firebase 專案
  └─ Firebase Hosting only（靜態檔案，無 Functions、無 Firestore、無 Auth）
```

三階段生成 pipeline（出題→驗題→模擬）完全在使用者瀏覽器內執行，每一步都是對 Groq/HF 的直接 API 呼叫。沒有任何伺服器端程式碼跑在 Firebase 上。

## 已驗證的函式庫細節（技術驗證結果）

規劃階段實測驗證過以下細節，plan 撰寫時直接採用這些結論，不需要再重新調查：

**注音轉換（`bopomofo.ts`）：**
- `pinyin-pro` 本身**不支援**直接輸出注音（一開始的假設是錯的）。改用 `pinyin-pro`（取得帶調號數字的拼音，`toneType: 'num'`）+ `pinyin-to-zhuyin`（其 `p2z()` 函式把拼音轉成注音符號）兩個套件組合。
- 實測這個組合對 `test_bopomofo.py` 現有測試案例（`乐器行`、`钢琴`、`演奏厅` 等）的輸出，與現有 Python 版 `pypinyin` 的 `Style.BOPOMOFO` 輸出**逐字元一致**，但需要三個正規化步驟：
  1. 只對「原始字元屬於中日韓統一表意文字」（正規表示式 `/[一-鿿]/`）的位置做轉換；非中文字元（英文字母、數字、標點）直接跳過（不能用「轉換結果是否包含注音字元」來判斷，因為 `p2z()` 對單一英文字母也會吐出看似合法的注音字元，例如 `p2z('A')` → `˙ㄚ`）
  2. `pinyin-pro` 的輕聲用數字 `0` 表示（如 `de0`），但 `pinyin-to-zhuyin` 預期輕聲是 `5`（或省略數字），送進 `p2z()` 前要把結尾的 `0` 換成 `5`
  3. `p2z()` 把輕聲符號 `˙` 放在音節「前面」（如 `˙ㄉㄜ`），但現有 Python 版 `pypinyin` 的輸出習慣放在「後面」（如 `ㄉㄜ˙`）；轉換後若字串以 `˙` 開頭，要把它移到字串尾端
  4. 現有 Python 版 `to_bopomofo()` 對第一聲（無聲調符號）會額外補上 `ˉ`；同樣邏輯搬到 JS：若結果字串最後一個字元不是 `ˊˋˇ˙` 其中之一，補上 `ˉ`
- **已知限制（可接受的落差）：** `pinyin-pro` 與 `pypinyin` 的輕聲判斷字典不完全相同。例如「我們」的「們」，`pypinyin` 判斷為輕聲，`pinyin-pro` 在某些上下文判斷為二聲。這是兩個函式庫底層拼音字典本身的差異，不是轉換邏輯的 bug，也不值得為了追求 100% 一致而額外實作一份輕聲字典。移植時針對常見詞彙做人工抽查，遇到明顯落差記錄下來即可，不視為阻擋部署的問題。
- **附帶發現（超出本次任務範圍，僅記錄）：** 現有 `test_bopomofo.py::test_to_bopomofo_cells_count` 目前是**壞掉的**（预期「鋼琴」為 6 格，實際程式碼行為是 7 格，因為第一聲的「鋼」會被加上額外的 `ˉ` 格）。這是現有 Python 版本裡本來就存在的測試錯誺，與本次 Firebase 移植無關，移植時應該以「實際執行結果」（7 格）為準，不要照抄這個測試裡寫錯的期望值。

**簡轉繁（`zhconv.ts`）：**
- `opencc-js` 的 `Converter({ from: 'cn', to: 'tw' })` 經實測是同步函式（字典已在套件內建置時打包好，不需要在瀏覽器內非同步下載），可以直接在 Vite 專案中 import 使用，行為與現有 Python 版 `zhconv.convert(text, "zh-tw")` 相同的範圍：只做字元級簡轉繁（例如 乐→樂、钢→鋼），**不做詞彙置換**（例如不會把「鼠標」換成「滑鼠」、「打印機」換成「印表機」）。這點兩邊函式庫都一樣，詞彙置換是靠 LLM prompt 裡的「請使用臺灣慣用詞彙」指示完成的，不是靠轉換函式庫。

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
    │   ├── prompts.ts      # 對應 prompts.py 的文字模板（含題庫 QUESTION_BANK）
    │   └── generator.ts    # 對應 generator.py 的三階段 pipeline + 重試邏輯
    ├── bopomofo.ts         # 對應 bopomofo.py，改用 pinyin-pro + pinyin-to-zhuyin
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

- `bopomofo.ts`、`zhconv.ts` 的轉換結果對照 Python 版現有測試（`test_bopomofo.py`）的案例，確保輸出一致（除了上述已知的輕聲字典落差，以及已修正的「鋼琴應為 7 格」）
- Pipeline 邏輯（重試、局部修正、洩題檢查）用假的 backend（回傳固定 JSON）做單元測試，不需要真的打 API
- 部署前手動用真實 Groq Key 跑一次完整流程，確認 CORS 沒問題（唯一無法純靠單元測試驗證的風險點）

## 部署步驟

```
cd web
npm install && npm run build
npx firebase-tools deploy --only hosting
```

## 範圍之外（Out of scope）

- 帳號系統、遊戲紀錄保存、排行榜（使用者明確表示不需要）
- 任何伺服器端程式碼（Cloud Functions/Cloud Run）— BYOK 架構下不需要
- 現有 Python/Notebook 工作流程不受影響，兩者並存
- 修復 `test_bopomofo.py` 現有的錯誤測試期望值（與本次任務無關，不在範圍內）
