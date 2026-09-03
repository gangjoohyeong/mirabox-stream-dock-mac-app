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

/**
 * 같은 곳에서 온 키끼리 한눈에 묶이게 하는 표식.
 *
 * 골격은 모든 키가 똑같이 쓴다. 상단 라벨, 가운데 수치, 하단 띠. 가독성이
 * 먼저라 배치는 건드리지 않는다. 대신 라벨의 색과 라벨에 붙는 작은 도형만
 * 출처마다 다르게 준다.
 *
 * 색은 값이 아니라 표식에만 쓴다. 수치의 색은 여전히 의미(좋음/주의/위험)를
 * 뜻하므로, 출처 색이 수치를 물들이면 안 된다.
 *
 * 도형이 주된 구분이고 색은 거들 뿐이다. 색만으로 나누면 95px 키에서, 그것도
 * 책상 거리에서 헷갈린다. 도형은 서로 확실히 다른 것만 골랐다.
 *   막대   Claude
 *   밑줄   Google
 *   알약   Atlassian
 *   마름모 GitLab
 *   삼각   빌드 서버
 *   동그라미 날씨
 *   네모   내 맥
 *   없음   기본, 직접 넣기
 */
export type Family =
  | 'claude' | 'google' | 'atlassian' | 'gitlab' | 'build'
  | 'weather' | 'system' | 'basic' | 'custom'

type Mark = 'bar' | 'underline' | 'pill' | 'diamond' | 'triangle' | 'circle' | 'square' | 'none'

interface FamilyStyle {
  /** 조작 화면에서 묶어 보여줄 이름 */
  title: string
  color: string
  mark: Mark
}

export const FAMILIES: Record<Family, FamilyStyle> = {
  claude: { title: 'Claude', color: '#d97757', mark: 'bar' },
  google: { title: 'Google', color: '#5b9bff', mark: 'underline' },
  atlassian: { title: 'Atlassian', color: '#8b7ff0', mark: 'pill' },
  gitlab: { title: 'GitLab', color: '#3fb9a8', mark: 'diamond' },
  build: { title: '빌드 서버', color: '#e08fb0', mark: 'triangle' },
  weather: { title: '날씨', color: '#6cb6e0', mark: 'circle' },
  system: { title: '내 맥', color: '#9bd17a', mark: 'square' },
  basic: { title: '기본', color: TERTIARY, mark: 'none' },
  custom: { title: '직접 넣기', color: TERTIARY, mark: 'none' },
}

/**
 * 키캡이 아래쪽을 가린다.
 *
 * 패널에 보낸 그림의 아래 끝은 눈에 보이지 않는다. `tools/ruler.ts` 로 키
 * 열여덟 개에 눈금을 띄워 실기기에서 쟀고, 95px 기준으로 **아래 10px** 이
 * 가려진다. 키마다 차이는 거의 없었다.
 *
 * 이걸 모르고 그리면 하단 띠가 절반쯤 잘리고, 그림 키는 아래가 잘려 나가
 * 무게중심이 아래로 내려가 보인다. 세로 배치는 전부 보이는 높이 안에 넣는다.
 * 가로는 잘리지 않으므로 그대로 둔다.
 */
const HIDDEN_BOTTOM = 10

/** 95px 키 기준. 세로 값은 보이는 높이(85) 안에서 잡았다. */
const PAD = 8
const TOP_BASELINE = 24
const VALUE_BASELINE = 64
const BAND_Y = 71
const BAND_H = 8

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
  /** 출처 표식. 생략하면 아무 장식이 없는 시스템 모양이다. */
  family?: Family
}

/** 표식이 라벨 앞에서 차지하는 폭. 밑줄과 알약은 라벨을 밀지 않는다. */
function markAdvance(mark: Mark, scale: number): number {
  const unit = Math.max(3, Math.round(7 * scale))
  const gap = Math.max(3, Math.round(5 * scale))
  if (mark === 'bar') return Math.max(2, Math.round(3 * scale)) + gap
  if (mark === 'diamond' || mark === 'triangle' || mark === 'circle') return unit + gap
  if (mark === 'square') return Math.round(unit * 0.85) + gap
  return 0
}

/**
 * 라벨 앞뒤에 출처 표식을 그린다.
 *
 * 라벨이 차지할 왼쪽 여백을 돌려준다. 표식이 없으면 0 이다.
 */
