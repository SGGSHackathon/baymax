"""
Sarvam.ai multilingual service — language detection, translation, TTS, STT.

Endpoints used:
  POST /text-lid          — detect language of text
  POST /translate         — translate text between languages
  POST /transliterate     — transliterate text (script swap)
  POST /text-to-speech    — convert text → base64 audio (REST)
  POST /speech-to-text    — convert audio → text (REST)

Auth header: api-subscription-key: <key>
"""

import logging
import httpx
from typing import Optional

from app.config import C

logger = logging.getLogger("medai.sarvam")

_BASE = C.SARVAM_BASE_URL          # https://api.sarvam.ai
_HEADERS = {
    "Content-Type": "application/json",
    "api-subscription-key": C.SARVAM_API_KEY,
}

# Supported language codes (BCP-47 Indic + English)
SUPPORTED_LANGS = {
    "en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN",
    "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
    # Extended (sarvam-translate:v1 only)
    "as-IN", "ur-IN", "ne-IN", "kok-IN", "ks-IN", "sd-IN",
    "sa-IN", "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
}

# Mapping from short codes to BCP-47 format
_SHORT_TO_BCP47 = {
    "en": "en-IN", "hi": "hi-IN", "bn": "bn-IN", "gu": "gu-IN",
    "kn": "kn-IN", "ml": "ml-IN", "mr": "mr-IN", "od": "od-IN",
    "pa": "pa-IN", "ta": "ta-IN", "te": "te-IN", "as": "as-IN",
    "ur": "ur-IN", "ne": "ne-IN", "kok": "kok-IN", "ks": "ks-IN",
    "sd": "sd-IN", "sa": "sa-IN", "sat": "sat-IN", "mni": "mni-IN",
    "brx": "brx-IN", "mai": "mai-IN", "doi": "doi-IN",
}


def normalize_lang_code(code: str) -> str:
    """Convert short lang codes ('hi', 'mr') to BCP-47 ('hi-IN', 'mr-IN').
    Already-valid codes are returned unchanged."""
    if not code:
        return "en-IN"
    code = code.strip()
    if code in SUPPORTED_LANGS:
        return code
    return _SHORT_TO_BCP47.get(code, "en-IN")

# ── helpers ────────────────────────────────────────────────────

async def _post(path: str, body: dict, timeout: float = 15.0) -> Optional[dict]:
    """Fire a JSON POST to Sarvam and return parsed response."""
    url = f"{_BASE}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=body, headers=_HEADERS)
            if resp.status_code == 200:
                return resp.json()
            logger.warning("Sarvam %s → %s: %s", path, resp.status_code, resp.text[:300])
    except Exception as e:
        logger.error("Sarvam %s error: %s", path, e)
    return None


async def _post_form(path: str, files: dict, data: dict = None,
                     timeout: float = 30.0) -> Optional[dict]:
    """Fire a multipart POST (used by STT)."""
    url = f"{_BASE}{path}"
    headers = {"api-subscription-key": C.SARVAM_API_KEY}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, files=files, data=data or {}, headers=headers)
            if resp.status_code == 200:
                return resp.json()
            logger.warning("Sarvam %s → %s: %s", path, resp.status_code, resp.text[:300])
    except Exception as e:
        logger.error("Sarvam %s error: %s", path, e)
    return None


# ── 1. Language Detection ──────────────────────────────────────

async def detect_language(text: str) -> Optional[str]:
    """
    Detect the language of *text* using /text-lid.
    Returns BCP-47 code like "hi-IN", "en-IN", etc. or None on failure.
    """
    data = await _post("/text-lid", {"input": text[:1000]})
    if data:
        return data.get("language_code")
    return None


# ── 2. Translation ─────────────────────────────────────────────

async def _translate_chunk(text: str, src: str, tgt: str) -> str:
    """Translate a single chunk (≤2000 chars).
    Preserves newlines by using placeholders that survive translation."""
    src = normalize_lang_code(src)
    tgt = normalize_lang_code(tgt)

    # Replace newlines with a unique placeholder that Sarvam won't strip
    _NL_PLACEHOLDER = " @@NL@@ "
    text_safe = text.replace("\n", _NL_PLACEHOLDER)

    body = {
        "input": text_safe,
        "source_language_code": src,
        "target_language_code": tgt,
        "model": "mayura:v1",
        "mode": "formal",
    }
    data = await _post("/translate", body)
    if data and data.get("translated_text"):
        # Restore newlines from placeholder
        result = data["translated_text"]
        result = result.replace(_NL_PLACEHOLDER, "\n")
        result = result.replace("@@NL@@", "\n")      # handle if spaces got trimmed
        return result
    return text          # fallback: return original


