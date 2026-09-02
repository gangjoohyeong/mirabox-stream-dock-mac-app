/**
 * 지금 설정대로 18칸을 기기 모양 그대로 한 장에 그린다. README 에 넣을 그림이다.
 *
 * 앱 화면을 찍으면 창 껍데기가 절반을 차지한다. 기기에 실제로 나가는 그림만
 * 보이는 편이 무엇을 만드는 물건인지 빨리 설명한다. 사이드 열이 작은 것도
 * 실제 비율 그대로다.
 *
 *   npx tsx tools/board.ts /tmp/board.png
 */

import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { load, profileOf } from '../src/main/config.js'
import { KEY_COUNT, keySize } from '../src/main/device.js'
import '../src/main/integrations/index.js'
import { warmImages } from '../src/main/integrations/index.js'
import { KEYS, emptyState, type State } from '../src/main/registry.js'
import { SOURCES } from '../src/main/registry.js'
import { empty } from '../src/main/render.js'

const OUT = process.argv[2] ?? '/tmp/board.png'
const COLUMNS = 6
const ROWS = 3
const SCALE = 4
const GAP = 9
const PAD = 22
const BODY = '#1c1d20'

const config = load()
const profile = profileOf(config)

// 보드에 올라온 키가 요구하는 소스만 실제로 부른다
const state: State = emptyState()
const wanted = new Set<string>()
for (const slot of profile.slots) {
  for (const name of (slot.key && KEYS.get(slot.key)?.sources) ?? []) wanted.add(name)
}
await Promise.all(
  [...wanted].map(async (name) => {
    try {
      state.data[name] = await SOURCES.get(name)!.fetch()
    } catch (error) {
      console.warn(`${name}: ${error instanceof Error ? error.message : error}`)
    }
  }),
)
await warmImages(profile.slots.map((s) => s.options.path ?? ''))

// 실제 키 크기 비율을 지킨다. 사이드 열은 작다.
const cell = keySize(0) * SCALE
const width = PAD * 2 + COLUMNS * cell + (COLUMNS - 1) * GAP
const height = PAD * 2 + ROWS * cell + (ROWS - 1) * GAP
const canvas = createCanvas(width, height)
const ctx = canvas.getContext('2d')

ctx.fillStyle = BODY
ctx.beginPath()
ctx.roundRect(0, 0, width, height, 26)
ctx.fill()

for (let index = 0; index < KEY_COUNT; index++) {
  const slot = profile.slots[index]
  const entry = slot.key ? KEYS.get(slot.key) : undefined
  const tile = entry ? entry.render(index, state, slot.options) : empty(index)
  const size = keySize(index) * SCALE
  const column = index % COLUMNS
  const row = Math.floor(index / COLUMNS)
  // 작은 키는 칸 가운데에 놓는다
  const x = PAD + column * (cell + GAP) + (cell - size) / 2
  const y = PAD + row * (cell + GAP) + (cell - size) / 2
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, 10)
  ctx.clip()
  ctx.drawImage(tile, x, y, size, size)
  ctx.restore()
}

writeFileSync(OUT, canvas.toBuffer('image/png'))
console.log(`${OUT} (${width}x${height})`)
