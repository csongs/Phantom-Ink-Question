"""
AI 驅動的題目生成器。

三階段流程：
1. 出題（Designer）— 產生七道由難到易的問答
2. 驗題（Reviewer）— 檢查題目品質
3. 模擬（Simulator）— AI 扮演玩家逐題猜測

使用 Hugging Face Inference API（免下載模型，免費）。
"""

import json
from typing import Optional

from zhconv import convert

from backends import HFInferenceBackend
from models import (
    QuestionItem,
    QuestionSet,
    QuestionSetWithMeta,
    ReviewResult,
    SimulationResult,
    SimulationRound,
)
from prompts import (
    REVIEWER_SYSTEM_PROMPT,
    REVIEWER_USER_PROMPT,
    SIMULATOR_SYSTEM_PROMPT,
    SIMULATOR_USER_PROMPT,
    CATEGORY_HINTS,
    QUESTION_BANK,
    ANSWER_GENERATOR_PROMPT,
    format_designer_prompt,
)
from bopomofo import to_bopomofo_cells, count_bopomofo_cells


class PhantomInkGenerator:
    """Phantom Ink 題目生成器（Hugging Face Inference API）

    需要 Hugging Face Token（免費申請：https://huggingface.co/settings/tokens）
    """

    def __init__(
        self,
        token: str,
        model: str = "Qwen/Qwen2.5-7B-Instruct",
        max_retries: int = 3,
    ):
        self.llm = HFInferenceBackend(token=token, model=model)
        self.max_retries = max_retries

    def _json_chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> dict:
        """發送對話並解析 JSON 回覆"""
        reply = self.llm.chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return json.loads(reply)

    # ── 後處理 ──────────────────────────

    @staticmethod
    def _post_process(qs: QuestionSet) -> QuestionSet:
        """後處理：簡轉繁 + 修正注音"""
        for q in qs.questions:
            q.question = convert(q.question, "zh-tw")
            q.reply = convert(q.reply, "zh-tw")
        return qs

    # ── Phase 1: 出題 ──────────────────────

    def design_questions(self, answer: str, answer_mode: str = "ai", num_questions: int = 7) -> QuestionSet:
        """階段一：出題 — AI 扮演出題老師產生問答

        answer_mode: "ai" = AI 填回答, "human" = 只選題目，回答留空
        num_questions: 要出幾題（預設 7）
        """
        system, user = format_designer_prompt(answer, num_questions=num_questions)
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        raw = self._json_chat(messages, temperature=0.7)

        questions = [
            QuestionItem(question=q["question"], reply=q["reply"])
            for q in raw["questions"]
        ]

        qs = QuestionSet(answer=raw["answer"], questions=questions)

        # 後處理：簡轉繁
        self._post_process(qs)

        # 題庫檢查 + 標記自創題（後處理後才檢查）
        for q in qs.questions:
            if q.question not in QUESTION_BANK:
                q.is_custom = True

        unknown = [q.question for q in qs.questions if q.is_custom]
        if unknown:
            print("⚠️  以下題目不在題庫中（已標記為自創題）：")
            for uq in unknown:
                print(f"     ✗ {uq}")

        # 回答重複檢查
        replies = [q.reply for q in qs.questions]
        dupes = set(r for r in replies if replies.count(r) > 1)
        if dupes:
            print(f"⚠️  發現重複回答：{', '.join(dupes)}")

        # 回答洩題檢查（回答包含謎底的文字）
        leak_replies = []
        for q in qs.questions:
            leaked_chars = [c for c in qs.answer if c in q.reply]
            if leaked_chars:
                leak_replies.append(
                    f"「{q.reply}」洩漏了「{''.join(leaked_chars)}」"
                )
        if leak_replies:
            print("⚠️  回答包含謎底文字（可能太簡單）：")
            for lr in leak_replies:
                print(f"     ✗ {lr}")

        # human 模式：清空回答
        if answer_mode == "human":
            qs.questions = [
                QuestionItem(question=q.question, reply="")
                for q in qs.questions
            ]

        return qs

    # ── Phase 2: 驗題 ──────────────────────

    def review_questions(self, question_set: QuestionSet) -> ReviewResult:
        """階段二：驗題 — AI 扮演驗題老師檢查品質"""
        questions_text = "\n".join(
            f"Q{i+1}. {q.question}\nA{i+1}. {q.reply}"
            for i, q in enumerate(question_set.questions)
        )

        messages = [
            {"role": "system", "content": REVIEWER_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": REVIEWER_USER_PROMPT.format(
                    answer=question_set.answer,
                    questions_text=questions_text,
                ),
            },
        ]

        raw = self._json_chat(messages, temperature=0.3, max_tokens=1024)

        return ReviewResult(
            score=raw.get("score", 0),
            passed=raw.get("passed", False),
            comments=raw.get("comments", []),
        )

    # ── Phase 3: 模擬玩家 ──────────────────

    def simulate_player(self, question_set: QuestionSet) -> SimulationResult:
        """階段三：模擬玩家 — AI 扮演玩家逐題猜測"""
        rounds = []

        category_hint = self._infer_category(question_set.answer)

        for i, q_item in enumerate(question_set.questions):
            round_num = i + 1
            total_cells = count_bopomofo_cells(q_item.reply)

            cells = to_bopomofo_cells(q_item.reply)
            revealed_count = 0
            guessed = False
            last_raw = {}

            for reveal_step in range(1, total_cells + 1):
                revealed_count = reveal_step

                history_lines = []
                for j, r in enumerate(rounds):
                    history_lines.append(
                        f"Q{j+1}: {r.question}\n"
                        f"回答注音: {r.ink_revealed}\n"
                        f"你的猜測: {r.player_guess or '（尚未猜測）'}"
                    )

                history = "\n\n".join(history_lines) if history_lines else "（尚無歷史）"

                revealed_display = " ".join(
                    cells[:revealed_count] + ["▢"] * (total_cells - revealed_count)
                )

                prompt = SIMULATOR_USER_PROMPT.format(
                    category_hint=category_hint,
                    round_number=round_num,
                    history=history,
                    question=q_item.question,
                    revealed_bpmf=revealed_display,
                    total_cells=total_cells,
                )

                messages = [
                    {"role": "system", "content": SIMULATOR_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ]

                raw = self._json_chat(messages, temperature=0.5)
                last_raw = raw
                want_to_guess = raw.get("want_to_guess", False)
                guess = raw.get("current_best_guess", "")

                if want_to_guess and guess.strip() == question_set.answer:
                    guessed = True
                    break

                if want_to_guess and guess.strip() != question_set.answer:
                    guessed = False
                    break

            revealed_display_final = " ".join(
                cells[:revealed_count] + ["▢"] * (total_cells - revealed_count)
            )

            simulation_round = SimulationRound(
                round_number=round_num,
                question=q_item.question,
                reply=q_item.reply,
                ink_revealed=revealed_display_final,
                player_guess=last_raw.get("current_best_guess", ""),
                guessed_correctly=guessed,
            )
            rounds.append(simulation_round)

            if guessed:
                break

        guess_round = next(
            (r.round_number for r in reversed(rounds) if r.guessed_correctly),
            len(rounds) + 1,
        )
        ink_used = sum(
            len([c for c in r.ink_revealed if c != "▢" and c != " "])
            for r in rounds
        )
        too_easy = guess_round <= 2
        too_hard = guess_round > len(question_set.questions)
        confidence = max(0.0, min(1.0, 1.0 - (guess_round - 1) / 7))

        return SimulationResult(
            guess_round=guess_round,
            ink_used=ink_used,
            confidence=round(confidence, 2),
            too_easy=too_easy,
            too_hard=too_hard,
            reason=self._build_simulation_reason(rounds, guess_round, too_easy, too_hard),
            rounds=rounds,
        )

    # ── AI 自產謎底 ──────────────────────

    def generate_answer(self) -> str:
        """讓 AI 自己產生一個適合的謎底"""
        reply = self.llm.chat(
            messages=[{"role": "user", "content": ANSWER_GENERATOR_PROMPT}],
            temperature=0.9,
            max_tokens=20,
        )
        return reply.strip()

    # ── 局部修正 ──────────────────────────

    def _fix_questions(
        self,
        answer: str,
        qs: QuestionSet,
        bad_indices: list[int],
    ) -> QuestionSet:
        """重新產生指定的題號（只換有問題的幾題）"""
        bad_desc = "\n".join(
            f"第 {i+1} 題：{qs.questions[i].question} → {qs.questions[i].reply}"
            for i in bad_indices
        )
        good = [
            qs.questions[i]
            for i in range(len(qs.questions))
            if i not in bad_indices
        ]
        good_desc = "\n".join(
            f"第 {i+1} 題：{qs.questions[i].question} → {qs.questions[i].reply}"
            for i in range(len(qs.questions))
            if i not in bad_indices
        )

        prompt = (
            f'謎底是「{answer}」，已經有 {len(good)} 題合格的題目：\n'
            f"{good_desc}\n\n"
            f"以下 {len(bad_indices)} 題需要重做：\n"
            f"{bad_desc}\n\n"
            f"請重新產生這 {len(bad_indices)} 題（問題從題庫選，回答根據謎底填入），"
            f"輸出 JSON 格式：\n"
            f'{{"questions": [\n'
            f'  {{"question": "...", "reply": "..."}},\n'
            f"  ...\n"
            f"]}}"
        )

        raw = self._json_chat(
            [{"role": "user", "content": prompt}],
            temperature=0.7,
        )

        new_questions = [
            QuestionItem(question=q["question"], reply=q["reply"])
            for q in raw["questions"]
        ]

        # 合併：保留舊的好題 + 新的替換題
        merged = []
        replace_idx = 0
        for i in range(len(qs.questions)):
            if i in bad_indices:
                merged.append(new_questions[replace_idx])
                replace_idx += 1
            else:
                merged.append(qs.questions[i])

        qs.questions = merged
        self._post_process(qs)
        return qs

    # ── 完整 Pipeline ──────────────────────

    def generate(
        self,
        answer: str = "",
        skip_review: bool = False,
        skip_simulation: bool = True,
        verbose: bool = True,
        answer_mode: str = "ai",
        num_questions: int = 7,
    ) -> QuestionSetWithMeta:
        """完整流程：出題 → 驗題 → 模擬（自動重試不合格題目）

        answer_mode: "ai" = AI 自產謎底 + 填回答
                    "human" = 人提供謎底，AI 只填回答
        num_questions: 要出幾題（預設 7）
        """
        # AI 自產謎底
        if answer_mode == "ai":
            if verbose:
                print("🎲 AI 思考謎底中...")
            answer = self.generate_answer()
            if verbose:
                print(f"🎲 AI 產生的謎底：{answer}\n")
        elif not answer:
            raise ValueError("answer_mode 為 human 時必須提供謎底")

        retry_count = 0
        last_error = None

        for attempt in range(self.max_retries):
            if verbose:
                print(f"\n{'='*50}")
                print(f"📝 第 {attempt + 1} 次生成 — 謎底：{answer}")
                print(f"{'='*50}")

            if verbose:
                print("\n🤖 出題中...")
            try:
                question_set = self.design_questions(answer, answer_mode=answer_mode, num_questions=num_questions)
            except Exception as e:
                last_error = str(e)
                if verbose:
                    print(f"❌ 出題失敗：{e}")
                continue

            # 驗證 + 局部修正
            for fix_attempt in range(3):
                self._post_process(question_set)

                # 找有問題的題號
                bad = set()
                replies = [q.reply for q in question_set.questions]
                # 重複回答
                for i, r in enumerate(replies):
                    if replies.count(r) > 1:
                        bad.add(i)
                # 洩題
                for i, q in enumerate(question_set.questions):
                    if any(c in q.reply for c in question_set.answer):
                        bad.add(i)

                if not bad:
                    break  # 全部 OK

                if verbose:
                    print(f"⚠️  發現 {len(bad)} 題有問題，重新產生...")
                    for i in sorted(bad):
                        reason = []
                        r = question_set.questions[i].reply
                        if replies.count(r) > 1:
                            reason.append("回答重複")
                        if any(c in r for c in question_set.answer):
                            reason.append("洩漏謎底")
                        print(f"     第 {i+1} 題：{'、'.join(reason)}")

                question_set = self._fix_questions(
                    answer, question_set, sorted(bad)
                )

            # 顯示結果
            if verbose:
                for i, q in enumerate(question_set.questions):
                    tag = " [自創]" if q.is_custom else ""
                    print(f"  Q{i+1}. {q.question}{tag}")
                    print(f"  A{i+1}. {q.reply}")
                    print()

            if not skip_review:
                if verbose:
                    print("🔍 驗題中...")
                try:
                    review = self.review_questions(question_set)
                except Exception as e:
                    last_error = str(e)
                    if verbose:
                        print(f"❌ 驗題失敗：{e}")
                    continue

                if verbose:
                    print(f"  評分：{review.score}/100")
                    for c in review.comments:
                        print(f"  • {c}")

                if not review.passed:
                    retry_count += 1
                    if verbose:
                        print(f"\n🔄 未通過（{review.score}分），重新生成...")
                    continue
            else:
                review = None

            simulation = None
            if not skip_simulation:
                if verbose:
                    print("🎮 模擬玩家中...")
                try:
                    simulation = self.simulate_player(question_set)
                except Exception as e:
                    if verbose:
                        print(f"⚠️  模擬失敗：{e}（跳過）")

                if simulation:
                    if verbose:
                        print(f"  在第 {simulation.guess_round} 題猜出")
                        print(f"  使用 {simulation.ink_used} 格注音")
                        print(f"  信心指數：{simulation.confidence}")
                        print(f"  太簡單：{simulation.too_easy}")
                        print(f"  太困難：{simulation.too_hard}")
                        print(f"  原因：{simulation.reason}")

            if verbose:
                print(f"\n✅ 題組生成成功！（嘗試 {attempt + 1} 次）")

            return QuestionSetWithMeta(
                answer=question_set.answer,
                questions=question_set.questions,
                review=review,
                simulation=simulation,
                retry_count=retry_count,
            )

        if verbose:
            print(f"\n❌ 超過最大重試次數（{self.max_retries}），生成失敗。")
            if last_error:
                print(f"   最後錯誤：{last_error}")

        return QuestionSetWithMeta(
            answer=answer,
            questions=[
                QuestionItem(question="（生成失敗）", reply="（生成失敗）"),
            ],
            retry_count=retry_count,
        )

    # ── 輔助方法 ──────────────────────────

    def _infer_category(self, answer: str) -> str:
        """根據答案推測類別提示"""
        prompt = f"""請判斷"{answer}"最適合以下哪個類別，只輸出類別名稱：
{"、".join(CATEGORY_HINTS.keys())}"""

        reply = self.llm.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=20,
        )
        category = reply.strip()
        return CATEGORY_HINTS.get(category, f"這與「{answer}」相關")

    def _build_simulation_reason(
        self,
        rounds: list[SimulationRound],
        guess_round: int,
        too_easy: bool,
        too_hard: bool,
    ) -> str:
        total = len(rounds)
        if too_easy:
            return (
                f"玩家在第 {guess_round} 題就猜出，表示題目太過簡單。"
                f"建議增加前面題目的難度。"
            )
        elif too_hard:
            return (
                f"玩家看完所有 {total} 題仍未猜出，表示題目太難。"
                f"建議增加更多提示性問題。"
            )
        else:
            return (
                f"玩家在第 {guess_round} 題猜出，難度適中。"
                f"共使用 {sum(len(r.ink_revealed.split()) for r in rounds if r.guessed_correctly)} "
                f"格注音，節奏良好。"
            )

    # ── 批次生成 ──────────────────────────

    def generate_batch(
        self,
        answers: list[str],
        skip_review: bool = False,
        skip_simulation: bool = True,
        verbose: bool = True,
        answer_mode: str = "ai",
        num_questions: int = 7,
    ) -> list[QuestionSetWithMeta]:
        """批次生成多個題組"""
        results = []
        for answer in answers:
            result = self.generate(
                answer=answer,
                skip_review=skip_review,
                skip_simulation=skip_simulation,
                verbose=verbose,
                answer_mode=answer_mode,
                num_questions=num_questions,
            )
            results.append(result)
        return results


# ── 主程式 ────────────────────────────────

if __name__ == "__main__":
    import os

    token = os.getenv("HF_TOKEN")
    if not token:
        print("請設定 HF_TOKEN 環境變數")
        print("到 https://huggingface.co/settings/tokens 申請免費 Token")
        exit(1)

    gen = PhantomInkGenerator(
        token=token,
        model=os.getenv("HF_MODEL", "Qwen/Qwen2.5-7B-Instruct"),
    )

    result = gen.generate("鋼琴", verbose=True)

    if result.questions and result.questions[0].reply != "（生成失敗）":
        print("\n\n📦 最終 JSON：")
        print(result.model_dump_json(indent=2, exclude_none=True))
