"""조작 화면.

데몬을 별도 프로세스로 두지 않고 이 앱 안에서 워커 스레드로 돌린다. 기기는
한 프로세스만 점유할 수 있으므로, UI 와 데몬을 붙여 두는 편이 IPC 도 없고
경합도 없다.

생김새는 macOS 기본 위젯에 맡긴다. 스타일시트를 씌우지 않아야 시스템
글꼴과 밝은/어두운 모드를 그대로 따라간다. 직접 그리는 것은 보드 하나뿐인데,
그건 하드웨어를 그대로 옮긴 그림이라 어두운 베젤이 맞다.
"""

from __future__ import annotations

import sys
import threading

from PIL import Image
from PySide6.QtCore import QObject, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QImage, QPainter, QPainterPath, QPixmap
from PySide6.QtWidgets import (QAbstractButton, QApplication, QComboBox,
                               QFormLayout, QFrame, QGridLayout, QHBoxLayout,
                               QLabel, QLineEdit, QMainWindow, QSizePolicy,
                               QSlider, QVBoxLayout, QWidget)

from ..core import actions as actions_module
from ..core import config as config_module
from ..core.daemon import Daemon
from ..core.device import COLUMNS, KEY_COUNT, ROWS
from ..core.registry import KEYS
from ..core.render import blank, empty
from ..core.state import State

TILE_PT = 95          # 실제 키와 같은 크기로 보여 준다
BEZEL_PAD = 14
BEZEL_GAP = 8


def to_pixmap(image: Image.Image, ratio: float) -> QPixmap:
    """레티나에서 흐려지지 않게 정수배로 키운 뒤 배율을 알려 준다."""
    scale = max(1, int(round(ratio)))
    if scale > 1:
        image = image.resize((image.width * scale, image.height * scale), Image.NEAREST)
    data = image.convert("RGB").tobytes("raw", "RGB")
    qimage = QImage(data, image.width, image.height, image.width * 3,
                    QImage.Format_RGB888).copy()
    pixmap = QPixmap.fromImage(qimage)
    pixmap.setDevicePixelRatio(scale)
    return pixmap


class KeyTile(QAbstractButton):
    """보드의 칸 하나. 실제로 기기에 나가는 그림을 그대로 보여 준다."""

    def __init__(self, index: int):
        super().__init__()
        self.index = index
        self.setCheckable(True)
        self.setFixedSize(TILE_PT, TILE_PT)
        self.setCursor(Qt.PointingHandCursor)
        self._pixmap: QPixmap | None = None

    def set_image(self, image: Image.Image) -> None:
        self._pixmap = to_pixmap(image, self.devicePixelRatioF())
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        rect = self.rect().adjusted(0, 0, -1, -1)

        path = QPainterPath()
        path.addRoundedRect(rect, 11, 11)
        painter.setClipPath(path)
        if self._pixmap is not None:
            painter.drawPixmap(rect, self._pixmap)
        else:
            painter.fillRect(rect, QColor(12, 14, 18))
        painter.setClipping(False)

        if self.isChecked():
            pen = painter.pen()
            pen.setColor(self.palette().highlight().color())
            pen.setWidth(3)
            painter.setPen(pen)
            painter.drawRoundedRect(rect.adjusted(1, 1, -1, -1), 10, 10)


