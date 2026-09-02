/**
 * 이 맥의 상태.
 *
 * 바깥에 나가지 않는다. 전부 로컬 명령 한 줄이라 실패할 여지가 적고 빠르다.
 * 한 번에 모아서 한 소스로 낸다. 키마다 따로 부르면 같은 명령을 여섯 번
 * 돌리게 된다.
 */

import { DANGER, INK, OK, TERTIARY, WARN, blank, card, hhmm } from '../render.js'
import { key, pick, source } from '../registry.js'
import { sh } from '../shell.js'

const F = 'system' as const

export const MACHINE = 'system.machine'

export interface MachineValue {
  load: number
  cores: number
  memFreePct: number | null
  diskUsedPct: number | null
  diskFreeGb: number | null
  battery: { pct: number; charging: boolean; remainMin: number | null } | null
  uptimeMin: number | null
  volume: number | null
}

/** `{ 1.36 1.50 1.98 }` 에서 첫 값만 쓴다. */
function parseLoad(text: string): number {
  const match = text.match(/([\d.]+)/)
  return match ? Number(match[1]) : 0
}

/** `System-wide memory free percentage: 69%` */
function parseMemFree(text: string): number | null {
  const match = text.match(/free percentage:\s*(\d+)/)
  return match ? Number(match[1]) : null
}

/** `-InternalBattery-0 (id=..)\t96%; charging; 0:23 remaining present: true` */
function parseBattery(text: string): MachineValue['battery'] {
  const pct = text.match(/(\d+)%/)
  if (!pct) return null
  const remain = text.match(/(\d+):(\d\d)\s+remaining/)
  return {
    pct: Number(pct[1]),
    charging: /charging|charged|AC Power/i.test(text),
    // 0:00 은 "계산 중" 이라는 뜻이라 값이 아니다
    remainMin: remain && remain[0] !== '0:00' ? Number(remain[1]) * 60 + Number(remain[2]) : null,
  }
}

/** `{ sec = 1788303574, usec = ... }` */
function parseBoot(text: string): number | null {
  const match = text.match(/sec\s*=\s*(\d+)/)
  if (!match) return null
  return Math.max(0, Math.round((Date.now() / 1000 - Number(match[1])) / 60))
}

source(MACHINE, 20, async (): Promise<MachineValue> => {
  const line = async (command: string) => {
    try {
      return (await sh(command, 4000)).trim()
    } catch {
      return ''
    }
  }

  const [loadRaw, coresRaw, memRaw, diskRaw, battRaw, bootRaw, volRaw] = await Promise.all([
    line('sysctl -n vm.loadavg'),
    line('sysctl -n hw.ncpu'),
    line('memory_pressure -Q'),
    // 루트는 봉인된 시스템 스냅숏이라 늘 한가해 보인다. 사람이 쓰는 볼륨을 본다.
    line('df -P /System/Volumes/Data | tail -1'),
    line('pmset -g batt | tail -1'),
    line('sysctl -n kern.boottime'),
    line("osascript -e 'output volume of (get volume settings)'"),
  ])

  const disk = diskRaw.split(/\s+/)
  const usedPct = disk.length >= 5 ? Number(disk[4].replace('%', '')) : NaN
  const freeKb = disk.length >= 4 ? Number(disk[3]) : NaN

  return {
    load: parseLoad(loadRaw),
    cores: Number(coresRaw) || 1,
    memFreePct: parseMemFree(memRaw),
    diskUsedPct: Number.isFinite(usedPct) ? usedPct : null,
    diskFreeGb: Number.isFinite(freeKb) ? freeKb / 1024 / 1024 : null,
    battery: parseBattery(battRaw),
    uptimeMin: parseBoot(bootRaw),
    volume: /^\d+$/.test(volRaw) ? Number(volRaw) : null,
  }
})

const machine = (state: Parameters<typeof pick>[0]) => pick<MachineValue>(state, MACHINE)

