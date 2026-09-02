"""설정.

프로필 여러 개를 두고 그중 하나가 활성이다. 프로필에 앱을 지정해 두면 그
앱이 앞으로 나올 때 자동으로 전환된다.

칸 하나는 무엇을 보여줄지(key), 그 키의 개별 설정(options), 누를 때 할
일(action)을 가진다. 예전 형식(layout 과 actions 가 따로)도 읽어서 옮긴다.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import actions as actions_module
from .device import KEY_COUNT

CONFIG_PATH = Path.home() / ".config" / "mirabox" / "config.json"
DEFAULT_PROFILE = "기본"


@dataclass
class Slot:
    key: str | None = None
    options: dict = field(default_factory=dict)
    action: dict = field(default_factory=lambda: {"type": actions_module.NONE, "value": ""})

    @staticmethod
    def parse(raw) -> "Slot":
        if isinstance(raw, str) or raw is None:          # 예전 형식
            return Slot(key=raw or None)
        return Slot(key=raw.get("key") or None,
                    options=dict(raw.get("options") or {}),
                    action=actions_module.normalize(raw.get("action")))


def _default_slots() -> list[Slot]:
    names = ["five", "seven", "ctx", "cost", "cache", None,
             "today", "burn", "mail", "cal", "jira", None,
             "mr", "build", None, None, None, None]
    return [Slot(key=name) for name in names]


@dataclass
class Profile:
    name: str = DEFAULT_PROFILE
    slots: list[Slot] = field(default_factory=_default_slots)
    app: str = ""            # 이 앱이 앞에 오면 자동 전환. 빈 값이면 수동 전환만

    def normalized(self) -> "Profile":
        slots = (list(self.slots) + [Slot() for _ in range(KEY_COUNT)])[:KEY_COUNT]
        return Profile(name=self.name or DEFAULT_PROFILE, slots=slots, app=self.app or "")

    def keys_in_use(self) -> set[str]:
        return {slot.key for slot in self.slots if slot.key}


@dataclass
class Config:
    profiles: list[Profile] = field(default_factory=lambda: [Profile()])
    active: str = DEFAULT_PROFILE
    brightness: int = 80
    refresh_seconds: float = 15.0

    def normalized(self) -> "Config":
        profiles = [p.normalized() for p in self.profiles] or [Profile()]
        names = {p.name for p in profiles}
        return Config(profiles=profiles,
                      active=self.active if self.active in names else profiles[0].name,
                      brightness=max(0, min(100, int(self.brightness))),
                      refresh_seconds=max(2.0, float(self.refresh_seconds)))

    def profile(self, name: str | None = None) -> Profile:
        target = name or self.active
        for entry in self.profiles:
            if entry.name == target:
                return entry
        return self.profiles[0]

    def profile_for_app(self, app: str) -> Profile | None:
        """앞으로 나온 앱에 묶인 프로필. 없으면 None."""
        if not app:
            return None
        for entry in self.profiles:
            if entry.app and entry.app.lower() == app.lower():
                return entry
        return None


def _from_raw(raw: dict) -> Config:
    if "profiles" in raw:
        profiles = [
            Profile(name=p.get("name", DEFAULT_PROFILE),
                    slots=[Slot.parse(s) for s in (p.get("slots") or [])],
                    app=p.get("app", ""))
            for p in raw["profiles"]
        ]
        return Config(profiles=profiles or [Profile()],
                      active=raw.get("active", DEFAULT_PROFILE),
                      brightness=raw.get("brightness", 80),
                      refresh_seconds=raw.get("refresh_seconds", 15.0))

    # 예전 형식: layout 과 actions 가 따로 있었다
    slots = [Slot.parse(name) for name in (raw.get("layout") or [])]
    for index_text, action in (raw.get("actions") or {}).items():
        try:
            index = int(index_text)
        except ValueError:
            continue
        if 0 <= index < len(slots):
            slots[index].action = actions_module.normalize(action)
    return Config(profiles=[Profile(slots=slots or _default_slots())],
                  brightness=raw.get("brightness", 80),
                  refresh_seconds=raw.get("refresh_seconds", 15.0))


def load(path: Path = CONFIG_PATH) -> Config:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Config().normalized()
    return _from_raw(raw).normalized()


def save(config: Config, path: Path = CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(asdict(config.normalized()), ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(path)
