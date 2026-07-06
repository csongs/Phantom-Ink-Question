"""
LLM 後端 — Hugging Face Inference API（免下載模型，免費）

用法：
    backend = HFInferenceBackend(token="hf_...", model="Qwen/Qwen2.5-7B-Instruct")
    reply = backend.chat(messages, temperature=0.7)
"""

import json
import re
from abc import ABC, abstractmethod
from typing import Optional


class LLMBackend(ABC):
    """LLM 後端抽象介面"""

    @abstractmethod
    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        response_format: Optional[dict] = None,
    ) -> str:
        ...

    @abstractmethod
    def model_name(self) -> str:
        ...


class HFInferenceBackend(LLMBackend):
    """Hugging Face Inference API 後端（透過 huggingface_hub）

    優點：
    - 不用下載模型（節省 15GB+ 空間）
    - 不需要 GPU（一般 CPU 即可，Colab 免費額度足夠）
    - Hugging Face 免費方案每天有 generous 的用量
    """

    def __init__(
        self,
        token: str,
        model: str = "Qwen/Qwen2.5-7B-Instruct",
    ):
        from huggingface_hub import InferenceClient
        self._client = InferenceClient(token=token)
        self._model = model
        print(f"✅ HF Inference API 已連接：{model}")

    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        response_format: Optional[dict] = None,
    ) -> str:
        kwargs = dict(
            model=self._model,
            messages=messages,
            temperature=temperature,
        )
        if max_tokens:
            kwargs["max_tokens"] = max_tokens

        response = self._client.chat_completion(**kwargs)
        reply = response.choices[0].message.content

        # 如果是 JSON 格式要求，擷取 JSON 區塊
        if response_format and response_format.get("type") == "json_object":
            reply = self._extract_json(reply)

        return reply

    def model_name(self) -> str:
        return self._model

    def _extract_json(self, text: str) -> str:
        """從模型輸出中提取 JSON 區塊"""
        # 嘗試找 ```json ... ```
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if match:
            return match.group(1).strip()

        # 嘗試找 { ... }
        brace_start = text.find("{")
        if brace_start >= 0:
            depth = 0
            for i in range(brace_start, len(text)):
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                    if depth == 0:
                        return text[brace_start : i + 1].strip()

        return text
