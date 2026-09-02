/** 기기와 실제로 통신되는지 확인한다. 벤더 앱을 먼저 종료할 것. */
import { createCanvas } from '@napi-rs/canvas'
import { KEY_COUNT, COLUMNS, StreamDock, keySize, listDevices } from '../src/main/device.js'
import { encodeKey, BG, INK, ACCENT } from '../src/main/render.js'

const found = listDevices()
console.log(`인터페이스 ${found.length}개`)
if (!found.length) process.exit(1)

const dock = new StreamDock()
dock.open()
console.log('open 성공')
dock.connect()
dock.setBrightness(70)

for (let key = 0; key < KEY_COUNT; key++) {
  const size = keySize(key)
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = ACCENT
  ctx.fillRect(0, 0, size / 4, size / 4)      // 좌상단 표식
  ctx.fillStyle = INK
  ctx.font = '600 40px "Avenir Next Condensed"'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(key), size / 2, size / 2)
  dock.setKeyImage(key, encodeKey(canvas))
}
dock.refresh()
console.log(`${KEY_COUNT}칸에 번호 전송 (좌상단 파란 사각형)`)

console.log('12초 동안 키를 눌러보라')
dock.drain()
const end = Date.now() + 12_000
while (Date.now() < end) {
  for (const ev of dock.readEvents(250)) {
    if (ev.pressed) console.log(`  키 ${ev.key}  행 ${Math.floor(ev.key / COLUMNS)} 열 ${ev.key % COLUMNS}`)
  }
}
dock.close()
console.log('close 완료')
