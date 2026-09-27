"""封面生成服务：AI（Seedream，含模型回退）+ 程序化模板（兜底，永远可用）。"""
import textwrap
import uuid
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..config import settings

MEDIA_DIR = Path(__file__).resolve().parent.parent.parent / "media"
COVER_DIR = MEDIA_DIR / "covers"


class CoverError(Exception):
    pass


def _font(size: int, bold: bool = False):
    """加载 macOS 苹方字体。"""
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size, index=1 if bold else 0)
        except Exception:
            continue
    return ImageFont.load_default()


def generate_template_cover(prompt: str) -> str:
    """程序化竖版封面（1080x1920 深色 + 紫色点缀 + 居中标题），永不离线。"""
    COVER_DIR.mkdir(parents=True, exist_ok=True)
    W, H = 1080, 1920

    top = (13, 13, 24)
    bottom = (34, 22, 64)
    img = Image.new("RGB", (W, H), top)
    px = img.load()
    for y in range(H):
        t = y / H
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(W):
            px[x, y] = (r, g, b)

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W * 0.3, H * 0.05, W * 0.85, H * 0.45), fill=(124, 58, 237, 60))
    gd.ellipse((-W * 0.2, H * 0.6, W * 0.5, H * 1.05), fill=(89, 42, 190, 45))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    draw = ImageDraw.Draw(img)

    badge_font = _font(40, bold=True)
    draw.text((70, 100), "CreatorOS", fill=(165, 128, 255, 255), font=badge_font)
    draw.text((70, 165), "AI 编导工作台", fill=(170, 170, 190, 255), font=_font(30))

    title_text = prompt.replace("\n", " ").strip() or "新作发布"
    if len(title_text) > 36:
        title_text = title_text[:36] + "…"
    lines = textwrap.wrap(title_text, width=12)[:6]
    title_font = _font(88, bold=True)
    line_h = 118
    total = len(lines) * line_h
    y = (H + total) // 2 - 160
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=title_font)
        lw = bbox[2] - bbox[0]
        x = (W - lw) // 2
        draw.text((x + 6, y + 6), line, fill=(0, 0, 0, 120), font=title_font)
        draw.text((x, y), line, fill=(245, 245, 250, 255), font=title_font)
        y += line_h

    draw.text((70, H - 160), "· 竖版 9:16 ·", fill=(130, 130, 155, 255), font=_font(34))

    fname = f"cover_tpl_{uuid.uuid4().hex[:12]}.png"
    path = COVER_DIR / fname
    img.save(path, "PNG")
    return f"/media/covers/{fname}"


async def generate_cover(prompt: str, size: str = "1024x1024") -> str:
    """生成封面图，下载到本地 media/covers/，返回可访问 URL。
    主模型限流（429）时自动回退到备用模型。"""
    if not settings.ark_api_key:
        raise CoverError("未配置 ARK_API_KEY")
    COVER_DIR.mkdir(parents=True, exist_ok=True)
    url = f"{settings.ark_base_url}/images/generations"
    models = [settings.ark_model_image] + list(settings.ark_model_image_fallback)
    last_err = ""
    async with httpx.AsyncClient(timeout=180) as client:
        for model in models:
            payload = {"model": model, "prompt": prompt[:1500], "size": size}
            try:
                r = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {settings.ark_api_key}"},
                    json=payload,
                )
                if r.status_code == 429:
                    last_err = f"模型 {model} 用量上限：{r.text[:150]}"
                    continue
                r.raise_for_status()
                data = r.json()
                image_url = data["data"][0]["url"]
                img = await client.get(image_url)
                img.raise_for_status()
                fname = f"cover_{uuid.uuid4().hex[:12]}.png"
                path = COVER_DIR / fname
                path.write_bytes(img.content)
                return f"/media/covers/{fname}"
            except httpx.HTTPStatusError as e:
                last_err = f"模型 {model} 错误 {e.response.status_code}: {e.response.text[:150]}"
            except httpx.TimeoutException:
                last_err = f"模型 {model} 超时"
    raise CoverError(f"所有生图模型均失败：{last_err}")