class Board(QFrame):
    """6x3 배치. 실물과 같은 비율로 둔다."""

    selected = Signal(int)

    def __init__(self):
        super().__init__()
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        grid = QGridLayout(self)
        grid.setContentsMargins(BEZEL_PAD, BEZEL_PAD, BEZEL_PAD, BEZEL_PAD)
        grid.setSpacing(BEZEL_GAP)

        self.tiles: list[KeyTile] = []
        for index in range(KEY_COUNT):
            tile = KeyTile(index)
            tile.clicked.connect(lambda _checked=False, i=index: self._pick(i))
            grid.addWidget(tile, index // COLUMNS, index % COLUMNS)
            self.tiles.append(tile)
        self._pick(0)

    def _pick(self, index: int) -> None:
        for tile in self.tiles:
            tile.setChecked(tile.index == index)
        self.selected.emit(index)

    def current(self) -> int:
        return next((t.index for t in self.tiles if t.isChecked()), 0)

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(QColor(23, 25, 29))
        painter.setPen(Qt.NoPen)
        painter.drawRoundedRect(self.rect().adjusted(0, 0, -1, -1), 18, 18)


class Bridge(QObject):
    """데몬 스레드에서 오는 알림을 Qt 시그널로 옮긴다."""
    status = Signal(str, bool)
    painted = Signal()


class MainWindow(QMainWindow):
    def __init__(self, cfg: config_module.Config):
        super().__init__()
        self.cfg = cfg
        self.setWindowTitle("Stream Dock")

        self.bridge = Bridge()
        self.bridge.status.connect(self._on_status)
        self.bridge.painted.connect(self.refresh_preview)

        self.daemon = Daemon(
            cfg,
            on_status=lambda text, ok: self.bridge.status.emit(text, ok),
            on_painted=lambda _state: self.bridge.painted.emit(),
        )

        self.board = Board()
        self.board.selected.connect(self._on_select)

        body = QHBoxLayout()
        body.setContentsMargins(20, 20, 20, 20)
        body.setSpacing(20)
        body.addWidget(self.board, 0, Qt.AlignTop)
        body.addWidget(self._build_inspector(), 1)

        central = QWidget()
        central.setLayout(body)
        self.setCentralWidget(central)

        self._build_toolbar()
        self.statusBar().showMessage("시작하는 중")

        self._thread = threading.Thread(target=self.daemon.run, daemon=True)
        self._thread.start()

        self._timer = QTimer(self)
        self._timer.timeout.connect(self.refresh_preview)
        self._timer.start(2000)
        self._on_select(0)
        self.refresh_preview()

    # ---------- 구성 ----------

    def _build_toolbar(self) -> None:
        bar = self.addToolBar("상태")
        bar.setMovable(False)
        bar.setFloatable(False)

        self.status_label = QLabel("기기를 찾는 중")
        bar.addWidget(self.status_label)

        spacer = QWidget()
        spacer.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        bar.addWidget(spacer)

        bar.addWidget(QLabel("밝기"))
        self.brightness = QSlider(Qt.Horizontal)
        self.brightness.setRange(10, 100)
        self.brightness.setValue(self.cfg.brightness)
        self.brightness.setFixedWidth(160)
        self.brightness.valueChanged.connect(self._on_brightness)
        bar.addWidget(self.brightness)

    def _build_inspector(self) -> QWidget:
        panel = QWidget()
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        self.title = QLabel()
        title_font = QFont(self.font())
        title_font.setPointSize(title_font.pointSize() + 3)
        title_font.setBold(True)
        self.title.setFont(title_font)
        layout.addWidget(self.title)

        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignRight | Qt.AlignVCenter)
        form.setSpacing(10)

        self.key_combo = QComboBox()
        self.key_combo.addItem("빈 칸", None)
        for name, entry in KEYS.items():
            self.key_combo.addItem(f"{entry.label}  {entry.summary}", name)
        self.key_combo.currentIndexChanged.connect(self._on_key_changed)
        form.addRow("표시", self.key_combo)

        self.action_combo = QComboBox()
        for kind, label in actions_module.LABELS.items():
            self.action_combo.addItem(label, kind)
        self.action_combo.currentIndexChanged.connect(self._on_action_kind)
        form.addRow("누를 때", self.action_combo)

        self.action_value = QLineEdit()
        self.action_value.setPlaceholderText("값")
        self.action_value.editingFinished.connect(self._on_action_value)
        form.addRow("", self.action_value)

        self.media_combo = QComboBox()
        for value, label in actions_module.MEDIA_CHOICES:
            self.media_combo.addItem(label, value)
        self.media_combo.currentIndexChanged.connect(self._on_action_value)
        form.addRow("", self.media_combo)

        layout.addLayout(form)

        self.hint = QLabel()
        self.hint.setWordWrap(True)
        self.hint.setEnabled(False)
        layout.addWidget(self.hint)
        layout.addStretch(1)
        return panel

    # ---------- 동작 ----------

    def _current_action(self) -> dict:
        return actions_module.normalize(
            self.cfg.actions.get(str(self.board.current())))

    def _on_select(self, index: int) -> None:
        name = self.cfg.layout[index]
        row, col = index // COLUMNS, index % COLUMNS
        self.title.setText(f"{row + 1}행 {col + 1}열")

        self.key_combo.blockSignals(True)
        self.key_combo.setCurrentIndex(max(0, self.key_combo.findData(name)))
        self.key_combo.blockSignals(False)

        action = self._current_action()
        self.action_combo.blockSignals(True)
        self.action_combo.setCurrentIndex(self.action_combo.findData(action["type"]))
        self.action_combo.blockSignals(False)
        self._sync_action_widgets(action)

    def _sync_action_widgets(self, action: dict) -> None:
        kind = action["type"]
        is_media = kind == actions_module.MEDIA
        has_value = kind not in (actions_module.NONE, actions_module.MEDIA)

        self.action_value.setVisible(has_value)
        self.media_combo.setVisible(is_media)

        placeholder = {
            actions_module.APP: "/Applications/Safari.app",
            actions_module.URL: "https://example.com",
            actions_module.SHELL: "say hello",
        }.get(kind, "값")
        self.action_value.setPlaceholderText(placeholder)
        self.action_value.blockSignals(True)
        self.action_value.setText("" if is_media else action["value"])
        self.action_value.blockSignals(False)

        if is_media:
            self.media_combo.blockSignals(True)
            found = self.media_combo.findData(action["value"])
            self.media_combo.setCurrentIndex(max(0, found))
            self.media_combo.blockSignals(False)

        entry = KEYS.get(self.cfg.layout[self.board.current()] or "")
        self.hint.setText(entry.summary if entry else
                          "이 칸은 비어 있다. 표시할 항목을 고르면 기기에 바로 반영된다.")

    def _on_key_changed(self) -> None:
        self.cfg.layout[self.board.current()] = self.key_combo.currentData()
        self._persist(restart_sources=True)
        self._sync_action_widgets(self._current_action())

    def _on_action_kind(self) -> None:
        kind = self.action_combo.currentData()
        action = {"type": kind, "value": ""}
        if kind == actions_module.MEDIA and actions_module.MEDIA_CHOICES:
            action["value"] = self.media_combo.currentData() or actions_module.MEDIA_CHOICES[0][0]
        self.cfg.actions[str(self.board.current())] = action
        self._sync_action_widgets(action)
        self._persist()

    def _on_action_value(self) -> None:
        kind = self.action_combo.currentData()
        value = (self.media_combo.currentData() if kind == actions_module.MEDIA
                 else self.action_value.text())
        self.cfg.actions[str(self.board.current())] = {"type": kind, "value": value}
        self._persist()

    def _on_brightness(self, value: int) -> None:
        self.cfg.brightness = value
        self._persist()

    def _persist(self, restart_sources: bool = False) -> None:
        config_module.save(self.cfg)
        if restart_sources:
            self.daemon.restart_sources()
        self.daemon.notify()
        self.refresh_preview()

    # ---------- 미리보기 ----------

    def refresh_preview(self) -> None:
        state = self.daemon.state()
        for index, tile in enumerate(self.board.tiles):
            name = self.cfg.layout[index]
            entry = KEYS.get(name) if name else None
            try:
                image = entry.render(index, state) if entry else empty(index)
            except Exception:
                image = blank(index, entry.label if entry else "", "err")
            tile.set_image(image)

        errors = state.errors
        self.statusBar().showMessage(
            f"수집 실패 {len(errors)}종: {', '.join(sorted(errors))}" if errors
            else "정상")

    def _on_status(self, text: str, connected: bool) -> None:
        dot = "●" if connected else "○"
        self.status_label.setText(f"{dot}  {text}")

    # ---------- 종료 ----------

    def closeEvent(self, event) -> None:
        # HID 핸들을 쥔 채 죽으면 기기가 잠긴다. 반드시 정상 종료시킨다.
        self.daemon.stop_event.set()
        self._thread.join(timeout=6)
        event.accept()


def main() -> None:
    cfg = config_module.load()
    if not config_module.CONFIG_PATH.exists():
        config_module.save(cfg)

    app = QApplication(sys.argv)
    app.setApplicationName("Stream Dock")
    window = MainWindow(cfg)
    window.adjustSize()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
