/**
 * 앱 아이콘을 만든다. build/icon.icns 로 나간다.
 *
 * 그림 파일을 저장소에 넣지 않고 코드로 그린다. 기기 자체를 그린다.
 * 가로로 긴 몸체에 6x3 키가 박힌 모양이라 축소해도 무엇인지 읽힌다.
 */

import { createCanvas } from '@napi-rs/canvas'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const SIZE = 1024
const COLUMNS = 6
const ROWS = 3
const BODY = '#1c1d20'
const KEY = '#0a0b0c'
const ACCENT = '#4a8fff'
const OK = '#59b57c'

function draw() {
  const canvas = createCanvas(SIZE, SIZE)
  const ctx = canvas.getContext('2d')

  const key = 130
  const gap = 18
  const pad = 38
  const gridWidth = COLUMNS * key + (COLUMNS - 1) * gap
  const gridHeight = ROWS * key + (ROWS - 1) * gap
  const bodyWidth = gridWidth + pad * 2
  const bodyHeight = gridHeight + pad * 2
  const bodyX = (SIZE - bodyWidth) / 2
  const bodyY = (SIZE - bodyHeight) / 2

  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.roundRect(bodyX, bodyY, bodyWidth, bodyHeight, 76)
  ctx.fill()
  // 어두운 바탕 위에서도 윤곽이 남게 한 줄 두른다
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 3
  ctx.stroke()

  // 위쪽에서 들어오는 빛. 평평한 판이 아니라 물체로 보이게 한다
  const sheen = ctx.createLinearGradient(0, bodyY, 0, bodyY + bodyHeight)
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)')
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.beginPath()
  ctx.roundRect(bodyX, bodyY, bodyWidth, bodyHeight, 76)
  ctx.fill()

  // 게이지를 얹을 칸. 무엇을 하는 물건인지 한눈에 알리는 유일한 단서다
  const bars = new Map([
    [0, { color: ACCENT, fill: 0.62 }],
    [7, { color: OK, fill: 0.34 }],
    [14, { color: OK, fill: 0.86 }],
  ])

  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const x = bodyX + pad + column * (key + gap)
      const y = bodyY + pad + row * (key + gap)
      ctx.fillStyle = KEY
      ctx.beginPath()
      ctx.roundRect(x, y, key, key, 18)
      ctx.fill()

      const bar = bars.get(row * COLUMNS + column)
      if (!bar) continue
      const barX = x + 20
      const barY = y + key - 32
      const barWidth = key - 40
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.beginPath()
      ctx.roundRect(barX, barY, barWidth, 13, 6.5)
      ctx.fill()
      ctx.fillStyle = bar.color
      ctx.beginPath()
      ctx.roundRect(barX, barY, barWidth * bar.fill, 13, 6.5)
      ctx.fill()
    }
  }

  return canvas
}

const canvas = draw()
const iconset = 'build/icon.iconset'
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

// iconutil 이 요구하는 이름 규칙 그대로 낸다
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = size * scale
    const out = createCanvas(pixels, pixels)
    out.getContext('2d').drawImage(canvas, 0, 0, pixels, pixels)
    const suffix = scale === 1 ? '' : '@2x'
    writeFileSync(`${iconset}/icon_${size}x${size}${suffix}.png`, out.toBuffer('image/png'))
  }
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns'])
rmSync(iconset, { recursive: true, force: true })
writeFileSync('build/icon.png', canvas.toBuffer('image/png'))
console.log('build/icon.icns 와 build/icon.png 를 만들었다')
