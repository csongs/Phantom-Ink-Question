"""
bopomofo 模组的单元测试
"""

import unittest
from bopomofo import (
    to_bopomofo,
    to_bopomofo_cells,
    reveal_bopomofo,
    count_bopomofo_cells,
    has_bopomofo,
)


class TestBopomofo(unittest.TestCase):

    def test_to_bopomofo_basic(self):
        """基本转换测试"""
        result = to_bopomofo("乐器行")
        # Note: pypinyin may choose different readings for polyphonic chars
        self.assertTrue(
            "ㄑㄧˋ" in result,
            f"Expected 'ㄑㄧˋ' in '{result}'"
        )
        self.assertTrue(
            "ㄒㄧㄥˊ" in result,
            f"Expected 'ㄒㄧㄥˊ' in '{result}'"
        )

    def test_to_bopomofo_single_char(self):
        """单字转换"""
        result = to_bopomofo("钢")
        self.assertIn("ㄍ", result)

    def test_to_bopomofo_cells_count(self):
        """逐格拆解数量正确"""
        cells = to_bopomofo_cells("钢琴")
        self.assertGreater(len(cells), 0)
        # 钢 = ㄍㄤ (2格) + 琴 = ㄑㄧㄣˊ (4格) = 6格
        self.assertEqual(len(cells), 6)

    def test_reveal_bopomofo_partial(self):
        """部分揭露测试"""
        revealed = reveal_bopomofo("钢琴", 3)
        self.assertIn("▢", revealed)
        # 前3格不该是 ▢
        first_three = revealed.split()[:3]
        self.assertNotIn("▢", first_three)

    def test_reveal_bopomofo_all(self):
        """全部揭露"""
        cells = to_bopomofo_cells("钢琴")
        total = len(cells)
        revealed = reveal_bopomofo("钢琴", total)
        self.assertNotIn("▢", revealed)

    def test_count_bopomofo_cells(self):
        """格数计算"""
        count = count_bopomofo_cells("演奏厅")
        self.assertGreater(count, 0)

    def test_has_bopomofo_true(self):
        """中文可转注音"""
        self.assertTrue(has_bopomofo("钢琴"))

    def test_has_bopomofo_false(self):
        """纯英数无注音"""
        self.assertFalse(has_bopomofo("ABC123"))

    def test_empty_string(self):
        """空字串"""
        self.assertEqual(count_bopomofo_cells(""), 0)

    def test_mixed_content(self):
        """中英混合"""
        self.assertTrue(has_bopomofo("Hello世界"))
        cells = to_bopomofo_cells("钢琴ABC")
        self.assertGreater(len(cells), 0)


if __name__ == "__main__":
    unittest.main()
