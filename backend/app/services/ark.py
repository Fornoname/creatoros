"""火山方舟 LLM 调用服务：对话、结构化 JSON 输出。"""
import json
import re

import httpx

from ..config import settings


class ArkError(Exception):
    pass


def _extract_json(text: str) -> dict:
    """优先 json.loads，失败时提取首个 ```json 块或 {} 块。"""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            raise ArkError(f"模型未返回合法 JSON: {text[:200]}")
    raise ArkError(f"模型未返回 JSON: {text[:200]}")


async def chat(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> str:
    """普通对话。model 默认 Lite（选题批量/日常），关键创作用 Pro。"""
    if not settings.ark_api_key:
        raise ArkError("未配置 ARK_API_KEY（.env.local）")
    model = model or settings.ark_model_lite
    url = f"{settings.ark_base_url}/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.ark_api_key}"},
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as e:
        raise ArkError(f"方舟 API 错误 {e.response.status_code}: {e.response.text[:200]}")
    except httpx.TimeoutException:
        raise ArkError("方舟 API 超时")


async def chat_json(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict:
    """请求 JSON 结构化输出。"""
    if not settings.ark_api_key:
        raise ArkError("未配置 ARK_API_KEY（.env.local）")
    model = model or settings.ark_model_lite
    url = f"{settings.ark_base_url}/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.ark_api_key}"},
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
            content = data["choices"][0]["message"]["content"]
            return _extract_json(content)
    except httpx.HTTPStatusError as e:
        raise ArkError(f"方舟 API 错误 {e.response.status_code}: {e.response.text[:200]}")
    except httpx.TimeoutException:
        raise ArkError("方舟 API 超时")
