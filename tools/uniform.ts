/**
 * 자리에 따라 다르게 보이는지 확인한다.
 *
 * 앞선 보정 시험에는 결함이 있었다. 후보를 서로 다른 칸에 늘어놓고 비교했다.
 * 키캡은 살짝 파인 창이라 보는 각도에 따라 안쪽이 달라 보인다. 그러면 "몇
 * 번째가 가운데로 보인다" 는 답이 내용의 자리가 아니라 그 칸의 자리를 고른
 * 것일 수 있다.
 *
 * 그래서 열다섯 개 본체 키에 **똑같은 그림**을 넣는다. 전부 빛나는 영역의
 * 정확한 가운데다. 이걸 보고 칸마다 다르게 보이면 원인은 시선 각도이고,
 * 상수 하나로 밀면 어떤 키는 나아지고 어떤 키는 나빠진다.
 *
 * 기기를 점유하므로 앱을 먼저 끈다.
 *
 *   osascript -e 'tell application "Stream Dock" to quit'
 *   npx tsx tools/uniform.ts
 */

import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { COLUMNS, KEY_COUNT, StreamDock, keySize } from '../src/main/device.js'
import { encodeKey, visibleHeight } from '../src/main/render.js'

function tile(index: number): Canvas {
  const size = keySize(index)
  const shown = visibleHeight(size)
  const canvas = createCanvas(size, size) as Canvas
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  // 사이드 열은 다른 화면이라 비교 대상이 아니다
  if (index % COLUMNS >= COLUMNS - 1) return canvas

  const cx = size / 2
  const cy = shown / 2

  // 빛나는 영역의 경계. 어디가 끝인지 같이 보여 준다
  ctx.strokeStyle = '#2f6a3a'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, shown - 2)

  // 정확히 가운데인 원과 십자
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, Math.round(size * 0.26), 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#101114'
  ctx.fillRect(cx - 1, cy - 12, 2, 24)
  ctx.fillRect(cx - 12, cy - 1, 24, 2)

  return canvas
}

const dock = new StreamDock()
dock.open()
dock.connect()
dock.setBrightness(80)
for (let index = 0; index < KEY_COUNT; index++) {
  dock.setKeyImage(index, encodeKey(tile(index)))
}
dock.refresh()
dock.close()

console.log(`본체 키 열다섯 개에 **똑같은 그림**을 넣었다.
전부 빛나는 영역의 정확한 가운데다. 오른쪽 끝 열은 비어 있다.

머리를 움직이지 말고 평소 쓰는 자세로 보고 답해 달라.

  1. 열다섯 개가 다 같아 보이나, 아니면 칸마다 다르게 보이나
  2. 다르다면 어느 쪽이 어느 방향으로 쏠려 보이나
     (예: 왼쪽 칸들은 오른쪽으로, 오른쪽 칸들은 왼쪽으로)
  3. 가운데 칸(둘째 줄 셋째 칸)만 보면 원이 가운데로 보이나

칸마다 다르면 원인은 보는 각도다. 그러면 상수 하나로 밀어서는 고칠 수 없고,
지금처럼 기하학적 가운데에 두는 것이 맞다.`)
