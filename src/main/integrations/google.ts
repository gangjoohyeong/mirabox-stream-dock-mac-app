/** Google Workspace 연동. gws CLI 로 읽는다. 인증은 gws 가 OAuth 키링으로 들고 있다. */

import { ACCENT, DANGER, OK, TERTIARY, WARN, blank, card, remainText } from '../render.js'
import { key, pick, source } from '../registry.js'
import { jsonAfterNoise, sh } from '../shell.js'

export const MAIL = 'google.mail'
export const CALENDAR = 'google.calendar'

const iso = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z')

interface MailValue { unread: number; threads: number }
interface CalendarValue { inMin: number | null; title: string }

source(MAIL, 60, async (): Promise<MailValue> => {
  // 라벨 한 번만 읽으면 되므로 가장 싸다
  const out = await sh(
    `gws gmail users labels get --params '{"userId":"me","id":"INBOX"}' 2>/dev/null`, 20_000)
  const data = jsonAfterNoise(out) as any
  if (!data) throw new Error('gmail 응답을 파싱하지 못했다')
  return { unread: data.messagesUnread ?? 0, threads: data.threadsUnread ?? 0 }
})

source(CALENDAR, 60, async (): Promise<CalendarValue> => {
  const now = Date.now()
  const params = JSON.stringify({
    calendarId: 'primary', timeMin: iso(now), timeMax: iso(now + 7 * 24 * 3600_000),
    maxResults: 10, singleEvents: true, orderBy: 'startTime',
  })
  const data = jsonAfterNoise(
    await sh(`gws calendar events list --params '${params}' 2>/dev/null`, 20_000)) as any
  if (!data) throw new Error('calendar 응답을 파싱하지 못했다')
  for (const item of data.items ?? []) {
    const start = item.start?.dateTime
    if (!start) continue // 종일 일정은 제외한다
    const at = Date.parse(start)
    if (at > now) return { inMin: Math.round((at - now) / 60000), title: item.summary ?? '' }
  }
  return { inMin: null, title: '' }
})

key({
  name: 'mail', label: 'MAIL', summary: '안 읽은 메일 수', sources: [MAIL],
  render: (index, state) => {
    const value = pick<MailValue>(state, MAIL)
    if (!value) return blank(index, 'MAIL')
    const color = value.unread === 0 ? OK : value.unread >= 100 ? DANGER : WARN
    return card(index, {
      label: 'MAIL', value: String(value.unread), valueColor: color,
      right: String(value.threads), bandColor: color,
    })
  },
})

key({
  name: 'cal', label: 'CAL', summary: '다음 일정까지 남은 시간', sources: [CALENDAR],
  render: (index, state) => {
    const value = pick<CalendarValue>(state, CALENDAR)
    if (!value) return blank(index, 'CAL')
    if (value.inMin == null) return card(index, { label: 'CAL', value: 'none', valueColor: TERTIARY })
    const color = value.inMin <= 15 ? DANGER : value.inMin <= 60 ? WARN : OK
    return card(index, {
      label: 'CAL', value: remainText(value.inMin), valueColor: color, bandColor: color,
    })
  },
})

void ACCENT
