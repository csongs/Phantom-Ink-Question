"""
Phantom Ink 互動試玩遊戲

在終端機或 Colab 中以文字介面遊玩：
- 每題逐格揭露注音（每格 +1 墨水）
- 隨時可以猜謎底（猜錯 +3 墨水）
- 不限猜測次數
"""

from models import QuestionSet, QuestionSetWithMeta
from bopomofo import to_bopomofo_cells


def play_game(data: QuestionSet | QuestionSetWithMeta) -> dict:
    """互動試玩：逐題揭露注音，讓玩家猜謎底。

    Args:
        data: 生成的題組（QuestionSet 或 QuestionSetWithMeta）

    Returns:
        {"ink": 總墨水, "guesses": 猜測次數, "won": 是否猜中}
    """
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
    print("  指令：")
    print("    [Enter]     揭露下一個注音（+1 墨水）")
    print("    輸入答案    猜測謎底（猜錯 +3 墨水）")
    print("    q           離開遊戲")
    print("=" * 50)

    for q_idx, q_item in enumerate(qs.questions):
        cells = to_bopomofo_cells(q_item.reply)
        total_cells = len(cells)

        print(f"\n{'─' * 50}")
        print(f"  Q{q_idx + 1}. {q_item.question}")
        print(f"{'─' * 50}")
        print(f"  墨水：{ink}　已猜測：{total_guesses} 次")

        while revealed_per_q[q_idx] < total_cells:
            revealed = revealed_per_q[q_idx]
            # 顯示目前揭露狀態
            display = " ".join(
                cells[:revealed] + ["▢"] * (total_cells - revealed)
            ) if revealed > 0 else "（尚未顯示墨水）"

            print(f"\n  注音：{display}")
            inp = input("\n  > ").strip()

            if inp.lower() == "q":
                print(f"\n  謎底是：{qs.answer}")
                return {"ink": ink, "guesses": total_guesses, "won": won}

            if inp == "":
                # 揭露下一格
                revealed_per_q[q_idx] += 1
                ink += 1
                print(f"  → 揭露一格（+1 墨水）")
            else:
                # 猜測
                total_guesses += 1
                if inp == qs.answer:
                    won = True
                    revealed_per_q[q_idx] = total_cells
                    display = " ".join(cells)
                    print(f"\n  🎉 答對了！謎底就是「{qs.answer}」！")
                    print(f"  注音：{display}")
                    print(f"\n  最終墨水：{ink}　猜測次數：{total_guesses}")
                    return {"ink": ink, "guesses": total_guesses, "won": won}
                else:
                    ink += 3
                    print(f"  ✗ 不對喔（+3 墨水，累計 {ink}）")

        # 這題全部揭露了
        display = " ".join(cells)
        print(f"\n  注音：{display}")

        # 這題揭露完，讓玩家最後一次猜
        if q_idx < total_questions - 1:
            print(f"\n  這題已全部揭露。輸入答案猜測，或按 Enter 進下一題。")
            inp = input("\n  > ").strip()
            if inp:
                total_guesses += 1
                if inp == qs.answer:
                    won = True
                    print(f"\n  🎉 答對了！謎底就是「{qs.answer}」！")
                    print(f"\n  最終墨水：{ink}　猜測次數：{total_guesses}")
                    return {"ink": ink, "guesses": total_guesses, "won": won}
                else:
                    ink += 3
                    print(f"  ✗ 不對喔（+3 墨水，累計 {ink}）")

    # 全部題目沒人猜中
    print(f"\n{'=' * 50}")
    print(f"  題目全部出完了！")
    print(f"  謎底是：「{qs.answer}」")
    print(f"  最終墨水：{ink}　猜測次數：{total_guesses}")
    return {"ink": ink, "guesses": total_guesses, "won": won}
