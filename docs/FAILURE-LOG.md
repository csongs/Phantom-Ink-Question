# 失敗經驗簿（FAILURE LOG）

> **這是什麼**：本專案所有「踩過的坑」的正式紀錄，目的是讓之後任何 AI agent / 開發者不再重犯。
> **何時必讀**：改動任何 LLM 呼叫相關程式（`web/src/backends/`、`web/src/solver.ts`、`web/src/generator/`）之前；或遇到 429、413、空回應、`json_validate_failed` 時。
> **何時必寫**：你在本專案遇到任何非預期失敗（API 錯誤、額度問題、prompt 品質事故、建置失敗），修完後、收工前，**必須**在「紀錄」區最上方追加一條。沒寫 = 該任務未完成。
> 已有紀錄涵蓋的坑就不要重新踩一次來「驗證」——直接採用「正確修法」。

## 追加格式（複製此段填寫，放在「紀錄」區最上方）

```
### FL-<下一個編號>｜YYYY-MM-DD｜<一句話標題>
- **症狀**：使用者／開發者實際看到什麼
- **根因**：真正的原因（不是表象）
- **錯誤做法**：當時走過的彎路，讓後人直接跳過
- **正確修法**：最後怎麼解的（附 commit hash 或 檔案:行號）
- **現行防護**：現在程式裡哪個位置擋住了這件事
- **關鍵字**：給搜尋用的詞
```

---

## 紀錄（新的在上面）

### FL-7｜2026-07-09｜工具鏈對 CJK 檔案的編碼陷阱（Edit 失敗、print 炸掉）
- **症狀**：(a) 對含 CJK regex 的 TypeScript 檔用 Edit 工具，old_string 看起來一模一樣卻 match 失敗；(b) Windows 終端跑 python `print()` 中文時 `UnicodeEncodeError: 'cp950' codec can't encode`。
- **根因**：(a) 工具鏈在顯示/傳輸層會做 unicode 正規化（`\uXXXX` 跳脫與實際字元互換），模型「看到」的內容與檔案實際位元組不一致；(b) Windows 舊終端預設 cp950 編碼，print 非 BIG5 相容字元會炸。
- **錯誤做法**：反覆重試同樣的 Edit；在 bash heredoc 裡猜測跳脫層數。
- **正確修法**：(a) 含 CJK 的精確修改改用 python 腳本按行號處理（`open(p, encoding='utf-8').read().split('\n')` → 改指定 index → 寫回）；(b) python 輸出用 `sys.stdout.write(ascii(...))` 或避免印 CJK。
- **現行防護**：`docs/ENGINEERING.md`「已知地雷」段。
- **關鍵字**：Edit, CJK, unicode, 正規化, cp950, UnicodeEncodeError

### FL-6｜2026-07-09｜429 時死等重試同一模型，使用者枯等數十秒
- **症狀**：Groq 回 429 後，畫面卡在「思考中」很久才動；最壞情況等 5s+10s+15s 還是失敗。
- **根因**：`GroqBackend.chat()` 遇 429 只會 sleep 後重試**同一個模型**（舊版 `web/src/backends/groq.ts` 的 `MAX_429_RETRIES` 迴圈）。但實測證實 **Groq 的限速桶是每個模型獨立的**（見 `docs/GROQ-NOTES.md`）——同模型的桶空了，換一個模型立刻就有新額度，等待毫無必要。
- **錯誤做法**：把重試次數調高、把 sleep 調長、壓縮 prompt——這些只能緩解，不能消除等待。
- **正確修法**：模型鏈 fallback——429/413/5xx 時立刻換下一個模型（獨立的新桶）。設計與決策表見 `docs/LLM-RESILIENCE.md`，實作在 `web/src/backends/fallbackGroq.ts`（實作狀態以該文件的「實作狀態」節為準）。
- **現行防護**：`GroqFallbackBackend`（模型鏈）＋ CLAUDE.md 硬規則「新增 Groq 呼叫一律走 fallback backend」。
- **關鍵字**：429, rate limit, retry, fallback, 換模型, 死等

### FL-5｜2026-07-08｜system prompt 太大，直接撞爆 6000 TPM
- **症狀**：解題功能（clue solver）一叫就 413/429：`Request too large ... tokens per minute (TPM): Limit 6000`。連第一次呼叫都會失敗——這不是「太頻繁」，是**單一請求就超標**。
- **根因**：CLUE_SOLVER_SYSTEM_PROMPT 塞了完整注音對照表＋大量範例，約 4500 tokens；加上進度文字與 max_tokens，單次請求就超過 qwen3-32b 的 6000 TPM（free tier）。Groq 的 TPM 檢查把「請求的 max_tokens」也算進去。
- **錯誤做法**：先試著把 maxTokens 從 4096 降到 6144 以下（commit 44099b2）——治標；prompt 本體還是太肥。
- **正確修法**：把 system prompt 從 ~4500 壓到 ~200 tokens（移除注音表、冗長範例），maxTokens 降到 2048（commit c9028e6）。
- **現行防護**：規則「est_prompt + max_tokens ≤ 該模型 TPM × 0.8」寫在 `docs/LLM-RESILIENCE.md`；改任何 prompt 前先估 token。
- **關鍵字**：413, TPM, request too large, prompt 太大, 注音表

