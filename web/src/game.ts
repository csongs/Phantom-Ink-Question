export interface GameQuestion {
  question: string;
  reply: string;
  cells: string[];
  total: number;
}

export interface GameState {
  currentQ: number;
  revealed: number[];
  visited: number[];
  ink: number;
  guesses: number;
  oracleCharges: number;
  oracleUsed: number;
  won: boolean;
  gameOver: boolean;
  finalRevealed: boolean;
  oracleCells: Record<number, number[]>;
}

export class PhantomInkGame {
  readonly questions: GameQuestion[];
  readonly answer: string;
  state: GameState;
  private oracleQ5Granted = false;
  private oracleFinalGranted = false;

  constructor(questions: GameQuestion[], answer: string) {
    this.questions = questions;
    this.answer = answer;
    this.state = {
      currentQ: 0,
      revealed: questions.map(() => 0),
      visited: [],
      ink: 0,
      guesses: 0,
      oracleCharges: 0,
      oracleUsed: 0,
      won: false,
      gameOver: false,
      finalRevealed: false,
      oracleCells: {},
    };
  }

  revealInk(): void {
    const s = this.state;
    if (s.gameOver || s.won) return;
    const total = this.questions[s.currentQ].total;
    if (s.revealed[s.currentQ] >= total) return;
    s.revealed[s.currentQ]++;
    s.ink++;
  }

  nextQuestion(): void {
    const s = this.state;
    if (s.gameOver) return;
    if (!s.visited.includes(s.currentQ)) s.visited.push(s.currentQ);
    if (s.currentQ + 1 < this.questions.length) {
      s.currentQ++;
      if (s.currentQ >= 4 && !this.oracleQ5Granted) {
        this.oracleQ5Granted = true;
        s.oracleCharges++;
      }
    }
  }

  finishClues(): void {
    const s = this.state;
    s.finalRevealed = true;
    if (!s.visited.includes(s.currentQ)) s.visited.push(s.currentQ);
    if (!this.oracleFinalGranted) {
      this.oracleFinalGranted = true;
      s.oracleCharges++;
    }
  }

  revealOracle(questionIndex: number): void {
    const s = this.state;
    if (s.oracleCharges <= 0) return;
    s.oracleCharges--;
    s.oracleUsed++;
    const pos = s.revealed[questionIndex];
    s.revealed[questionIndex] = Math.min(pos + 1, this.questions[questionIndex].total);
    if (!s.oracleCells[questionIndex]) s.oracleCells[questionIndex] = [];
    s.oracleCells[questionIndex].push(pos);
  }

  giveUp(): void {
    this.state.gameOver = true;
    this.state.won = false;
  }

