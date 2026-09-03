/**
 * 아래쪽이 몇 픽셀 가려지는지 잰다.
 *
 * 보정 패턴에서 아래 변만 안 보인다는 것을 확인했다. 이제 양을 알아야 한다.
 * 키 열여덟 개를 눈금으로 쓴다. 키마다 흰 막대를 바닥에서 조금씩 띄워 그리고,
 * 큰 숫자로 몇 픽셀 띄웠는지 적는다. 막대가 온전히 보이는 첫 숫자가 곧
 * 가려지는 픽셀 수다.
 *
 * 기기를 점유하므로 앱을 먼저 끈다.
 *
 *   osascript -e 'tell application "Stream Dock" to quit'
 *   npx tsx tools/ruler.ts
 */

import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { KEY_COUNT, StreamDock, keySize } from '../src/main/device.js'
import { encodeKey } from '../src/main/render.js'

const BAR = 4

function ruler(index: number, offset: number): Canvas {
  const size = keySize(index)
  const canvas = createCanvas(size, size) as Canvas
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  // 위쪽은 잘리지 않는 것이 확인됐다. 기준선으로 남겨 둔다
  ctx.fillStyle = '#40ff60'
  ctx.fillRect(0, 0, size, 2)

  // 바닥에서 offset 만큼 띄운 흰 막대. 이게 온전히 보이면 그만큼은 안 가려진다
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, size - offset - BAR, size, BAR)

  // 몇 픽셀 띄웠는지. 가운데 크게
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${Math.round(size * 0.42)}px "Avenir Next Condensed"`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(offset), size / 2, size * 0.45)

  return canvas
}

const dock = new StreamDock()
dock.open()
dock.connect()
dock.setBrightness(80)
for (let index = 0; index < KEY_COUNT; index++) {
  dock.setKeyImage(index, encodeKey(ruler(index, index)))
}
dock.refresh()
dock.close()

console.log(`눈금을 보냈다. 키마다 숫자와 흰 막대가 하나씩 있다.

  왼쪽 위부터 행 우선으로 0, 1, 2, ... 17 이다.
  숫자는 흰 막대를 바닥에서 몇 픽셀 띄웠는지를 뜻한다.
  초록 줄은 위쪽 기준선이다. 모든 키에서 보여야 한다.

알려 달라. 흰 막대가 **온전히** 보이는 첫 숫자는 몇인가.
0 번 키에서도 막대가 다 보이면 아래는 안 가려지는 것이다.`)
