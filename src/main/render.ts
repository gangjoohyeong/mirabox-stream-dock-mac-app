/**
 * 키 카드의 공통 골격.
 *
 * 여기에는 그리는 방법만 있다. 무엇을 그릴지는 integrations 가 정한다.
 *
 * 모든 키가 같은 골격을 쓴다.
 *   상단 행   라벨(왼쪽) 과 보조값(오른쪽)
 *   주 수치   가운데. 네 글자를 넘기지 않는다
 *   하단 띠   비율이 있으면 게이지, 없으면 상태색 단색
 *
 * 색은 앱과 같은 토큰 값을 쓴다. 다만 기기는 물리 표시장치라 상태색을 수치
 * 글자에 그대로 얹는다. 책상 거리에서 색이 유일하게 즉시 읽히는 신호다.
 * 화면 UI 의 규칙(상태색은 아이콘에만)은 앱 쪽에만 적용한다.
 *
 * 판독 기준은 화면이 아니라 실물이다. 책상 거리에서 읽히지 않으면 실패다.
 */

import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { KEY_SIZE, keySize } from './device.js'

// tokens.css 의 다크 값과 같다
export const BG = '#08090a'
export const INK = '#f7f8f8'
export const SECONDARY = '#b4b8bf'
export const TERTIARY = '#8a8f98'
export const TRACK = '#1f2022'
export const ACCENT = '#4a8fff'
export const OK = '#59b57c'
export const WARN = '#e5a33d'
export const DANGER = '#e5484d'

// 95px 키 기준. 126 기준 설계를 0.754 배 한 값이다.
const PAD = 8
const TOP_BASELINE = 26
const VALUE_BASELINE = 72
const BAND_Y = 80
const BAND_H = 9

const TOP_SIZE = 23
const VALUE_SIZE = 35
const SMALL_SIZE = 17

const LATIN = 'Avenir Next Condensed'
// 한글 글리프가 없어서 그냥 두면 두부가 된다. 사용자가 넣는 글자에만 쓰인다.
const CJK = 'Apple SD Gothic Neo'

const isAscii = (text: string) => /^[\x00-\x7F]*$/.test(text)

function font(size: number, text: string): string {
  return isAscii(text) ? `600 ${size}px "${LATIN}"` : `600 ${size}px "${CJK}"`
}

function width(ctx: SKRSContext2D, text: string, size: number): number {
  ctx.font = font(size, text)
  return ctx.measureText(text).width
}

/** 최대 네 글자. 글자 수를 줄여야 폰트를 키울 수 있다. */
export function fmt4(value: number): string {
  const n = Number(value)
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e7) return `${Math.round(n / 1e6)}M`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(Math.round(n))
}

export const hhmm = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

/** 하루를 넘으면 분 단위가 의미 없다. */
export const remainText = (minutes: number) =>
  minutes >= 24 * 60 ? `${Math.round(minutes / 60)}h` : hhmm(minutes)

/** 한도형. 높을수록 나쁘다. */
export const toneUp = (pct: number) => (pct >= 85 ? DANGER : pct >= 60 ? WARN : OK)

/** 적중률처럼 높을수록 좋은 값. */
export const toneDown = (pct: number) => (pct >= 85 ? OK : pct >= 60 ? WARN : DANGER)

function roundRect(
  ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
  ctx.fill()
}

export interface Card {
  label: string
  value: string
  right?: string | null
  rightColor?: string
  valueColor?: string
  bandPct?: number | null
  bandColor?: string
}

