/**
 * 기기 화면이 실제로 어디에 어떻게 찍히는지 눈으로 확인하는 패턴.
 *
 * 그림이 한쪽으로 쏠려 보인다는 말은 원인이 셋 중 하나다.
 *   1. 우리가 보내는 그림 자체가 치우쳤다
 *   2. 패널의 보이는 영역이 우리가 쓰는 크기와 다르다
 *   3. 패널은 맞는데 베젤이나 키캡이 한쪽을 더 가린다
 * 1번은 코드로 확인할 수 있지만 2번과 3번은 실물을 봐야 안다. 그래서 답을
 * 읽을 수 있는 그림을 보낸다.
 *
 * 각 키에 그리는 것.
 *   가장 바깥 1px 흰 테두리   네 변이 다 보이면 크기가 맞다
 *   모서리마다 다른 색 갈고리 어느 변이 잘렸는지 바로 읽힌다
 *     좌상 빨강, 우상 초록, 좌하 파랑, 우하 노랑
 *   가운데 십자와 점          가운데가 어디로 보이는지
 *
 * 기기를 점유하므로 앱을 먼저 끈다.
 *
 *   osascript -e 'tell application "Stream Dock" to quit'
 *   npx tsx tools/calib.ts
 */

import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { KEY_COUNT, StreamDock, keySize } from '../src/main/device.js'
import { encodeKey } from '../src/main/render.js'

const CORNERS = [
  { color: '#ff4040', x: 0, y: 0 }, // 좌상
  { color: '#40ff60', x: 1, y: 0 }, // 우상
  { color: '#4090ff', x: 0, y: 1 }, // 좌하
  { color: '#ffd040', x: 1, y: 1 }, // 우하
]

function pattern(index: number): Canvas {
  const size = keySize(index)
  const canvas = createCanvas(size, size) as Canvas
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  // 가장 바깥 픽셀 한 줄. 한 변이라도 안 보이면 그쪽이 잘린 것이다
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, 1)
  ctx.fillRect(0, size - 1, size, 1)
  ctx.fillRect(0, 0, 1, size)
  ctx.fillRect(size - 1, 0, 1, size)

  // 모서리 갈고리. 색으로 어느 쪽인지 구분한다
  const arm = Math.round(size * 0.22)
  const thick = 3
  for (const corner of CORNERS) {
    ctx.fillStyle = corner.color
    const x = corner.x ? size - arm : 0
    const y = corner.y ? size - thick : 0
    ctx.fillRect(x, y, arm, thick)
    ctx.fillRect(corner.x ? size - thick : 0, corner.y ? size - arm : 0, thick, arm)
  }

  // 가운데 십자와 점
  const mid = Math.round(size / 2)
  ctx.fillStyle = '#808080'
  ctx.fillRect(mid, Math.round(size * 0.3), 1, Math.round(size * 0.4))
  ctx.fillRect(Math.round(size * 0.3), mid, Math.round(size * 0.4), 1)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(mid - 2, mid - 2, 5, 5)

  return canvas
}

const dock = new StreamDock()
dock.open()
dock.connect()
dock.setBrightness(80)
for (let index = 0; index < KEY_COUNT; index++) {
  dock.setKeyImage(index, encodeKey(pattern(index)))
}
dock.refresh()
dock.close()

console.log(`${KEY_COUNT} 칸에 보정 패턴을 보냈다. 기기를 보고 답해 달라.

  1. 흰 테두리가 네 변 모두 보이나. 안 보이는 변이 있나
  2. 모서리 갈고리 네 개가 다 보이나
       좌상 빨강, 우상 초록, 좌하 파랑, 우하 노랑
  3. 가운데 흰 점이 키의 한가운데로 보이나

앱을 다시 띄우면 원래 화면으로 돌아온다.`)
