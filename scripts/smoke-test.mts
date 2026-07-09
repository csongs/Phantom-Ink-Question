/**
 * Smoke test for the Groq fallback chain.
 *
 * Uses exactly the same fallbackGroq module as the web app, but runs from
 * Node.js (via vite-node or tsx). Run before deploying to catch API-level
 * breakage (model renames, endpoint changes, auth failures).
 *
 * Usage:
 *   export GROQ_API_KEY=gsk_...
 *   npx vite-node scripts/smoke-test.mts
 *
 * Or via tsx:
 *   npx tsx scripts/smoke-test.mts
 *
 * The test generates a 1-question puzzle for answer "鋼琴" and reports which
 * model in the chain actually handled the request.
 */
import { GroqFallbackBackend, CHAINS } from '../web/src/backends/fallbackGroq';
import { PhantomInkGenerator } from '../web/src/generator/generator';

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) {
  console.error('❌ 請設定 GROQ_API_KEY 環境變數');
  process.exit(1);
}

async function main() {
  console.log('🔍 冒煙測試：Groq fallback 鏈迷你出題\n');
  console.log(`模型鏈：${CHAINS.generator.join(' → ')}\n`);

  const events: string[] = [];
  const backend = new GroqFallbackBackend(API_KEY, CHAINS.generator, {
    onEvent: (msg) => {
      events.push(msg);
      console.log(`  ${msg}`);
    },
  });

  const generator = new PhantomInkGenerator(backend);

  console.log('📝 生成 1 題謎底為「鋼琴」的題組⋯⋯\n');
  const result = await generator.generate({
    answer: '鋼琴',
    answerMode: 'human',
    numQuestions: 1,
    skipReview: true,
    skipSimulation: true,
  });

  console.log('');
  if (result.questions[0]?.reply && result.questions[0].reply !== '（生成失敗）') {
    console.log(`✅ 成功！`);
    console.log(`   謎底：${result.answer}`);
    console.log(`   題目：${result.questions[0].question}`);
    console.log(`   回答：${result.questions[0].reply}`);
    console.log(`   使用的模型：${backend.lastUsedModel ?? '未知'}`);
    process.exit(0);
  } else {
    console.error(`❌ 失敗：${result.questions[0]?.reply ?? '無結果'}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ 冒煙測試失敗：', err);
  process.exit(1);
});
