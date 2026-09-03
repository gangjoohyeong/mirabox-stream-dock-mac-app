/**
 * Electron 메인.
 *
 * 데몬을 별도 프로세스로 두지 않고 이 프로세스 안에서 돌린다. 기기는 한
 * 프로세스만 점유할 수 있으므로, UI 와 데몬을 붙여 두는 편이 IPC 도 없고
 * 경합도 없다.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as agent from './agent.js'
import { ACTION_LABELS, MEDIA_CHOICES } from './actions.js'
import { appIndex } from './appwatch.js'
import * as configModule from './config.js'
import { KEY_COUNT } from './device.js'
import './integrations/index.js'
import { KEYS } from './registry.js'
import { FAMILIES } from './render.js'
import { Daemon } from './daemon.js'
import { MenuBar } from './tray.js'
import type { Config, KeyInfo, Slot, Snapshot } from '../shared/types.js'

const dirname = fileURLToPath(new URL('.', import.meta.url))

let window: BrowserWindow | null = null
let daemon: Daemon | null = null
let menuBar: MenuBar | null = null
// 창을 닫는 것과 앱을 끝내는 것은 다르다. 이 값으로만 구분된다.
let quitting = false

// ---------- 창 ----------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 900,
    minHeight: 640,
    show: false,
    // 좌측 콘텐츠는 --traffic-light-inset 만큼 민다
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  // 창을 닫아도 데몬은 계속 돈다. 메뉴 막대에서 다시 연다.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  // 네이티브 앱이 하는 일이다. 비활성일 때 색을 죽인다.
  win.on('blur', () => !win.isDestroyed() && win.webContents.send('window:active', false))
  win.on('focus', () => {
    if (win.isDestroyed()) return
    win.webContents.send('window:active', true)
    // 그 사이에 앱을 설치했거나 껐을 수 있다. 오래됐을 때만 다시 훑는다
    void appIndex.refresh().then(push)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(dirname, '../renderer/index.html'))
  }
  return win
}

/** 창이 살아 있을 때만 보낸다. 메뉴 막대에만 남아 있는 동안에도 데몬은 돈다. */
function send(channel: string, payload?: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}

function showWindow(): void {
  if (!window || window.isDestroyed()) window = createWindow()
  else {
    window.show()
    window.focus()
  }
  app.focus({ steal: true })
}

// ---------- 스냅샷 ----------

function keyInfos(): KeyInfo[] {
  return [...KEYS.values()].map((entry) => ({
    name: entry.name,
    label: entry.label,
    summary: entry.summary,
    group: FAMILIES[entry.family].title,
    groupColor: FAMILIES[entry.family].color,
    sources: entry.sources,
    options: entry.options,
  }))
}

async function snapshot(): Promise<Snapshot> {
  const current = daemon!
  return {
    config: current.config,
    device: current.device,
    sources: current.sourceStatus(),
    tiles: current.tiles(),
    runAtLogin: agent.isInstalled(),
    // 캐시에서 바로 준다. 훑기는 창이 앞으로 나올 때 뒤에서 돈다
    apps: appIndex.list(),
  }
}

function push(): void {
  const current = daemon
  if (!current) return
  menuBar?.update(
    current.device.connected ? '기기 연결됨' : current.device.message,
    current.config.profiles.map((profile) => profile.name),
    current.config.active,
  )
  void snapshot().then((data) => send('state:changed', data))
}

/**
 * 설정을 저장하고 다시 그린다.
 *
 * `force` 는 18칸을 전부 다시 보낸다. 칸 하나를 고쳤을 뿐인데 전량을 보내면
 * 입력창에 글자를 칠 때마다 기기가 전송에 잠긴다. 바뀐 칸만 나가게 두고,
 * 프로필이 통째로 바뀔 때만 force 를 쓴다.
 */
