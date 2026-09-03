/** 기기에서 안 보이는 아래쪽을 빨갛게 덮어 보여 준다. 개발용 확인 도구다. */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import '../src/main/integrations/index.js'
import { KEYS, emptyState } from '../src/main/registry.js'
import { visibleHeight } from '../src/main/render.js'

const S = 95
const SC = 4
const GAP = 14
const state = emptyState()
state.data['claude.snapshot'] = {
  ageMs: 60_000,
  fiveHour: { pct: 62, resetsAt: 0, remainMin: 66, expired: false },
  sevenDay: { pct: 9, resetsAt: 0, remainMin: null, expired: false },
  raw: { context_window: { used_percentage: 14, context_window_size: 1_000_000 } },
}
state.data['system.machine'] = {
  load: 2.5, cores: 10, memFreePct: 61, diskUsedPct: 70, diskFreeGb: 269,
  battery: { pct: 80, charging: true, remainMin: null }, uptimeMin: 555, volume: 42,
}
const names = ['five', 'ctx', 'cpu', 'disk', 'clock', 'text']
const opts: Record<string, Record<string, string>> = {
  text: { title: '회의', value: '시작', color: 'orange', band: 'orange' },
}
const canvas = createCanvas(names.length * (S * SC + GAP) + GAP, S * SC + 2 * GAP)
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#2a2b2e'
ctx.fillRect(0, 0, canvas.width, canvas.height)
ctx.imageSmoothingEnabled = false
const shown = visibleHeight(S)
names.forEach((name, i) => {
  const tile = KEYS.get(name)!.render(0, state, opts[name] ?? {})
  const x = GAP + i * (S * SC + GAP)
  ctx.drawImage(tile, x, GAP, S * SC, S * SC)
  ctx.fillStyle = 'rgba(255,0,0,0.45)'
  ctx.fillRect(x, GAP + shown * SC, S * SC, (S - shown) * SC)
})
writeFileSync('/tmp/hidden.png', canvas.toBuffer('image/png'))
console.log(`보이는 높이 ${shown}/${S}. 빨간 영역이 기기에서 안 보인다`)
