"""소스와 키 등록소.

연동(integrations) 은 여기에 자기 데이터 소스와 키를 등록한다. 코어는
무엇이 등록됐는지만 알 뿐 각 연동의 사정은 모른다. 연동을 하나 추가하는
일이 파일 하나 추가로 끝나게 하려는 구조다.

키는 자기가 필요한 소스를 선언한다. 데몬은 보드에 올라온 키가 요구하는
소스만 켠다. MAIL 키를 안 쓰면 Gmail 을 아예 호출하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from PIL import Image

from .state import State

FetchFn = Callable[[], Any]
RenderFn = Callable[[int, State, dict], Image.Image]


@dataclass(frozen=True)
class Source:
    name: str
    fetch: FetchFn
    every: float          # 초


@dataclass(frozen=True)
class Option:
    """키마다 다른 개별 설정. 조작 화면이 이걸 보고 입력란을 만든다."""
    name: str
    label: str
    kind: str = "text"        # text 또는 file
    placeholder: str = ""


@dataclass(frozen=True)
class Key:
    name: str
    label: str            # 키에 찍히는 짧은 이름
    summary: str          # 조작 화면에 보여줄 한 줄 설명
    render: RenderFn
    sources: frozenset[str]
    options: tuple[Option, ...] = ()


SOURCES: dict[str, Source] = {}
KEYS: dict[str, Key] = {}


def source(name: str, every: float) -> Callable[[FetchFn], FetchFn]:
    """데이터 소스를 등록한다. fetch 는 실패하면 예외를 던지면 된다."""
    def register(fn: FetchFn) -> FetchFn:
        SOURCES[name] = Source(name, fn, every)
        return fn
    return register


def key(name: str, label: str, summary: str,
        sources: tuple[str, ...] = (),
        options: tuple[Option, ...] = ()) -> Callable[[RenderFn], RenderFn]:
    def register(fn: RenderFn) -> RenderFn:
        KEYS[name] = Key(name, label, summary, fn, frozenset(sources), options)
        return fn
    return register


def sources_for(key_names) -> set[str]:
    """이 키들을 그리는 데 필요한 소스 이름."""
    needed: set[str] = set()
    for name in key_names:
        entry = KEYS.get(name)
        if entry:
            needed |= entry.sources
    return needed
