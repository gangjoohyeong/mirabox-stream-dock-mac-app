/**
 * 아무것도 수집하지 않는 키.
 *
 * 직접 넣는 그림과 글자, 그리고 시계와 날짜처럼 이 컴퓨터의 시각만 있으면
 * 되는 것들이다. 소스를 요구하지 않으므로 켜 두어도 아무 데도 붙지 않는다.
 */

import { loadImage, type Image } from '@napi-rs/canvas'
import { statSync } from 'node:fs'
import { keySize } from '../device.js'
import {
  ACCENT,
  DANGER,
  INK,
  OK,
  TERTIARY,
  WARN,
  blank,
  card,
  empty,
  visibleHeight,
} from '../render.js'
import { key } from '../registry.js'

const CUSTOM = 'custom' as const
const BASIC = 'basic' as const

/** 사용자가 고를 수 있는 글자 색. 의미색을 그대로 쓴다. */
const COLORS: Record<string, string> = {
  white: INK,
  gray: TERTIARY,
  blue: ACCENT,
  green: OK,
  orange: WARN,
  red: DANGER,
}

const COLOR_CHOICES = [
  { value: 'white', label: '흰색' },
  { value: 'gray', label: '회색' },
  { value: 'blue', label: '파랑' },
  { value: 'green', label: '초록' },
  { value: 'orange', label: '주황' },
  { value: 'red', label: '빨강' },
]

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

// ---------- 직접 넣기 ----------

key({
  name: 'image', label: 'IMG', summary: '그림 파일을 키에 채운다', family: CUSTOM,
  options: [
    { name: 'path', label: '파일', kind: 'file', placeholder: '/경로/아이콘.png' },
    { name: 'caption', label: '아래 글자', kind: 'text', placeholder: '없으면 비워 둔다' },
    {
      name: 'fit', label: '채우기', kind: 'choice', placeholder: '',
      choices: [
        { value: 'cover', label: '꽉 채우기 (잘림)' },
        { value: 'contain', label: '전체 보이기 (여백)' },
      ],
    },
  ],
  render: (index, _state, options) => {
    const image = cachedImage(options.path ?? '')
    if (!image) return blank(index, 'IMG', '없음', CUSTOM)

    const size = keySize(index)
    // 키캡이 아래를 가린다. 보이는 높이 안에 넣어야 잘리지 않는다
    const shown = visibleHeight(size)
    const canvas = empty(index)
    const ctx = canvas.getContext('2d')

    // cover 는 보이는 영역을 꽉 채우도록 잘라 넣고, contain 은 전체가 보이게 줄인다
    const pick = options.fit === 'contain' ? Math.min : Math.max
    const scale = pick(size / image.width, shown / image.height)
    const w = image.width * scale
    const h = image.height * scale
    ctx.drawImage(image, (size - w) / 2, (shown - h) / 2, w, h)

    const caption = (options.caption ?? '').trim().slice(0, 8)
    if (caption) {
      // 그림 위 글자는 대비가 보장되지 않는다. 검은 띠를 깔고 그 위에 쓴다
      const band = Math.round(shown * 0.3)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, shown - band, size, band)
      const ascii = /^[\x00-\x7F]*$/.test(caption)
      ctx.fillStyle = INK
      ctx.font = `600 ${Math.round(band * 0.62)}px "${ascii ? 'Avenir Next Condensed' : 'Apple SD Gothic Neo'}"`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(caption, size / 2, shown - band / 2)
    }
    return canvas
  },
})

key({
  name: 'text', label: 'TXT', summary: '원하는 글자를 크게 보여준다', family: CUSTOM,
  options: [
    { name: 'title', label: '위쪽 작은 글자', kind: 'text', placeholder: '예: 회의' },
    { name: 'value', label: '가운데 큰 글자', kind: 'text', placeholder: '예: 시작' },
    { name: 'color', label: '큰 글자 색', kind: 'choice', placeholder: '', choices: COLOR_CHOICES },
    {
      name: 'band', label: '아래 띠', kind: 'choice', placeholder: '',
      choices: [
        { value: '', label: '없음' },
        ...COLOR_CHOICES.map((c) => ({ value: c.value, label: c.label })),
      ],
    },
  ],
  render: (index, _state, options) =>
    card(index, {
      label: (options.title ?? '').slice(0, 10),
      value: (options.value ?? '').slice(0, 6) || '--',
      valueColor: COLORS[options.color ?? ''] ?? INK,
      bandColor: COLORS[options.band ?? ''],
      family: CUSTOM,
    }),
})

// ---------- 기본 ----------

const two = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

key({
  name: 'clock', label: 'CLOCK', summary: '현재 시각', family: BASIC,
  options: [
    {
      name: 'hour', label: '시간 표기', kind: 'choice', placeholder: '',
      choices: [
        { value: '24', label: '24시간' },
        { value: '12', label: '12시간' },
      ],
    },
  ],
  render: (index, _state, options) => {
    const now = new Date()
    const h24 = now.getHours()
    const twelve = options.hour === '12'
    const hour = twelve ? (h24 % 12 === 0 ? 12 : h24 % 12) : h24
    // 라벨에 0 을 채우면 폭이 늘어 AM/PM 이 밀려난다. 날짜는 그냥 9/2 로 둔다
    return card(index, {
      label: `${now.getMonth() + 1}/${now.getDate()}`,
      value: `${twelve ? hour : two(hour)}:${two(now.getMinutes())}`,
      right: twelve ? (h24 < 12 ? 'AM' : 'PM') : null,
      valueColor: INK,
      family: BASIC,
    })
  },
})

key({
  name: 'date', label: 'DATE', summary: '오늘 날짜와 요일', family: BASIC,
  render: (index) => {
    const now = new Date()
    // 연도까지 넣으면 요일에 밀려 통째로 사라진다. 요일과 날짜면 충분하다
    return card(index, {
      label: `${WEEKDAYS[now.getDay()]}요일`,
      value: `${now.getMonth() + 1}/${now.getDate()}`,
      valueColor: INK,
      family: BASIC,
    })
  },
})

key({
  name: 'blank', label: 'BLANK', summary: '아무것도 표시하지 않는다', family: BASIC,
  render: (index) => empty(index),
})