function drawMark(
  ctx: SKRSContext2D, mark: Mark, color: string,
  x: number, baseline: number, labelWidth: number, scale: number,
): number {
  const unit = Math.max(3, Math.round(7 * scale))
  const gap = Math.max(3, Math.round(5 * scale))
  ctx.fillStyle = color

  if (mark === 'bar') {
    const w = Math.max(2, Math.round(3 * scale))
    const h = Math.round(unit * 1.7)
    ctx.fillRect(x, baseline - h + Math.round(2 * scale), w, h)
    return w + gap
  }
  if (mark === 'diamond') {
    const r = unit / 2
    const cy = baseline - Math.round(unit * 0.6)
    ctx.beginPath()
    ctx.moveTo(x + r, cy - r)
    ctx.lineTo(x + unit, cy)
    ctx.lineTo(x + r, cy + r)
    ctx.lineTo(x, cy)
    ctx.closePath()
    ctx.fill()
    return unit + gap
  }
  if (mark === 'triangle') {
    const cy = baseline - Math.round(unit * 0.6)
    ctx.beginPath()
    ctx.moveTo(x + unit / 2, cy - unit / 2)
    ctx.lineTo(x + unit, cy + unit / 2)
    ctx.lineTo(x, cy + unit / 2)
    ctx.closePath()
    ctx.fill()
    return unit + gap
  }
  if (mark === 'circle') {
    const r = unit / 2
    const cy = baseline - Math.round(unit * 0.6)
    const lw = Math.max(1.5, 2 * scale)
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.arc(x + r, cy, r - lw / 2, 0, Math.PI * 2)
    ctx.stroke()
    return unit + gap
  }
  if (mark === 'square') {
    const side = Math.round(unit * 0.85)
    const cy = baseline - Math.round(unit * 0.6)
    ctx.fillRect(x, cy - side / 2, side, side)
    return side + gap
  }
  if (mark === 'underline') {
    const h = Math.max(2, Math.round(2.5 * scale))
    const y = baseline + Math.round(4 * scale)
    roundRect(ctx, x, y, labelWidth, h, h / 2)
    return 0
  }
  return 0
}

/** 카드 한 장을 그려 PNG 가 아닌 캔버스로 돌려준다. 인코딩은 encodeKey 가 한다. */
/**
 * 실제로 눈에 보이는 높이. 세로로 무엇을 놓든 이 안에 들어가야 한다.
 *
 * 그림을 키에 꽉 채우는 키들이 이 값으로 자기 배치를 잡는다.
 */
export const visibleHeight = (size: number): number =>
  size - Math.round(HIDDEN_BOTTOM * (size / KEY_SIZE))

export function card(key: number, spec: Card): Canvas {
  const size = keySize(key)
  const scale = size / KEY_SIZE // 사이드 키는 조금 작다
  const pad = Math.round(PAD * scale)
  const canvas = createCanvas(size, size) as Canvas
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, size, size)
  ctx.textBaseline = 'alphabetic'

  const baseline = Math.round(TOP_BASELINE * scale)
  const style = FAMILIES[spec.family ?? 'system']
  const pillPad = Math.max(3, Math.round(5 * scale))
  const advance =
    style.mark === 'pill' ? pillPad * 2 : markAdvance(style.mark, scale)

  // 라벨도 넘치면 줄인다. 사용자가 넣은 글자와 한글 상태말이 그냥 잘려 나갔다.
  let topSize = Math.max(10, Math.round(TOP_SIZE * scale))
  const room = size - 2 * pad - advance
  while (topSize > Math.max(9, Math.round(11 * scale)) && width(ctx, spec.label, topSize) > room) {
    topSize -= 1
  }
  const labelWidth = width(ctx, spec.label, topSize)

  // 알약은 라벨을 감싸므로 글자보다 먼저 깔아야 한다
  let labelX = pad
  if (spec.label && style.mark === 'pill') {
    const top = baseline - topSize + Math.round(4 * scale)
    const height = topSize + Math.round(2 * scale)
    ctx.fillStyle = style.color + '2e'
    roundRect(ctx, pad, top, labelWidth + pillPad * 2, height, Math.round(4 * scale))
    labelX = pad + pillPad
  } else if (spec.label) {
    labelX = pad + drawMark(ctx, style.mark, style.color, pad, baseline, labelWidth, scale)
  }

  ctx.fillStyle = style.color
  ctx.font = font(topSize, spec.label)
  ctx.textAlign = 'left'
  ctx.fillText(spec.label, labelX, baseline)
  if (spec.label && style.mark === 'underline') {
    drawMark(ctx, 'underline', style.color, labelX, baseline, labelWidth, scale)
  }

  // 라벨이 길면 보조값과 겹친다. 폭을 재서 줄이고, 그래도 안 되면 버린다.
  if (spec.right) {
    const used = labelX - pad + labelWidth + (style.mark === 'pill' ? pillPad : 0)
    const avail = size - 2 * pad - used - Math.round(5 * scale)
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
export const blank = (key: number, label = '', note = '--', family?: Family): Canvas =>
  card(key, { label, value: note, valueColor: TERTIARY, family })

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
/**
 * 0..100 퍼센트에 남은 시간을 곁들이는, 한도형 지표의 공통 모양.
 *
 * 값이 낡았으면 그 사실을 감추지 않는다. 계정 한도는 상태줄이 갱신될 때만
 * 들어오므로 조용한 시간에는 몇 시간씩 멈춘다. 멈춘 20% 를 지금 20% 인 것처럼
 * 보여주면 안 된다. 색을 죽이고, 남은 시간 대신 값을 받은 지 얼마나 됐는지를
 * 오른쪽에 적는다.
 */
export function limitCard(
  key: number, label: string,
  window: { pct: number; remainMin: number | null } | null | undefined,
  ageMs: number, family?: Family, staleMs = 20 * 60_000,
): Canvas {
  if (!window) return blank(key, label, '--', family)
  const stale = ageMs > staleMs
  const color = stale ? TERTIARY : toneUp(window.pct)
  const age = Math.round(ageMs / 60_000)
  return card(key, {
    label,
    value: `${window.pct}%`,
    valueColor: color,
    right: stale ? `-${remainText(age)}` : window.remainMin == null ? null : remainText(window.remainMin),
    rightColor: stale ? WARN : TERTIARY,
    bandPct: window.pct,
    bandColor: stale ? TRACK : color,
    family,
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
