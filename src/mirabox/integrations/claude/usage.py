"""~/.claude/projects 의 jsonl 을 증분으로 읽어 토큰 사용량을 집계한다.

전량은 1GB 를 넘으므로 매번 다시 읽으면 안 된다. 파일별로 어디까지 읽었는지
기억하고 덧붙은 부분만 본다. 첫 스캔은 1초 남짓, 이후 갱신은 수십 밀리초다.

계정 한도 퍼센트는 여기서 나오지 않는다. 그건 snapshot.py 가 담당한다.
여기는 토큰 절대량과 소모 속도용이다.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path.home() / ".claude" / "projects"
LIVE_WINDOW = timedelta(hours=24)
BLOCK = timedelta(hours=5)
SEEN_CAP = 200_000
CHUNK = 1 << 20

_TOKEN_FIELDS = ("input_tokens", "output_tokens",
                 "cache_creation_input_tokens", "cache_read_input_tokens")


def _floor_hour(ts: datetime) -> datetime:
    return ts.replace(minute=0, second=0, microsecond=0)


class Usage:
    def __init__(self) -> None:
        self._offsets: dict[Path, int] = {}
        self._seen: set[tuple[str, str]] = set()
        self._records: list[tuple[datetime, int]] = []

    def _recent_files(self) -> list[Path]:
        cutoff = (datetime.now() - LIVE_WINDOW).timestamp()
        out = []
        for path in ROOT.rglob("*.jsonl"):
            try:
                if path.stat().st_mtime > cutoff:
                    out.append(path)
            except OSError:
                continue
        return out

    def _ingest(self, line: str) -> None:
        if not line or '"usage"' not in line:
            return
        try:
            row = json.loads(line)
        except ValueError:
            return
        message = row.get("message")
        if not isinstance(message, dict):
            return
        usage = message.get("usage")
        if not isinstance(usage, dict):
            return

        key = (message.get("id") or "", row.get("requestId") or "")
        if key in self._seen:
            return
        self._seen.add(key)

        stamp = row.get("timestamp")
        if not stamp:
            return
        try:
            when = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone()
        except ValueError:
            return
        self._records.append((when, sum(usage.get(f) or 0 for f in _TOKEN_FIELDS)))

    def refresh(self) -> None:
        for path in self._recent_files():
            try:
                size = path.stat().st_size
            except OSError:
                continue
            previous = self._offsets.get(path, 0)
            if size == previous:
                continue
            start = 0 if size < previous else previous     # 파일이 줄었으면 처음부터

            try:
                with path.open("rb") as fh:
                    fh.seek(start)
                    blob = fh.read(size - start)
            except OSError:
                continue

            text = blob.decode("utf-8", errors="replace")
            cut = text.rfind("\n")
            if cut < 0:                                    # 아직 한 줄도 완성되지 않았다
                continue
            self._offsets[path] = start + len(text[:cut + 1].encode("utf-8"))
            for line in text[:cut].split("\n"):
                self._ingest(line)

        keep = datetime.now().astimezone() - LIVE_WINDOW
        self._records = [r for r in self._records if r[0] >= keep]
        if len(self._seen) > SEEN_CAP:
            self._seen.clear()

    def today(self) -> dict | None:
        if not self._records:
            return None
        midnight = datetime.now().astimezone().replace(
            hour=0, minute=0, second=0, microsecond=0)
        rows = [r for r in self._records if r[0] >= midnight]
        return {"tok": sum(t for _, t in rows), "msgs": len(rows)}

    def block(self) -> dict | None:
        """5시간 이상 공백이 생기면 다음 활동에서 블록이 새로 시작한다."""
        if not self._records:
            return None
        rows = sorted(self._records)
        start = _floor_hour(rows[0][0])
        previous = rows[0][0]
        total = count = 0
        for when, tokens in rows:
            if when - previous > BLOCK or when - start > BLOCK:
                start = _floor_hour(when)
                total = count = 0
            total += tokens
            count += 1
            previous = when

        now = datetime.now().astimezone()
        end = start + BLOCK
        return {
            "tok": total,
            "msgs": count,
            "remain_min": max(0, round((end - now).total_seconds() / 60)),
            "elapsed_min": max(1, round((now - start).total_seconds() / 60)),
            "time_pct": min(100, max(0, round(
                (now - start).total_seconds() / BLOCK.total_seconds() * 100))),
        }
