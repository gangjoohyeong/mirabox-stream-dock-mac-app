/**
 * 메뉴 막대 상주.
 *
 * 창을 닫아도 데몬은 계속 돈다. 벤더 앱을 대체하려면 이게 있어야 한다.
 * 창이 곧 프로그램이면 화면을 치우는 순간 키가 멈춰 버린다.
 *
 * 아이콘은 파일로 두지 않고 그린다. 템플릿 이미지로 넘기면 macOS 가 밝은/어두운
 * 막대에 맞춰 알아서 뒤집는다. 색을 칠하면 안 되고 알파만 의미가 있다.
 */

import { createCanvas } from '@napi-rs/canvas'
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'

const SIZE = 16
const COLUMNS = 3
const ROWS = 2

function icon() {
  // 2배로 그려서 레티나 표현으로 넘긴다
  const scale = 2
  const canvas = createCanvas(SIZE * scale, SIZE * scale)
  const ctx = canvas.getContext('2d')
  const cell = 8
  const gap = 3
  const width = COLUMNS * cell + (COLUMNS - 1) * gap
  const height = ROWS * cell + (ROWS - 1) * gap
  const left = (SIZE * scale - width) / 2
  const top = (SIZE * scale - height) / 2

  ctx.fillStyle = '#000000'
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      ctx.beginPath()
      ctx.roundRect(left + column * (cell + gap), top + row * (cell + gap), cell, cell, 2)
      ctx.fill()
    }
  }

  const image = nativeImage.createFromBuffer(canvas.toBuffer('image/png'), {
    width: SIZE,
    height: SIZE,
    scaleFactor: scale,
  })
  image.setTemplateImage(true)
  return image
}

export interface TrayHooks {
  onOpen: () => void
  onQuit: () => void
  onProfile: (name: string) => void
}

export class MenuBar {
  private tray: Tray | null = null

  constructor(private readonly hooks: TrayHooks) {}

  start(): void {
    this.tray = new Tray(icon())
    this.tray.setToolTip('Stream Dock')
    // 왼쪽 클릭도 메뉴를 연다. 창 하나뿐이라 다른 동작을 둘 이유가 없다
    this.tray.on('click', () => this.tray?.popUpContextMenu())
  }

  stop(): void {
    this.tray?.destroy()
    this.tray = null
  }

  /** 기기 상태와 프로필 목록을 메뉴에 반영한다. */
  update(status: string, profiles: string[], active: string): void {
    if (!this.tray) return
    const items: MenuItemConstructorOptions[] = [
      { label: status, enabled: false },
      { type: 'separator' },
      { label: '창 열기', click: () => this.hooks.onOpen() },
      { type: 'separator' },
    ]
    for (const name of profiles) {
      items.push({
        label: name,
        type: 'radio',
        checked: name === active,
        click: () => this.hooks.onProfile(name),
      })
    }
    items.push({ type: 'separator' }, { label: '종료', click: () => this.hooks.onQuit() })
    this.tray.setContextMenu(Menu.buildFromTemplate(items))
  }
}
