"""키를 그릴 때 넘겨받는 상태.

소스 이름으로 값을 꺼낸다. 값이 아직 없으면 None 이다. 키는 None 을 받았을 때
빈 카드를 그리도록 만들어야 한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class State:
    data: dict[str, Any] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)

    def get(self, source: str, default: Any = None) -> Any:
        value = self.data.get(source)
        return default if value is None else value

    def failed(self, source: str) -> bool:
        return source in self.errors
