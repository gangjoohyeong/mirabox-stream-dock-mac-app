"""키 배치와 동작 설정.

파일이 없으면 기본값을 쓰고, 처음 실행할 때 만들어 둔다. 조작 화면이
생기면 이 파일을 고치는 방식이 된다.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import actions as actions_module
from .device import KEY_COUNT

CONFIG_PATH = Path.home() / ".config" / "mirabox" / "config.json"

# 좌상단부터 행 우선. None 은 빈 칸이다.
DEFAULT_LAYOUT: list[str | None] = [
    "five", "seven", "ctx", "cost", "cache", None,
    "today", "burn", "mail", "cal", "jira", None,
    "mr", "build", None, None, None, None,
]


@dataclass
class Config:
    layout: list[str | None] = field(default_factory=lambda: list(DEFAULT_LAYOUT))
    brightness: int = 80
    refresh_seconds: float = 15.0
    # 키 번호 문자열 -> 동작. actions.py 의 구조를 따른다
    actions: dict[str, dict] = field(default_factory=dict)

    def normalized(self) -> "Config":
        layout = (self.layout + [None] * KEY_COUNT)[:KEY_COUNT]
        return Config(layout=layout,
                      brightness=max(0, min(100, int(self.brightness))),
                      refresh_seconds=max(2.0, float(self.refresh_seconds)),
                      actions={k: actions_module.normalize(v)
                               for k, v in self.actions.items()})

    def keys_in_use(self) -> set[str]:
        return {name for name in self.layout if name}


def load(path: Path = CONFIG_PATH) -> Config:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Config().normalized()
    return Config(
        layout=raw.get("layout", list(DEFAULT_LAYOUT)),
        brightness=raw.get("brightness", 80),
        refresh_seconds=raw.get("refresh_seconds", 15.0),
        actions=raw.get("actions", {}),
    ).normalized()


def save(config: Config, path: Path = CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(asdict(config.normalized()), ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(path)
