from pydantic import BaseModel, Field
from typing import Optional


class QuestionItem(BaseModel):
    """單題問答"""
    question: str = Field(description="問題")
    reply: str = Field(description="回答（不超過六個中文字）")


class QuestionSet(BaseModel):
    """一組完整的七題問答"""
    answer: str = Field(description="謎底（具體名詞）")
    questions: list[QuestionItem] = Field(description="七道問答，由難到易")


class ReviewResult(BaseModel):
    """驗題結果"""
    score: int = Field(description="評分 0-100")
    passed: bool = Field(description="是否通過驗證")
    comments: list[str] = Field(description="逐項檢查意見")


class SimulationRound(BaseModel):
    """模擬玩家的一回合"""
    round_number: int = Field(description="第幾題")
    question: str = Field(description="該題問題")
    reply: str = Field(description="該題回答")
    ink_revealed: str = Field(description="已揭露的注音")
    player_guess: Optional[str] = Field(description="玩家這次的猜測", default=None)
    guessed_correctly: bool = Field(description="是否猜中", default=False)


class SimulationResult(BaseModel):
    """模擬玩家結果"""
    guess_round: int = Field(description="在第幾題猜出")
    ink_used: int = Field(description="總共用掉多少注音格數")
    confidence: float = Field(description="信心指數 0-1")
    too_easy: bool = Field(description="是否太簡單")
    too_hard: bool = Field(description="是否太難")
    reason: str = Field(description="原因說明")
    rounds: list[SimulationRound] = Field(description="每回合記錄")


class QuestionSetWithMeta(BaseModel):
    """含元資料的完整題組"""
    answer: str
    questions: list[QuestionItem]
    review: Optional[ReviewResult] = None
    simulation: Optional[SimulationResult] = None
    retry_count: int = 0
