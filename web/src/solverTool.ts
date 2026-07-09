// web/src/solverTool.ts
//
// 共用的「解謎小幫手」結果 HTML 化工具。目錄頁與遊戲內 overlay 都用同一份。
import { escapeHtml } from './game';
import type { SolveResult } from './solver';

export function describeSolveResultHtml(result: SolveResult): string {
  const perQ = result.perQuestion.length
    ? `<h4>各題線索推測</h4><ul class="pi-solver-perq">${result.perQuestion
        .map(
          (p) =>
            `<li><span class="pi-solver-q">Q${p.q}</span> → <strong>${escapeHtml(
              p.replyGuess || '？',
            )}</strong>${p.note ? `<div class="pi-solver-note">${escapeHtml(p.note)}</div>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '';

  const finals = result.finalGuesses.length
    ? `<h4>謎底候選（最可能在前）</h4><ol class="pi-solver-finals">${result.finalGuesses
        .map(
          (f) =>
            `<li><strong>${escapeHtml(f.answer)}</strong>${
              f.reason ? `<div class="pi-solver-note">${escapeHtml(f.reason)}</div>` : ''
            }</li>`,
        )
        .join('')}</ol>`
    : '<p class="pi-solver-empty">（沒有得到謎底候選，可再多開一些注音後重試）</p>';

  const summary = result.summary
    ? `<h4>整體思路</h4><p class="pi-solver-summary">${escapeHtml(result.summary)}</p>`
    : '';

  return perQ + finals + summary;
}
