"""
LLM 後端 — 支援 Hugging Face Inference API 與 Groq API

用法：
    backend = HFInferenceBackend(token="hf_...", model="Qwen/Qwen2.5-7B-Instruct")
    reply = backend.chat(messages, temperature=0.7)

    backend = GroqBackend(api_key="gsk_...", model="qwen-2.5-coder-32b")
    reply = backend.chat(messages, temperature=0.7)
"""

import json
import re
from typing import Optional


class LLMBackend:
    """LLM 後端抽象介面"""

    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        response_format: Optional[dict] = None,
    ) -> str:
        raise NotImplementedError

    def model_name(self) -> str:
        raise NotImplementedError

    @staticmethod
    def _extract_json(text: str) -> str:
        """從模型輸出中提取 JSON 區塊"""
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if match:
            return match.group(1).strip()

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


class HFInferenceBackend(LLMBackend):
    """Hugging Face Inference API 後端（透過 huggingface_hub）

    優點：
    - 不用下載模型
    - 不需要 GPU
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

        if response_format and response_format.get("type") == "json_object":
            reply = self._extract_json(reply)

        return reply

    def model_name(self) -> str:
        return self._model


class GroqBackend(LLMBackend):
    """Groq API 後端

    優點：
    - 免費額度比 HF 更慷慨
    - 生成速度極快
    - 支援 Llama、Qwen 等開源模型

    申請 API Key：https://console.groq.com/keys
    """

    def __init__(
        self,
        api_key: str,
        model: str = "qwen/qwen3-32b",
    ):
        from groq import Groq
        self._client = Groq(api_key=api_key)
        self._model = model
        print(f"✅ Groq API 已連接：{model}")

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
        if response_format:
            kwargs["response_format"] = response_format

        response = self._client.chat.completions.create(**kwargs)
        reply = response.choices[0].message.content

        if response_format and response_format.get("type") == "json_object":
            reply = self._extract_json(reply)

        return reply

    def model_name(self) -> str:
        return self._model
