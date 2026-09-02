/** 사내 빌드 서버 연동. ssh 키 인증으로 붙는다. */

import { DANGER, OK, TERTIARY, WARN, blank, card } from '../render.js'
import { key, pick, source } from '../registry.js'
import { sh } from '../shell.js'

export const BUILD = 'buildhost.load'

// 원격 명령은 로컬에서 작은따옴표로 감싸 넘긴다. 그래서 명령 안에는
// 작은따옴표도 $ 도 쓰면 안 된다. 둘 다 로컬 셸이 먼저 건드린다.
const REMOTE = 'cut -d" " -f1 /proc/loadavg; nproc; df -P / | tail -1 | tr -s " " | cut -d" " -f5'

interface BuildValue { load: number; cores: number; diskPct: number }

source(BUILD, 300, async (): Promise<BuildValue> => {
  const out = await sh(
    `ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new sphere-build '${REMOTE}' 2>/dev/null`,
    25_000)
  const parts = out.trim().split('\n')
  if (parts.length < 3) throw new Error('빌드 서버 응답이 짧다')
  return { load: parseFloat(parts[0]), cores: parseInt(parts[1], 10), diskPct: parseInt(parts[2], 10) }
})

key({
  name: 'build', label: 'BUILD', summary: '빌드 서버 부하와 디스크', sources: [BUILD],
  render: (index, state) => {
    const value = pick<BuildValue>(state, BUILD)
    if (!value) return blank(index, 'BUILD')
    const ratio = value.cores ? value.load / value.cores : 0
    const color = ratio >= 0.9 ? DANGER : ratio >= 0.5 ? WARN : OK
    return card(index, {
      label: 'BUILD',
      value: value.load < 10 ? value.load.toFixed(1) : String(Math.round(value.load)),
      valueColor: color,
      right: value.diskPct ? `${value.diskPct}%` : null,
      rightColor: value.diskPct >= 85 ? DANGER : TERTIARY,
      bandPct: ratio * 100, bandColor: color,
    })
  },
})
