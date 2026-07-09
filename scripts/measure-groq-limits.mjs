#!/usr/bin/env node
// scripts/measure-groq-limits.mjs
//
// 重測 Groq 各聊天模型的限速（TPM / RPD）。什麼時候跑：
//   - 收到 404（模型下架）或懷疑限速數字過期時
//   - 調整 web/src/backends/fallbackGroq.ts 的模型鏈之前（必跑）
// 用法（需 Node 18+，GROQ_API_KEY 已設在使用者環境變數）：
//   node scripts/measure-groq-limits.mjs
// 量完之後：更新 docs/GROQ-NOTES.md 的實測表（含日期）與 fallbackGroq.ts 的 MODEL_CONF。

const KEY = process.env.GROQ_API_KEY;
if (!KEY) {
  console.error('請先設定 GROQ_API_KEY 環境變數（PowerShell: $env:GROQ_API_KEY = "gsk_..."）');
  process.exit(1);
}

// 語音/安全分類/agent 系統等非聊天模型，不屬於遊戲模型鏈。
const EXCLUDE = /whisper|guard|safeguard|compound|allam|orpheus|tts/i;

const listRes = await fetch('https://api.groq.com/openai/v1/models', {
  headers: { Authorization: `Bearer ${KEY}` },
});
if (!listRes.ok) {
  console.error(`/models 失敗 HTTP ${listRes.status}: ${await listRes.text()}`);
  process.exit(1);
}
const list = await listRes.json();
const models = list.data.map((m) => m.id).filter((id) => !EXCLUDE.test(id)).sort();
console.log(`共 ${models.length} 個聊天模型，逐一探測（每個模型只花 1 個 token）⋯⋯`);

const rows = [];
for (const id of models) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: id,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    }),
  });
  const h = (n) => res.headers.get(n) ?? '-';
  rows.push({
    model: id,
    status: res.status,
    TPM: h('x-ratelimit-limit-tokens'),
    RPD: h('x-ratelimit-limit-requests'),
    remaining_tokens: h('x-ratelimit-remaining-tokens'),
  });
  await new Promise((r) => setTimeout(r, 300));
}

console.table(rows);
console.log('\n下一步：');
console.log('1. 更新 docs/GROQ-NOTES.md 的「實測限速表」（記得改日期）');
console.log('2. 對照 web/src/backends/fallbackGroq.ts 的 MODEL_CONF：tpm 數字、模型是否下架');
console.log('3. status 非 200 的模型：404=下架（從鏈中移除）、429=額度用盡（稍後再測）');
