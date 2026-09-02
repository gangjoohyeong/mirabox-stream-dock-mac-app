"""조작 화면.

데몬을 별도 프로세스로 두지 않고 이 앱 안에서 워커 스레드로 돌린다. 기기는
한 프로세스만 점유할 수 있으므로, UI 와 데몬을 붙여 두는 편이 IPC 도 없고
경합도 없다. 같은 이유로 로그인 에이전트가 떠 있으면 화면이 사는 동안만
잠시 내려 둔다.

화면은 왼쪽에 프로필 목록, 오른쪽에 보드와 선택한 칸의 설정이다. 값과
여백은 theme.py 에서만 정한다. 네이티브 컨트롤(콤보, 입력, 슬라이더)에는
스타일을 씌우지 않는다. 그래야 시스템 글꼴과 밝은/어두운 모드를 그대로
따라간다. 장식 대신 여백으로 위계를 만든다.
"""

from __future__ import annotations

import sys
import threading

from PIL import Image
from PySide6.QtCore import QObject, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QColor, QImage, QPainter, QPainterPath, QPixmap
from PySide6.QtWidgets import (QAbstractButton, QApplication, QComboBox,
                               QFileDialog, QFormLayout, QFrame, QGridLayout,
                               QHBoxLayout, QInputDialog, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QMainWindow,
                               QMessageBox, QPushButton, QSizePolicy, QSlider,
                               QVBoxLayout, QWidget)

from ..core import actions as actions_module
from ..core import agent as agent_module
from ..core import appwatch
from ..core import config as config_module
from ..core.daemon import Daemon
from ..core.device import COLUMNS, KEY_COUNT
from ..core.registry import KEYS
from ..core.render import empty
from . import theme

TILE_IMAGE = 95            # 실제 키와 같은 크기
TILE_INSET = 4             # 선택 표시를 그릴 여유
TILE_BOX = TILE_IMAGE + TILE_INSET * 2

SIDEBAR_WIDTH = 184
FORM_MAX_WIDTH = 520       # 입력란이 창 끝까지 늘어나지 않게 묶는다


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
    """보드의 칸 하나. 실제로 기기에 나가는 그림을 그대로 보여 준다.

    선택은 굵은 테두리 대신 옅은 액센트 틴트로 알린다.
    """

    def __init__(self, index: int):
        super().__init__()
        self.index = index
        self.setCheckable(True)
        self.setFixedSize(TILE_BOX, TILE_BOX)
        self.setCursor(Qt.PointingHandCursor)
        self._pixmap: QPixmap | None = None

    def set_image(self, image: Image.Image) -> None:
        self._pixmap = to_pixmap(image, self.devicePixelRatioF())
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        if self.isChecked():
            painter.setPen(Qt.NoPen)
            painter.setBrush(theme.accent(0.20))
            painter.drawRoundedRect(self.rect(), theme.RADIUS_PANEL, theme.RADIUS_PANEL)

        inner = self.rect().adjusted(TILE_INSET, TILE_INSET, -TILE_INSET, -TILE_INSET)
        path = QPainterPath()
        path.addRoundedRect(inner, theme.RADIUS_CONTROL, theme.RADIUS_CONTROL)
        painter.setClipPath(path)
        if self._pixmap is not None:
            painter.drawPixmap(inner, self._pixmap)
        else:
            painter.fillRect(inner, theme.TILE_EMPTY)


