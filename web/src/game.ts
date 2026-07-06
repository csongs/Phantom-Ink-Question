export interface GameQuestion {
  question: string;
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
  answerBoxOpen: boolean;
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
      answerBoxOpen: false,
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

  showAnswerInput(): void {
    this.state.answerBoxOpen = true;
  }

  hideAnswerInput(): void {
    this.state.answerBoxOpen = false;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the current game state into `container` and wires up button
 * handlers. Ported from `game.py`'s `GAME_HTML_TEMPLATE` render() function
 * (game.py lines 411-567) — same markup and CSS classes, driven directly by
 * `game.state` instead of a Python-injected JSON blob.
 */
export function renderGame(container: HTMLElement, game: PhantomInkGame): void {
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
    html += `<button class="pi-btn pi-btn-answer" data-action="show-answer">🎯 提交謎底</button>
      <button class="pi-btn pi-btn-oracle" data-action="open-oracle" ${oracleDisabled}>👁 老天有眼</button>
    </div></div>`;
  }

  if (!s.gameOver) {
    html += `<div class="pi-answer-box${s.answerBoxOpen ? ' open' : ''}" id="pi-answer-box">
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
    </div>`;
  }

  container.innerHTML = html;

  container.querySelector('[data-action="reveal-ink"]')?.addEventListener('click', () => {
    game.revealInk();
    renderGame(container, game);
  });
  container.querySelector('[data-action="next-question"]')?.addEventListener('click', () => {
    game.nextQuestion();
    renderGame(container, game);
  });
  container.querySelector('[data-action="finish-clues"]')?.addEventListener('click', () => {
    game.finishClues();
    renderGame(container, game);
  });
  container.querySelector('[data-action="show-answer"]')?.addEventListener('click', () => {
    game.showAnswerInput();
    renderGame(container, game);
  });
  container.querySelector('[data-action="hide-answer"]')?.addEventListener('click', () => {
    game.hideAnswerInput();
    renderGame(container, game);
  });
  container.querySelector('[data-action="submit-answer"]')?.addEventListener('click', () => {
    const input = container.querySelector<HTMLInputElement>('#pi-input');
    if (!input) return;
    game.submitAnswer(input.value);
    renderGame(container, game);
  });
  container.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
    window.location.reload();
  });

  if (s.answerBoxOpen) {
    container.querySelector<HTMLInputElement>('#pi-input')?.focus();
  }

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
        renderGame(container, game);
      });
    });
    overlay.querySelector('.pi-dialog-close')?.addEventListener('click', () => {
      overlay.remove();
    });
  });
}
