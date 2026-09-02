/**
 * Claude Code 연동.
 *
 * 두 갈래에서 값을 얻는다.
 *   statusLine 스냅샷   계정 한도, 컨텍스트, 비용, 캐시 적중률
 *   로컬 jsonl          오늘 토큰, 현재 블록 소모 속도
 *
 * 계정 한도는 statusLine 훅에서만 나온다. `/usage` 를 비대화형으로 불러도
 * 세션 요약만 나오고 한도는 없다. 훅 payload 에 rate_limits 가 들어오는 것은
 * Claude Code 2.1.80 부터다. ~/.claude/statusline-capture.sh 가 그 payload 를
 * 파일로 떨궈두면 여기서 읽는다.
 *
 * 컨텍스트와 비용과 캐시는 계정 전역이 아니라 세션별 값이다. 여러 세션이
 * 돌면 마지막에 상태줄을 갱신한 세션 것이 잡힌다.
 */

import { openSync, readSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { INK, blank, card, fmt4, limitCard, toneDown, toneUp } from '../render.js'
import { key, pick, source, type State } from '../registry.js'

const F = 'claude' as const

export const SNAPSHOT = 'claude.snapshot'
export const USAGE = 'claude.usage'

const SNAPSHOT_PATH = join(homedir(), '.claude', 'usage-snapshot.json')
const PROJECTS = join(homedir(), '.claude', 'projects')

// ---------- statusLine 스냅샷 ----------

interface Window {
  pct: number
  resetsAt: number
  remainMin: number | null
  expired: boolean
}

export interface SnapshotValue {
  ageMs: number
  fiveHour: Window | null
  sevenDay: Window | null
  raw: Record<string, any>
}

function parseWindow(raw: any, now: number): Window | null {
  if (!raw || typeof raw.used_percentage !== 'number') return null
  const resetsAt = (raw.resets_at ?? 0) * 1000
  // 대화형 세션이 떠 있을 때만 갱신되므로 창이 지났는지 직접 판단한다
  const expired = resetsAt > 0 && now >= resetsAt
  return {
    pct: expired ? 0 : Math.max(0, Math.min(100, Math.round(raw.used_percentage))),
    resetsAt,
    remainMin: resetsAt > 0 ? Math.max(0, Math.round((resetsAt - now) / 60000)) : null,
    expired,
  }
}

source(SNAPSHOT, 5, async (): Promise<SnapshotValue | null> => {
  let stat: ReturnType<typeof statSync>
  let payload: Record<string, any>
  try {
    stat = statSync(SNAPSHOT_PATH)
    payload = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  } catch {
    return null
  }
  const limits = payload.rate_limits
  if (!limits) return null
  const now = Date.now()
  return {
    ageMs: now - stat.mtimeMs,
    fiveHour: parseWindow(limits.five_hour, now),
    sevenDay: parseWindow(limits.seven_day, now),
    raw: payload,
  }
}, (value) => {
  const snap = value as SnapshotValue | null
  if (!snap) return null
  const minutes = Math.round(snap.ageMs / 60_000)
  if (minutes < 20) return null
  const age = minutes >= 120 ? `${Math.round(minutes / 60)}시간` : `${minutes}분`
  return `상태줄이 ${age} 전에 남긴 값이다. 대화형 세션이 그려질 때만 갱신된다`
})

// ---------- 로컬 jsonl ----------

const LIVE_MS = 24 * 3600_000
const BLOCK_MS = 5 * 3600_000
const SEEN_CAP = 200_000
const CHUNK = 1 << 20
const TOKEN_FIELDS = [
  'input_tokens', 'output_tokens',
  'cache_creation_input_tokens', 'cache_read_input_tokens',
] as const

interface Record_ {
  at: number
  tokens: number
}

const offsets = new Map<string, number>()
let seen = new Set<string>()
let records: Record_[] = []

function recentFiles(): { path: string; size: number }[] {
  const cutoff = Date.now() - LIVE_MS
  const out: { path: string; size: number }[] = []
  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.jsonl')) {
        try {
          const stat = statSync(full)
          if (stat.mtimeMs > cutoff) out.push({ path: full, size: stat.size })
        } catch {
          /* 읽는 중 사라진 파일은 건너뛴다 */
        }
      }
    }
  }
  walk(PROJECTS)
  return out
}

function ingest(line: string): void {
  if (!line || !line.includes('"usage"')) return
  let row: any
  try {
    row = JSON.parse(line)
  } catch {
    return
  }
  const usage = row?.message?.usage
  if (!usage || typeof usage !== 'object') return

  const id = `${row.message.id ?? ''}|${row.requestId ?? ''}`
  if (seen.has(id)) return
  seen.add(id)

  const at = Date.parse(row.timestamp ?? '')
  if (!at) return
  let tokens = 0
  for (const field of TOKEN_FIELDS) tokens += Number(usage[field] ?? 0)
  records.push({ at, tokens })
}

/** 전량은 1GB 를 넘는다. 파일별로 어디까지 읽었는지 기억하고 덧붙은 부분만 본다. */
function refreshUsage(): void {
  for (const file of recentFiles()) {
    const previous = offsets.get(file.path) ?? 0
    if (file.size === previous) continue
    const from = file.size < previous ? 0 : previous // 파일이 줄었으면 처음부터
    const want = file.size - from
    if (want <= 0) continue

    let text: string
    let fd: number | null = null
    try {
      fd = openSync(file.path, 'r')
      const buffer = Buffer.alloc(Math.min(want, CHUNK * 64))
      const read = readSync(fd, buffer, 0, buffer.length, from)
      text = buffer.subarray(0, read).toString('utf8')
    } catch {
      continue
    } finally {
      if (fd !== null) closeSync(fd)
    }

    // 마지막 줄은 아직 쓰이는 중일 수 있으니 완결된 줄까지만 소비한다
    const cut = text.lastIndexOf('\n')
    if (cut < 0) continue
    offsets.set(file.path, from + Buffer.byteLength(text.slice(0, cut + 1), 'utf8'))
    for (const line of text.slice(0, cut).split('\n')) ingest(line)
  }

  const keep = Date.now() - LIVE_MS
  records = records.filter((r) => r.at >= keep)
  if (seen.size > SEEN_CAP) seen = new Set()
}

