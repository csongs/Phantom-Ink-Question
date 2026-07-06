"""
注音符號轉換工具

將中文字串轉換為注音符號序列。

依賴：
- pypinyin 套件（支援 bopomofo 輸出）
"""

from pypinyin import lazy_pinyin, Style
import re


def to_bopomofo(text: str) -> str:
    """將中文字串轉為注音符號，以空格分隔。

    >>> to_bopomofo("樂器行")
    'ㄩㄝˋ ㄑㄧˋ ㄒㄧㄥˊ'

    >>> to_bopomofo("演奏廳")
    'ㄧㄢˇ ㄗㄡˋ ㄊㄧㄥ'
    """
    parts = lazy_pinyin(text, style=Style.BOPOMOFO)
    clean = []
    for p in parts:
        if p and p != text:  # 有成功轉換
            clean.append(p)
        else:
            # 對無法轉換的字元（如英數），保留原字
            clean.append(p if p else text)
    return " ".join(clean)


def to_bopomofo_cells(text: str) -> list[str]:
    """將中文字串轉為逐格注音列表（不含空格）。

    >>> to_bopomofo_cells("樂器行")
    ['ㄩ', 'ㄝ', 'ˋ', 'ㄑ', 'ㄧ', 'ˋ', 'ㄒ', 'ㄧ', 'ㄥ', 'ˊ']
    """
    bpmf = to_bopomofo(text)
    # 移除空格，拆成單個字元
    chars = list(bpmf.replace(" ", ""))
    return chars


def reveal_bopomofo(text: str, cells_to_reveal: int) -> str:
    """揭露指定格數的注音，未揭露的以 ▢ 顯示。

    >>> reveal_bopomofo("樂器行", 3)
    'ㄩ ㄝ ˋ ▢ ▢ ▢ ▢ ▢ ▢ ▢'
    """
    cells = to_bopomofo_cells(text)
    total = len(cells)
    revealed_count = min(cells_to_reveal, total)

    result = []
    for i in range(total):
        if i < revealed_count:
            result.append(cells[i])
        else:
            result.append("▢")

    return " ".join(result)


def format_bopomofo_grid(text: str) -> str:
    """將注音排版為適合顯示的格式，含行號提示。

    回傳格式：
    [1] ㄩ
    [2] ㄝ
    [3] ˋ
    [4] ▢
    ..."""
    cells = to_bopomofo_cells(text)
    lines = []
    for i, cell in enumerate(cells, 1):
        lines.append(f"[{i:2d}] {cell}")
    return "\n".join(lines)


def count_bopomofo_cells(text: str) -> int:
    """計算注音總格數。

    >>> count_bopomofo_cells("樂器行")
    10
    """
    return len(to_bopomofo_cells(text))


def has_bopomofo(text: str) -> bool:
    """檢查文字是否包含可轉注音的中文。"""
    # 檢查是否有中文字元
    chinese_chars = re.findall(r'[一-鿿]', text)
    if not chinese_chars:
        return False
    # 嘗試轉換
    bpmf = to_bopomofo(text)
    # 如果有中文字但 bpmf 不含注音符號，代表失敗
    bpmf_chars = re.findall(r'[ㄅ-ㄩˇˊˋˉ]', bpmf)
    return len(bpmf_chars) > 0
