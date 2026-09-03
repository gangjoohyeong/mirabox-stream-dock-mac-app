/**
 * 네 변이 각각 몇 픽셀 가려지는지 잰다.
 *
 * 키캡이 패널을 가리는데, 어느 변을 얼마나 가리는지는 실물을 봐야 안다.
 * 키 열여덟 개를 눈금으로 쓴다. 키마다 네 변에서 같은 거리만큼 띄운 짧은
 * 막대를 하나씩 그리고, 가운데 큰 숫자로 그 거리를 적는다. 어떤 색 막대가
 * 온전히 보이는 첫 숫자가 그 변에서 가려지는 픽셀 수다.
 *
 *   위  빨강    아래 파랑    왼쪽 초록    오른쪽 노랑
 *
 * 막대는 변의 가운데 절반만 차지한다. 모서리에서 서로 겹치면 어느 색이
 * 잘린 것인지 읽을 수 없다.
 *
 * 기기를 점유하므로 앱을 먼저 끈다.
 *
 *   osascript -e 'tell application "Stream Dock" to quit'
 *   npx tsx tools/ruler.ts
 */

import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { KEY_COUNT, StreamDock, keySize } from '../src/main/device.js'
import { encodeKey } from '../src/main/render.js'

const THICK = 3

function ruler(index: number, offset: number): Canvas {
  const size = keySize(index)
  const canvas = createCanvas(size, size) as Canvas
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  // 변의 가운데 절반에만 그린다
  const span = Math.round(size * 0.5)
  const start = Math.round((size - span) / 2)

  ctx.fillStyle = '#ff4040' // 위
  ctx.fillRect(start, offset, span, THICK)
  ctx.fillStyle = '#4090ff' // 아래
  ctx.fillRect(start, size - offset - THICK, span, THICK)
  ctx.fillStyle = '#40ff60' // 왼쪽
  ctx.fillRect(offset, start, THICK, span)
  ctx.fillStyle = '#ffd040' // 오른쪽
  ctx.fillRect(size - offset - THICK, start, THICK, span)

  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${Math.round(size * 0.4)}px "Avenir Next Condensed"`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(offset), size / 2, size / 2)

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

console.log(`눈금을 보냈다. 키마다 숫자 하나와 색 막대 네 개가 있다.

  왼쪽 위부터 행 우선으로 0, 1, 2, ... 17
  숫자는 네 막대를 각 변에서 몇 픽셀 띄웠는지를 뜻한다.

  위 빨강   아래 파랑   왼쪽 초록   오른쪽 노랑

색마다 알려 달라. 그 색 막대가 **온전히** 보이는 첫 숫자는 몇인가.
0 번 키에서도 다 보이면 그 변은 안 가려지는 것이다.`)
