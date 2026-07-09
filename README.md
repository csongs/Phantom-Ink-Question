# Phantom Ink Question Generator

AI 驅動的「靈媒遊戲」（Phantom Ink）題目生成與解題輔助工具。

> **專案入口**：`CLAUDE.md` — 依任務路由到對應文件。

## 專案結構

```
web/          ← 主要 app（Vite + TypeScript + vitest，純前端、無伺服器）
docs/         ← 制度文件（品質規則、LLM 政策、工程指引等）
scripts/      ← Groq 限速測量腳本
*.py（根目錄） ← 早期 Python 原型，僅供參考
```

## 開始使用

```bash
cd web
npm install
npm run dev        # 開發伺服器 → http://localhost:5173
npm test           # 單元測試
npm run build      # 型別檢查 + 生產建置
```

## 設定

1. 開啟 `http://localhost:5173`
2. 在設定頁貼入你的 Groq API Key（存於瀏覽器 localStorage）
3. 選擇謎底（或隨機選題），點擊生成題目

## 關鍵技術

- **出題**：三階段流程（生成 → 驗證 → 模擬），品質規則見 `docs/QUESTION-QUALITY.md`
- **LLM 呼叫**：全部經由 `fallbackGroq.ts` 模型鏈，遇到 429 自動換模型，見 `docs/LLM-RESILIENCE.md`
- **解題器**：兩階段 AI 推理（注音解讀 → 謎底推測），見 `web/src/solver.ts`
- **注音轉換**：回答自動轉注音，支援 BoPoMoFo

## 相關文件

| 你想做的事 | 請讀 |
|---|---|
| 改 LLM/Groq 相關程式 | `docs/LLM-RESILIENCE.md` |
| 改出題/驗題規則 | `docs/QUESTION-QUALITY.md` |
| 跑起來、測試、驗收 | `docs/ENGINEERING.md` |
| 待辦事項與已知風險 | `docs/BACKLOG.md` |
