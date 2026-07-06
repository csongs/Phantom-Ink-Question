"""
Phantom Ink 互動試玩遊戲

支援兩種模式：
- CLI 模式（play_game）：以文字介面遊玩
- Colab HTML 模式（play_colab_game）：以 HTML/JS 渲染的互動遊戲
"""

from models import QuestionSet, QuestionSetWithMeta
from bopomofo import to_bopomofo_cells

# ── CLI 模式 ──────────────────────────────

def _status_bar(ink: int, guesses: int) -> str:
    bar = "▌"
    bar += f" 墨水：{ink}  "
    bar += f"│ 已猜測：{guesses} 次  "
    bar += f"│ [Enter]揭露  [輸入]猜測  [q]離開"
    bar += "▐"
    return bar


def play_game(data: QuestionSet | QuestionSetWithMeta) -> dict:
    """互動試玩：逐題揭露注音，讓玩家猜謎底。"""
    qs = data if isinstance(data, QuestionSet) else QuestionSet(
        answer=data.answer, questions=data.questions
    )

    total_questions = len(qs.questions)
    ink = 0
    total_guesses = 0
    won = False
    revealed_per_q = [0] * total_questions

    print("\n" + "=" * 50)
    print("  靈媒遊戲 — Phantom Ink 試玩")
    print("=" * 50)
    print(f"  謎底：{'*' * len(qs.answer)} ({len(qs.answer)}字)")
    print(f"  題數：{total_questions} 題")
    print("=" * 50)
    print("  規則：揭露每格 +1 墨水，猜錯 +3 墨水")
    print("=" * 50)

    for q_idx, q_item in enumerate(qs.questions):
        cells = to_bopomofo_cells(q_item.reply)
        total_cells = len(cells)

        print(f"\n{'─' * 50}")
        print(f"  Q{q_idx + 1}. {q_item.question}")
        print(f"{'─' * 50}")
        print(f"  {_status_bar(ink, total_guesses)}")

        if total_cells == 0:
            print("  （此題無注音可揭露）")
            continue

        while revealed_per_q[q_idx] < total_cells:
            revealed = revealed_per_q[q_idx]
            display = " ".join(
                cells[:revealed] + ["▢"] * (total_cells - revealed)
            ) if revealed > 0 else "（尚未顯示墨水）"

            print(f"\n  注音：{display}")
            inp = input("\n  ▶ ").strip()

            if inp.lower() == "q":
                print(f"\n  謎底是：{qs.answer}")
                return {"ink": ink, "guesses": total_guesses, "won": won}

            if inp == "":
                revealed_per_q[q_idx] += 1
                ink += 1
            else:
                total_guesses += 1
                if inp == qs.answer:
                    won = True
                    revealed_per_q[q_idx] = total_cells
                    display = " ".join(cells)
                    print(f"\n  注音：{display}")
                    print(f"  🎉 答對了！謎底就是「{qs.answer}」！")
                    print(f"  {_status_bar(ink, total_guesses)}")
                    return {"ink": ink, "guesses": total_guesses, "won": won}
                else:
                    ink += 3
                    print(f"  ✗ 不對喔（+3 墨水）")

            print(f"  {_status_bar(ink, total_guesses)}")

        display = " ".join(cells)
        print(f"\n  注音：{display}")

        if q_idx < total_questions - 1:
            print(f"\n  這題已全部揭露。[Enter]進下一題，或輸入答案猜測。")
            inp = input("\n  ▶ ").strip()
            if inp:
                total_guesses += 1
                if inp == qs.answer:
                    won = True
                    print(f"\n  🎉 答對了！謎底就是「{qs.answer}」！")
                    print(f"  {_status_bar(ink, total_guesses)}")
                    return {"ink": ink, "guesses": total_guesses, "won": won}
                else:
                    ink += 3
                    print(f"  ✗ 不對喔（+3 墨水）")
                    print(f"  {_status_bar(ink, total_guesses)}")

    print(f"\n{'=' * 50}")
    print(f"  題目全部出完了！")
    print(f"  謎底是：「{qs.answer}」")
    print(f"  {_status_bar(ink, total_guesses)}")
    return {"ink": ink, "guesses": total_guesses, "won": won}


