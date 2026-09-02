/**
 * 데몬 루프.
 *
 * 활성 프로필의 칸을 그려 기기에 보내고, 키 입력을 받아 설정된 동작을
 * 실행한다. 앞으로 나온 앱에 묶인 프로필이 있으면 그쪽으로 바꾼다.
 *
 * 기기가 USB 에서 빠졌다 들어오는 일이 잦다. 벤더 앱은 그때 죽지만 여기서는
 * 다시 붙는다. 종료할 때는 반드시 close() 를 태운다. HID 핸들을 쥔 채로
 * 죽으면 기기가 잠겨서 물리적 재연결이 필요해진다.
 */

import { EventEmitter } from 'node:events'
import { toCommand } from './actions.js'
import { AppWatcher } from './appwatch.js'
import { keysInUse, profileForApp, profileOf, save } from './config.js'
import { DeviceError, KEY_COUNT, StreamDock } from './device.js'
import { warmImages } from './integrations/index.js'
import { KEYS, SOURCES, emptyState, sourcesFor, type State } from './registry.js'
import { blank, empty, encodeKey } from './render.js'
import { spawnDetached } from './shell.js'
import type { Config, DeviceStatus, SourceStatus } from '../shared/types.js'

const RECONNECT_MS = 3000

/** 필요한 소스만 각자 주기로 모은다. */
class Collector {
  private timers: NodeJS.Timeout[] = []
  private stopped = false
  readonly state: State = emptyState()

  constructor(
    private readonly wanted: Set<string>,
    private readonly onUpdate: () => void,
  ) {}

  start(): void {
    let delay = 0
    for (const name of [...this.wanted].sort()) {
      const entry = SOURCES.get(name)
      if (!entry) continue
      // 동시에 몰리지 않게 어긋나게 시작한다
      const tick = async () => {
        if (this.stopped) return
        try {
          this.state.data[name] = await entry.fetch()
          delete this.state.errors[name]
          this.state.updatedAt[name] = Date.now()
        } catch (error) {
          this.state.errors[name] = error instanceof Error ? error.message : String(error)
        }
        this.onUpdate()
      }
      this.timers.push(
        setTimeout(() => {
          void tick()
          this.timers.push(setInterval(() => void tick(), entry.every * 1000))
        }, delay),
      )
      delay += 1500
    }
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    this.timers = []
  }

  status(): SourceStatus[] {
    return [...this.wanted].sort().map((name) => ({
      name,
      ok: !(name in this.state.errors) && name in this.state.data,
      error: this.state.errors[name] ?? null,
      updatedAt: this.state.updatedAt[name] ?? null,
    }))
  }
}

export interface DaemonEvents {
  status: [DeviceStatus]
  painted: []
  profile: [string]
}

export class Daemon extends EventEmitter<DaemonEvents> {
  private dock: StreamDock | null = null
  private collector: Collector | null = null
  private readonly watcher = new AppWatcher((app) => this.onFrontApp(app))
  private sent = new Map<number, string>()
  private paintTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopping = false
  private painting = false
  private pendingPaint: { force: boolean } | null = null
  device: DeviceStatus = { connected: false, message: '기기를 찾는 중' }

  constructor(public config: Config) {
    super()
  }

  // ---------- 수명 ----------

