/** Jira 연동. 사내 읽기 전용 CLI 를 쓴다. 자격증명은 ~/.config 에 있다. */

import { DANGER, OK, blank, card } from '../render.js'
import { key, pick, source } from '../registry.js'
import { jsonAfterNoise, sh } from '../shell.js'

export const JIRA_TODAY = 'jira.today'

interface JiraValue { items: number }

source(JIRA_TODAY, 300, async (): Promise<JiraValue> => {
  const data = jsonAfterNoise(await sh('jira today 2>/dev/null', 25_000)) as any
  if (!data) throw new Error('jira 응답을 파싱하지 못했다')
  return { items: (data.items ?? []).length }
})

key({
  name: 'jira', label: 'JIRA', summary: '오늘 Jira 에 기록한 항목 수', sources: [JIRA_TODAY],
  render: (index, state) => {
    const value = pick<JiraValue>(state, JIRA_TODAY)
    if (!value) return blank(index, 'JIRA')
    // 0 이면 일일업무 미등록이다. 이 키의 존재 이유가 그 경고다.
    const color = value.items === 0 ? DANGER : OK
    return card(index, {
      label: 'JIRA', value: String(value.items), valueColor: color,
      right: value.items === 0 ? 'todo' : 'done', rightColor: color, bandColor: color,
    })
  },
})
