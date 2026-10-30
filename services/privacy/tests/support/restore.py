"""Restore an anonymized text from its mapping: what the gateway will do (T-005-04).

One pass over the placeholders actually in the mapping, so a value that happens to look like
a placeholder, or a placeholder-shaped string already in the original text, is never
replaced twice or by mistake.
"""

import re
from collections.abc import Iterable, Mapping

from privacy.domain.placeholders import PLACEHOLDER_PATTERN, PlaceholderEntry


def restore(text: str, mapping: Iterable[PlaceholderEntry] | Mapping[str, str]) -> str:
    values = (
        dict(mapping)
        if isinstance(mapping, Mapping)
        else {entry.placeholder: entry.value for entry in mapping}
    )

    def replace(match: re.Match[str]) -> str:
        return values.get(match.group(0), match.group(0))

    return PLACEHOLDER_PATTERN.sub(replace, text)
