# Groq 平台實測筆記

> 實測日：**2026-07-09**，帳號層級：**Free tier**。限速數字會隨 Groq 政策改變——過期就用文末「重測方法」更新本表，不要憑記憶猜。

## 最重要的一件事：限速桶是「每個模型獨立」的

實測證實：打爆 A 模型的 TPM，完全不影響 B 模型的額度。
→ **遇到 429 換模型 = 立刻拿到一個全新的桶**，比等待快得多。這是本專案 fallback 架構（`docs/LLM-RESILIENCE.md`）的理論基礎。
→ 反過來說：**把所有呼叫集中在同一個模型 = 自願擠最小的桶**（本專案曾全部打 qwen3-32b，它偏偏是 TPM 最小的）。

## 實測限速表（free tier，2026-07-09）

| 模型 ID | TPM | RPD | reasoning? | 關思考的方法 | 中文/注音適性 | 定位 |
|---|---|---|---|---|---|---|
| `qwen/qwen3-32b` | **6000**（最小！） | 1000 | ✅ | ❌ 無法關 | 注音理解最佳 | 解題 stage1 首選 |
| `qwen/qwen3.6-27b` | 8000 | 1000 | ✅ | `reasoning_effort:'none'` | 注音佳 | qwen 的替補 |
| `llama-3.3-70b-versatile` | 12000 | 1000 | ❌ | 不需要 | 中文佳、注音普通 | 通用主力 |
| `meta-llama/llama-4-scout-17b-16e-instruct` | **30000**（最大） | 1000 | ❌ | 不需要 | 中文尚可 | 大 prompt 救援 |
| `openai/gpt-oss-120b` | 8000 | 1000 | ✅ | `reasoning_effort:'low'` | 中文尚可 | 替補 |
| `openai/gpt-oss-20b` | 8000 | 1000 | ✅ | `reasoning_effort:'low'` | 較弱 | 末位替補 |
| `llama-3.1-8b-instant` | 6000 | **14400** | ❌ | 不需要 | 弱 | 最後保底（RPD 超大） |

- 本帳號**沒有** kimi、deepseek 等模型（完整清單見重測方法）。
- `groq/compound*` 是含網搜的 agent 系統、`allam-2-7b` 是阿拉伯語、`whisper*` 是語音、`*prompt-guard*`/`*safeguard*` 是安全分類器——**都不要**放進遊戲用的模型鏈。
- RPM（每分鐘請求數）不出現在 headers；free tier 約 30 RPM／模型，一般不會先撞到它。

## 429 / 413 的三種長相與正確反應（決策表）

| 你看到什麼 | 意義 | 正確反應 |
|---|---|---|
| `429` + `retry-after: 2`（幾秒內） | 該模型 TPM 分鐘桶暫時滿了 | ≤2 秒可以等一下重試同模型；更長就**換下一個模型** |
| `429` + retry-after 幾分鐘～幾小時 | 該模型**每日**額度（RPD/TPD）用完 | **只能換模型**，等待毫無意義 |
| `413`，body 寫 `Request too large ... TPM: Limit 6000, Requested 8000` | 單一請求的 `est_prompt + max_tokens` 就超過該模型 TPM 上限 | 縮 prompt／降 max_tokens，或**換 TPM 更大的模型**；重試同模型永遠不會成功 |

錯誤 body 格式範例（`parseRetryAfter` 靠這個）：`... Please try again in 7.66s ...`；HTTP header 也會給 `retry-after: 8`（秒，整數）——**header 優先，body 備援**。

## Rate-limit headers 完整語義（實測值示例）

```
x-ratelimit-limit-requests: 1000        ← RPD（每日請求上限；8b-instant 是 14400）
x-ratelimit-remaining-requests: 999
x-ratelimit-reset-requests: 1m26.4s     ← 補滿 1 個請求額度所需時間（86400s/1000）
x-ratelimit-limit-tokens: 6000          ← TPM（每分鐘 token 上限）
x-ratelimit-remaining-tokens: 5990
x-ratelimit-reset-tokens: 370ms         ← 格式可能是 "370ms"、"7.66s"、"1m26.4s"
retry-after: 8                          ← 只在 429 時出現，單位秒
```

## Reasoning 模型的鐵律

1. **隱藏思考（think token）計入 completion tokens 與 TPM**。看不到 ≠ 不用錢、不佔額度。這是本專案最大宗的歷史事故來源（FAILURE-LOG FL-4）。
2. reasoning 模型 + `response_format: json_object` **必須**搭 `reasoning_format: 'hidden'` 或 `'parsed'`，否則 think 吃光預算 → `json_validate_failed` 且 failed_generation 為空。
3. `reasoning_format` / `reasoning_effort` **只能送給 reasoning 模型**；送給 llama 系列會被拒。模型鏈切換時必須按模型調整參數（`fallbackGroq.ts` 的 MODEL_CONF 負責）。
4. 對 reasoning 模型的「判斷型」任務不要吝嗇 max_tokens：思考需要空間，給 200~1024 常常正文一個字都出不來。要嘛給足（≥2048 或不設），要嘛換非 reasoning 模型。

## 中文 token 估算（估 prompt 預算用）

- 經驗值：**1 個中文字 ≈ 1.2~2 tokens**（各家 tokenizer 不同，Llama 對 CJK 較差）。
- 保守估法：`tokens ≈ 中文字數 × 1.7 + 英文單字數 × 1.3 + 50`（訊息結構開銷）。
- 預算鐵律：`est_prompt + max_tokens ≤ 該模型 TPM × 0.8`（留 20% 給同分鐘內的其他呼叫）。
- 對照：解題 prompt 曾經 ~4500 tokens 直接撞爆 6000 TPM（FL-5）。

## 免費層 vs Developer tier

- Free tier（現況）：上表數字。
- Developer tier：到 [console.groq.com](https://console.groq.com) 綁一張信用卡（不用預儲值）即解鎖，約 10 倍限速（例：llama-3.3-70b → 300K TPM / 1000 RPM）。**如果 429 持續困擾，這是成本最低的一勞永逸解**，用量少的話帳單接近 0。

## 金鑰管理

- 網頁 app 由使用者在設定頁貼上自己的 key，存 `localStorage`（key: `phantom-ink-settings`）——不經任何伺服器。
- 本機開發／腳本用環境變數 `GROQ_API_KEY`（使用者層級已設定）。
- **絕不**把 key 寫進 repo 任何檔案（`.gitignore` 已擋 `.env`、`*.key`，但真正的防線是：不要寫）。
- ⚠️ 2026-07-09 當時使用的 key 曾以明文出現在對話／終端紀錄中，建議使用者有空到 console.groq.com 重新產生（rotate）。

## 重測方法（數字過期時照做）

```bash
# 1) 完整模型清單
curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"

# 2) 單一模型的限速 headers（max_tokens=1，幾乎不耗額度）
curl -s -D - -o /dev/null -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"qwen/qwen3-32b","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' \
  | grep -iE '^HTTP|x-ratelimit|retry-after'
```

或直接跑現成腳本（會列出整張表）：`node scripts/measure-groq-limits.mjs`（需要 `GROQ_API_KEY` 環境變數）。
量完把上面的實測表與日期更新掉。