key({
  name: 'cpu', label: 'CPU', summary: '이 맥의 부하 (코어 수 대비)', family: F, sources: [MACHINE],
  render: (index, state) => {
    const value = machine(state)
    if (!value) return blank(index, 'CPU', '--', F)
    const pct = Math.min(100, Math.round((value.load / value.cores) * 100))
    const color = pct >= 90 ? DANGER : pct >= 50 ? WARN : OK
    return card(index, {
      label: 'CPU',
      value: `${pct}%`,
      right: value.load.toFixed(1),
      valueColor: color,
      bandPct: pct,
      bandColor: color,
      family: F,
    })
  },
})

key({
  name: 'mem', label: 'MEM', summary: '이 맥의 메모리 사용률', family: F, sources: [MACHINE],
  render: (index, state) => {
    const free = machine(state)?.memFreePct
    if (free == null) return blank(index, 'MEM', '--', F)
    const used = 100 - free
    const color = used >= 90 ? DANGER : used >= 75 ? WARN : OK
    return card(index, {
      label: 'MEM', value: `${used}%`, valueColor: color, bandPct: used, bandColor: color, family: F,
    })
  },
})

key({
  name: 'disk', label: 'DISK', summary: '이 맥의 디스크 사용률과 남은 용량', family: F, sources: [MACHINE],
  render: (index, state) => {
    const value = machine(state)
    if (value?.diskUsedPct == null) return blank(index, 'DISK', '--', F)
    const color = value.diskUsedPct >= 90 ? DANGER : value.diskUsedPct >= 80 ? WARN : OK
    return card(index, {
      label: 'DISK',
      value: `${value.diskUsedPct}%`,
      right: value.diskFreeGb == null ? null : `${Math.round(value.diskFreeGb)}G`,
      valueColor: color,
      bandPct: value.diskUsedPct,
      bandColor: color,
      family: F,
    })
  },
})

key({
  name: 'battery', label: 'BATT', summary: '배터리 잔량과 남은 시간', family: F, sources: [MACHINE],
  render: (index, state) => {
    const battery = machine(state)?.battery
    if (!battery) return blank(index, 'BATT', '--', F)
    // 충전 중이면 잔량이 낮아도 문제가 아니다. 경고는 방전 중일 때만 뜬다.
    const color = battery.charging
      ? OK
      : battery.pct <= 15
        ? DANGER
        : battery.pct <= 30
          ? WARN
          : INK
    return card(index, {
      label: 'BATT',
      value: `${battery.pct}%`,
      right: battery.charging ? 'AC' : battery.remainMin == null ? null : hhmm(battery.remainMin),
      rightColor: battery.charging ? OK : TERTIARY,
      valueColor: color,
      bandPct: battery.pct,
      bandColor: color === INK ? OK : color,
      family: F,
    })
  },
})

key({
  name: 'uptime', label: 'UP', summary: '이 맥을 켜 둔 시간', family: F, sources: [MACHINE],
  render: (index, state) => {
    const minutes = machine(state)?.uptimeMin
    if (minutes == null) return blank(index, 'UP', '--', F)
    const days = Math.floor(minutes / 1440)
    return card(index, {
      label: 'UP',
      value: days >= 1 ? `${days}d` : hhmm(minutes),
      right: days >= 1 ? hhmm(minutes % 1440) : null,
      valueColor: INK,
      family: F,
    })
  },
})

key({
  name: 'volume', label: 'VOL', summary: '시스템 출력 음량', family: F, sources: [MACHINE],
  render: (index, state) => {
    const volume = machine(state)?.volume
    if (volume == null) return blank(index, 'VOL', '--', F)
    return card(index, {
      label: 'VOL',
      value: volume === 0 ? 'mute' : `${volume}%`,
      valueColor: volume === 0 ? TERTIARY : INK,
      bandPct: volume,
      bandColor: volume === 0 ? TERTIARY : OK,
      family: F,
    })
  },
})
