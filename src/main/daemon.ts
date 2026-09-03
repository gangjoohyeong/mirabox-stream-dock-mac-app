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
import { AppWatcher, type FrontApp } from './appwatch.js'
import { keysInUse, profileForApp, profileOf, save } from './config.js'
import { DeviceError, KEY_COUNT, StreamDock } from './device.js'
import { warmIcons, warmImages } from './integrations/index.js'
import { KEYS, SOURCES, emptyState, sourcesFor, type State } from './registry.js'
import { blank, empty, encodeKey } from './render.js'
import { spawnDetached } from './shell.js'
import type { Config, DeviceStatus, SourceStatus } from '../shared/types.js'

const RECONNECT_MS = 3000
/** 쓰기가 한 번 튕겼다고 연결을 버리지 않는다. 이만큼 쉬고 다시 해 본다. */
const RETRY_MS = 400
const MAX_RETRIES = 2

/**
 * 필요한 소스만 각자 주기로 모은다.
 *
 * 상태는 데몬이 들고 있고 여기서는 채우기만 한다. 칸 하나를 바꿨다고 모아 둔
 * 값이 날아가면 기기가 몇 초 동안 빈 화면이 된다.
 */
class Collector {
  private timers: NodeJS.Timeout[] = []
  private stopped = false

  constructor(
    private readonly wanted: Set<string>,
    private readonly state: State,
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
    return [...this.wanted].sort().map((name) => {
      const value = this.state.data[name]
      return {
        name,
        ok: !(name in this.state.errors) && name in this.state.data,
        error: this.state.errors[name] ?? null,
        updatedAt: this.state.updatedAt[name] ?? null,
        note: value === undefined ? null : (SOURCES.get(name)?.describe?.(value) ?? null),
      }
    })
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
  private readonly collected: State = emptyState()
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
    this.connect().catch((error) => this.onDeviceLost(error))
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
    this.collector = new Collector(needed, this.collected, () => this.requestPaint())
    this.collector.start()
  }

  private stopSources(): void {
    this.collector?.stop()
    this.collector = null
  }

  /** 보드가 바뀌어 필요한 소스 목록이 달라졌을 때 부른다. 모은 값은 지키고 주기만 새로 건다. */
  restartSources(): void {
    this.stopSources()
    this.startSources()
  }

  get state(): State {
    return this.collected
  }

  sourceStatus(): SourceStatus[] {
    return this.collector?.status() ?? []
  }

  // ---------- 프로필 ----------

  private onFrontApp(app: FrontApp): void {
    const profile = profileForApp(this.config, app.id, app.name)
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
    // 그리기는 동기다. 파일에서 읽어야 하는 것은 여기서 미리 준비한다
    await warmImages(profile.slots.map((s) => s.options.path ?? ''))
    await warmIcons(profile.slots.map((s) => s.options.id ?? ''))

    const state = this.state
    // 한 번에 많이 밀어 넣으면 기기가 쓰기를 거부한다. 몇 번 쉬고 다시 해 본다.
    for (let attempt = 0; ; attempt++) {
      if (!this.dock?.isOpen) return
      try {
        this.writeFrame(state, force || attempt > 0)
        this.emit('painted')
        return
      } catch (error) {
        if (attempt >= MAX_RETRIES || this.stopping) {
          this.onDeviceLost(error)
          return
        }
        // 중간에 끊겼으면 기기와 내가 아는 그림이 어긋난다. 다음엔 전부 보낸다
        this.sent.clear()
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
      }
    }
  }

  private writeFrame(state: State, force: boolean): void {
    const dock = this.dock
    if (!dock) return
    let sent = 0
    dock.setBrightness(this.config.brightness)
    for (let index = 0; index < KEY_COUNT; index++) {
      const jpeg = encodeKey(this.renderSlot(index, state))
      const digest = `${jpeg.length}:${jpeg.subarray(0, 24).toString('hex')}`
      if (!force && this.sent.get(index) === digest) continue
      dock.setKeyImage(index, jpeg)
      this.sent.set(index, digest)
      sent += 1
    }
    if (sent > 0) dock.refresh()
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

    // 여는 데 성공해도 첫 명령이 튕길 수 있다. 앞 프로세스가 아직 핸들을
    // 놓지 않았을 때가 그렇다. 여기서 안 잡으면 처리되지 않은 거부로 새고,
    // 재연결도 걸리지 않은 채 영영 '기기를 찾는 중' 에 멈춘다.
    try {
      dock.connect()
      dock.startReading(
        (event) => {
          if (event.pressed) this.onPress(event.key)
        },
        (error) => this.onDeviceLost(error),
      )
    } catch (error) {
      this.onDeviceLost(error)
      return
    }
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
    const message = error instanceof Error ? error.message : '연결이 끊겼다'
    console.error('기기 연결 끊김:', message)
    this.setStatus(false, message)
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopping) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch((error) => this.onDeviceLost(error))
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
