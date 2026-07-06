# Phantom Ink Question Generator

AI 驅動的「靈媒遊戲」問答題目生成器。

## 流程

1. **出題** — AI 扮演出題老師，產生七道由難到易的問答
2. **驗題** — AI 扮演驗題老師，檢查題目品質
3. **模擬** — AI 扮演玩家，逐題模擬猜測過程
4. **注音轉換** — 自動將回答轉換為注音符號

## 使用方式

```python
from generator import PhantomInkGenerator

gen = PhantomInkGenerator(api_key="YOUR_API_KEY")
result = gen.generate("鋼琴")
print(result)
```