/** 카드 한 장을 그려 PNG 가 아닌 캔버스로 돌려준다. 인코딩은 encodeKey 가 한다. */
export function card(key: number, spec: Card): Canvas {
  const size = keySize(key)
  const scale = size / KEY_SIZE // 사이드 키는 조금 작다
  const pad = Math.round(PAD * scale)
  const canvas = createCanvas(size, size) as Canvas
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, size, size)
  ctx.textBaseline = 'alphabetic'

  const topSize = Math.max(10, Math.round(TOP_SIZE * scale))
  const baseline = Math.round(TOP_BASELINE * scale)
  ctx.fillStyle = TERTIARY
  ctx.font = font(topSize, spec.label)
  ctx.textAlign = 'left'
  ctx.fillText(spec.label, pad, baseline)

  // 라벨이 길면 보조값과 겹친다. 폭을 재서 줄이고, 그래도 안 되면 버린다.
  if (spec.right) {
    const avail = size - 2 * pad - width(ctx, spec.label, topSize) - Math.round(5 * scale)
    for (const trySize of [topSize, Math.max(9, Math.round(SMALL_SIZE * scale))]) {
      if (width(ctx, spec.right, trySize) <= avail) {
        ctx.fillStyle = spec.rightColor ?? TERTIARY
        ctx.font = font(trySize, spec.right)
        ctx.textAlign = 'right'
        ctx.fillText(spec.right, size - pad, baseline)
        break
      }
    }
  }

  // 주 수치가 폭을 넘으면 한 단계씩 줄인다.
  // 한글 글꼴은 라틴보다 세로로 커서 그대로 두면 아래 띠와 겹친다.
  let valueSize = Math.round(VALUE_SIZE * scale * (isAscii(spec.value) ? 1 : 0.82))
  while (valueSize > 12 && width(ctx, spec.value, valueSize) > size - 2 * pad) valueSize -= 1
  ctx.fillStyle = spec.valueColor ?? INK
  ctx.font = font(valueSize, spec.value)
  ctx.textAlign = 'left'
  ctx.fillText(spec.value, pad, Math.round(VALUE_BASELINE * scale))

  const bandY = Math.round(BAND_Y * scale)
  const bandH = Math.max(4, Math.round(BAND_H * scale))
  const bandW = size - 2 * pad
  ctx.fillStyle = TRACK
  roundRect(ctx, pad, bandY, bandW, bandH, bandH / 2)
  const bandColor = spec.bandColor ?? TRACK
  if (spec.bandPct != null) {
    const filled = Math.max(bandH, Math.round((bandW * Math.min(100, Math.max(0, spec.bandPct))) / 100))
    ctx.fillStyle = bandColor
    roundRect(ctx, pad, bandY, filled, bandH, bandH / 2)
  } else if (bandColor !== TRACK) {
    ctx.fillStyle = bandColor
    roundRect(ctx, pad, bandY, bandW, bandH, bandH / 2)
  }
  return canvas
}

/** 값이 아직 없는 키. 자리는 지키되 비어 있음을 알린다. */
export const blank = (key: number, label = '', note = '--'): Canvas =>
  card(key, { label, value: note, valueColor: TERTIARY })

/** 아무것도 배치하지 않은 칸. 기기에서는 그냥 꺼진 것처럼 보여야 한다. */
export function empty(key: number): Canvas {
  const size = keySize(key)
  const canvas = createCanvas(size, size) as Canvas
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, size, size)
  return canvas
}

/** 0..100 퍼센트에 남은 시간을 곁들이는, 한도형 지표의 공통 모양. */
export function limitCard(
  key: number, label: string,
  window: { pct: number; remainMin: number | null } | null | undefined,
  ageMs: number, staleMs = 30 * 60_000,
): Canvas {
  if (!window) return blank(key, label)
  const stale = ageMs > staleMs
  const color = stale ? TERTIARY : toneUp(window.pct)
  return card(key, {
    label,
    value: `${window.pct}%`,
    valueColor: color,
    right: window.remainMin == null ? null : remainText(window.remainMin),
    rightColor: stale ? TERTIARY : TERTIARY,
    bandPct: window.pct,
    bandColor: color,
  })
}

/**
 * 기기로 보낼 JPEG 바이트.
 *
 * 패널이 90도 돌아가 있다. 참고 구현은 "rot90 + mirror both" 로 적혀 있지만
 * 그건 Rust image 크레이트 기준(시계 방향)이고, 시계 90 도에 180 도 반전을
 * 더하면 결국 반시계 90 도가 된다. 여기서는 반시계 한 번만 돌린다.
 */
export function encodeKey(source: Canvas, quality = 90): Buffer {
  const size = source.width
  const out = createCanvas(size, size) as Canvas
  const ctx = out.getContext('2d')
  ctx.translate(0, size)
  ctx.rotate(-Math.PI / 2)
  ctx.drawImage(source, 0, 0)
  return out.toBuffer('image/jpeg', quality)
}
