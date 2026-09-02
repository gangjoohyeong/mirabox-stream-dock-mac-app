/** 사내 GitLab 연동. 토큰은 macOS 키체인에서 꺼낸다. */

import { OK, WARN, blank, card } from '../render.js'
import { key, pick, source } from '../registry.js'
import { sh } from '../shell.js'

export const REVIEW_MRS = 'gitlab.reviewMrs'

const SCRIPT = `
T=$(security find-generic-password -s gitlab.wisenut.kr -a jkang -w 2>/dev/null) || exit 1
[ -n "$T" ] || exit 1
curl -s --max-time 20 -H "PRIVATE-TOKEN: $T" \
  "https://gitlab.wisenut.kr/api/v4/merge_requests?scope=all&reviewer_username=jkang&state=opened&per_page=100"
`

interface MrValue { count: number }

source(REVIEW_MRS, 120, async (): Promise<MrValue> => {
  const out = await sh(SCRIPT, 30_000)
  let rows: unknown
  try {
    rows = JSON.parse(out)
  } catch {
    throw new Error('gitlab 응답을 파싱하지 못했다')
  }
  if (!Array.isArray(rows)) throw new Error('gitlab 응답 형태가 다르다')
  return { count: rows.length }
})

key({
  name: 'mr', label: 'MR', summary: '내 리뷰를 기다리는 MR 수', sources: [REVIEW_MRS],
  render: (index, state) => {
    const value = pick<MrValue>(state, REVIEW_MRS)
    if (!value) return blank(index, 'MR')
    const color = value.count === 0 ? OK : WARN
    return card(index, { label: 'MR', value: String(value.count), valueColor: color, bandColor: color })
  },
})