  start(): void {
    this.startSources()
    this.watcher.start()
    void this.connect()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.watcher.stop()
    this.stopSources()
    if (this.paintTimer) clearInterval(this.paintTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    // HID 핸들을 쥔 채 죽으면 기기가 잠긴다. 반드시 닫는다.
    this.dock?.close()
    this.dock = null
  }

  // ---------- 소스 ----------

  /** 활성 프로필과, 앱에 묶여 언제든 활성화될 프로필의 것을 함께 켠다. */
  private neededSources(): Set<string> {
    const names = new Set(keysInUse(profileOf(this.config)))
    for (const profile of this.config.profiles) {
      if (profile.app) for (const name of keysInUse(profile)) names.add(name)
    }
    return sourcesFor(names)
  }

  private startSources(): void {
    const needed = this.neededSources()
    if (needed.size === 0) return
    this.collector = new Collector(needed, () => this.requestPaint())
    this.collector.start()
  }

  private stopSources(): void {
    this.collector?.stop()
    this.collector = null
  }

  restartSources(): void {
    this.stopSources()
    this.startSources()
  }

  get state(): State {
    return this.collector?.state ?? emptyState()
  }

  sourceStatus(): SourceStatus[] {
    return this.collector?.status() ?? []
  }

  // ---------- 프로필 ----------

  private onFrontApp(app: string): void {
    const profile = profileForApp(this.config, app)
    if (profile && profile.name !== this.config.active) {
      this.config.active = profile.name
      save(this.config)
      this.emit('profile', profile.name)
      this.requestPaint(true)
    }
  }

  switchProfile(name: string): void {
    if (name === this.config.active) return
    this.config.active = name
    this.restartSources()
    this.requestPaint(true)
  }

  /** 설정이 바뀌었으니 다시 그린다. */
  requestPaint(force = false): void {
    if (force) this.sent.clear()
    void this.paint(force)
  }

  // ---------- 그리기 ----------

  renderSlot(index: number, state: State) {
    const slot = profileOf(this.config).slots[index]
    const entry = slot.key ? KEYS.get(slot.key) : undefined
    if (!entry) return empty(index)
    try {
      return entry.render(index, state, slot.options)
    } catch {
      return blank(index, entry.label, 'err')
    }
  }

  /** 조작 화면 미리보기. 기기와 같은 그림을 PNG data URL 로 돌려준다. */
  tiles(): string[] {
    const state = this.state
    return Array.from({ length: KEY_COUNT }, (_, index) => {
      const png = this.renderSlot(index, state).toBuffer('image/png')
      return `data:image/png;base64,${png.toString('base64')}`
    })
  }

  /**
   * 한 번에 하나만 그린다.
   *
   * paint 는 비동기라 소스가 갱신될 때마다 부르면 서로 끼어든다. 같은 HID
   * 핸들에 쓰기가 뒤섞이면 프레임이 깨져 기기가 쓰기를 거부한다. 진행 중이면
   * 예약만 해 두고 끝나는 대로 한 번 더 돈다.
   */
  private async paint(force = false): Promise<void> {
    if (this.painting) {
      this.pendingPaint = { force: (this.pendingPaint?.force ?? false) || force }
      return
    }
    this.painting = true
    try {
      await this.paintOnce(force)
    } finally {
      this.painting = false
      const pending = this.pendingPaint
      this.pendingPaint = null
      if (pending) void this.paint(pending.force)
    }
  }

  private async paintOnce(force: boolean): Promise<void> {
    if (!this.dock?.isOpen) return
    const profile = profileOf(this.config)
    await warmImages(profile.slots.map((s) => s.options.path ?? ''))

    const state = this.state
    let sent = 0
    try {
      this.dock.setBrightness(this.config.brightness)
      for (let index = 0; index < KEY_COUNT; index++) {
        const jpeg = encodeKey(this.renderSlot(index, state))
        const digest = `${jpeg.length}:${jpeg.subarray(0, 24).toString('hex')}`
        if (!force && this.sent.get(index) === digest) continue
        this.dock.setKeyImage(index, jpeg)
        this.sent.set(index, digest)
        sent += 1
      }
      if (sent > 0) this.dock.refresh()
    } catch (error) {
      this.onDeviceLost(error)
      return
    }
    this.emit('painted')
  }

  // ---------- 기기 ----------

  private setStatus(connected: boolean, message: string): void {
    this.device = { connected, message }
    this.emit('status', this.device)
  }

  private async connect(): Promise<void> {
    if (this.stopping) return
    const dock = new StreamDock()
    try {
      dock.open()
    } catch (error) {
      this.setStatus(false, error instanceof DeviceError ? error.message : '기기를 찾는 중')
      this.scheduleReconnect()
      return
    }

    this.dock = dock
    this.sent.clear()
    dock.connect()
    dock.startReading(
      (event) => {
        if (event.pressed) this.onPress(event.key)
      },
      (error) => this.onDeviceLost(error),
    )
    this.setStatus(true, '기기 연결됨')

    // 부팅 로딩 화면은 CLE 로 지워지지 않는다. 전부 덮어써야 사라진다.
    await this.paint(true)

    if (this.paintTimer) clearInterval(this.paintTimer)
    this.paintTimer = setInterval(() => void this.paint(), this.config.refreshSeconds * 1000)
  }

  private onDeviceLost(error: unknown): void {
    if (this.stopping) return
    this.dock?.close()
    this.dock = null
    if (this.paintTimer) clearInterval(this.paintTimer)
    this.paintTimer = null
    this.setStatus(false, error instanceof Error ? error.message : '연결이 끊겼다')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopping) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, RECONNECT_MS)
  }

  // ---------- 입력 ----------

  private onPress(index: number): void {
    const command = toCommand(profileOf(this.config).slots[index].action)
    if (!command) return
    try {
      spawnDetached(command)
    } catch {
      /* 실행 실패가 데몬을 멈추게 두지 않는다 */
    }
  }
}
