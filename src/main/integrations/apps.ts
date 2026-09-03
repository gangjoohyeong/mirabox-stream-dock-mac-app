/**
 * 앱 하나를 키에 올린다.
 *
 * 고르면 그 앱의 아이콘이 키에 채워지고, 누르면 그 앱이 열린다. 그림 파일을
 * 따로 찾아 넣고 실행 동작을 따로 거는 세 단계를 한 단계로 줄인 것이다.
 * 실행 동작은 index.ts 의 slot:set 이 함께 걸어 준다.
 *
 * 아이콘은 시스템에서 뽑아 파일로 캐시한다. 그리는 시점에는 이미 준비된
 * 파일만 읽는다.
 */

import { loadImage, type Image } from '@napi-rs/canvas'
import { iconFile } from '../appicon.js'
import { appIndex } from '../appwatch.js'
import { keySize } from '../device.js'
import { INK, blank, empty, visibleHeight } from '../render.js'
import { key } from '../registry.js'

const F = 'custom' as const

/** 뽑아 둔 PNG 를 캔버스가 쓸 수 있는 형태로 들고 있는다. */
const loaded = new Map<string, Image>()

/**
 * 보드에 올라온 앱들의 아이콘을 미리 뽑아 둔다.
 *
 * 데몬이 그리기 직전에 부른다. 그리기는 동기라서 여기서 준비가 끝나 있어야
 * 한다. 이미 캐시가 있으면 파일 확인 한 번으로 끝난다.
 */
export async function warmIcons(ids: Iterable<string>): Promise<void> {
  for (const id of new Set([...ids].filter(Boolean))) {
    if (loaded.has(id)) continue
    const app = appIndex.list().find((entry) => entry.id === id)
    if (!app) continue
    const file = await iconFile(app.id, app.path)
    if (!file) continue
    try {
      loaded.set(id, await loadImage(file))
    } catch {
      /* 깨진 파일이면 다음 기회에 */
    }
  }
}

key({
  name: 'app',
  label: 'APP',
  summary: '앱 아이콘. 누르면 그 앱이 열린다',
  family: F,
  options: [
    { name: 'id', label: '앱', kind: 'app', placeholder: '' },
    {
      name: 'caption',
      label: '이름 표시',
      kind: 'choice',
      placeholder: '',
      choices: [
        { value: '', label: '아이콘만' },
        { value: 'name', label: '아래에 이름' },
      ],
    },
  ],
  render: (index, _state, options) => {
    const id = options.id ?? ''
    const image = loaded.get(id)
    if (!image) return blank(index, 'APP', id ? '...' : '없음', F)

    const size = keySize(index)
    const canvas = empty(index)
    const ctx = canvas.getContext('2d')

    // 키캡이 아래를 가리므로 보이는 높이 안에 넣는다. 키를 꽉 채워 그리면
    // 아이콘 아래가 잘려 무게중심이 내려가 보인다.
    const shown = visibleHeight(size)
    const name = appIndex.list().find((entry) => entry.id === id)?.name ?? ''
    const band = options.caption === 'name' && name ? Math.round(shown * 0.28) : 0
    const box = shown - band
    ctx.drawImage(image, (size - box) / 2, 0, box, box)

    if (band) {
      const text = name.slice(0, 10)
      const ascii = /^[\x00-\x7F]*$/.test(text)
      ctx.fillStyle = INK
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let fontSize = Math.round(band * 0.66)
      const face = ascii ? 'Avenir Next Condensed' : 'Apple SD Gothic Neo'
      // 이름이 길면 줄인다. 잘라 내면 무슨 앱인지 알 수 없게 된다
      while (fontSize > 8) {
        ctx.font = `600 ${fontSize}px "${face}"`
        if (ctx.measureText(text).width <= size - 8) break
        fontSize -= 1
      }
      ctx.fillText(text, size / 2, shown - band / 2)
    }
    return canvas
  },
})
