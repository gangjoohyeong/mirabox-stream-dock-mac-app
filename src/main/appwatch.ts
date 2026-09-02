/**
 * 앞으로 나온 앱을 감시한다.
 *
 * 프로필에 앱을 지정해 두면 그 앱이 활성화될 때 자동으로 전환한다.
 *
 * Node 에는 NSWorkspace 가 없다. AppleScript 로 물어보면 자동화 권한
 * 프롬프트가 뜨므로, 권한이 필요 없는 lsappinfo 를 쓴다.
 */

import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sh } from './shell.js'

const APP_DIRS = ['/Applications', '/System/Applications', join(homedir(), 'Applications')]

export async function frontmost(): Promise<string> {
  try {
    const asn = (await sh('lsappinfo front', 2000)).trim()
    if (!asn) return ''
    const info = await sh(`lsappinfo info -only name ${asn}`, 2000)
    return info.match(/"LSDisplayName"="([^"]*)"/)?.[1] ?? ''
  } catch {
    return ''
  }
}

/** 조작 화면에서 앱을 고를 때 쓸 목록. 설치된 앱을 그대로 보여준다. */
export function listApps(): string[] {
  const names = new Set<string>()
  for (const dir of APP_DIRS) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.endsWith('.app')) names.add(entry.slice(0, -4))
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'ko'))
}

/** 앞선 앱이 바뀌면 콜백한다. 값이 바뀌었을 때만 알린다. */
export class AppWatcher {
  private timer: NodeJS.Timeout | null = null
  private current = ''

  constructor(
    private readonly onChange: (app: string) => void,
    private readonly intervalMs = 1500,
  ) {}

  start(): void {
    if (this.timer) return
    const tick = async () => {
      const name = await frontmost()
      if (name && name !== this.current) {
        this.current = name
        try {
          this.onChange(name)
        } catch {
          /* 콜백 실패가 감시를 멈추게 두지 않는다 */
        }
      }
    }
    void tick()
    this.timer = setInterval(tick, this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
