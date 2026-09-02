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
| 명령 프레임 규격 | 확인 |
| 키 이미지 전송 | 확인 |
| 키 입력 수신 | 확인 (본체 15키) |
| 키 렌더링 | 12종 구현 |
| 데이터 수집 | 8종 구현 |
| 데몬 루프 | 구현 |
| 조작 화면 | PySide6 앱 구현 |
| 키 동작 | 앱, 링크, 셸, 미디어 |

## 요구 사항

- macOS (26.5에서 개발)
- Python 3.11 이상
- Mirabox Stream Dock 293S

sudo는 필요 없다. 기기가 벤더 정의 HID usage page(`0xFFA0`)를 쓰기 때문에
macOS가 키보드나 마우스에 거는 제약을 받지 않는다.

## 설치

uv 로 관리한다.

```bash
uv sync
```

## 실행

벤더 앱이 떠 있으면 기기를 점유하므로 먼저 종료한다.

조작 화면과 데몬이 한 프로세스다. 기기는 한 프로세스만 점유할 수 있어서
따로 두지 않는다.

```bash
osascript -e 'tell application "StreamDock" to quit'
uv run mirabox-app     # 조작 화면 (데몬 포함)
uv run mirabox         # 화면 없이 데몬만
```

기기 없이 렌더링만 확인하려면 이렇게 한다. 실제 크기와 4배 확대를
`/tmp/mirabox-keys` 에 떨군다.

```bash
uv run mirabox-preview
```

기기 통신만 확인하려면 이렇게 한다.

```bash
uv run mirabox-probe
```

Ctrl-C 로 끝낸다. **강제 종료하면 기기가 잠긴다.** HID 핸들을 쥔 채로
죽으면 이후 어떤 프로그램도 열지 못하고 USB 를 다시 꽂아야 한다.

## 키 종류

설정은 `~/.config/mirabox/config.json` 이다. 첫 실행 때 만들어진다.

| 키 | 내용 | 출처 |
| --- | --- | --- |
| `five` | 계정 5시간 한도 사용률 | statusLine 스냅샷 |
| `seven` | 계정 7일 한도 사용률 | statusLine 스냅샷 |
| `ctx` | 최근 세션 컨텍스트 사용률 | statusLine 스냅샷 |
| `cost` | 최근 세션 누적 비용 | statusLine 스냅샷 |
| `cache` | 프롬프트 캐시 적중률 | statusLine 스냅샷 |
| `today` | 오늘 누적 토큰 | 로컬 jsonl |
| `burn` | 현재 블록 분당 토큰 | 로컬 jsonl |
| `mail` | 안 읽은 메일 | `gws` |
| `cal` | 다음 일정까지 | `gws` |
| `jira` | 오늘 Jira 기록 수 | `jira` CLI |
| `mr` | 리뷰 대기 MR | GitLab REST |
| `build` | 빌드 서버 부하 | ssh |

보드에 올린 키에 필요한 수집만 켠다. `mail` 을 안 쓰면 Gmail 을 아예
호출하지 않는다.

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
