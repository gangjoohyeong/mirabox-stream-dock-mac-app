# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 명세. macOS .app 번들을 만든다.

    uv run pyinstaller packaging/StreamDock.spec --noconfirm

PySide6 는 통째로 넣으면 매우 커진다. 안 쓰는 Qt 모듈을 빼서 줄인다.
hidapi 는 네이티브 확장이라 딸린 dylib 가 함께 들어가야 한다.
"""

from PyInstaller.utils.hooks import collect_dynamic_libs

APP_NAME = "Stream Dock"
BUNDLE_ID = "com.jkang.mirabox"

# 안 쓰는 Qt 모듈. 넣으면 번들이 몇 배로 커진다.
EXCLUDES = [
    "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets", "PySide6.QtWebEngineQuick",
    "PySide6.QtQuick", "PySide6.QtQuick3D", "PySide6.QtQml", "PySide6.Qt3DCore",
    "PySide6.Qt3DRender", "PySide6.Qt3DAnimation", "PySide6.Qt3DExtras",
    "PySide6.QtMultimedia", "PySide6.QtMultimediaWidgets", "PySide6.QtCharts",
    "PySide6.QtDataVisualization", "PySide6.QtBluetooth", "PySide6.QtNfc",
    "PySide6.QtPositioning", "PySide6.QtLocation", "PySide6.QtSerialPort",
    "PySide6.QtSql", "PySide6.QtTest", "PySide6.QtDesigner", "PySide6.QtHelp",
    "PySide6.QtPdf", "PySide6.QtPdfWidgets", "PySide6.QtOpenGL",
    "PySide6.QtOpenGLWidgets", "PySide6.QtNetworkAuth", "PySide6.QtRemoteObjects",
    "PySide6.QtScxml", "PySide6.QtSensors", "PySide6.QtSpatialAudio",
    "PySide6.QtStateMachine", "PySide6.QtTextToSpeech", "PySide6.QtWebChannel",
    "PySide6.QtWebSockets", "PySide6.QtHttpServer", "PySide6.QtGraphs",
    "tkinter", "unittest", "pydoc_data",
]

analysis = Analysis(
    ["main.py"],
    pathex=["../src"],
    binaries=collect_dynamic_libs("hid"),
    datas=[],
    hiddenimports=[
        # integrations 는 __init__ 에서 정적으로 부르지만 확실히 해 둔다
        "mirabox.integrations.basic",
        "mirabox.integrations.claude.keys",
        "mirabox.integrations.google",
        "mirabox.integrations.atlassian",
        "mirabox.integrations.gitlab",
        "mirabox.integrations.buildhost",
    ],
    excludes=EXCLUDES,
    noarchive=False,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    console=False,
    strip=False,
    upx=False,
    target_arch=None,
)

collected = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    name=APP_NAME,
)

app = BUNDLE(
    collected,
    name=f"{APP_NAME}.app",
    icon="StreamDock.icns",
    bundle_identifier=BUNDLE_ID,
    info_plist={
        "CFBundleName": APP_NAME,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "0.1.0",
        "LSMinimumSystemVersion": "13.0",
        "NSHighResolutionCapable": True,
        "LSApplicationCategoryType": "public.app-category.utilities",
        # 기기를 여는 데 필요한 권한은 없다. 벤더 정의 HID 라 별도 동의가 없다.
    },
)
