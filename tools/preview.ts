/**
 * 등록된 키를 전부 한 장에 그린다. 기기 없이 눈으로 확인하는 용도다.
 *
 * 좌표 계산만 믿으면 안 된다. 특히 출처 표식은 95px 에서 서로 구별돼야 하고,
 * 라벨이 길어지면 보조값과 부딪힌다. 실제 크기와 3배 확대를 함께 낸다.
 *
 *   npx tsx tools/preview.ts /tmp/keys.png
 */

import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import '../src/main/integrations/index.js'
import { KEYS } from '../src/main/registry.js'
import { FAMILIES } from '../src/main/render.js'
import { emptyState, type State } from '../src/main/registry.js'
import { SNAPSHOT, USAGE } from '../src/main/integrations/claude.js'
import { CALENDAR, MAIL } from '../src/main/integrations/google.js'
import { JIRA_TODAY } from '../src/main/integrations/atlassian.js'
import { REVIEW_MRS } from '../src/main/integrations/gitlab.js'
import { BUILD } from '../src/main/integrations/buildhost.js'
import { MACHINE } from '../src/main/integrations/system.js'
import { WEATHER } from '../src/main/integrations/weather.js'

const OUT = process.argv[2] ?? '/tmp/keys.png'
const SIZE = 95
const SCALE = 3
const GAP = 10
const COLUMNS = 7

/** 진짜처럼 보이는 값. 빈 카드만 잔뜩 나오면 볼 것이 없다. */
function sampleState(): State {
  const state = emptyState()
  const hour = 3600_000
  state.data[SNAPSHOT] = {
    ageMs: 4 * 60_000,
    fiveHour: { pct: 62, resetsAt: Date.now() + hour, remainMin: 66, expired: false },
    sevenDay: { pct: 9, resetsAt: Date.now() + 67 * hour, remainMin: 67 * 60, expired: false },
    raw: {
      context_window: { used_percentage: 14, context_window_size: 1_000_000 },
      cost: { total_cost_usd: 107.4, total_duration_ms: 45 * hour },
      prompt_cache: { hit_ratio: 0.98 },
    },
  }
  state.data[USAGE] = {
    today: { tokens: 401_000_000, messages: 812 },
    block: { tokens: 84_000_000, messages: 210, elapsedMin: 58 },
  }
  state.data[MAIL] = { unread: 49, threads: 78 }
  state.data[CALENDAR] = { inMin: 41 * 60 }
  state.data[JIRA_TODAY] = { items: 1 }
  state.data[REVIEW_MRS] = { count: 0 }
  state.data[BUILD] = { load: 8.5, cores: 40, diskUsedPct: 34 }
  state.data[MACHINE] = {
    load: 1.4, cores: 10, memFreePct: 31, diskUsedPct: 70, diskFreeGb: 269,
    battery: { pct: 96, charging: true, remainMin: 23 },
    uptimeMin: 555, volume: 42,
  }
  state.data[WEATHER] = {
    place: '서울', tempC: 23, feelsC: 25, code: 61, highC: 28, lowC: 19, rainPct: 70, windMs: 3.4,
  }
  return state
}

const OPTIONS: Record<string, Record<string, string>> = {
  text: { title: '회의', value: '시작', color: 'blue', band: 'blue' },
  clock: { hour: '12' },
}

/**
 * 평상시 모습만 봐서는 모자란다. 값이 낡았을 때, 라벨이 길 때, 아직 아무것도
 * 못 받았을 때가 실제로 자주 나오고 그때 깨진다.
 */
function specials(): { name: string; state: State; options: Record<string, string> }[] {
  const stale = sampleState()
  const snap = stale.data[SNAPSHOT] as any
  stale.data[SNAPSHOT] = { ...snap, ageMs: 132 * 60_000 }

  const longLabel = sampleState()
  const weather = longLabel.data[WEATHER] as any
  longLabel.data[WEATHER] = { ...weather, code: 81, tempC: -8 }

  return [
    { name: 'five', state: stale, options: {} },
    { name: 'seven', state: stale, options: {} },
    { name: 'weather', state: longLabel, options: {} },
    { name: 'mail', state: emptyState(), options: {} },
    { name: 'cpu', state: emptyState(), options: {} },
    { name: 'jira', state: emptyState(), options: {} },
    { name: 'text', state: emptyState(), options: { title: '아주긴제목', value: '길다란값' } },
  ]
}

const state = sampleState()
const normal = [...KEYS.values()].map((entry) => ({
  entry,
  state,
  options: OPTIONS[entry.name] ?? {},
}))
const extra = specials().map((item) => ({
  entry: KEYS.get(item.name)!,
  state: item.state,
  options: item.options,
}))
// 특수 상황은 줄을 바꿔 시작하게 빈 자리로 채운다
const pad = (COLUMNS - (normal.length % COLUMNS)) % COLUMNS
const entries = [...normal, ...Array(pad).fill(null), ...extra]
const rows = Math.ceil(entries.length / COLUMNS)

// 위쪽은 실제 크기, 아래쪽은 3배. 둘 다 봐야 판단이 선다.
const width = COLUMNS * (SIZE * SCALE + GAP) + GAP
const smallH = rows * (SIZE + GAP) + GAP
const bigH = rows * (SIZE * SCALE + GAP) + GAP
const canvas = createCanvas(width, smallH + bigH)
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#202124'
ctx.fillRect(0, 0, canvas.width, canvas.height)
ctx.imageSmoothingEnabled = false

entries.forEach((item, i) => {
  if (!item) return
  const column = i % COLUMNS
  const row = Math.floor(i / COLUMNS)
  const tile = item.entry.render(0, item.state, item.options)
  ctx.drawImage(tile, GAP + column * (SIZE + GAP), GAP + row * (SIZE + GAP), SIZE, SIZE)
  ctx.drawImage(
    tile,
    GAP + column * (SIZE * SCALE + GAP),
    smallH + GAP + row * (SIZE * SCALE + GAP),
    SIZE * SCALE,
    SIZE * SCALE,
  )
})

writeFileSync(OUT, canvas.toBuffer('image/png'))
console.log(`키 ${normal.length} 개와 특수 상황 ${extra.length} 개를 ${OUT} 에 그렸다`)
for (const [name, style] of Object.entries(FAMILIES)) {
  const labels = normal.filter((n) => n.entry.family === name).map((n) => n.entry.label)
  if (labels.length) {
    console.log(`  ${style.title.padEnd(10)} ${style.mark.padEnd(9)} ${labels.join(' ')}`)
  }
}