class Board(QFrame):
    """6x3 배치. 하드웨어를 옮긴 그림이라 시스템 밝기와 무관하게 어둡다."""

    selected = Signal(int)

    def __init__(self):
        super().__init__()
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        grid = QGridLayout(self)
        margin = theme.SPACE[2]                    # 12
        grid.setContentsMargins(margin, margin, margin, margin)
        grid.setSpacing(0)                         # 여유는 타일이 자기 안에 갖는다

        self.tiles: list[KeyTile] = []
        for index in range(KEY_COUNT):
            tile = KeyTile(index)
            tile.clicked.connect(lambda _checked=False, i=index: self.pick(i))
            grid.addWidget(tile, index // COLUMNS, index % COLUMNS)
            self.tiles.append(tile)
        self.tiles[0].setChecked(True)

        # 크기 정책만으로는 검사기가 커질 때 눌린다. 아예 고정한다.
        rows = KEY_COUNT // COLUMNS
        self.setFixedSize(margin * 2 + COLUMNS * TILE_BOX,
                          margin * 2 + rows * TILE_BOX)

    def pick(self, index: int) -> None:
        for tile in self.tiles:
            tile.setChecked(tile.index == index)
        self.selected.emit(index)

    def current(self) -> int:
        return next((t.index for t in self.tiles if t.isChecked()), 0)

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setPen(Qt.NoPen)
        painter.setBrush(theme.BOARD_BG)
        painter.drawRoundedRect(self.rect(), theme.RADIUS_PANEL, theme.RADIUS_PANEL)


class Bridge(QObject):
    """데몬 스레드에서 오는 알림을 Qt 시그널로 옮긴다."""
    status = Signal(str, bool)
    painted = Signal()
    profile = Signal(str)


class MainWindow(QMainWindow):
    def __init__(self, cfg: config_module.Config):
        super().__init__()
        self.cfg = cfg
        self.setWindowTitle("Stream Dock")
        self._option_widgets: dict[str, QWidget] = {}
        self._option_rows: list[int] = []

        self.bridge = Bridge()
        self.bridge.status.connect(self._on_status)
        self.bridge.painted.connect(self.refresh_preview)
        self.bridge.profile.connect(self._on_profile_switched)

        self.daemon = Daemon(
            cfg,
            on_status=lambda text, ok: self.bridge.status.emit(text, ok),
            on_painted=lambda _state: self.bridge.painted.emit(),
            on_profile=lambda name: self.bridge.profile.emit(name),
        )

        self.board = Board()
        self.board.selected.connect(self.show_slot)

        root = QHBoxLayout()
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._build_sidebar())
        root.addWidget(self._build_content(), 1)

        central = QWidget()
        central.setLayout(root)
        self.setCentralWidget(central)

        # 보드는 줄어들 수 없다. 창 최소 크기를 보드 실제 크기에서 역산한다.
        board = self.board.sizeHint()
        self.setMinimumWidth(SIDEBAR_WIDTH + board.width() + theme.SPACE[3] * 2)
        # 옵션이 가장 많은 키를 골라도 검사기가 잘리지 않을 만큼 남긴다
        self.setMinimumHeight(board.height() + 420)
        self.resize(self.minimumWidth() + 60, self.minimumHeight())

        self._build_toolbar()
        self._build_menu()

        self._thread = threading.Thread(target=self.daemon.run, daemon=True)
        self._thread.start()

        self._timer = QTimer(self)
        self._timer.timeout.connect(self.refresh_preview)
        self._timer.start(2000)
        self.show_slot(0)
        self.refresh_preview()

    # ---------- 작은 조각 ----------

    def _label(self, text: str, size: int = theme.SIZE_BODY,
               semibold: bool = False, color: QColor | None = None) -> QLabel:
        label = QLabel(text)
        label.setFont(theme.font(size, semibold))
        label.setStyleSheet(
            f"color: {theme.rgba(color or theme.ink())}; background: transparent")
        return label

    def _rule(self) -> QFrame:
        line = QFrame()
        line.setFixedHeight(1)
        line.setStyleSheet(f"background: {theme.rgba(theme.divider())}; border: none")
        return line

    # ---------- 구성 ----------

    def _build_sidebar(self) -> QWidget:
        panel = QWidget()
        panel.setFixedWidth(SIDEBAR_WIDTH)
        panel.setStyleSheet("background: transparent")
        layout = QVBoxLayout(panel)
        pad = theme.SPACE[2]                       # 12
        layout.setContentsMargins(pad, theme.SPACE[3], pad, pad)
        layout.setSpacing(theme.SPACE[1])          # 8

        layout.addWidget(self._label("프로필", theme.SIZE_SMALL, color=theme.muted()))

        self.profile_list = QListWidget()
        self.profile_list.setFrameShape(QFrame.NoFrame)
        self.profile_list.setFont(theme.font())
        self.profile_list.setStyleSheet(f"""
            QListWidget {{ background: transparent; border: none; outline: none; }}
            QListWidget::item {{
                padding: {theme.SPACE[0]}px {theme.SPACE[1]}px;
                border-radius: {theme.RADIUS_CONTROL}px;
                color: {theme.rgba(theme.ink())};
            }}
            QListWidget::item:selected {{ background: {theme.rgba(theme.accent(0.16))}; }}
        """)
        self.profile_list.currentRowChanged.connect(self._on_profile_row)
        layout.addWidget(self.profile_list, 1)

        add = QPushButton("새 프로필")
        add.setFont(theme.font(theme.SIZE_SMALL))
        add.clicked.connect(self._new_profile)
        layout.addWidget(add)
        self._reload_profiles()
        return panel

    def _build_content(self) -> QWidget:
        panel = QWidget()
        panel.setStyleSheet("background: transparent")
        layout = QVBoxLayout(panel)
        pad = theme.SPACE[3]                       # 16
        layout.setContentsMargins(0, pad, pad, pad)
        layout.setSpacing(theme.SPACE[4])          # 24

        board_row = QHBoxLayout()
        board_row.setContentsMargins(0, 0, 0, 0)
        board_row.addWidget(self.board, 0, Qt.AlignLeft | Qt.AlignTop)
        board_row.addStretch(1)
        layout.addLayout(board_row)

        layout.addWidget(self._rule())
        layout.addWidget(self._build_inspector())
        layout.addStretch(1)
        return panel

    def _build_inspector(self) -> QWidget:
        panel = QWidget()
        panel.setStyleSheet("background: transparent")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(theme.SPACE[2])          # 12

        self.title = self._label("", theme.SIZE_TITLE, semibold=True)
        layout.addWidget(self.title)

        form_holder = QWidget()
        form_holder.setMaximumWidth(FORM_MAX_WIDTH)
        form_holder.setStyleSheet("background: transparent")
        self.form = QFormLayout(form_holder)
        self.form.setContentsMargins(0, 0, 0, 0)
        self.form.setLabelAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.form.setFieldGrowthPolicy(QFormLayout.AllNonFixedFieldsGrow)
        self.form.setHorizontalSpacing(theme.SPACE[2])
        self.form.setVerticalSpacing(theme.SPACE[1])

        self.key_combo = QComboBox()
        self.key_combo.setFont(theme.font())
        self.key_combo.addItem("빈 칸", None)
        for name, entry in KEYS.items():
            self.key_combo.addItem(f"{entry.label}   {entry.summary}", name)
        self.key_combo.currentIndexChanged.connect(self._on_key_changed)
        self.form.addRow(self._label("표시"), self.key_combo)

        # 키마다 다른 개별 설정이 이 자리 뒤에 동적으로 끼어든다
        self._options_anchor = self.form.rowCount()

        self.action_combo = QComboBox()
        self.action_combo.setFont(theme.font())
        for kind, label in actions_module.LABELS.items():
            self.action_combo.addItem(label, kind)
        self.action_combo.currentIndexChanged.connect(self._on_action_kind)
        self.form.addRow(self._label("누를 때"), self.action_combo)

        self.action_value = QLineEdit()
        self.action_value.setFont(theme.font())
        self.action_value.editingFinished.connect(self._on_action_value)
        self._base_action_row = self.form.rowCount()
        self.action_row = self._base_action_row
        self.form.addRow(self._label("값"), self.action_value)

        self.media_combo = QComboBox()
        self.media_combo.setFont(theme.font())
        for value, label in actions_module.MEDIA_CHOICES:
            self.media_combo.addItem(label, value)
        self.media_combo.currentIndexChanged.connect(self._on_action_value)
        self._base_media_row = self.form.rowCount()
        self.media_row = self._base_media_row
        self.form.addRow(self._label("동작"), self.media_combo)

        self.app_combo = QComboBox()
        self.app_combo.setFont(theme.font())
        self.app_combo.addItem("연결 안 함", "")
        for name in appwatch.running_apps():
            self.app_combo.addItem(name, name)
        self.app_combo.currentIndexChanged.connect(self._on_app_bind)
        self.form.addRow(self._label("연결 앱"), self.app_combo)
        layout.addWidget(form_holder)

        self.hint = self._label("", theme.SIZE_SMALL, color=theme.muted())
        self.hint.setWordWrap(True)
        # 줄바꿈 라벨은 폭이 정해져야 높이가 나온다. 안 그러면 글자가 겹쳐 그려진다.
        self.hint.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Minimum)
        self.hint.setMinimumHeight(30)
        self.hint.setAlignment(Qt.AlignTop)
        layout.addWidget(self.hint)
        return panel

    def _build_toolbar(self) -> None:
        bar = self.addToolBar("상태")
        bar.setMovable(False)
        bar.setFloatable(False)

        self.status_label = self._label("기기를 찾는 중", theme.SIZE_SMALL,
                                        color=theme.muted())
        bar.addWidget(self.status_label)

        spacer = QWidget()
        spacer.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        spacer.setStyleSheet("background: transparent")
        bar.addWidget(spacer)

        bar.addWidget(self._label("밝기", theme.SIZE_SMALL, color=theme.muted()))
        self.brightness = QSlider(Qt.Horizontal)
        self.brightness.setRange(10, 100)
        self.brightness.setValue(self.cfg.brightness)
        self.brightness.setFixedWidth(120)
        self.brightness.valueChanged.connect(self._on_brightness)
        bar.addWidget(self.brightness)

    def _build_menu(self) -> None:
        profiles = self.menuBar().addMenu("프로필")
        for label, handler in (("새로 만들기", self._new_profile),
                               ("이름 바꾸기", self._rename_profile),
                               ("이 프로필 삭제", self._delete_profile)):
            action = QAction(label, self)
            action.triggered.connect(handler)
            profiles.addAction(action)

        system = self.menuBar().addMenu("시스템")
        self.agent_action = QAction("로그인할 때 자동 시작", self)
        self.agent_action.setCheckable(True)
        self.agent_action.setChecked(agent_module.is_installed())
        self.agent_action.triggered.connect(self._toggle_agent)
        system.addAction(self.agent_action)

    def _set_row_visible(self, row: int, visible: bool) -> None:
        """폼의 한 줄을 라벨까지 함께 감춘다."""
        for role in (QFormLayout.LabelRole, QFormLayout.FieldRole):
            item = self.form.itemAt(row, role)
            if item and item.widget():
                item.widget().setVisible(visible)

    # ---------- 프로필 ----------

    def _reload_profiles(self) -> None:
        self.profile_list.blockSignals(True)
        self.profile_list.clear()
        for profile in self.cfg.profiles:
            item = QListWidgetItem(profile.name)
            item.setData(Qt.UserRole, profile.name)
            self.profile_list.addItem(item)
        names = [p.name for p in self.cfg.profiles]
        if self.cfg.active in names:
            self.profile_list.setCurrentRow(names.index(self.cfg.active))
        self.profile_list.blockSignals(False)

    def _on_profile_row(self, row: int) -> None:
        if row < 0 or row >= len(self.cfg.profiles):
            return
        self.daemon.switch_profile(self.cfg.profiles[row].name)
        config_module.save(self.cfg)
        self.show_slot(self.board.current())
        self.refresh_preview()

    def _on_profile_switched(self, _name: str) -> None:
        """앱 전환으로 데몬이 프로필을 바꿨을 때."""
        self._reload_profiles()
        self.show_slot(self.board.current())
        self.refresh_preview()

    def _new_profile(self) -> None:
        name, ok = QInputDialog.getText(self, "새 프로필", "이름")
        name = name.strip() if ok else ""
        if not name:
            return
        if any(p.name == name for p in self.cfg.profiles):
            QMessageBox.warning(self, "이미 있음", "같은 이름의 프로필이 있다.")
            return
        self.cfg.profiles.append(config_module.Profile(name=name).normalized())
        self.cfg.active = name
        self._reload_profiles()
        self._persist(restart_sources=True)
        self.show_slot(self.board.current())

    def _rename_profile(self) -> None:
        current = self.cfg.profile()
        name, ok = QInputDialog.getText(self, "이름 바꾸기", "이름", text=current.name)
        name = name.strip() if ok else ""
        if not name:
            return
        current.name = name
        self.cfg.active = name
        self._reload_profiles()
        self._persist()

    def _delete_profile(self) -> None:
        if len(self.cfg.profiles) <= 1:
            QMessageBox.information(self, "삭제할 수 없음", "프로필은 하나 이상 있어야 한다.")
            return
        current = self.cfg.profile()
        if QMessageBox.question(self, "삭제", f"{current.name} 을 지울까?") != QMessageBox.Yes:
            return
        self.cfg.profiles.remove(current)
        self.cfg.active = self.cfg.profiles[0].name
        self._reload_profiles()
        self._persist(restart_sources=True)
        self.show_slot(self.board.current())

    def _on_app_bind(self) -> None:
        self.cfg.profile().app = self.app_combo.currentData() or ""
        self._persist(restart_sources=True)

    def _toggle_agent(self, checked: bool) -> None:
        if checked:
            agent_module.install()
            agent_module.stop()          # 화면이 떠 있는 동안은 기기를 다투지 않는다
            self.statusBar().showMessage("로그인 자동 시작을 켰다. 이 창을 닫으면 시작된다")
        else:
            agent_module.uninstall()
            self.statusBar().showMessage("로그인 자동 시작을 껐다")

    # ---------- 칸 ----------

    def _slot(self, index: int | None = None) -> config_module.Slot:
        return self.cfg.profile().slots[self.board.current() if index is None else index]

    def show_slot(self, index: int) -> None:
        slot = self._slot(index)
        self.title.setText(f"{index // COLUMNS + 1}행 {index % COLUMNS + 1}열")

        self.key_combo.blockSignals(True)
        self.key_combo.setCurrentIndex(max(0, self.key_combo.findData(slot.key)))
        self.key_combo.blockSignals(False)

        self.action_combo.blockSignals(True)
        self.action_combo.setCurrentIndex(
            self.action_combo.findData(slot.action.get("type", actions_module.NONE)))
        self.action_combo.blockSignals(False)

        self.app_combo.blockSignals(True)
        bound = self.cfg.profile().app
        found = self.app_combo.findData(bound)
        if found < 0 and bound:
            self.app_combo.addItem(bound, bound)
            found = self.app_combo.count() - 1
        self.app_combo.setCurrentIndex(max(0, found))
        self.app_combo.blockSignals(False)

        self._rebuild_options(slot)
        self._sync_action_widgets(slot.action)

    def _rebuild_options(self, slot: config_module.Slot) -> None:
        for row in reversed(self._option_rows):
            self.form.removeRow(row)
        self._option_rows.clear()
        self._option_widgets.clear()

        entry = KEYS.get(slot.key) if slot.key else None
        if entry:
            for offset, option in enumerate(entry.options):
                field = QLineEdit(str(slot.options.get(option.name, "")))
                field.setFont(theme.font())
                field.setPlaceholderText(option.placeholder)
                field.editingFinished.connect(
                    lambda name=option.name, w=field: self._on_option(name, w.text()))
                self._option_widgets[option.name] = field

                if option.kind == "file":
                    holder = QWidget()
                    holder.setStyleSheet("background: transparent")
                    box = QHBoxLayout(holder)
                    box.setContentsMargins(0, 0, 0, 0)
                    box.setSpacing(theme.SPACE[1])
                    box.addWidget(field, 1)
                    browse = QPushButton("고르기")
                    browse.setFont(theme.font(theme.SIZE_SMALL))
                    browse.clicked.connect(
                        lambda _=False, name=option.name: self._pick_file(name))
                    box.addWidget(browse)
                    widget = holder
                else:
                    widget = field

                row = self._options_anchor + offset
                self.form.insertRow(row, self._label(option.label), widget)
                self._option_rows.append(row)

        shift = len(self._option_rows)
        self.action_row = self._base_action_row + shift
        self.media_row = self._base_media_row + shift

    def _pick_file(self, option_name: str) -> None:
        path, _filter = QFileDialog.getOpenFileName(
            self, "그림 고르기", "", "그림 (*.png *.jpg *.jpeg *.gif *.bmp *.webp)")
        if not path:
            return
        widget = self._option_widgets.get(option_name)
        if widget:
            widget.setText(path)
        self._on_option(option_name, path)

    def _on_option(self, name: str, value: str) -> None:
        self._slot().options[name] = value
        self._persist()

    def _on_key_changed(self) -> None:
        slot = self._slot()
        slot.key = self.key_combo.currentData()
        slot.options = {}
        self._rebuild_options(slot)
        self._sync_action_widgets(slot.action)
        self._persist(restart_sources=True)

    # ---------- 동작 ----------

    def _sync_action_widgets(self, action: dict) -> None:
        kind = action.get("type", actions_module.NONE)
        is_media = kind == actions_module.MEDIA
        has_value = kind not in (actions_module.NONE, actions_module.MEDIA)

        self._set_row_visible(self.action_row, has_value)
        self._set_row_visible(self.media_row, is_media)
        self.action_value.setPlaceholderText({
            actions_module.APP: "/Applications/Safari.app",
            actions_module.URL: "https://example.com",
            actions_module.SHELL: "say hello",
        }.get(kind, ""))

        self.action_value.blockSignals(True)
        self.action_value.setText("" if is_media else action.get("value", ""))
        self.action_value.blockSignals(False)

        if is_media:
            self.media_combo.blockSignals(True)
            self.media_combo.setCurrentIndex(
                max(0, self.media_combo.findData(action.get("value"))))
            self.media_combo.blockSignals(False)

        entry = KEYS.get(self._slot().key or "")
        self.hint.setText(entry.summary if entry else
                          "빈 칸이다. 표시할 항목을 고르면 기기에 바로 반영된다.")

    def _on_action_kind(self) -> None:
        kind = self.action_combo.currentData()
        value = ""
        if kind == actions_module.MEDIA and actions_module.MEDIA_CHOICES:
            value = self.media_combo.currentData() or actions_module.MEDIA_CHOICES[0][0]
        self._slot().action = {"type": kind, "value": value}
        self._sync_action_widgets(self._slot().action)
        self._persist()

    def _on_action_value(self) -> None:
        kind = self.action_combo.currentData()
        value = (self.media_combo.currentData() if kind == actions_module.MEDIA
                 else self.action_value.text())
        self._slot().action = {"type": kind, "value": value}
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
            try:
                tile.set_image(self.daemon.render_slot(index, state))
            except Exception:
                tile.set_image(empty(index))

        placed = sum(1 for slot in self.cfg.profile().slots if slot.key)
        total = len(state.data) + len(state.errors)
        parts = [f"칸 {placed}/{KEY_COUNT}", f"수집 {len(state.data)}/{total}종"]
        if state.errors:
            parts.append("실패: " + ", ".join(sorted(state.errors)))
        self.statusBar().showMessage("   ".join(parts))

    def _on_status(self, text: str, connected: bool) -> None:
        self.status_label.setText(text)
        color = theme.ink() if connected else theme.muted()
        self.status_label.setStyleSheet(
            f"color: {theme.rgba(color)}; background: transparent")

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

    # 로그인 에이전트가 떠 있으면 기기를 쥐고 있다. 화면이 사는 동안만 내린다.
    with agent_module.Suspension():
        window = MainWindow(cfg)
        window.show()
        code = app.exec()
    sys.exit(code)


if __name__ == "__main__":
    main()
