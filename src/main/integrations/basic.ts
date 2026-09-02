/**
 * 외부 데이터가 필요 없는 기본 키.
 *
 * 그림, 글자, 시계, 빈 칸. 벤더 앱에서 앱 실행 버튼이나 라벨로 쓰던 자리를
 * 이걸로 채운다. 소스를 요구하지 않으므로 아무것도 수집하지 않는다.
 */

import { loadImage, type Image } from '@napi-rs/canvas'
import { statSync } from 'node:fs'
import { keySize } from '../device.js'
import { BG, INK, blank, card, empty } from '../render.js'
import { key } from '../registry.js'

/** 파일이 바뀌면 다시 읽는다. 키마다 한 장이면 충분하다. */
const cache = new Map<string, { stamp: number; image: Image }>()

function cachedImage(path: string): Image | null {
  if (!path) return null
  let stamp: number
  try {
    stamp = statSync(path).mtimeMs
  } catch {
    return null
  }
  const hit = cache.get(path)
  if (hit && hit.stamp === stamp) return hit.image
  return null
}

/** 그림은 비동기 로드라 미리 데워 둔다. 데몬이 그리기 전에 부른다. */
export async function warmImages(paths: Iterable<string>): Promise<void> {
  for (const path of paths) {
    if (!path || cachedImage(path)) continue
    try {
      const stamp = statSync(path).mtimeMs
      cache.set(path, { stamp, image: await loadImage(path) })
    } catch {
      cache.delete(path)
    }
  }
}

key({
  name: 'image', label: 'IMG', summary: '그림 파일을 키에 채운다',
  options: [
    { name: 'path', label: '파일', kind: 'file', placeholder: '/경로/아이콘.png' },
    { name: 'caption', label: '글자', kind: 'text', placeholder: '아래에 덧붙일 짧은 글자' },
  ],
  render: (index, _state, options) => {
    const image = cachedImage(options.path ?? '')
    if (!image) return blank(index, 'IMG', '없음')

    const size = keySize(index)
    const canvas = empty(index)
    const ctx = canvas.getContext('2d')

    // 키를 꽉 채우도록 잘라 넣는다
    const scale = Math.max(size / image.width, size / image.height)
    const w = image.width * scale
    const h = image.height * scale
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h)

    const caption = (options.caption ?? '').trim().slice(0, 8)
    if (caption) {
      const band = Math.round(size * 0.28)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, size - band, size, band)
      const ascii = /^[\x00-\x7F]*$/.test(caption)
      ctx.fillStyle = INK
      ctx.font = `600 ${Math.round(band * 0.62)}px "${ascii ? 'Avenir Next Condensed' : 'Apple SD Gothic Neo'}"`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(caption, size / 2, size - band / 2)
    }
    return canvas
  },
})

key({
  name: 'text', label: 'TXT', summary: '원하는 글자를 크게 보여준다',
  options: [
    { name: 'title', label: '위쪽 작은 글자', kind: 'text', placeholder: '예: 회의' },
    { name: 'value', label: '가운데 큰 글자', kind: 'text', placeholder: '예: 시작' },
  ],
  render: (index, _state, options) =>
    card(index, {
      label: (options.title ?? '').slice(0, 8),
      value: (options.value ?? '').slice(0, 6) || '--',
    }),
})

key({
  name: 'clock', label: 'CLOCK', summary: '현재 시각',
  render: (index) => {
    const now = new Date()
    const two = (n: number) => String(n).padStart(2, '0')
    return card(index, {
      label: `${two(now.getMonth() + 1)}/${two(now.getDate())}`,
      value: `${two(now.getHours())}:${two(now.getMinutes())}`,
      valueColor: INK,
    })
  },
})

key({
  name: 'blank', label: 'BLANK', summary: '아무것도 표시하지 않는다',
  render: (index) => empty(index),
})

void BG
