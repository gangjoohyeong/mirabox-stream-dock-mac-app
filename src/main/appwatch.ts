/**
 * 앞으로 나온 앱을 감시하고, 고를 수 있는 앱 목록을 만든다.
 *
 * 프로필에 앱을 지정해 두면 그 앱이 활성화될 때 자동으로 전환한다.
 *
 * Node 에는 NSWorkspace 가 없다. AppleScript 로 물어보면 자동화 권한
 * 프롬프트가 뜨므로, 권한이 필요 없는 lsappinfo 를 쓴다.
 *
 * 앱을 이름으로 붙잡으면 안 된다. 실기기에서 확인한 것들이다.
 *   `Visual Studio Code.app` 은 스스로를 `Code` 라고 보고한다
 *   `TextEdit.app` 은 한국어 환경에서 `텍스트 편집기` 다
 *   `open -a "Code"` 는 실패한다. `open -a` 는 번들 파일명만 받는다
 * 세 이름이 다 다르므로 이름을 식별자로 쓰면 자동 전환도 실행도 조용히
 * 어긋난다. 식별자는 번들 ID 하나로 통일하고, 이름은 보여주기에만 쓴다.
 */

import { homedir } from 'node:os'
import { sh } from './shell.js'
import type { AppInfo } from '../shared/types.js'

const APP_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  `${homedir()}/Applications`,
]

/** 앞선 앱. 프로필을 붙잡는 열쇠는 id 이고 name 은 화면에 띄울 때만 쓴다. */
export interface FrontApp {
  id: string
  name: string
}

export async function frontmost(): Promise<FrontApp | null> {
  try {
    const asn = (await sh('lsappinfo front', 2000)).trim()
    if (!asn) return null
    const info = await sh(`lsappinfo info -only bundleid -only name ${asn}`, 2000)
    const id = info.match(/"CFBundleIdentifier"="([^"]*)"/)?.[1] ?? ''
    const name = info.match(/"LSDisplayName"="([^"]*)"/)?.[1] ?? ''
    return id ? { id, name } : null
  } catch {
    return null
  }
}

/**
 * 설치된 앱을 훑는다.
 *
 * 번들마다 plutil 과 mdls 를 한 번씩 돌리므로 백 개면 0.5 초쯤 걸린다.
 * 매번 하면 안 되고 캐시가 필요하다. 아래 AppIndex 가 그 일을 한다.
 */
async function scanApps(): Promise<AppInfo[]> {
  // 셸에서 한 번에 돌린다. 백 번의 프로세스 왕복을 Node 에서 하면 훨씬 느리다
  const script = `
for d in ${APP_DIRS.map((d) => `'${d}'`).join(' ')}; do
  [ -d "$d" ] || continue
  for p in "$d"/*.app; do
    [ -d "$p" ] || continue
    base=$(basename "$p" .app)
    case "$base" in .*) continue ;; esac
    id=$(plutil -extract CFBundleIdentifier raw "$p/Contents/Info.plist" 2>/dev/null) || continue
    [ -n "$id" ] || continue
    name=$(mdls -name kMDItemDisplayName -raw "$p" 2>/dev/null)
    case "$name" in ""|"(null)") name=$base ;; esac
    printf '%s\t%s\t%s\n' "$id" "\${name%.app}" "$p"
  done
done`
  const out = await sh(script, 20000)
  const apps = new Map<string, AppInfo>()
  for (const line of out.split('\n')) {
    const [id, name, path] = line.split('\t')
    if (!id || !name || !path) continue
    // 같은 앱이 여러 곳에 있으면 먼저 찾은 것을 쓴다
    if (!apps.has(id)) apps.set(id, { id, name, running: false, path })
  }
  return [...apps.values()]
}

/** 지금 떠 있는 앱의 번들 ID. 배경 전용 프로세스는 뺀다. */
async function runningIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const out = await sh('lsappinfo list', 4000)
    let id = ''
    for (const line of out.split('\n')) {
      const found = line.match(/bundleID="([^"]*)"/)
      if (found) id = found[1]
      // 사용자가 볼 수 있는 앱만. loginwindow 같은 것을 목록에 올릴 이유가 없다
      if (id && /type="(Foreground|UIElement)"/.test(line)) {
        ids.add(id)
        id = ''
      }
    }
  } catch {
    /* 목록을 못 얻어도 앱 고르기는 되어야 한다 */
  }
  return ids
}

/**
 * 앱 목록 캐시.
 *
 * 조작 화면은 상태를 보낼 때마다 이 목록을 함께 싣는다. 그 주기가 짧아서
 * 훑기를 그대로 태우면 초당 수백 개의 프로세스를 띄우게 된다. 값은 캐시에서
 * 내주고, 오래됐으면 뒤에서 한 번만 다시 훑는다.
 */
class AppIndex {
  private apps: AppInfo[] = []
  private stamp = 0
  private inFlight: Promise<void> | null = null

  /** 지금 아는 것을 바로 준다. 아직 못 훑었으면 빈 목록이다. */
  list(): AppInfo[] {
    return this.apps
  }

  /** 오래됐으면 다시 훑는다. 이미 훑는 중이면 그 약속을 함께 기다린다. */
  refresh(maxAgeMs = 60_000, now = Date.now()): Promise<void> {
    if (this.inFlight) return this.inFlight
    if (this.apps.length > 0 && now - this.stamp < maxAgeMs) return Promise.resolve()
    this.inFlight = (async () => {
      try {
        const [apps, running] = await Promise.all([scanApps(), runningIds()])
        for (const app of apps) app.running = running.has(app.id)
        // 떠 있는 것을 위로, 그 다음은 한국어 기준 가나다순
        apps.sort((a, b) =>
          a.running === b.running ? a.name.localeCompare(b.name, 'ko') : a.running ? -1 : 1,
        )
        this.apps = apps
        this.stamp = now
      } catch {
        /* 훑기 실패가 앱을 멈추게 두지 않는다. 다음에 다시 해 본다 */
      } finally {
        this.inFlight = null
      }
    })()
    return this.inFlight
  }
}

export const appIndex = new AppIndex()

/** 번들 ID 로 이름을 찾는다. 아직 못 훑었거나 지워진 앱이면 null 이다. */
export function appName(id: string): string | null {
  return appIndex.list().find((app) => app.id === id)?.name ?? null
}

/** 앞선 앱이 바뀌면 콜백한다. 값이 바뀌었을 때만 알린다. */
export class AppWatcher {
  private timer: NodeJS.Timeout | null = null
  private current = ''

  constructor(
    private readonly onChange: (app: FrontApp) => void,
    private readonly intervalMs = 1500,
  ) {}

  start(): void {
    if (this.timer) return
    const tick = async () => {
      const front = await frontmost()
      if (front && front.id !== this.current) {
        this.current = front.id
        try {
          this.onChange(front)
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