# ── Colab HTML 模式 ─────────────────────────

def _embed_cells_data(qs: QuestionSet) -> list[dict]:
    """將題目轉為前端的 cells 資料（句號算一格）"""
    result = []
    for q in qs.questions:
        cells = to_bopomofo_cells(q.reply)
        # 回答固定以句號結尾，句號也算一格墨水
        if q.reply.rstrip().endswith("。"):
            cells.append("。")
        result.append({
            "question": q.question,
            "cells": cells,
            "total": len(cells),
        })
    return result


GAME_HTML_TEMPLATE = """<div id="pi-game"></div>
<style>
#pi-game {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  max-width: 520px; margin: 0 auto; padding: 20px 16px 32px;
  color: #d7dadc; background: #121213; border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5); user-select: none;
}
#pi-game * { box-sizing: border-box; margin: 0; padding: 0; }
.pi-header { text-align: center; font-size: 28px; font-weight: 800; color: #c084fc; letter-spacing: 6px; padding: 8px 0 18px; font-family: 'Noto Sans TC','Segoe UI',sans-serif; }
.pi-header small { display: block; font-size: 11px; font-weight: 400; color: #666; letter-spacing: 2px; margin-top: 2px; }
.pi-stats { display: flex; gap: 4px; margin-bottom: 16px; justify-content: center; }
.pi-stat { background: #1a1a2e; border-radius: 8px; padding: 8px 16px; text-align: center; min-width: 70px; }
.pi-stat-icon { font-size: 16px; }
.pi-stat-val { font-size: 22px; font-weight: 700; color: #c084fc; }
.pi-stat-lbl { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
.pi-q-card { background: #1a1a2e; border-radius: 12px; padding: 18px; margin-bottom: 14px; border: 1px solid rgba(192,132,252,0.12); }
.pi-q-num { font-size: 11px; color: #666; letter-spacing: 1px; margin-bottom: 8px; }
.pi-q-text { font-size: 16px; font-weight: 600; line-height: 1.6; margin-bottom: 14px; color: #f0f0f0; }
/* Wordle-style tiles */
.pi-tiles { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; min-height: 48px; padding: 4px 0; }
.pi-tile { width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; border-radius: 4px; transition: background 0.2s; border: 2px solid #3a3a3c; background: transparent; color: transparent; }
.pi-tile.revealed { border-color: #c084fc; background: #2d1f5e; color: #c084fc; animation: tileFlip 0.4s ease; }
@keyframes tileFlip {
  0% { transform: rotateX(0deg); border-color: #3a3a3c; background: transparent; color: transparent; }
  40% { transform: rotateX(-90deg); border-color: #3a3a3c; background: transparent; color: transparent; }
  100% { transform: rotateX(0deg); border-color: #c084fc; background: #2d1f5e; color: #c084fc; }
}
.pi-ink-label { text-align: center; font-size: 11px; color: #666; margin-top: 8px; }
/* Past clues */
.pi-clues { margin-bottom: 14px; }
.pi-clue-card { background: #1a1a2e; border-radius: 10px; margin-bottom: 6px; border: 1px solid rgba(192,132,252,0.08); overflow: hidden; }
.pi-clue-hdr { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; font-size: 13px; color: #888; transition: background 0.2s; }
.pi-clue-hdr:hover { background: rgba(192,132,252,0.06); }
.pi-clue-arrow { transition: transform 0.2s; font-size: 11px; }
.pi-clue-arrow.open { transform: rotate(90deg); }
.pi-clue-body { padding: 0 14px 12px; display: none; }
.pi-clue-body.open { display: block; }
.pi-clue-q { font-size: 13px; margin-bottom: 6px; }
.pi-clue-tiles { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.pi-clue-tile { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600; border-radius: 4px; border: 2px solid #3a3a3c; background: #2d1f5e; color: #c084fc; }
.pi-clue-ink-cnt { font-size: 11px; color: #666; margin-top: 4px; }
/* Buttons */
.pi-btns { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; justify-content: center; }
.pi-btn { padding: 10px 14px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.pi-btn:disabled { opacity: 0.25; cursor: default; transform: none !important; }
.pi-btn:hover:not(:disabled) { filter: brightness(1.15); }
.pi-btn:active:not(:disabled) { transform: scale(0.96); }
.pi-btn-ink { background: #3b82f6; color: #fff; }
.pi-btn-next { background: #374151; color: #ccc; }
.pi-btn-finish { background: #d97706; color: #fff; }
.pi-btn-answer { background: #22c55e; color: #fff; }
.pi-btn-oracle { background: #7c3aed; color: #fff; }
/* Answer input */
.pi-answer-box { background: #1a1a2e; border-radius: 12px; padding: 16px; margin-bottom: 14px; display: none; border: 1px solid rgba(192,132,252,0.12); }
.pi-answer-box.open { display: block; }
.pi-answer-box input { width: 100%; padding: 12px 14px; border: 2px solid #3a3a3c; border-radius: 8px; font-size: 18px; background: #121213; color: #d7dadc; outline: none; margin-bottom: 10px; text-align: center; letter-spacing: 4px; transition: border-color 0.2s; }
.pi-answer-box input:focus { border-color: #7c3aed; }
.pi-answer-actions { display: flex; gap: 8px; justify-content: center; }
/* Oracle overlay */
.pi-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; display: none; }
.pi-overlay.open { display: flex; }
.pi-dialog { background: #121213; border-radius: 14px; padding: 24px; max-width: 340px; width: 90%; border: 1px solid rgba(192,132,252,0.25); }
.pi-dialog-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; text-align: center; color: #c084fc; }
.pi-dialog-opt { display: block; width: 100%; padding: 10px 14px; margin-bottom: 6px; background: #1a1a2e; border: 1px solid rgba(192,132,252,0.12); border-radius: 8px; color: #d7dadc; cursor: pointer; text-align: left; font-size: 13px; transition: background 0.15s; }
.pi-dialog-opt:hover { background: #2d1f5e; }
.pi-dialog-close { display: block; margin: 10px auto 0; padding: 6px 20px; background: #3a3a3c; border: none; border-radius: 6px; color: #888; cursor: pointer; font-size: 12px; }
/* Notif */
.pi-notif { background: rgba(124,58,237,0.15); border: 1px solid rgba(192,132,252,0.25); border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; color: #c084fc; text-align: center; animation: fadeIn 0.3s ease; }
@keyframes fadeIn { 0% { opacity:0; transform:translateY(-6px); } 100% { opacity:1; transform:translateY(0); } }
/* Oracle flash */
.pi-flash { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); background: rgba(124,58,237,0.95); color: #fff; padding: 18px 28px; border-radius: 12px; font-size: 16px; font-weight: 600; z-index: 999; animation: flashAnim 1.4s ease forwards; pointer-events: none; }
@keyframes flashAnim { 0% { opacity:0; transform:translate(-50%,-50%) scale(0.8); } 15% { opacity:1; transform:translate(-50%,-50%) scale(1); } 75% { opacity:1; } 100% { opacity:0; transform:translate(-50%,-50%) scale(0.9); } }
/* Results */
.pi-result { text-align: center; padding: 24px 16px; }
.pi-result-icon { font-size: 44px; margin-bottom: 10px; }
.pi-result-title { font-size: 22px; font-weight: 700; margin-bottom: 16px; color: #c084fc; }
.pi-result-grid { display: flex; gap: 8px; justify-content: center; margin-bottom: 20px; }
.pi-result-stat { background: #1a1a2e; border-radius: 10px; padding: 12px 18px; text-align: center; min-width: 80px; }
.pi-result-stat-val { font-size: 26px; font-weight: 700; color: #c084fc; }
.pi-result-stat-lbl { font-size: 10px; color: #666; margin-top: 2px; }
.pi-result-stars { font-size: 26px; letter-spacing: 3px; margin-bottom: 16px; }
.pi-result-answer { margin-bottom: 16px; font-size: 14px; color: #888; }
.pi-result-answer strong { color: #c084fc; font-weight: 700; font-size: 16px; }
.pi-restart { display: inline-block; padding: 12px 32px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; background: #7c3aed; color: #fff; cursor: pointer; transition: background 0.2s; }
.pi-restart:hover { background: #6d28d9; }
/* Progress bar */
.pi-progress { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; color: #666; }
.pi-progress-bar { flex: 1; height: 4px; background: #1a1a2e; border-radius: 2px; overflow: hidden; }
.pi-progress-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #c084fc); border-radius: 2px; transition: width 0.4s ease; }
</style>
<script>
(function(){
var questions = __QUESTIONS__;
var ANSWER = __ANSWER__;
var Q_COUNT = questions.length;

var state = {
  currentQ: 0,
  revealed: questions.map(function(){return 0;}),
  visited: [],
  ink: 0,
  guesses: 0,
  oracleCharges: 0,
  oracleUsed: 0,
  won: false,
  gameOver: false,
  oracleQ5Granted: false,
  oracleFinalGranted: false,
  finalRevealed: false,
  notifMsg: '',
};

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── Core actions ──

window.revealInk = function(){
  if(state.gameOver||state.won) return;
  var r = state.revealed[state.currentQ];
  var t = questions[state.currentQ].total;
  if(r>=t) return;
  state.revealed[state.currentQ]++;
  state.ink++;
  render();
}

window.nextQuestion = function(){
  if(state.gameOver) return;
  if(state.visited.indexOf(state.currentQ)<0) state.visited.push(state.currentQ);
  if(state.currentQ+1<Q_COUNT){
    state.currentQ++;
    if(state.currentQ>=4 && !state.oracleQ5Granted){
      state.oracleQ5Granted=true;
      state.oracleCharges++;
      state.notifMsg='👁 獲得「老天有眼」！可選擇過往任一答案多揭露一格';
    }
  }
  render();
}

window.finishClues = function(){
  state.finalRevealed=true;
  if(state.visited.indexOf(state.currentQ)<0) state.visited.push(state.currentQ);
  if(!state.oracleFinalGranted){
    state.oracleFinalGranted=true;
    state.oracleCharges++;
    state.notifMsg='👁 獲得第二個「老天有眼」！';
  }
  render();
}

window.submitAnswer = function(){
  var inp = document.getElementById('pi-input');
  if(!inp) return;
  var val = inp.value.trim();
  if(!val) return;
  state.guesses++;
  if(val===ANSWER){
    state.won=true;
    state.gameOver=true;
  } else {
    state.ink+=3;
    inp.value='';
    inp.focus();
    inp.style.borderColor='#ef4444';
    setTimeout(function(){inp.style.borderColor='#3a3a3c';},600);
  }
  render();
}

window.showAnswerInput = function(){
  document.getElementById('pi-answer-box').classList.add('open');
  setTimeout(function(){
    var inp=document.getElementById('pi-input');
    if(inp) inp.focus();
  },100);
}

window.hideAnswerInput = function(){
  document.getElementById('pi-answer-box').classList.remove('open');
}

window.openOracle = function(){
  if(state.oracleCharges<=0) return;
  var past = [];
  for(var i=0;i<state.currentQ;i++) past.push(i);
  if(state.finalRevealed) past.push(state.currentQ);
  if(past.length===0) return;
  var opts = past.map(function(i){
    return '<button class="pi-dialog-opt" onclick="doOracleReveal('+i+')">Q'+(i+1)+'：'+esc(questions[i].question.slice(0,22))+'</button>';
  }).join('');
  var div = document.createElement('div');
  div.className='pi-overlay open';
  div.id='pi-overlay';
  div.innerHTML=
    '<div class="pi-dialog">'+
      '<div class="pi-dialog-title">👁 選擇要揭露哪一題</div>'+
      opts+
      '<button class="pi-dialog-close" onclick="closeOracle()">取消</button>'+
    '</div>';
  document.getElementById('pi-game').appendChild(div);
}

window.closeOracle = function(){
  var el=document.getElementById('pi-overlay');
  if(el) el.remove();
}

window.doOracleReveal = function(idx){
  state.oracleCharges--;
  state.oracleUsed++;
  state.revealed[idx]=Math.min(state.revealed[idx]+1,questions[idx].total);
  state.ink++;
  closeOracle();
  var cell=questions[idx].cells[state.revealed[idx]-1];
  var flash=document.createElement('div');
  flash.className='pi-flash';
  flash.textContent='Q'+(idx+1)+' 揭露：'+(cell||'。');
  document.getElementById('pi-game').appendChild(flash);
  setTimeout(function(){flash.remove();},1400);
  render();
}

window.toggleClue = function(el){
  var arrow=el.querySelector('.pi-clue-arrow');
  var body=el.nextElementSibling;
  if(body){body.classList.toggle('open');arrow.classList.toggle('open');}
}

// ── Render ──

function render(){
  var cur=state.currentQ;
  var r=state.revealed[cur];
  var q=questions[cur];
  var allDone=r>=q.total;
  var isLast=cur===Q_COUNT-1;
  var canNext = !state.gameOver && !state.finalRevealed;
  var showFinish = isLast && canNext;
  var pastVisited = state.visited.length;
  var hasPast = cur>0 && pastVisited>0;

  var html='<div class="pi-header">靈媒<small>Phantom Ink</small></div>';

  // Stats row
  html+='<div class="pi-stats">'+
    '<div class="pi-stat"><div class="pi-stat-icon">🖋</div><div class="pi-stat-val">'+state.ink+'</div><div class="pi-stat-lbl">墨水</div></div>'+
    '<div class="pi-stat"><div class="pi-stat-icon">🎯</div><div class="pi-stat-val">'+state.guesses+'</div><div class="pi-stat-lbl">猜測</div></div>'+
    '<div class="pi-stat"><div class="pi-stat-icon">👁</div><div class="pi-stat-val">'+state.oracleCharges+'</div><div class="pi-stat-lbl">天眼</div></div>'+
  '</div>';

  // Notification
  if(state.notifMsg){
    html+='<div class="pi-notif">'+state.notifMsg+'</div>';
    state.notifMsg='';
  }

  // Question card
  if(!state.gameOver){
    html+='<div class="pi-q-card">'+
      '<div class="pi-q-num">第 '+(cur+1)+' / '+Q_COUNT+' 題</div>'+
      '<div class="pi-q-text">'+esc(q.question)+'</div>'+
      '<div class="pi-tiles">';
    for(var i=0;i<r;i++){
      html+='<div class="pi-tile revealed">'+q.cells[i]+'</div>';
    }
    html+='</div>';
    if(r>0){
      html+='<div class="pi-ink-label">已揭露 '+r+' 格 / 墨水 '+state.ink+'</div>';
    }
    html+='</div>';
  }

  // Past clues
  if(pastVisited>0){
    html+='<div class="pi-clues">';
    for(var vi=0;vi<state.visited.length;vi++){
      var idx=state.visited[vi];
      var cq=questions[idx];
      var cr=state.revealed[idx];
      var shortQ=cq.question.length>16?cq.question.slice(0,16)+'…':cq.question;
      var autoOpen=vi<3?'open':'';
      var tileHtml='';
      for(var ti=0;ti<cr;ti++){
        tileHtml+='<div class="pi-clue-tile">'+cq.cells[ti]+'</div>';
      }
      html+='<div class="pi-clue-card">'+
        '<div class="pi-clue-hdr" onclick="toggleClue(this)">'+
          '<span class="pi-clue-arrow '+(vi<3?'open':'')+'">▶</span>'+
          '<span>Q'+(idx+1)+' '+esc(shortQ)+'</span>'+
        '</div>'+
        '<div class="pi-clue-body '+autoOpen+'">'+
          '<div class="pi-clue-q">'+esc(cq.question)+'</div>'+
          '<div class="pi-clue-tiles">'+tileHtml+'</div>'+
          '<div class="pi-clue-ink-cnt">已揭露 '+cr+' 格</div>'+
        '</div>'+
      '</div>';
    }
    html+='</div>';
  }

  // Buttons
  if(!state.gameOver){
    var inkDisabled=(allDone||state.finalRevealed)?'disabled':'';
    var nextDisabled=(state.finalRevealed)?'disabled':'';
    var oracleDisabled=(state.oracleCharges<=0||hasPast===false)?'disabled':'';
    html+='<div class="pi-btns">'+
      '<button class="pi-btn pi-btn-ink" onclick="revealInk()" '+inkDisabled+'>🖋 顯示墨水</button>';
    if(showFinish){
      html+='<button class="pi-btn pi-btn-finish" onclick="finishClues()">📜 完成線索</button>';
    }
    if(!isLast && !state.finalRevealed){
      html+='<button class="pi-btn pi-btn-next" onclick="nextQuestion()" '+nextDisabled+'>➡ 下一題</button>';
    }
    html+='<button class="pi-btn pi-btn-answer" onclick="showAnswerInput()">🎯 提交謎底</button>'+
      '<button class="pi-btn pi-btn-oracle" onclick="openOracle()" '+oracleDisabled+'>👁 老天有眼</button>'+
    '</div>';
  }

  // Answer input
  if(!state.gameOver){
    html+='<div class="pi-answer-box" id="pi-answer-box">'+
      '<input id="pi-input" placeholder="輸入謎底…" onkeydown="if(event.key===\\'Enter\\')submitAnswer()">'+
      '<div class="pi-answer-actions">'+
        '<button class="pi-btn pi-btn-answer" onclick="submitAnswer()">送出</button>'+
        '<button class="pi-btn pi-btn-next" onclick="hideAnswerInput()">取消</button>'+
      '</div>'+
    '</div>';
  }

  // Progress
  var doneCount=state.visited.length+(state.finalRevealed?1:0);
  if(state.gameOver) doneCount=Q_COUNT;
  if(doneCount>0){
    var pct=Math.round((doneCount/Q_COUNT)*100);
    html+='<div class="pi-progress">'+
      '<span>進度</span>'+
      '<div class="pi-progress-bar"><div class="pi-progress-fill" style="width:'+pct+'%"></div></div>'+
      '<span>'+doneCount+'/'+Q_COUNT+'</span>'+
    '</div>';
  }

  // Result
  if(state.gameOver){
    var stars=1;
    if(state.ink<=8&&state.guesses<=1) stars=5;
    else if(state.ink<=14&&state.guesses<=2) stars=4;
    else if(state.ink<=20) stars=3;
    else stars=2;
    var starStr='★'.repeat(stars)+'☆'.repeat(5-stars);
    html+='<div class="pi-result">'+
      '<div class="pi-result-icon">'+(state.won?'🎉':'😢')+'</div>'+
      '<div class="pi-result-title">'+(state.won?'猜對了！':'遊戲結束')+'</div>'+
      '<div class="pi-result-grid">'+
        '<div class="pi-result-stat"><div class="pi-result-stat-val">'+state.ink+'</div><div class="pi-result-stat-lbl">墨水</div></div>'+
        '<div class="pi-result-stat"><div class="pi-result-stat-val">'+state.guesses+'</div><div class="pi-result-stat-lbl">猜測</div></div>'+
        '<div class="pi-result-stat"><div class="pi-result-stat-val">'+state.oracleUsed+'</div><div class="pi-result-stat-lbl">天眼</div></div>'+
      '</div>'+
      '<div class="pi-result-stars">'+starStr+'</div>'+
      '<div class="pi-result-answer">謎底：<strong>'+esc(ANSWER)+'</strong></div>'+
      '<button class="pi-restart" onclick="location.reload()">再來一題</button>'+
    '</div>';
  }

  document.getElementById('pi-game').innerHTML=html;

  // Focus answer input if open
  var inp2=document.getElementById('pi-input');
  if(inp2 && document.getElementById('pi-answer-box').classList.contains('open')){
    inp2.focus();
  }
}

render();
})();
</script>"""


def play_colab_game(data: QuestionSet | QuestionSetWithMeta) -> None:
    """以 HTML/JS 渲染的互動遊戲（Colab 專用）"""
    qs = data if isinstance(data, QuestionSet) else QuestionSet(
        answer=data.answer, questions=data.questions
    )
    questions_data = _embed_cells_data(qs)
    import json
    html = GAME_HTML_TEMPLATE.replace(
        "__QUESTIONS__", json.dumps(questions_data, ensure_ascii=False)
    ).replace(
        "__ANSWER__", json.dumps(qs.answer, ensure_ascii=False)
    )
    from IPython.display import display, HTML, clear_output
    clear_output(wait=True)
    display(HTML(html))
