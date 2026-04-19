"""
utils/parser.py – Manual fallback parser for explicit /commands.

When the user types a structured command (e.g. /add Event John Maria category Staff)
Gemini is not needed and we parse locally to save latency and API costs.
"""

from __future__ import annotations

import re


def parse_add_command(args: list[str]) -> tuple[str, list[str], str]:
    """
    Parse arguments from:
      /add <event_name [words]> <names...> category <category_name>

    Returns (event_name, participants, category).

    Examples
    --------
    /add Leadership Meeting John Maria category Staff
    → ("Leadership Meeting", ["John", "Maria"], "Staff")

    /add Evangelism Training David
    → ("Evangelism Training", ["David"], "")
    """
    text = " ".join(args)

    # Try to split on "category" keyword (case-insensitive)
    category_match = re.search(r"\bcategory\b\s+(\S+.*)", text, re.IGNORECASE)
    category = ""
    if category_match:
        category = category_match.group(1).strip()
        text = text[: category_match.start()].strip()

    # Separate event name from participant names.
    # Heuristic: the event name is made of Title-Cased words; participant names
    # are also Title-Cased, so we need another separator signal.
    # Strategy: tokenise into words and find the longest known prefix that
    # forms a reasonable event name vs. single-word participant names.
    # We use a simpler approach: if there are quoted tokens, use them.
    # Otherwise treat the first N title-cased multi-word tokens as event name
    # and single-word tokens at the end as names.
    # For robustness this is kept intentionally simple; Gemini handles the
    # ambiguous cases via natural language.

    tokens = text.split()
    # Participants are always single words in the /add syntax.
    # Scan from the right: collect single-word capitalised tokens as names
    # until we hit a token that is lowercase (part of event name).
    participants: list[str] = []
    event_tokens: list[str] = []

    # Simple split: look for all-caps or mixed-case single-word names at end
    # We'll try to find where participant names start by scanning backwards.
    i = len(tokens) - 1
    while i >= 0:
        word = tokens[i]
        # A word is a participant name candidate if it looks like a given name
        # (title-cased single word) AND is not obviously part of a multi-word
        # event title. We stop accumulating if we find a lowercase word.
        if word[0].isupper() and word.isalpha():
            participants.insert(0, word)
            i -= 1
        else:
            break

    event_tokens = tokens[: i + 1]

    # Edge case: if nothing was identified as event, take first two words
    if not event_tokens and participants:
        event_tokens = participants[:2]
        participants = participants[2:]

    event_name = " ".join(event_tokens).strip()
    return event_name, participants, category


def parse_remove_command(args: list[str]) -> tuple[str, str]:
    """
    Parse arguments from:  /remove <event_name> <participant_name>

    The last word is treated as the participant name.
    Everything before it is the event name.

    Returns (event_name, participant_name).
    """
    if len(args) < 2:
        return " ".join(args), ""

    participant_name = args[-1]
    event_name = " ".join(args[:-1])
    return event_name.strip(), participant_name.strip()


def parse_list_command(args: list[str]) -> str:
    """Return the event name from /list <event_name> args."""
    return " ".join(args).strip()
