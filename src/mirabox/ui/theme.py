"""화면 토큰.

값을 여기서만 정한다. 위젯 코드에 색이나 여백 상수를 직접 쓰지 않는다.

원칙
    유채색은 액센트 하나뿐이다. 나머지는 전부 흑백 알파값으로 만든다.
    코너 반경은 패널 10, 버튼과 입력 6 두 가지만 쓴다.
    여백은 아래 SPACE 에 있는 값만 쓴다.
    장식 대신 여백으로 위계를 만든다.

금지
    그라디언트, 그림자, 유채색 테두리, 2px 이상 테두리,
    위젯마다 다른 코너 반경, 전부 대문자 라벨, 불필요한 구분선.
"""

from __future__ import annotations

from PySide6.QtGui import QColor, QFont, QPalette
from PySide6.QtWidgets import QApplication

# 액센트 하나. macOS 기본 파랑.
ACCENT = QColor("#0A84FF")

# 여백. 이 값들만 쓴다.
SPACE = (4, 8, 12, 16, 24, 32)

# 코너 반경. 이 둘만 쓴다.
RADIUS_PANEL = 10
RADIUS_CONTROL = 6

# 글자 크기. macOS 본문이 13 이다.
SIZE_BODY = 13
SIZE_SMALL = 11
SIZE_TITLE = 17

LINE_HEIGHT = 1.4


def is_dark() -> bool:
    """시스템 설정을 따라간다. 라이트로 고정하지 않는다."""
    app = QApplication.instance()
    if app is None:
        return False
    window = app.palette().color(QPalette.Window)
    return window.lightness() < 128


def ink(alpha: float = 0.85) -> QColor:
    """본문 글자색. 밝은 배경에서는 검정, 어두운 배경에서는 흰색."""
    base = 255 if is_dark() else 0
    color = QColor(base, base, base)
    color.setAlphaF(alpha)
    return color


def muted() -> QColor:
    return ink(0.5)


def divider() -> QColor:
    return ink(0.08)


def accent(alpha: float = 1.0) -> QColor:
    color = QColor(ACCENT)
    color.setAlphaF(alpha)
    return color


def rgba(color: QColor) -> str:
    return f"rgba({color.red()},{color.green()},{color.blue()},{color.alphaF():.3f})"


def font(size: int = SIZE_BODY, semibold: bool = False) -> QFont:
    """시스템 글꼴을 그대로 쓴다. 자간은 건드리지 않는다."""
    app = QApplication.instance()
    result = QFont(app.font()) if app else QFont()
    result.setPointSize(size)
    result.setWeight(QFont.DemiBold if semibold else QFont.Normal)
    return result


# 보드는 하드웨어를 옮긴 그림이라 시스템 밝기와 무관하게 어둡다.
BOARD_BG = QColor(23, 25, 29)
TILE_EMPTY = QColor(12, 14, 18)
