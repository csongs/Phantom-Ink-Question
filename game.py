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
  max-width: 800px; margin: 0 auto; padding: 24px 16px;
  color: #e0e0e0; background: #1a1a2e; border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4); user-select: none;
}
#pi-game * { box-sizing: border-box; margin: 0; padding: 0; }
.pi-header { text-align: center; font-size: 22px; font-weight: 700; color: #c084fc; letter-spacing: 4px; padding: 12px 0 20px; }
.pi-info-row { display: flex; gap: 10px; margin-bottom: 16px; }
.pi-info-card { flex: 1; background: #16213e; border-radius: 12px; padding: 12px 8px; text-align: center; border: 1px solid rgba(192,132,252,0.15); }
.pi-info-icon { font-size: 20px; }
.pi-info-label { font-size: 11px; color: #888; margin: 2px 0; }
.pi-info-value { font-size: 24px; font-weight: 700; color: #c084fc; }
.pi-q-card { background: #16213e; border-radius: 14px; padding: 20px; margin-bottom: 14px; border: 1px solid rgba(192,132,252,0.2); }
.pi-q-header { font-size: 13px; color: #888; margin-bottom: 10px; }
.pi-q-text { font-size: 17px; font-weight: 600; line-height: 1.6; margin-bottom: 18px; color: #f0f0f0; }
.pi-ink-label { font-size: 11px; color: #888; margin-bottom: 6px; }
.pi-ink-display { font-size: 32px; font-weight: 600; color: #a78bfa; min-height: 48px; padding: 8px 0; letter-spacing: 2px; font-family: 'Noto Sans TC','Segoe UI',sans-serif; }
.pi-ink-cells { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.pi-ink-cell { width: 28px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; background: #1e2a4a; border-radius: 6px; color: #555; transition: all 0.3s ease; }
.pi-ink-cell.revealed { background: #2d1f5e; color: #c084fc; animation: popIn 0.25s ease; }
@keyframes popIn { 0% { transform: scale(0.5); opacity: 0; } 70% { transform: scale(1.15); } 100% { transform: scale(1); opacity: 1; } }
.pi-clues { margin-bottom: 14px; }
.pi-clue-card { background: #16213e; border-radius: 10px; margin-bottom: 6px; border: 1px solid rgba(192,132,252,0.1); overflow: hidden; }
.pi-clue-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; font-size: 13px; color: #aaa; transition: background 0.2s; }
.pi-clue-header:hover { background: rgba(192,132,252,0.08); }
.pi-clue-toggle { transition: transform 0.2s; font-size: 12px; }
.pi-clue-toggle.open { transform: rotate(90deg); }
.pi-clue-body { padding: 0 14px 12px; display: none; font-size: 13px; color: #ccc; }
.pi-clue-body.open { display: block; }
.pi-clue-q { margin-bottom: 6px; }
.pi-clue-ink { font-size: 18px; color: #a78bfa; letter-spacing: 1px; }
.pi-clue-cnt { font-size: 11px; color: #666; margin-top: 4px; }
.pi-btn-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.pi-btn { flex: 1; min-width: 100px; padding: 10px 8px; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px; }
.pi-btn:disabled { opacity: 0.35; cursor: default; transform: none !important; }
.pi-btn:hover:not(:disabled) { transform: translateY(-1px); }
.pi-btn:active:not(:disabled) { transform: scale(0.97); }
.pi-btn-blue { background: #3b82f6; color: #fff; }
.pi-btn-blue:hover:not(:disabled) { background: #2563eb; }
.pi-btn-gray { background: #374151; color: #ccc; }
.pi-btn-gray:hover:not(:disabled) { background: #4b5563; }
.pi-btn-green { background: #22c55e; color: #fff; }
.pi-btn-green:hover:not(:disabled) { background: #16a34a; }
.pi-btn-purple { background: #7c3aed; color: #fff; }
.pi-btn-purple:hover:not(:disabled) { background: #6d28d9; }
.pi-btn-gold { background: #d97706; color: #fff; }
.pi-btn-gold:hover:not(:disabled) { background: #b45309; }
.pi-answer-section { background: #16213e; border-radius: 12px; padding: 16px; margin-bottom: 14px; display: none; border: 1px solid rgba(192,132,252,0.15); }
.pi-answer-section.open { display: block; }
.pi-answer-input { width: 100%; padding: 12px 14px; border: 2px solid #374151; border-radius: 10px; font-size: 16px; background: #1a1a2e; color: #e0e0e0; outline: none; margin-bottom: 10px; transition: border-color 0.2s; }
.pi-answer-input:focus { border-color: #7c3aed; }
.pi-answer-actions { display: flex; gap: 8px; }
.pi-answer-actions .pi-btn { flex: 0 1 auto; min-width: 80px; }
.pi-oracle-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; display: none; }
.pi-oracle-overlay.open { display: flex; }
.pi-oracle-dialog { background: #1a1a2e; border-radius: 16px; padding: 24px; max-width: 380px; width: 90%; border: 1px solid rgba(192,132,252,0.3); }
.pi-oracle-title { font-size: 16px; font-weight: 600; margin-bottom: 14px; text-align: center; }
.pi-oracle-option { display: block; width: 100%; padding: 10px 14px; margin-bottom: 6px; background: #16213e; border: 1px solid rgba(192,132,252,0.15); border-radius: 8px; color: #e0e0e0; cursor: pointer; text-align: left; font-size: 13px; transition: background 0.2s; }
.pi-oracle-option:hover { background: #2d1f5e; }
.pi-oracle-close { display: block; margin: 10px auto 0; padding: 6px 20px; background: #374151; border: none; border-radius: 8px; color: #aaa; cursor: pointer; font-size: 13px; }
.pi-progress { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13px; color: #888; }
.pi-progress-bar { flex: 1; height: 6px; background: #16213e; border-radius: 3px; overflow: hidden; }
.pi-progress-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #c084fc); border-radius: 3px; transition: width 0.4s ease; }
.pi-notif { background: rgba(124,58,237,0.2); border: 1px solid rgba(192,132,252,0.3); border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; color: #c084fc; text-align: center; animation: fadeIn 0.3s ease; }
@keyframes fadeIn { 0% { opacity: 0; transform: translateY(-8px); } 100% { opacity: 1; transform: translateY(0); } }
.pi-result { text-align: center; padding: 30px 20px; }
.pi-result-icon { font-size: 48px; margin-bottom: 12px; }
.pi-result-title { font-size: 24px; font-weight: 700; margin-bottom: 20px; color: #c084fc; }
.pi-result-stats { display: flex; gap: 12px; justify-content: center; margin-bottom: 24px; }
.pi-result-stat { background: #16213e; border-radius: 12px; padding: 14px 18px; text-align: center; min-width: 100px; }
.pi-result-stat-value { font-size: 28px; font-weight: 700; color: #c084fc; }
.pi-result-stat-label { font-size: 11px; color: #888; margin-top: 2px; }
.pi-result-stars { font-size: 28px; letter-spacing: 4px; margin-bottom: 20px; }
.pi-restart-btn { display: inline-block; padding: 12px 32px; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; background: #7c3aed; color: #fff; cursor: pointer; transition: background 0.2s; }
.pi-restart-btn:hover { background: #6d28d9; }
.pi-oracle-flash { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); background: rgba(124,58,237,0.95); color: #fff; padding: 20px 32px; border-radius: 14px; font-size: 18px; font-weight: 600; z-index: 999; animation: flashIn 0.3s ease, flashOut 0.3s ease 1.2s forwards; pointer-events: none; }
@keyframes flashIn { 0% { opacity:0; transform:translate(-50%,-50%) scale(0.8); } 100% { opacity:1; transform:translate(-50%,-50%) scale(1); } }
@keyframes flashOut { 0% { opacity:1; } 100% { opacity:0; transform:translate(-50%,-50%) scale(0.8); } }
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

// ── 核心邏輯（掛到 window 讓 onclick 能找到） ──

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
    // 第5題（index 4）開始 → 給第一個老天有眼
    if(state.currentQ>=4 && !state.oracleQ5Granted){
      state.oracleQ5Granted=true;
      state.oracleCharges++;
      state.notifMsg='👁 獲得「老天有眼」！可選擇過往任一答案多揭露一格墨水';
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
  var inp = document.getElementById('pi-answer-input');
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
    setTimeout(function(){inp.style.borderColor='#374151';},600);
  }
  render();
}

window.showAnswerInput = function(){
  document.getElementById('pi-answer-section').classList.add('open');
  setTimeout(function(){
    var inp=document.getElementById('pi-answer-input');
    if(inp) inp.focus();
  },100);
}

window.hideAnswerInput = function(){
  document.getElementById('pi-answer-section').classList.remove('open');
}

window.openOracle = function(){
  if(state.oracleCharges<=0) return;
  var past = [];
  for(var i=0;i<state.currentQ;i++) past.push(i);
  if(state.finalRevealed) past.push(state.currentQ);
  if(past.length===0) return;
  var opts = past.map(function(i){
    return '<button class="pi-oracle-option" onclick="doOracleReveal('+i+')">Q'+(i+1)+'：'+esc(questions[i].question.slice(0,20))+'</button>';
  }).join('');
  var div = document.createElement('div');
  div.className='pi-oracle-overlay open';
  div.id='pi-oracle-overlay';
  div.innerHTML=
    '<div class="pi-oracle-dialog">'+
      '<div class="pi-oracle-title">👁 請選擇要揭露哪一題</div>'+
      opts+
      '<button class="pi-oracle-close" onclick="closeOracle()">取消</button>'+
    '</div>';
  document.getElementById('pi-game').appendChild(div);
}

window.closeOracle = function(){
  var el=document.getElementById('pi-oracle-overlay');
  if(el) el.remove();
}

window.doOracleReveal = function(idx){
  state.oracleCharges--;
  state.oracleUsed++;
  var t=questions[idx].total;
  state.revealed[idx]=Math.min(state.revealed[idx]+1,t);
  state.ink++;
  closeOracle();
  var cell=questions[idx].cells[state.revealed[idx]-1];
  var flash=document.createElement('div');
  flash.className='pi-oracle-flash';
  flash.textContent='Q'+(idx+1)+' 揭露新墨水：'+(cell||'。');
  document.getElementById('pi-game').appendChild(flash);
  setTimeout(function(){flash.remove();},1500);
  render();
}

window.toggleClue = function(el){
  var tog=el.querySelector('.pi-clue-toggle');
  var body=el.nextElementSibling;
  if(body){body.classList.toggle('open');tog.classList.toggle('open');}
}

// ── 渲染 ──

function render(){
  var cur=state.currentQ;
  var r=state.revealed[cur];
  var q=questions[cur];
  var allDone=r>=q.total;
  var isLast=cur===Q_COUNT-1;
  var canNext = !state.gameOver && !state.finalRevealed;
  var showFinish = isLast && canNext;  // 最後一題 → [完成線索]
  var pastVisited = state.visited.length;
  var hasPast = cur>0 && pastVisited>0;

  var html='<div class="pi-header">靈媒挑戰</div>';

  // 老天有眼獲得通知
  var notif='';
  if(state.notifMsg){
    notif='<div class="pi-notif">'+state.notifMsg+'</div>';
    state.notifMsg='';
  }

  // 資訊卡
  html+='<div class="pi-info-row">'+
    '<div class="pi-info-card"><div class="pi-info-icon">🖋</div><div class="pi-info-label">墨水</div><div class="pi-info-value">'+state.ink+'</div></div>'+
    '<div class="pi-info-card"><div class="pi-info-icon">🎯</div><div class="pi-info-label">猜測</div><div class="pi-info-value">'+state.guesses+'</div></div>'+
    '<div class="pi-info-card"><div class="pi-info-icon">👁</div><div class="pi-info-label">老天有眼</div><div class="pi-info-value">'+state.oracleCharges+'</div></div>'+
  '</div>';

  // 通知
  if(notif) html+=notif;

  // 題目卡
  if(!state.gameOver){
    html+='<div class="pi-q-card">'+
      '<div class="pi-q-header">第 '+(cur+1)+' / '+Q_COUNT+' 題</div>'+
      '<div class="pi-q-text">'+esc(q.question)+'</div>'+
      '<div class="pi-ink-label">墨水</div>'+
      '<div class="pi-ink-display" id="pi-ink-display">';
    if(r>0) html+=q.cells.slice(0,r).join('');
    html+='</div><div class="pi-ink-cells">';
    for(var i=0;i<q.total;i++){
      var cls=i<r?'revealed':'';
      html+='<div class="pi-ink-cell '+cls+'">'+(i<r?q.cells[i]:'▢')+'</div>';
    }
    html+='</div></div>';
  }

  // 過往線索（前三題預設展開，之後收合）
  if(pastVisited>0){
    html+='<div class="pi-clues">';
    for(var vi=0;vi<state.visited.length;vi++){
      var idx=state.visited[vi];
      var cq=questions[idx];
      var cr=state.revealed[idx];
      var clueCells=cq.cells.slice(0,cr).join('');
      var shortQ=cq.question.length>14?cq.question.slice(0,14)+'…':cq.question;
      var autoOpen=vi<3?'open':'';
      html+='<div class="pi-clue-card">'+
        '<div class="pi-clue-header" onclick="toggleClue(this)">'+
          '<span class="pi-clue-toggle '+(vi<3?'open':'')+'">▶</span>'+
          '<span>Q'+(idx+1)+' '+esc(shortQ)+'</span>'+
        '</div>'+
        '<div class="pi-clue-body '+autoOpen+'">'+
          '<div class="pi-clue-q">'+esc(cq.question)+'</div>'+
          '<div class="pi-ink-label" style="margin-top:6px">墨水</div>'+
          '<div class="pi-clue-ink">'+esc(clueCells||'（尚未揭露）')+'</div>'+
          '<div class="pi-clue-cnt">已揭露 '+cr+' / '+cq.total+' 格</div>'+
        '</div>'+
      '</div>';
    }
    html+='</div>';
  }

  // 按鈕
  if(!state.gameOver){
    var inkDisabled=(allDone||state.finalRevealed)?'disabled':'';
    var nextDisabled=(state.finalRevealed)?'disabled':'';
    var oracleDisabled=(state.oracleCharges<=0||hasPast===false)?'disabled':'';
    html+='<div class="pi-btn-row">'+
      '<button class="pi-btn pi-btn-blue" onclick="revealInk()" '+inkDisabled+'>🖋 顯示墨水</button>';
    if(showFinish){
      html+='<button class="pi-btn pi-btn-gold" onclick="finishClues()">📜 完成線索</button>';
    } else if(!isLast || state.finalRevealed){
      // 不是最後一題 → [下一題]
    } else {
      html+='<button class="pi-btn pi-btn-gray" onclick="nextQuestion()" '+nextDisabled+'>➡ 下一題</button>';
    }
    // Actually, [下一題] for non-last questions
    if(!isLast && !state.finalRevealed){
      html+='<button class="pi-btn pi-btn-gray" onclick="nextQuestion()" '+nextDisabled+'>➡ 下一題</button>';
    }
    html+='<button class="pi-btn pi-btn-green" onclick="showAnswerInput()">🎯 提交謎底</button>'+
      '<button class="pi-btn pi-btn-purple" onclick="openOracle()" '+oracleDisabled+'>👁 老天有眼</button>'+
    '</div>';
  }

  // 答案輸入
  if(!state.gameOver){
    html+='<div class="pi-answer-section" id="pi-answer-section">'+
      '<div style="font-size:13px;color:#888;margin-bottom:8px">請輸入你的答案</div>'+
      '<input class="pi-answer-input" id="pi-answer-input" placeholder="輸入謎底…" onkeydown="if(event.key===\\'Enter\\')submitAnswer()">'+
      '<div class="pi-answer-actions">'+
        '<button class="pi-btn pi-btn-green" onclick="submitAnswer()">送出</button>'+
        '<button class="pi-btn pi-btn-gray" onclick="hideAnswerInput()">取消</button>'+
      '</div>'+
    '</div>';
  }

  // 進度
  var doneCount=state.visited.length+(state.finalRevealed?1:0);
  if(state.gameOver) doneCount=Q_COUNT;
  if(doneCount>0){
    var pct=Math.round((doneCount/Q_COUNT)*100);
    html+='<div class="pi-progress">'+
      '<span>目前進度</span>'+
      '<div class="pi-progress-bar"><div class="pi-progress-fill" style="width:'+pct+'%"></div></div>'+
      '<span>'+doneCount+' / '+Q_COUNT+'</span>'+
    '</div>';
  }

  // 結果
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
      '<div class="pi-result-stats">'+
        '<div class="pi-result-stat"><div class="pi-result-stat-value">'+state.ink+'</div><div class="pi-result-stat-label">墨水</div></div>'+
        '<div class="pi-result-stat"><div class="pi-result-stat-value">'+state.guesses+'</div><div class="pi-result-stat-label">猜測次數</div></div>'+
        '<div class="pi-result-stat"><div class="pi-result-stat-value">'+state.oracleUsed+'</div><div class="pi-result-stat-label">老天有眼</div></div>'+
      '</div>'+
      '<div class="pi-result-stars">'+starStr+'</div>'+
      '<div style="margin-bottom:16px;font-size:15px;color:#888">謎底：<span style="color:#c084fc;font-weight:600">'+esc(ANSWER)+'</span></div>'+
      '<button class="pi-restart-btn" onclick="location.reload()">再來一題</button>'+
    '</div>';
  }

  document.getElementById('pi-game').innerHTML=html;

  // afterRender
  var inp2=document.getElementById('pi-answer-input');
  if(inp2) inp2.focus();
  var cells=document.querySelectorAll('.pi-ink-cell.revealed');
  if(cells.length>0){
    var last=cells[cells.length-1];
    last.style.animation='none';
    void last.offsetHeight;
    last.style.animation='popIn 0.25s ease';
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
