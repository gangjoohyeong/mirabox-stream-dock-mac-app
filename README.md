# mirabox-stream-dock-mac-app

Mirabox Stream Dock 293S를 macOS에서 직접 구동하는 데몬. 벤더 앱 없이
HID로 기기와 통신해 키에 정보를 그리고 입력을 받는다.

## 왜 만드나

벤더 앱(StreamDock.app)이 불안정하다. 관측 기준 3분에서 7분 간격으로 스스로
종료됐고, 죽기 직전 로그에는 Qt 페인팅 실패가 반복된다. 설치된 빌드가 공개
최신판보다 높아 업그레이드로 해결할 수 없고, 실행 파일은 2025년 6월 빌드인데
호스트는 macOS 26.5다.

## 상태

초기 단계다. 아래는 실제 장비에서 확인한 것과 남은 것이다.

| 항목 | 상태 |
| --- | --- |
| 기기 식별 (VID/PID, HID 속성) | 확인 |
| Python `hidapi`로 sudo 없이 open | 확인 |
| 명령 프레임 규격 | 미구현 |
| 키 이미지 전송 | 미구현 |
| 키 입력 수신 | 미구현 |
| 키 렌더링 | 설계 확정, 이식 예정 |
| 데이터 수집 | 설계 확정, 이식 예정 |

## 요구 사항

- macOS (26.5에서 개발)
- Python 3.11 이상
- Mirabox Stream Dock 293S

sudo는 필요 없다. 기기가 벤더 정의 HID usage page(`0xFFA0`)를 쓰기 때문에
macOS가 키보드나 마우스에 거는 제약을 받지 않는다.

## 설치

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -e .
```

## 실행

벤더 앱이 떠 있으면 기기를 점유하므로 먼저 종료한다.

```bash
osascript -e 'tell application "StreamDock" to quit'
.venv/bin/python -m mirabox.daemon
```

## 기기 정보

| 항목 | 값 |
| --- | --- |
| USB Vendor ID | `0x5548` |
| USB Product ID | `0x6670` |
| HID usage page | `0xFFA0` |
| 리포트 크기 | 입력 512, 출력 512 바이트 |
| 키 배열 | 6 x 3 = 18 |
| 키 이미지 | 126 x 126 |
| 펌웨어 | `V2.293S.00.003` |

## 참고 구현

293S 프로토콜을 리버스 엔지니어링한 선행 작업들이다.

- [python-elgato-streamdeck PR #148](https://github.com/abcminiuser/python-elgato-streamdeck/pull/148)
  293S 지원 추가. 미머지 상태이나 StreamController가 포크로 채택했다
- [4ndv/mirajazz](https://github.com/4ndv/mirajazz) Rust. 293S를 명시 지원한다
- [rigor789/mirabox-streamdock-node](https://github.com/rigor789/mirabox-streamdock-node)
  Node.js. 293에서만 테스트됐다
- [Uriziel01/Ajazz-AKP153-reverse-engineering](https://github.com/Uriziel01/Ajazz-AKP153-reverse-engineering)

## 라이선스

미정.
