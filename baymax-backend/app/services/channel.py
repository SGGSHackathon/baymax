"""
Channel-adaptive response formatting.
Extracted from main_v6.py §V6-B.
"""

import re


# Common emoji pattern — matches most emoji Unicode ranges
_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"  # emoticons
    "\U0001F300-\U0001F5FF"  # symbols & pictographs
    "\U0001F680-\U0001F6FF"  # transport & map symbols
    "\U0001F1E0-\U0001F1FF"  # flags
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001F900-\U0001F9FF"  # supplemental symbols
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "\U00002600-\U000026FF"
    "\U0000FE0F"             # variation selector
    "]+",
    flags=re.UNICODE,
)


def _strip_for_sms(text: str) -> str:
    """Convert WhatsApp-formatted text to clean SMS-safe plain text."""
    # Remove emojis
    text = _EMOJI_RE.sub("", text)
    # *bold* → BOLD (uppercase for emphasis — SMS has no formatting)
    text = re.sub(r"\*([^*\n]+)\*", lambda m: m.group(1).upper(), text)
    # _italic_ → plain
    text = re.sub(r"_([^_\n]+)_", r"\1", text)
    # ~strikethrough~ → plain
    text = re.sub(r"~([^~\n]+)~", r"\1", text)
    # Collapse multiple blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Collapse multiple spaces
    text = re.sub(r"  +", " ", text)
    return text.strip()


def format_for_channel(text: str, channel: str) -> str:
    """
    Adapts reply text for the target channel.
    WhatsApp: *bold*, plain, concise, emoji-first
    Web:      Markdown ## headers, **bold**, richer layout
    SMS:      Plain text, no emoji, CAPS for emphasis, concise
    """
    if channel == "web":
        # Convert WhatsApp bold (*text*) → Markdown bold (**text**)
        text = re.sub(r"\*([^*\n]+)\*", r"**\1**", text)
        # Add horizontal rule before disclaimers
        text = text.replace("_⚕️ For informational", "\n---\n_⚕️ For informational")
        return text

    if channel == "sms":
        return _strip_for_sms(text)

    # WhatsApp is already formatted correctly as-is (V5 format)
    return text


def channel_disclaimer(channel: str) -> str:
    if channel == "web":
        return "\n\n---\n> ⚕️ *For informational purposes only. Not a substitute for professional medical advice.*"
    if channel == "sms":
        return "\n\nFor informational purposes only. Not a substitute for professional medical advice."
    return "\n\n_⚕️ For informational purposes only. Not a substitute for professional medical advice._"
