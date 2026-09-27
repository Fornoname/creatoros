"""多模态向量服务：Doubao Embedding Vision（文本/图片 → 2048 维），余弦检索。"""
import json

import httpx
import numpy as np

from ..config import settings


class EmbeddingError(Exception):
    pass


async def embed_text(text: str) -> list[float]:
    """文本向量化。"""
    if not settings.ark_api_key:
        raise EmbeddingError("未配置 ARK_API_KEY")
    url = f"{settings.ark_base_url}/embeddings/multimodal"
    payload = {"model": settings.ark_model_embedding, "input": [{"type": "text", "text": text[:3000]}]}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, headers={"Authorization": f"Bearer {settings.ark_api_key}"}, json=payload)
            r.raise_for_status()
            data = r.json()
            d = data["data"]
            if isinstance(d, list):
                d = d[0]
            return d["embedding"]
    except httpx.HTTPStatusError as e:
        raise EmbeddingError(f"向量 API 错误 {e.response.status_code}: {e.response.text[:200]}")
    except httpx.TimeoutException:
        raise EmbeddingError("向量 API 超时")


async def embed_image_url(image_url: str) -> list[float]:
    """图片向量化（封面/素材图）。"""
    url = f"{settings.ark_base_url}/embeddings/multimodal"
    payload = {"model": settings.ark_model_embedding, "input": [{"type": "image", "image": image_url}]}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers={"Authorization": f"Bearer {settings.ark_api_key}"}, json=payload)
        r.raise_for_status()
        d = r.json()["data"]
        if isinstance(d, list):
            d = d[0]
        return d["embedding"]


def cosine_search(query_vector: list[float], items: list[dict], top_k: int = 5) -> list[dict]:
    """items: [{id, label, embedding}]。返回按相似度降序的 [{id, label, score}]。"""
    if not items:
        return []
    q = np.asarray(query_vector, dtype=np.float32)
    rows = []
    for it in items:
        vec = it.get("embedding")
        if not vec:
            continue
        v = np.asarray(vec, dtype=np.float32)
        qn = np.linalg.norm(q)
        vn = np.linalg.norm(v)
        if qn == 0 or vn == 0:
            continue
        score = float(np.dot(q, v) / (qn * vn))
        rows.append({"id": it["id"], "label": it.get("label", ""), "score": round(score, 4)})
    rows.sort(key=lambda x: x["score"], reverse=True)
    return rows[:top_k]


def _load_vector(raw: list | str | None) -> list[float] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None
