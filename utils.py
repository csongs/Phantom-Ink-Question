"""
工具函式 — 檔案讀寫、格式化輸出、CSV 題庫管理
"""

import csv
import json
import os
from typing import Optional

from models import QuestionSetWithMeta, QuestionItem


def save_question_set(
    data: QuestionSetWithMeta,
    filepath: str,
    format: str = "json",
) -> str:
    """儲存題組到檔案。

    Args:
        data: 題組資料
        filepath: 檔案路徑
        format: "json" 或 "csv"

    Returns:
        實際寫入的檔案路徑
    """
    os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)

    if format == "json":
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(data.model_dump_json(indent=2, ensure_ascii=False, exclude_none=True))
    elif format == "csv":
        with open(filepath, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["answer", "question_number", "question", "reply"])
            for i, q in enumerate(data.questions):
                writer.writerow([data.answer, i + 1, q.question, q.reply])

    return filepath


def load_question_set(filepath: str) -> Optional[QuestionSetWithMeta]:
    """從 JSON 檔案載入題組。

    Args:
        filepath: JSON 檔案路徑

    Returns:
        題組資料，讀取失敗回傳 None
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return QuestionSetWithMeta(**raw)
    except (FileNotFoundError, json.JSONDecodeError, Exception) as e:
        print(f"讀取失敗 {filepath}: {e}")
        return None


def load_answer_bank(filepath: str) -> list[str]:
    """從 CSV 載入謎底清單。

    CSV 格式：一行一個謎底，或著有 answer 欄位

    Args:
        filepath: CSV 或純文字檔案路徑

    Returns:
        謎底列表
    """
    answers = []

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            first_line = f.readline().strip()

        # 檢查是否為 CSV 含標題列
        if "answer" in first_line.lower():
            with open(filepath, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if row.get("answer"):
                        answers.append(row["answer"].strip())
        else:
            # 純文字格式：一行一個
            with open(filepath, "r", encoding="utf-8") as f:
                answers = [line.strip() for line in f if line.strip()]

    except FileNotFoundError:
        print(f"找不到檔案：{filepath}")
    except Exception as e:
        print(f"讀取失敗：{e}")

    return answers


def export_to_colab_json(
    data: QuestionSetWithMeta,
    filepath: str = "phantom_ink_export.json",
) -> str:
    """匯出為精簡 JSON（不含 meta/simulation，適合遊戲前端使用）"""
    export = {
        "answer": data.answer,
        "questions": [
            {
                "question": q.question,
                "reply": q.reply,
            }
            for q in data.questions
        ],
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)

    return filepath


def print_question_set(data: QuestionSetWithMeta) -> None:
    """友善地印出題組，含注音資訊。"""
    from bopomofo import to_bopomofo, count_bopomofo_cells

    print(f"\n{'='*50}")
    print(f"🎯 謎底：{data.answer}")
    if data.review:
        print(f"📊 驗分：{data.review.score}/100 ({'通過' if data.review.passed else '未通過'})")
    if data.simulation:
        sim = data.simulation
        print(f"🎮 模擬：第{sim.guess_round}題猜出 | {sim.ink_used}格注音 | 信心{sim.confidence}")
    print(f"{'='*50}")

    for i, q in enumerate(data.questions):
        bpmf = to_bopomofo(q.reply)
        cells = count_bopomofo_cells(q.reply)
        print(f"\n  Q{i+1}. {q.question}")
        print(f"  A{i+1}. {q.reply}")
        print(f"        注音：{bpmf}（{cells}格）")

    print()
