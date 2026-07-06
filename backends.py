"""
LLM 後端抽象層 — 支援 OpenAI API 與 Hugging Face 本地模型。

用法：
    backend = OpenAIBackend(api_key="...")
    # 或
    backend = HFBackend(model_name="Qwen/Qwen2.5-7B-Instruct")

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
        """發送對話訊息，回傳文字回覆"""
        ...

    @abstractmethod
    def model_name(self) -> str:
        """回傳當前使用的模型名稱"""
        ...

    def supports_json_mode(self) -> bool:
        """是否支援原生 response_format='json_object' 模式"""
        return False


class OpenAIBackend(LLMBackend):
    """OpenAI 相容 API 後端（支援 OpenAI、Gemini、OpenRouter、vLLM 等）"""

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        model: str = "gpt-4o",
    ):
        from openai import OpenAI
        self._client = OpenAI(api_key=api_key, base_url=base_url)
        self._model = model

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
        return response.choices[0].message.content

    def model_name(self) -> str:
        return self._model

    def supports_json_mode(self) -> bool:
        return True


class HFBackend(LLMBackend):
    """Hugging Face Transformers 本地模型後端（4-bit 量化，適合 Colab T4）"""

    def __init__(
        self,
        model_name: str = "Qwen/Qwen2.5-7B-Instruct",
        device: str = "auto",
        load_in_4bit: bool = True,
        max_new_tokens: int = 2048,
    ):
        import torch
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
            pipeline,
        )

        print(f"⏳ 正在載入模型 {model_name} ...")

        quant_config = None
        if load_in_4bit and torch.cuda.is_available():
            quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
            )

        tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            quantization_config=quant_config,
            device_map=device,
            trust_remote_code=True,
            torch_dtype=torch.float16 if torch.cuda.is_available() else "auto",
        )

        self._pipe = pipeline(
            "text-generation",
            model=model,
            tokenizer=tokenizer,
            max_new_tokens=max_new_tokens,
        )
        self._model_name = model_name
        self._tokenizer = tokenizer
        print(f"✅ 模型載入完成：{model_name}")

    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        response_format: Optional[dict] = None,
    ) -> str:
        # 應用 chat template
        prompt = self._tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

        gen_kwargs = dict(
            temperature=temperature,
            do_sample=True,
            top_p=0.9,
        )
        if max_tokens:
            gen_kwargs["max_new_tokens"] = max_tokens

        output = self._pipe(prompt, **gen_kwargs)[0]["generated_text"]

        # 移除 prompt 部分，只保留生成的部分
        reply = output[len(prompt):].strip()

        # 如果是 JSON 格式要求，嘗試提取 JSON
        if response_format and response_format.get("type") == "json_object":
            reply = self._extract_json(reply)

        return reply

    def model_name(self) -> str:
        return self._model_name

    def _extract_json(self, text: str) -> str:
        """從模型輸出中提取 JSON 區塊"""
        # 嘗試找 ```json ... ```
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if match:
            return match.group(1).strip()

        # 嘗試找 { ... }
        brace_start = text.find("{")
        if brace_start >= 0:
            # 找到匹配的閉合括號
            depth = 0
            for i in range(brace_start, len(text)):
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                    if depth == 0:
                        return text[brace_start : i + 1].strip()

        return text


def create_backend(
    backend_type: str = "openai",
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: str = "gpt-4o",
    hf_model: str = "Qwen/Qwen2.5-7B-Instruct",
) -> LLMBackend:
    """工廠函式 — 建立對應後端"""

    if backend_type == "openai":
        if not api_key:
            raise ValueError("OpenAI 後端需要提供 api_key")
        return OpenAIBackend(api_key=api_key, base_url=base_url, model=model)

    elif backend_type == "huggingface":
        return HFBackend(model_name=hf_model)

    else:
        raise ValueError(f"不支援的後端類型：{backend_type}")