function persist(options: { restartSources?: boolean; force?: boolean } = {}): void {
  configModule.save(daemon!.config)
  if (options.restartSources) daemon!.restartSources()
  daemon!.requestPaint(options.force ?? false)
  push()
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle('state:get', () => snapshot())
  ipcMain.handle('meta:get', () => ({
    keys: keyInfos(),
    media: MEDIA_CHOICES,
    actionLabels: ACTION_LABELS,
    keyCount: KEY_COUNT,
  }))

  ipcMain.handle('slot:set', (_event, index: number, patch: Partial<Slot>) => {
    const profile = configModule.profileOf(daemon!.config)
    const slot = profile.slots[index]
    if (!slot) return
    if ('key' in patch) {
      slot.key = patch.key ?? null
      slot.options = {} // 키가 바뀌면 이전 키의 설정은 의미가 없다
    }
    if (patch.options) slot.options = { ...slot.options, ...patch.options }
    if (patch.action) slot.action = patch.action

    // 앱 키는 고르는 순간 실행 동작까지 걸어 준다. 아이콘만 띄우고 눌러도
    // 아무 일이 없으면 고른 사람의 기대와 어긋난다. 다른 동작을 이미
    // 걸어 두었으면 건드리지 않는다.
    const picked = patch.options?.id
    if (slot.key === 'app' && picked && ['none', 'app'].includes(slot.action.kind)) {
      slot.action = { kind: 'app', value: picked }
    }

    persist({ restartSources: 'key' in patch })
  })

  ipcMain.handle('brightness:set', (_event, value: number) => {
    daemon!.config.brightness = value
    persist()
  })

  ipcMain.handle('profile:switch', (_event, name: string) => {
    daemon!.switchProfile(name)
    persist({ force: true })
  })

  ipcMain.handle('profile:add', (_event, name: string) => {
    const config = daemon!.config
    if (config.profiles.some((p) => p.name === name)) return false
    config.profiles.push(configModule.emptyProfile(name))
    config.active = name
    persist({ restartSources: true, force: true })
    return true
  })

  ipcMain.handle('profile:rename', (_event, name: string) => {
    const profile = configModule.profileOf(daemon!.config)
    profile.name = name
    daemon!.config.active = name
    persist()
  })

  ipcMain.handle('profile:remove', () => {
    const config = daemon!.config
    if (config.profiles.length <= 1) return false
    const current = configModule.profileOf(config)
    config.profiles = config.profiles.filter((p) => p !== current)
    config.active = config.profiles[0].name
    persist({ restartSources: true, force: true })
    return true
  })

  ipcMain.handle('profile:setApp', (_event, appName: string) => {
    configModule.profileOf(daemon!.config).app = appName
    persist({ restartSources: true })
  })

  ipcMain.handle('login:set', async (_event, enabled: boolean) => {
    try {
      if (enabled) await agent.install()
      else await agent.uninstall()
    } catch (error) {
      push()
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    push()
    return { ok: agent.isInstalled() === enabled, message: '' }
  })

  ipcMain.handle('file:pick', async () => {
    const parent = window && !window.isDestroyed() ? window : undefined
    const result = await dialog.showOpenDialog(parent as never, {
      properties: ['openFile'],
      filters: [{ name: '그림', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

// ---------- 메뉴 ----------

/**
 * 네이티브 메뉴.
 *
 * HTML 로 흉내내지 않는다. 특히 편집 메뉴가 없으면 macOS 에서는 입력창의
 * Cmd+A, Cmd+C, Cmd+V 가 통째로 죽는다. 그 단축키는 앱 메뉴가 등록해야
 * 동작하기 때문이다.
 *
 * 라벨은 직접 적는다. 로캘이 ko 인데도 Electron 이 role 기본 라벨을 영어로
 * 내주어서, 그대로 두면 화면은 한글인데 메뉴만 영어가 된다. 라벨만 바꾸고
 * role 은 그대로 두어 표준 단축키와 동작을 지킨다.
 */
function buildMenu(): void {
  const name = app.getName()
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: name,
        submenu: [
          { role: 'about', label: `${name} 정보` },
          { type: 'separator' },
          { role: 'services', label: '서비스' },
          { type: 'separator' },
          { role: 'hide', label: `${name} 가리기` },
          { role: 'hideOthers', label: '기타 가리기' },
          { role: 'unhide', label: '모두 보기' },
          { type: 'separator' },
          { role: 'quit', label: `${name} 종료` },
        ],
      },
      {
        label: '편집',
        submenu: [
          { role: 'undo', label: '실행 취소' },
          { role: 'redo', label: '실행 복귀' },
          { type: 'separator' },
          { role: 'cut', label: '오려두기' },
          { role: 'copy', label: '복사하기' },
          { role: 'paste', label: '붙여놓기' },
          { role: 'pasteAndMatchStyle', label: '스타일에 맞춰 붙여놓기' },
          { role: 'delete', label: '삭제' },
          { role: 'selectAll', label: '전체 선택' },
        ],
      },
      {
        label: '프로필',
        submenu: [
          { label: '새 프로필', accelerator: 'CmdOrCtrl+N', click: () => send('menu:newProfile') },
          { label: '이름 바꾸기', click: () => send('menu:renameProfile') },
          { label: '프로필 삭제', click: () => send('menu:removeProfile') },
        ],
      },
      {
        label: '보기',
        submenu: [
          { label: '명령 팔레트', accelerator: 'CmdOrCtrl+K', click: () => send('menu:palette') },
          { type: 'separator' },
          { role: 'reload', label: '새로 고침' },
          { role: 'toggleDevTools', label: '개발자 도구' },
        ],
      },
      {
        label: '윈도우',
        submenu: [
          { role: 'minimize', label: '최소화' },
          { role: 'zoom', label: '확대/축소' },
          { type: 'separator' },
          { role: 'front', label: '모두 앞으로 가져오기' },
          { role: 'close', label: '닫기' },
        ],
      },
    ]),
  )
}

// ---------- 수명 ----------

/**
 * 한 번에 하나만 돈다.
 *
 * 기기는 한 프로세스만 점유한다. 둘이 뜨면 하나는 기기를 못 열고, 사용자
 * 눈에는 그냥 고장으로 보인다.
 *
 * Finder 로 여는 것은 macOS 가 알아서 막아 주지만 launchd 는 실행 파일을 직접
 * 띄우므로 그 규칙을 비켜 간다. 로그인 항목이 띄워 둔 상태에서 사용자가 앱을
 * 누르면 실제로 둘이 뜬다. 확인했다.
 *
 * 늦게 뜬 쪽은 물러나고, 먼저 뜬 쪽이 대신 창을 보여 준다.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => showWindow())

app.whenReady().then(async () => {
  // 잠금을 못 얻었으면 여기까지 와도 아무것도 붙잡지 않는다
  if (!app.hasSingleInstanceLock()) return
  const config: Config = configModule.load()
  configModule.save(config)

  daemon = new Daemon(config)
  daemon.on('status', () => push())
  daemon.on('painted', () => push())
  daemon.on('profile', () => push())

  registerIpc()
  buildMenu()
  menuBar = new MenuBar({
    onOpen: () => showWindow(),
    onQuit: () => app.quit(),
    onProfile: (name) => {
      daemon!.switchProfile(name)
      persist({ force: true })
    },
  })
  menuBar.start()
  // 로그인 자동 시작이면 창을 열지 않는다. 켤 때마다 창이 튀어나오면 안 된다
  if (!agent.startedInBackground()) window = createWindow()
  daemon.start()
  push()

  // 앱 목록은 백 개쯤 되는 번들을 읽어야 해서 느리다. 창부터 띄우고 뒤에서
  // 채운다. 창 없이 뜨는 자동 시작에서도 반드시 돌아야 한다. 앱 키는 이
  // 목록으로 아이콘을 찾으므로, 다 채우고 나서 한 번 더 그린다.
  void appIndex.refresh().then(() => {
    daemon?.requestPaint()
    push()
  })

  // 개발용. 메뉴는 화면에 안 나와서 등록됐는지 눈으로 볼 수가 없다.
  if (process.env.SHOT_MENU) {
    const dump = (items: Electron.MenuItem[], depth = 0): void => {
      for (const item of items) {
        const role = item.role ? ` role=${item.role}` : ''
        const key = item.accelerator ? ` [${item.accelerator}]` : ''
        console.log(`${'  '.repeat(depth)}${item.label || item.type}${role}${key}`)
        if (item.submenu) dump(item.submenu.items, depth + 1)
      }
    }
    console.log(`이름=${app.getName()} 로캘=${app.getLocale()} 시스템=${app.getSystemLocale()}`)
    dump(Menu.getApplicationMenu()?.items ?? [])
  }

  // 개발용. 화면 기록 권한 없이도 창을 확인할 수 있게 스스로 찍는다.
  if (process.env.SHOT_PATH) {
    if (process.env.SHOT_THEME === 'dark' || process.env.SHOT_THEME === 'light') {
      nativeTheme.themeSource = process.env.SHOT_THEME
    }
    setTimeout(async () => {
      // 팔레트처럼 조작해야 열리는 화면도 찍을 수 있게 한다
      if (process.env.SHOT_PALETTE) {
        send('menu:palette')
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
      // 화면 안을 눌러야 나오는 것도 찍는다. 개발용 통로다
      if (process.env.SHOT_SCRIPT) {
        const result = await window!.webContents.executeJavaScript(process.env.SHOT_SCRIPT)
        if (result !== undefined) console.log('스크립트:', JSON.stringify(result))
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
      const image = await window!.webContents.capturePage()
      writeFileSync(process.env.SHOT_PATH!, image.toPNG())
      console.log('캡처:', process.env.SHOT_PATH)
      app.quit()
    }, Number(process.env.SHOT_DELAY ?? 9000))
  }

  app.on('activate', () => showWindow())
})

// 창을 다 닫아도 끝내지 않는다. 메뉴 막대에 남아 기기를 계속 그린다.
app.on('window-all-closed', () => {})

app.on('before-quit', async (event) => {
  quitting = true
  if (!daemon) return
  event.preventDefault()
  const current = daemon
  daemon = null
  menuBar?.stop()
  menuBar = null
  // HID 핸들을 쥔 채 죽으면 기기가 잠긴다
  await current.stop()
  app.quit()
})