const floorHour = (at: number) => {
  const d = new Date(at)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

export interface UsageValue {
  today: { tokens: number; messages: number } | null
  block: { tokens: number; messages: number; remainMin: number; elapsedMin: number } | null
}

source(USAGE, 15, async (): Promise<UsageValue> => {
  refreshUsage()
  if (records.length === 0) return { today: null, block: null }

  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const todayRows = records.filter((r) => r.at >= midnight.getTime())

  // 5시간 이상 공백이 생기면 다음 활동에서 블록이 새로 시작한다
  const sorted = [...records].sort((a, b) => a.at - b.at)
  let start = floorHour(sorted[0].at)
  let previous = sorted[0].at
  let tokens = 0
  let messages = 0
  for (const row of sorted) {
    if (row.at - previous > BLOCK_MS || row.at - start > BLOCK_MS) {
      start = floorHour(row.at)
      tokens = 0
      messages = 0
    }
    tokens += row.tokens
    messages += 1
    previous = row.at
  }

  const now = Date.now()
  return {
    today: { tokens: todayRows.reduce((sum, r) => sum + r.tokens, 0), messages: todayRows.length },
    block: {
      tokens,
      messages,
      remainMin: Math.max(0, Math.round((start + BLOCK_MS - now) / 60000)),
      elapsedMin: Math.max(1, Math.round((now - start) / 60000)),
    },
  }
})

// ---------- 키 ----------

const raw = (state: State, field: string): Record<string, any> =>
  pick<SnapshotValue>(state, SNAPSHOT)?.raw?.[field] ?? {}

key({
  name: 'five', label: '5H', summary: '계정 5시간 한도 사용률', family: F, sources: [SNAPSHOT],
  render: (index, state) => {
    const snap = pick<SnapshotValue>(state, SNAPSHOT)
    return limitCard(index, '5H', snap?.fiveHour, snap?.ageMs ?? Infinity, F)
  },
})

key({
  name: 'seven', label: '7D', summary: '계정 7일 한도 사용률', family: F, sources: [SNAPSHOT],
  render: (index, state) => {
    const snap = pick<SnapshotValue>(state, SNAPSHOT)
    return limitCard(index, '7D', snap?.sevenDay, snap?.ageMs ?? Infinity, F)
  },
})

key({
  name: 'ctx', label: 'CTX', summary: '최근 활동 세션의 컨텍스트 사용률', family: F, sources: [SNAPSHOT],
  render: (index, state) => {
    const window = raw(state, 'context_window')
    if (typeof window.used_percentage !== 'number') return blank(index, 'CTX', '--', F)
    const pct = Math.max(0, Math.min(100, Math.round(window.used_percentage)))
    return card(index, {
      label: 'CTX', value: `${pct}%`, valueColor: toneUp(pct), family: F,
      right: fmt4(window.context_window_size ?? 0), bandPct: pct, bandColor: toneUp(pct),
    })
  },
})

key({
  name: 'cost', label: 'COST', summary: '최근 활동 세션의 누적 비용', family: F, sources: [SNAPSHOT],
  render: (index, state) => {
    const cost = raw(state, 'cost')
    if (typeof cost.total_cost_usd !== 'number') return blank(index, 'COST', '--', F)
    const hours = Math.round((cost.total_duration_ms ?? 0) / 3_600_000)
    return card(index, {
      label: 'COST', value: `$${Math.round(cost.total_cost_usd)}`, family: F,
      right: hours > 0 ? `${hours}h` : null,
    })
  },
})

key({
  name: 'cache', label: 'CACHE', summary: '프롬프트 캐시 적중률', family: F, sources: [SNAPSHOT],
  render: (index, state) => {
    const cache = raw(state, 'prompt_cache')
    if (typeof cache.hit_ratio !== 'number') return blank(index, 'CACHE', '--', F)
    const pct = Math.round(cache.hit_ratio * 100)
    return card(index, {
      label: 'CACHE', value: `${pct}%`, valueColor: toneDown(pct), family: F,
      bandPct: pct, bandColor: toneDown(pct),
    })
  },
})

key({
  name: 'today', label: 'TODAY', summary: '오늘 누적 토큰', family: F, sources: [USAGE],
  render: (index, state) => {
    const today = pick<UsageValue>(state, USAGE)?.today
    if (!today) return blank(index, 'TODAY', '--', F)
    return card(index, {
      label: 'TODAY', value: fmt4(today.tokens), right: String(today.messages),
      valueColor: INK, family: F,
    })
  },
})

key({
  name: 'burn', label: 'BURN', summary: '현재 블록의 분당 토큰 소모', family: F, sources: [USAGE],
  render: (index, state) => {
    const block = pick<UsageValue>(state, USAGE)?.block
    if (!block?.elapsedMin) return blank(index, 'BURN', '--', F)
    return card(index, {
      label: 'BURN', value: fmt4(block.tokens / block.elapsedMin),
      right: String(block.messages), valueColor: INK, family: F,
    })
  },
})