def _split_chunks(text: str, max_len: int = 1900) -> list[str]:
    """Split text into chunks ≤ max_len at sentence/newline boundaries."""
    if len(text) <= max_len:
        return [text]
    chunks, current = [], ""
    for line in text.split("\n"):
        if len(current) + len(line) + 1 <= max_len:
            current += ("" if not current else "\n") + line
        else:
            if current:
                chunks.append(current)
            # If single line exceeds max_len, hard-split at last space
            while len(line) > max_len:
                idx = line[:max_len].rfind(" ")
                idx = idx if idx > 0 else max_len
                chunks.append(line[:idx])
                line = line[idx:].lstrip()
            current = line
    if current:
        chunks.append(current)
    return chunks


async def translate_to_english(text: str, source_lang: str = "auto") -> tuple[str, str]:
    """
    Translate *text* from any supported language to English.

    Returns (english_text, detected_source_language_code).
    If the text is already English, returns it unchanged.
    """
    if not C.SARVAM_API_KEY:
        return text, "en-IN"

    # Quick detect first
    detected = source_lang
    if source_lang == "auto":
        detected = await detect_language(text) or "en-IN"

    if detected == "en-IN":
        return text, "en-IN"

    # Chunk-aware translation
    chunks = _split_chunks(text)
    translated_parts = []
    for chunk in chunks:
        t = await _translate_chunk(chunk, detected, "en-IN")
        translated_parts.append(t)
    return "\n".join(translated_parts), detected


async def translate_from_english(text: str, target_lang: str) -> str:
    """
    Translate English *text* to the user's preferred language.
    If target is already English, returns unchanged.
    """
    target_lang = normalize_lang_code(target_lang)
    if not C.SARVAM_API_KEY or not target_lang or target_lang == "en-IN":
        return text

    chunks = _split_chunks(text)
    translated_parts = []
    for chunk in chunks:
        t = await _translate_chunk(chunk, "en-IN", target_lang)
        translated_parts.append(t)
    return "\n".join(translated_parts)


# ── 3. Text-to-Speech (REST) ──────────────────────────────────

async def text_to_speech(text: str, lang: str = "hi-IN",
                         speaker: str = "anushka",
                         model: str = "bulbul:v2") -> Optional[str]:
    """
    Convert *text* to speech audio.
    Returns base64-encoded WAV string, or None on failure.
    """
    if not C.SARVAM_API_KEY:
        return None

    body = {
        "text": text[:1500],          # bulbul:v2 limit
        "target_language_code": lang,
        "speaker": speaker,
        "model": model,
        "pace": 1.0,
        "enable_preprocessing": True,
    }
    data = await _post("/text-to-speech", body, timeout=30.0)
    if data and data.get("audios"):
        return data["audios"][0]       # first (and only) audio base64
    return None


# ── 4. Speech-to-Text (REST) ──────────────────────────────────

async def speech_to_text(audio_bytes: bytes, filename: str = "audio.wav",
                         language_code: str = "unknown",
                         model: str = "saarika:v2.5") -> tuple[Optional[str], Optional[str]]:
    """
    Transcribe audio to text.

    Returns (transcript, detected_language_code) or (None, None) on failure.
    """
    if not C.SARVAM_API_KEY:
        return None, None

    files = {"file": (filename, audio_bytes)}
    form_data = {"model": model, "language_code": language_code}

    data = await _post_form("/speech-to-text", files=files, data=form_data, timeout=30.0)
    if data:
        return data.get("transcript"), data.get("language_code")
    return None, None


async def speech_to_text_translate(audio_bytes: bytes, filename: str = "audio.wav") -> tuple[Optional[str], Optional[str]]:
    """
    Transcribe audio AND translate to English in one call (saaras:v3 translate mode).

    Returns (english_transcript, detected_language_code).
    """
    if not C.SARVAM_API_KEY:
        return None, None

    files = {"file": (filename, audio_bytes)}
    form_data = {
        "model": "saaras:v3",
        "mode": "translate",
        "language_code": "unknown",
    }

    data = await _post_form("/speech-to-text", files=files, data=form_data, timeout=30.0)
    if data:
        return data.get("transcript"), data.get("language_code")
    return None, None


# ── 5. Transliterate ──────────────────────────────────────────

async def transliterate(text: str, source_lang: str, target_lang: str) -> Optional[str]:
    """
    Transliterate *text* from one script to another (preserves pronunciation).
    e.g. "namaste" → "नमस्ते"
    """
    if not C.SARVAM_API_KEY:
        return None

    body = {
        "input": text[:1000],
        "source_language_code": source_lang,
        "target_language_code": target_lang,
    }
    data = await _post("/transliterate", body)
    if data:
        return data.get("transliterated_text")
    return None
