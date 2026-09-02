"""Mirabox Stream Dock 293S HID 전송 계층.

프로토콜은 선행 리버스 엔지니어링 작업에서 확인한 규격을 따른다. 구현은
직접 작성했다. 참고한 곳은 README 의 "참고 구현" 절에 적어 두었다.

프레임 구조
    바이트 0        HID 리포트 ID (항상 0x00)
    바이트 1..5     ASCII "CRT" + 0x00 0x00
    바이트 6..      명령과 인자
    나머지          0x00 으로 512 바이트까지 채운다

기기는 키를 누를 때가 아니라 뗄 때 한 번만 보고한다. 누름과 뗌을 구분하려면
호출자가 흉내 내야 한다.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass

import hid
from PIL import Image

VENDOR_ID = 0x5548
PRODUCT_ID = 0x6670

PACKET = 512
HEADER = b"CRT\x00\x00"

COLUMNS = 6
ROWS = 3
KEY_COUNT = COLUMNS * ROWS

# 논리 키 번호(좌상단부터 행 우선) -> 기기 내부 키 ID
KEY_IDS = [
    0x0D, 0x0A, 0x07, 0x04, 0x01, 0x10,
    0x0E, 0x0B, 0x08, 0x05, 0x02, 0x11,
    0x0F, 0x0C, 0x09, 0x06, 0x03, 0x12,
]
DEVICE_ID_TO_KEY = {dev: num for num, dev in enumerate(KEY_IDS)}

# 오른쪽 끝 열(논리 키 5, 11, 17)은 본체 키가 아니라 사이드 디스플레이다
SIDE_KEY_IDS = {0x10, 0x11, 0x12}

# 펌웨어 V2.293S 는 프로토콜 v2 다. v1 은 전부 85x85 였다.
KEY_SIZE = (95, 95)
SIDE_SIZE = (82, 82)

# 참고 구현은 "rot90 + mirror both" 로 적혀 있지만 그건 Rust image 크레이트
# 기준이다. 거기서 rotate90 은 시계 방향이고, 시계 90도에 180도 반전을 더하면
# 결국 반시계 90도가 된다. PIL 의 rotate(90) 은 처음부터 반시계라서 이 한 번이
# 그 조합과 정확히 같다. 여기에 미러를 또 걸면 180도 뒤집힌다.
ROTATE = 90
MIRROR_BOTH = False


class DeviceError(RuntimeError):
    pass


@dataclass(frozen=True)
class KeyEvent:
    """기기는 뗄 때만 보고한다. pressed 는 호출자가 흉내 낸 값이다."""
    key: int
    pressed: bool


# 매핑에 없는 입력 보고를 남겨 둔다. 사이드 3키(0x10~0x12)가 실제로 무엇을
# 보내는지 아직 확인하지 못했다. 눌러 본 뒤 이 목록을 보면 알 수 있다.
UNKNOWN_REPORTS: list[bytes] = []
UNKNOWN_CAP = 40


def key_size(key: int) -> tuple[int, int]:
    """이 키가 받는 이미지 크기."""
    return SIDE_SIZE if KEY_IDS[key] in SIDE_KEY_IDS else KEY_SIZE


def encode_key_image(image: Image.Image, key: int, quality: int = 90) -> bytes:
    """PIL 이미지를 기기가 받는 JPEG 바이트로 만든다."""
    target = key_size(key)
    if image.size != target:
        image = image.resize(target, Image.LANCZOS)
    if ROTATE:
        image = image.rotate(ROTATE, expand=True)
    if MIRROR_BOTH:
        image = image.transpose(Image.ROTATE_180)
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


class StreamDock293S:
    def __init__(self, path: bytes | None = None):
        self._path = path
        self._hid: hid.device | None = None

    # ---------- 연결 ----------

    @staticmethod
    def enumerate() -> list[dict]:
        """이 기기는 제품명 문자열이 비어 있다. 반드시 VID 로 찾는다."""
        return [d for d in hid.enumerate()
                if d["vendor_id"] == VENDOR_ID and d["product_id"] == PRODUCT_ID]

    def open(self) -> "StreamDock293S":
        path = self._path
        if path is None:
            found = self.enumerate()
            if not found:
                raise DeviceError(
                    f"기기를 찾지 못했다 (VID {VENDOR_ID:#06x} PID {PRODUCT_ID:#06x}). "
                    "USB 연결을 확인한다."
                )
            path = found[0]["path"]
        self._hid = hid.device()
        try:
            self._hid.open_path(path)
        except OSError as exc:
            raise DeviceError(
                "기기를 열지 못했다. StreamDock.app 이 떠 있으면 점유하므로 먼저 종료한다."
            ) from exc
        # 논블로킹으로 두면 read 의 timeout_ms 가 무시되고 간헐적으로 read error 가 난다.
        # 블로킹 모드에서 timeout_ms 를 직접 준다. 단 0 을 주면 즉시 반환이 아니라
        # 무한 대기다. 항상 1 이상을 넘긴다.
        self._hid.set_nonblocking(False)
        self._path = path
        return self

    def close(self) -> None:
        if self._hid is not None:
            try:
                self._hid.close()
            finally:
                self._hid = None

    def __enter__(self) -> "StreamDock293S":
        return self.open()

    def __exit__(self, *exc) -> None:
        self.close()

    # ---------- 저수준 ----------

    def _require(self) -> hid.device:
        if self._hid is None:
            raise DeviceError("열려 있지 않다. open() 을 먼저 부른다.")
        return self._hid

    def _write(self, payload: bytes) -> None:
        """리포트 ID 를 붙이고 한 패킷 길이로 맞춰 보낸다."""
        if len(payload) > PACKET:
            raise DeviceError(f"패킷이 너무 길다: {len(payload)} > {PACKET}")
        frame = bytes([0x00]) + payload + b"\x00" * (PACKET - len(payload))
        written = self._require().write(frame)
        if written < 0:
            raise DeviceError("HID write 실패")

    def _command(self, *parts: bytes) -> None:
        self._write(HEADER + b"".join(parts))

    # ---------- 명령 ----------

    def connect(self) -> None:
        self._command(b"CONNECT")

    def disconnect(self) -> None:
        self._command(b"DIS")

    def clear(self) -> None:
        """모든 키를 지운다."""
        self._command(b"CLE", b"\x00\x00\x00\xff")

    def set_brightness(self, percent: int) -> None:
        percent = max(0, min(100, int(percent)))
        self._command(b"LIG", b"\x00\x00", bytes([percent]), b"\x00")

    def refresh(self) -> None:
        """보낸 이미지를 화면에 반영한다."""
        self._command(b"STP")

    def set_key_image(self, key: int, jpeg: bytes) -> None:
        """키 하나에 JPEG 를 올린다. 반영은 refresh() 가 한다."""
        if not 0 <= key < KEY_COUNT:
            raise DeviceError(f"키 번호 범위를 벗어났다: {key}")
        if len(jpeg) > 0xFFFF:
            raise DeviceError(f"이미지가 너무 크다: {len(jpeg)} 바이트")

        self._command(b"BAT", b"\x00\x00",
                      len(jpeg).to_bytes(2, "big"),
                      bytes([KEY_IDS[key]]))
        for offset in range(0, len(jpeg), PACKET):
            self._write(jpeg[offset:offset + PACKET])
        self._command(b"STP")

    def set_key(self, key: int, image: Image.Image) -> None:
        self.set_key_image(key, encode_key_image(image, key))

    # ---------- 입력 ----------

    def read_events(self, timeout_ms: int = 0) -> list[KeyEvent]:
        """입력 보고는 ACK\0\0OK\0 뒤에 기기 키 ID 와 상태가 붙는다.

        기기는 뗄 때만 보고하므로 누름과 뗌을 한 쌍으로 만들어 돌려준다.
        """
        events: list[KeyEvent] = []
        while True:
            data = self._require().read(PACKET, timeout_ms=timeout_ms)
            if not data:
                return events
            timeout_ms = 1          # 첫 패킷 이후로는 사실상 대기하지 않는다
            if bytes(data[:3]) != b"ACK" or len(data) < 11:
                continue
            device_id, _state = data[9], data[10]
            key = DEVICE_ID_TO_KEY.get(device_id)
            if key is None:
                if len(UNKNOWN_REPORTS) < UNKNOWN_CAP:
                    UNKNOWN_REPORTS.append(bytes(data[:16]))
                continue
            events.append(KeyEvent(key, True))
            events.append(KeyEvent(key, False))

    def drain(self) -> None:
        """묵은 입력 보고를 버린다."""
        while self._require().read(PACKET, timeout_ms=1):
            pass


def probe() -> None:
    """기기와 실제로 통신되는지 확인한다. 벤더 앱을 먼저 종료할 것."""
    found = StreamDock293S.enumerate()
    print(f"인터페이스 {len(found)}개 발견")
    for d in found:
        print(f"  usage_page {d['usage_page']:#06x} usage {d['usage']:#04x} "
              f"serial {d['serial_number']}")
    if not found:
        return

    with StreamDock293S() as dock:
        print("open 성공")
        dock.connect()
        dock.set_brightness(60)
        dock.clear()
        dock.refresh()
        print("connect / brightness 60 / clear 전송")

        # 번호와 좌상단 표식으로 키 매핑과 회전 방향을 한 번에 판정한다
        from PIL import ImageDraw, ImageFont
        font = ImageFont.truetype(
            "/System/Library/Fonts/Supplemental/HelveticaNeue.ttc", 44, index=4)
        for key in range(KEY_COUNT):
            w, h = key_size(key)
            img = Image.new("RGB", (w, h), (16, 19, 24))
            d = ImageDraw.Draw(img)
            d.rectangle([0, 0, w // 4, h // 4], fill=(240, 138, 75))   # 좌상단 표식
            text = str(key)
            x0, y0, x1, y1 = d.textbbox((0, 0), text, font=font)
            d.text(((w - (x1 - x0)) / 2 - x0, (h - (y1 - y0)) / 2 - y0),
                   text, font=font, fill=(255, 255, 255))
            dock.set_key(key, img)
        dock.refresh()
        print(f"{KEY_COUNT}개 키에 번호 이미지 전송 (좌상단에 주황 사각형)")

        print("키를 눌러보라. 10초 대기")
        deadline = time.time() + 10
        dock.drain()
        while time.time() < deadline:
            for ev in dock.read_events(timeout_ms=200):
                if ev.pressed:
                    print(f"  키 {ev.key} (행 {ev.key // COLUMNS}, 열 {ev.key % COLUMNS})")


if __name__ == "__main__":
    probe()