### FL-4｜2026-07-05 ~ 07-08｜reasoning 模型的隱藏思考吃光 token → 空回應 / json_validate_failed
- **症狀**：(a) Groq 回傳 content 為空字串；(b) json_object 模式下報 `json_validate_failed` 且 `failed_generation` 是空的；(c) 明明 maxTokens 設 1024 還是失敗。
- **根因**：qwen3-32b 是 reasoning 模型，**隱藏的 `<think>` token 也計入 completion tokens 與 TPM**。思考一長，額度先被吃光，正文一個字都沒生出來。這正是使用者說的「THINK 太多量導致超出額度」。
- **錯誤做法**：
  - 對「判斷型」任務只給 200~1024 tokens 的 max_tokens（思考根本不夠用，見 `generator.ts` 內 `generateAnswer`/`checkAnswerLocale` 的註解）；
  - json_object 模式下不設 `reasoning_format`（Groq 規定 reasoning 模型配 json_object 必須 `'hidden'` 或 `'parsed'`，否則 think 吃光預算）；
  - 一度把 `reasoning_format` 送給不吃這參數的情境導致空 content（commit 24ab116）。
- **正確修法**（按情境分）：
  - 出題等 json 任務：qwen3-32b + json_object + `reasoning_format:'hidden'`（`generator.ts` 的 `jsonChat`）。
  - 解題 stage 1：**改用純文字模式**（不設 json_object、不設 reasoning_format），讓模型思考＋輸出 JSON 混在正文，再用 `extractJson` 撈出來（commit c9028e6、`solver.ts` 註解）。
  - 需要壓思考量時：qwen3.6-27b 支援 `reasoning_effort:'none'`；gpt-oss 系列支援 `reasoning_effort:'low'`；qwen3-32b **沒有**關思考的開關，只能靠換模型或給足預算。
  - 猜謎底 stage 2：干脆換非 reasoning 模型 llama-3.3-70b（commit 084f8a5、a0c7640 兩階段拆分）。
- **現行防護**：`solver.ts` 兩階段架構＋各呼叫點的 max_tokens 註解；`docs/GROQ-NOTES.md` 的 reasoning 模型對照表。
- **關鍵字**：reasoning, think, 思考token, 空回應, empty content, json_validate_failed, reasoning_format, qwen

### FL-3｜2026-07 上旬｜請求太頻繁 → 連環 429
- **症狀**：generate() 一次流程連發多個請求（出謎底→用語檢查→出題→修題→驗題），後面的請求開始 429。
- **根因**：free tier 每模型 TPM 只有 6000，且**全部呼叫都打同一個模型**（qwen3-32b）的同一個桶；一個 generate 流程 3~10+ 個請求在同一分鐘內把桶清空。
- **錯誤做法**：無腦重試。
- **正確修法**：呼叫之間加最小間隔（`MIN_INTERVAL_MS = 3000`，`groq.ts`）；根治靠 FL-6 的模型鏈（把負載攤到多個桶）。
- **現行防護**：throttle（每模型間隔）＋ fallback 鏈。
- **關鍵字**：429, 頻繁, throttle, TPM, 連發

### FL-2｜2026-07-07｜解題 prompt 把「已揭露注音」當成「完整詞注音」來驗證
- **症狀**：AI 解題時把語意合理的候選全排除，或硬湊出怪答案——因為它要求候選詞的**全部**音節都要對上，但遊戲裡注音是逐格揭露的、天生不完整。
- **根因**：prompt 沒有講清楚「注音是前綴過濾器」：只需驗證已揭露的音節與候選前幾個字一致，未揭露部分不用管；且部分注音可能引出多字詞（commit bbda6b7）。
- **正確修法**：prompt 明定「前綴匹配」規則＋易混聲母表（ㄙ≠ㄕ、ㄗ≠ㄓ、ㄘ≠ㄔ），見 `solver.ts` 的 CLUE_SOLVER_SYSTEM_PROMPT 核心規則 2、3、6（commits bbda6b7, 1e105ec, c9028e6）。
- **現行防護**：現行 CLUE_SOLVER_SYSTEM_PROMPT；改此 prompt 前先讀 `docs/QUESTION-QUALITY.md`。
- **關鍵字**：注音, 前綴, prefix, 解題, clue solver, 誤判

### FL-1｜2026-07 上旬｜AI 驗題放行 14 字回答，破壞遊戲
- **症狀**：生成的題組裡出現 14 個中文字的回答。這是逐格開注音的遊戲，回答太長直接把遊戲拖爛。
- **根因**：把「回答 ≤ 6 中文字」這種**可程式判定**的規則交給 AI reviewer 把關——AI 驗題會漏。
- **正確修法**：可程式判定的規則一律用 CODE 硬擋，AI 驗題只管語意類問題。6 字上限的硬檢查在 `generator.ts` 的 `replyCharCount` + fix 迴圈。
- **現行防護**：`generator.ts` generate() 內的 bad-set 檢查（空回答／重複／洩漏謎底字／超過 6 字）。這也是 raccoon 五原則之五（見 `docs/QUESTION-QUALITY.md`）。
- **關鍵字**：驗題, reviewer, 六字, 硬規則, code check