  submitAnswer(value: string): boolean {
    const s = this.state;
    const val = value.trim();
    if (!val) return false;
    s.guesses++;
    const correct = val === this.answer;
    if (correct) {
      s.won = true;
      s.gameOver = true;
    } else {
      s.ink += 3;
    }
    return correct;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function flashCopied(container: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'pi-flash';
  el.textContent = '✅ 已複製！';
  container.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

/**
 * Build a Wordle-style share text with colored squares per question.
 * No actual answer text — safe to share.
 */
export function buildShareText(game: PhantomInkGame): string {
  const s = game.state;
  const lines: string[] = [];
  lines.push('靈媒遊戲 Phantom Ink');

  for (let i = 0; i < game.questions.length; i++) {
    const revealed = s.revealed[i];
    const total = game.questions[i].total;
    if (revealed === 0) continue;
    const green = '🟩'.repeat(revealed);
    const black = '⬛'.repeat(total - revealed);
    const oracleCount = (s.oracleCells[i] ?? []).length;
    const oracleMark = oracleCount > 0 ? ' 👁' : '';
    lines.push(`${green}${black} Q${i + 1}${oracleMark}`);
  }

  let stars = 1;
  if (s.ink <= 8 && s.guesses <= 1) stars = 5;
  else if (s.ink <= 14 && s.guesses <= 2) stars = 4;
  else if (s.ink <= 20) stars = 3;
  else stars = 2;
  const starStr = '★'.repeat(stars) + '☆'.repeat(5 - stars);

  lines.push('');
  lines.push(`🖋 ${s.ink}  🎯 ${s.guesses}${s.oracleUsed > 0 ? `  👁 ${s.oracleUsed}` : ''}  ${starStr}`);

  return lines.join('\n');
}

/**
 * Build a full share text with answer, questions, and replies.
 */
export function buildFullShareText(game: PhantomInkGame): string {
  const s = game.state;
  const lines: string[] = [];
  lines.push('靈媒遊戲 Phantom Ink');
  lines.push(`謎底：${game.answer}`);
  lines.push('');

  for (let i = 0; i < game.questions.length; i++) {
    const q = game.questions[i];
    const revealed = s.revealed[i];
    const total = q.total;
    const oracleCount = (s.oracleCells[i] ?? []).length;
    const oracleMark = oracleCount > 0 ? ' 👁' : '';
    if (revealed === 0) {
      lines.push(`Q${i + 1}：${q.question}`);
      lines.push(`   回答：${q.reply} (🔒 ${oracleMark})`);
    } else {
      const green = '🟩'.repeat(revealed);
      const black = '⬛'.repeat(total - revealed);
      lines.push(`${green}${black} Q${i + 1}：${q.question}`);
      lines.push(`   回答：${q.reply} (${revealed}/${total})${oracleMark}`);
    }
  }

  let stars = 1;
  if (s.ink <= 8 && s.guesses <= 1) stars = 5;
  else if (s.ink <= 14 && s.guesses <= 2) stars = 4;
  else if (s.ink <= 20) stars = 3;
  else stars = 2;
  const starStr = '★'.repeat(stars) + '☆'.repeat(5 - stars);

  lines.push('');
  lines.push(`🖋 ${s.ink}  🎯 ${s.guesses}${s.oracleUsed > 0 ? `  👁 ${s.oracleUsed}` : ''}  ${starStr}`);

  return lines.join('\n');
}

/**
 * Build a BLIND solving snapshot for the 解題小幫手: each seen question with its
 * currently-revealed bopomofo (or a placeholder), and crucially NO answer and
 * NO reply text. This is the exact paste format the helper consumes.
 */
export function buildSolverProgressText(game: PhantomInkGame): string {
  const s = game.state;
  const seen = [...new Set([...s.visited, s.currentQ])].sort((a, b) => a - b);
  return seen
    .map((i) => {
      const q = game.questions[i];
      const revealed = s.revealed[i];
      const clue = revealed > 0 ? q.cells.slice(0, revealed).join('') : '（尚未顯示墨水）';
      return `Q${i + 1}. ${q.question}\n${clue}`;
    })
    .join('\n\n');
}

// ── Share preview modal ──────────────────

export function renderSharePreview(root: HTMLElement, text: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'pi-overlay open';
  overlay.innerHTML = `
    <div class="pi-dialog pi-share-dialog">
      <div class="pi-dialog-title">📋 預覽分享內容</div>
      <pre class="pi-share-preview">${escapeHtml(text)}</pre>
      <div class="pi-share-actions">
        <button class="pi-btn pi-btn-green" id="pi-share-copy">📋 複製</button>
        <button class="pi-btn pi-btn-next" id="pi-share-close">關閉</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector('#pi-share-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(text).catch(() => {});
    flashCopied(overlay);
  });
  overlay.querySelector('#pi-share-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

const RULES_MODAL_HTML = `
<div class="pi-dialog pi-rules-dialog">
  <div class="pi-dialog-title">📖 遊戲說明</div>
  <div class="pi-rules-body">
    <strong>靈媒遊戲 Phantom Ink — 遊戲說明</strong><br><br>
    <strong>🎯 目標</strong><br>
    猜出謎底（一個詞語或事物）。<br><br>
    <strong>🖋 顯示墨水</strong><br>
    每按一次會顯示當前題目回答中的一個注音符號。<br>
    每顯示一格消耗 1 點墨水。<br><br>
    <strong>🎯 提交謎底</strong><br>
    隨時可以輸入答案猜測。猜錯 +3 墨水，不限次數。<br><br>
    <strong>➡ 下一題</strong><br>
    揭露部分線索後可跳到下一題。<br>
    跳過後無法再回頭顯示該題的墨水。<br><br>
    <strong>👁 老天有眼</strong><br>
    第 5 題開始獲得一次。<br>
    全部線索揭露完後可再獲得一次。<br>
    可選擇任意一題多揭露一格。<br><br>
    <strong>📜 完成線索</strong><br>
    最後一題揭露完後可「完成線索」。<br>
    之後不能再顯示墨水，但可提交謎底或使用老天有眼。<br><br>
    <strong>🏳️ 放棄／公布答案</strong><br>
    直接結束遊戲並公布謎底。<br><br>
    <strong>⭐ 評價</strong><br>
    根據墨水用量和猜測次數給予 1-5 星評價。
  </div>
  <button class="pi-dialog-close pi-rules-close">關閉</button>
</div>`;

export function showGameRules(root: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'pi-overlay open';
  overlay.innerHTML = RULES_MODAL_HTML;
  root.appendChild(overlay);
  overlay.querySelector('.pi-rules-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Game render ──────────────────────────

export function renderGame(
  container: HTMLElement,
  game: PhantomInkGame,
  root?: HTMLElement,
): void {
  const s = game.state;
  const cur = s.currentQ;
  const q = game.questions[cur];
  const r = s.revealed[cur];
  const allDone = r >= q.total;
  const isLast = cur === game.questions.length - 1;
  const canNext = !s.gameOver && !s.finalRevealed;
  const showFinish = isLast && canNext;

  let html = '<div class="pi-header">靈媒<small>Phantom Ink</small></div>';

  html += `<div class="pi-stats">
    <div class="pi-stat"><div class="pi-stat-icon">🖋</div><div class="pi-stat-val">${s.ink}</div><div class="pi-stat-lbl">墨水</div></div>
    <div class="pi-stat"><div class="pi-stat-icon">🎯</div><div class="pi-stat-val">${s.guesses}</div><div class="pi-stat-lbl">猜測</div></div>
    <div class="pi-stat"><div class="pi-stat-icon">👁</div><div class="pi-stat-val">${s.oracleCharges}</div><div class="pi-stat-lbl">天眼</div></div>
  </div>`;

  if (!s.gameOver) {
    html += `<div class="pi-q-card">
      <div class="pi-q-num">第 ${cur + 1} / ${game.questions.length} 題</div>
      <div class="pi-q-text">${escapeHtml(q.question)}</div>
      <div class="pi-tiles">`;
    for (let i = 0; i < r; i++) {
      const oracleCls = (s.oracleCells[cur] ?? []).includes(i) ? ' oracle' : '';
      html += `<div class="pi-tile revealed${oracleCls}">${q.cells[i]}</div>`;
    }
    html += '</div>';
    if (r > 0) html += `<div class="pi-ink-label">已揭露 ${r} 格 / 墨水 ${s.ink}</div>`;
    html += '</div>';
  }

  // 使用者要求:動作按鈕（顯示墨水 / 下一題 / 提交謎底 / 老天有眼 / 放棄）必須
  // 在題目卡片「正下方」,而不是被歷史 QA 區塊擠到下面。
  if (!s.gameOver) {
    const inkDisabled = allDone || s.finalRevealed ? 'disabled' : '';
    const nextDisabled = s.finalRevealed ? 'disabled' : '';
    const hasPast = cur > 0 && s.visited.length > 0;
    const oracleDisabled = s.oracleCharges <= 0 || !hasPast ? 'disabled' : '';
    html += `<div class="pi-btns">
      <div class="pi-btns-row"><button class="pi-btn pi-btn-ink" data-action="reveal-ink" ${inkDisabled}>🖋 顯示墨水</button></div>
      <div class="pi-btns-row">`;
    if (showFinish) html += '<button class="pi-btn pi-btn-finish" data-action="finish-clues">📜 完成線索</button>';
    if (!isLast && !s.finalRevealed) {
      html += `<button class="pi-btn pi-btn-next" data-action="next-question" ${nextDisabled}>➡ 下一題</button>`;
    }
    html += `<button class="pi-btn pi-btn-oracle" data-action="open-oracle" ${oracleDisabled}>👁 老天有眼</button>
    </div>
    <div class="pi-btns-row">
      <button class="pi-btn pi-btn-finish" data-action="give-up">🏳️ 放棄／公布答案</button>
    </div></div>`;
  }

  if (s.visited.length > 0) {
    html += '<div class="pi-clues">';
    for (let vi = 0; vi < s.visited.length; vi++) {
      const idx = s.visited[vi];
      const cq = game.questions[idx];
      const cr = s.revealed[idx];
      const shortQ = cq.question.length > 16 ? cq.question.slice(0, 16) + '…' : cq.question;
      const autoOpen = vi < 3 ? 'open' : '';
      let tileHtml = '';
      for (let ti = 0; ti < cr; ti++) {
        const ocCls = (s.oracleCells[idx] ?? []).includes(ti) ? ' oracle' : '';
        tileHtml += `<div class="pi-clue-tile${ocCls}">${cq.cells[ti]}</div>`;
      }
      html += `<div class="pi-clue-card">
        <div class="pi-clue-hdr">
          <span class="pi-clue-arrow ${vi < 3 ? 'open' : ''}">▶</span>
          <span>Q${idx + 1} ${escapeHtml(shortQ)}</span>
        </div>
        <div class="pi-clue-body ${autoOpen}">
          <div class="pi-clue-q">${escapeHtml(cq.question)}</div>
          <div class="pi-clue-tiles">${tileHtml}</div>
          <div class="pi-clue-ink-cnt">已揭露 ${cr} 格</div>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  if (!s.gameOver) {
    // 謎底輸入框永遠顯示、放在「🏳️ 放棄」正上方。
    // 原本要按「🎯 提交謎底」才開啟的彈出流程被移除 — 玩家直接在這裡打字、
    // 旁邊按「送出」即可。結構上的小調整,UX 不變。
    html += `<div class="pi-answer-box open" id="pi-answer-box">
      <input id="pi-input" placeholder="輸入謎底…">
      <div class="pi-answer-actions">
        <button class="pi-btn pi-btn-answer" data-action="submit-answer">送出</button>
        <button class="pi-btn pi-btn-next" data-action="hide-answer">取消</button>
      </div>
    </div>`;
  }

  let doneCount = s.visited.length + (s.finalRevealed ? 1 : 0);
  if (s.gameOver) doneCount = game.questions.length;
  if (doneCount > 0) {
    const pct = Math.round((doneCount / game.questions.length) * 100);
    html += `<div class="pi-progress">
      <span>進度</span>
      <div class="pi-progress-bar"><div class="pi-progress-fill" style="width:${pct}%"></div></div>
      <span>${doneCount}/${game.questions.length}</span>
    </div>`;
  }

  if (s.gameOver) {
    let stars = 1;
    if (s.ink <= 8 && s.guesses <= 1) stars = 5;
    else if (s.ink <= 14 && s.guesses <= 2) stars = 4;
    else if (s.ink <= 20) stars = 3;
    else stars = 2;
    const starStr = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    let ratingWord = '';
    if (s.won) {
      if (stars >= 5) ratingWord = '天才級表現！';
      else if (stars >= 4) ratingWord = '非常厲害！';
      else if (stars >= 3) ratingWord = '表現不錯！';
      else ratingWord = '驚險過關！';
    }
    const ratingHtml = ratingWord ? `<div class="pi-result-rating">${ratingWord}</div>` : '';
    html += `<div class="pi-result">
      <div class="pi-result-icon">${s.won ? '🎉' : '😢'}</div>
      <div class="pi-result-title">${s.won ? '猜對了！' : '遊戲結束'}</div>
      ${ratingHtml}
      <div class="pi-result-grid">
        <div class="pi-result-stat"><div class="pi-result-stat-val">${s.ink}</div><div class="pi-result-stat-lbl">墨水</div></div>
        <div class="pi-result-stat"><div class="pi-result-stat-val">${s.guesses}</div><div class="pi-result-stat-lbl">猜測</div></div>
        <div class="pi-result-stat"><div class="pi-result-stat-val">${s.oracleUsed}</div><div class="pi-result-stat-lbl">天眼</div></div>
      </div>
      <div class="pi-result-stars">${starStr}</div>
      <div class="pi-result-answer">謎底：<strong>${escapeHtml(game.answer)}</strong></div>
      <button class="pi-restart" data-action="restart">再來一題</button>
      <div class="pi-share-row">
        <button class="pi-btn pi-btn-share" data-action="share-blind">📋 不暴雷</button>
        <button class="pi-btn pi-btn-share" data-action="share-full">📋 含解答</button>
      </div>
    </div>`;
  }

  // Utility bar (always visible during game)
  if (!s.gameOver) {
    html += `<div class="pi-help-bar">
      <button class="pi-btn-help" data-action="solver">🔍 解題小幫手</button>
      <button class="pi-btn-help" data-action="show-help">📖 規則</button>
    </div>`;
  }

  container.innerHTML = html;

  container.querySelector('[data-action="reveal-ink"]')?.addEventListener('click', () => {
    game.revealInk();
    renderGame(container, game, root);
  });
  container.querySelector('[data-action="next-question"]')?.addEventListener('click', () => {
    game.nextQuestion();
    renderGame(container, game, root);
  });
  container.querySelector('[data-action="finish-clues"]')?.addEventListener('click', () => {
    game.finishClues();
    renderGame(container, game, root);
  });
  container.querySelector('[data-action="hide-answer"]')?.addEventListener('click', () => {
    // 「取消」= 清空輸入框(因為輸入框永遠顯示,「關閉」沒有意義)。
    const input = container.querySelector<HTMLInputElement>('#pi-input');
    if (input) input.value = '';
  });
  container.querySelector('[data-action="submit-answer"]')?.addEventListener('click', () => {
    const input = container.querySelector<HTMLInputElement>('#pi-input');
    if (!input) return;
    game.submitAnswer(input.value);
    renderGame(container, game, root);
  });
  container.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
    window.location.reload();
  });

  container.querySelector('[data-action="share-blind"]')?.addEventListener('click', () => {
    const text = buildShareText(game);
    if (root) renderSharePreview(root, text);
    else { navigator.clipboard.writeText(text).catch(() => {}); flashCopied(container); }
  });

  container.querySelector('[data-action="share-full"]')?.addEventListener('click', () => {
    const text = buildFullShareText(game);
    if (root) renderSharePreview(root, text);
    else { navigator.clipboard.writeText(text).catch(() => {}); flashCopied(container); }
  });

  container.querySelector('[data-action="give-up"]')?.addEventListener('click', () => {
    game.giveUp();
    renderGame(container, game, root);
  });

  container.querySelector('[data-action="show-help"]')?.addEventListener('click', () => {
    if (root) showGameRules(root);
  });

  // Open the standalone solving helper, pre-filled with the current BLIND
  // progress. Dispatched as an event so game.ts stays free of settings/backend.
  container.querySelector('[data-action="solver"]')?.addEventListener('click', () => {
    (root ?? container).dispatchEvent(
      new CustomEvent('pi-open-solver', { detail: buildSolverProgressText(game), bubbles: true }),
    );
  });

  container.querySelectorAll<HTMLElement>('.pi-clue-hdr').forEach((hdr) => {
    hdr.addEventListener('click', () => {
      const arrow = hdr.querySelector('.pi-clue-arrow');
      const body = hdr.nextElementSibling;
      if (body) {
        body.classList.toggle('open');
        arrow?.classList.toggle('open');
      }
    });
  });

  container.querySelector('[data-action="open-oracle"]')?.addEventListener('click', () => {
    if (s.oracleCharges <= 0) return;
    const past: number[] = [];
    for (let i = 0; i < cur; i++) past.push(i);
    if (s.finalRevealed) past.push(cur);
    if (past.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'pi-overlay open';
    const optsHtml = past
      .map((i) => {
        const label = game.questions[i].question.slice(0, 22);
        return `<button class="pi-dialog-opt" data-idx="${i}">Q${i + 1}：${escapeHtml(label)}</button>`;
      })
      .join('');
    overlay.innerHTML = `<div class="pi-dialog">
      <div class="pi-dialog-title">👁 選擇要揭露哪一題</div>
      ${optsHtml}
      <button class="pi-dialog-close">取消</button>
    </div>`;
    container.appendChild(overlay);

    overlay.querySelectorAll<HTMLButtonElement>('.pi-dialog-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        game.revealOracle(idx);
        overlay.remove();
        renderGame(container, game, root);
      });
    });
    overlay.querySelector('.pi-dialog-close')?.addEventListener('click', () => {
      overlay.remove();
    });
  });
}
