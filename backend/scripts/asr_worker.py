"""ASR worker：faster-whisper 语音转文字（原字幕提取）。
用法: python asr_worker.py <wav_path> [--model base|small|medium] [--lang zh] [--model-dir <本地模型目录>]
输出: 转写文本到 stdout。
"""
import argparse
import os
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--model", default="base")
    ap.add_argument("--lang", default="zh")
    ap.add_argument("--model-dir", default=None, help="本地 faster-whisper 模型目录（优先使用，避免联网下载）")
    args = ap.parse_args()
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print(f"ASR_ERROR: faster-whisper 不可用: {e}", file=sys.stderr)
        return 2
    try:
        target = args.model_dir if args.model_dir and os.path.isdir(args.model_dir) else args.model
        model = WhisperModel(target, device="cpu", compute_type="int8")
    except Exception as e:
        print(f"ASR_ERROR: 模型加载失败: {e}", file=sys.stderr)
        return 3
    try:
        segments, _info = model.transcribe(args.wav, language=args.lang, vad_filter=True)
        text = "\n".join(seg.text.strip() for seg in segments if seg.text and seg.text.strip())
    except Exception as e:
        print(f"ASR_ERROR: 转写失败: {e}", file=sys.stderr)
        return 4
    if not text:
        print("ASR_ERROR: 未识别到语音内容", file=sys.stderr)
        return 5
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
