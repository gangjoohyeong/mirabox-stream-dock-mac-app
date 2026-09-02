#!/bin/sh
# .app 번들을 만든다. 결과는 dist/Stream Dock.app 이다.
set -e
cd "$(dirname "$0")/.."
uv sync --dev
uv run python tools/make_icon.py packaging/StreamDock.icns
uv run pyinstaller packaging/StreamDock.spec --noconfirm --distpath dist --workpath build
echo
echo "완성: dist/Stream Dock.app  ($(du -sh 'dist/Stream Dock.app' | cut -f1))"
echo "설치하려면 /Applications 로 옮긴다:"
echo "  cp -R 'dist/Stream Dock.app' /Applications/"
