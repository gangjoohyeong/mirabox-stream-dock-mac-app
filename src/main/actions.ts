/**
 * 키를 눌렀을 때 할 일.
 *
 * 설정에는 구조를 그대로 담는다. 셸 문자열 하나로만 저장하면 조작 화면에서
 * 되읽어 편집할 수가 없다.
 *
 * 미디어 항목은 AppleScript 로 처리한다. 음량과 음소거는 시스템 전체에
 * 확실히 먹는다. 재생 제어는 시스템 전역 미디어 키를 AppleScript 로 보낼
 * 방법이 없어서 실행 중인 음악 앱에 직접 지시한다.
 */

import type { Action, ActionKind, MediaChoice } from '../shared/types.js'

export const ACTION_LABELS: Record<ActionKind, string> = {
  none: '없음',
  app: '앱 실행',
  url: '링크 열기',
  shell: '셸 명령',
  media: '미디어',
}

const VOLUME_STEP = 10

/**
 * 앱 참조를 변수로 두면 "next track" 같은 두 단어 명령이 컴파일 시점에
 * 해석되지 않는다. run script 로 실행 시점까지 미룬다.
 */
const player = (verb: string) => `
tell application "System Events" to set running_apps to name of every process
if "Spotify" is in running_apps then
    run script "tell application \\"Spotify\\" to ${verb}"
else if "Music" is in running_apps then
    run script "tell application \\"Music\\" to ${verb}"
end if
`

/** AppleScript 에는 min, max 연산자가 없다. 조건문으로 자른다. */
const volume = (delta: number) => {
  const bound = delta > 0 ? 'if v > 100 then set v to 100' : 'if v < 0 then set v to 0'
  return `set v to (output volume of (get volume settings)) + ${delta}\n${bound}\nset volume output volume v`
}

const MEDIA: Record<string, { label: string; script: string }> = {
  playpause: { label: '재생 / 일시정지', script: player('playpause') },
  next: { label: '다음 트랙', script: player('next track') },
  previous: { label: '이전 트랙', script: player('previous track') },
  volumeup: { label: '음량 올리기', script: volume(VOLUME_STEP) },
  volumedown: { label: '음량 내리기', script: volume(-VOLUME_STEP) },
  mute: {
    label: '음소거 전환',
    script: 'set volume output muted (not (output muted of (get volume settings)))',
  },
}

export const MEDIA_CHOICES: MediaChoice[] = Object.entries(MEDIA).map(([value, m]) => ({
  value,
  label: m.label,
}))

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

/** `com.microsoft.VSCode` 처럼 생겼나. 공백 있는 이름과 갈라내기만 하면 된다. */
const isBundleId = (text: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9._-]+$/.test(text)

export function normalizeAction(raw: unknown): Action {
  if (typeof raw === 'string') return raw ? { kind: 'shell', value: raw } : { kind: 'none', value: '' }
  if (raw && typeof raw === 'object') {
    const candidate = raw as { kind?: string; type?: string; value?: unknown }
    const kind = (candidate.kind ?? candidate.type) as ActionKind | undefined
    if (kind && kind in ACTION_LABELS) return { kind, value: String(candidate.value ?? '') }
  }
  return { kind: 'none', value: '' }
}

/** 실행할 셸 한 줄. 할 일이 없으면 null. */
export function toCommand(raw: unknown): string | null {
  const { kind, value } = normalizeAction(raw)
  const trimmed = value.trim()
  if (kind === 'none' || !trimmed) return null
  // `open -a` 는 번들 파일명만 받는다. `open -a "Code"` 는 실패하고
  // `open -b com.microsoft.VSCode` 는 된다. 이름으로 저장된 옛 값만 -a 로 보낸다.
  if (kind === 'app') return isBundleId(trimmed) ? `open -b ${quote(trimmed)}` : `open -a ${quote(trimmed)}`
  if (kind === 'url') return `open ${quote(trimmed)}`
  if (kind === 'shell') return trimmed
  if (kind === 'media') {
    const entry = MEDIA[trimmed]
    return entry ? `osascript -e ${quote(entry.script)}` : null
  }
  return null
}
