"""
Phantom Ink 互動試玩遊戲

在 Colab 中以文字介面遊玩：
- 每題逐格揭露注音（每格 +1 墨水）
- 隨時可以猜謎底（猜錯 +3 墨水）
- 不限猜測次數
"""

from models import QuestionSet, QuestionSetWithMeta
from bopomofo import to_bopomofo_cells


def _status_bar(ink: int, guesses: int) -> str:
    """顯示墨水與猜測狀態"""
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

            # 每次操作後更新狀態列
            print(f"  {_status_bar(ink, total_guesses)}")

        # 全部揭露
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
