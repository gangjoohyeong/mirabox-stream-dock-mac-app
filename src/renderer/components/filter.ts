/**
 * 검색 필터.
 *
 * cmdk 의 기본 점수기로는 한글을 찾을 수 없다. 실기기에서 코드포인트까지
 * 찍어 확인했다. cmdk 는 항목 값을 NFD 로 정규화해서 넘기는데(`카` 가
 * `ᄏ`+`ᅡ`, U+110F U+1161 로 쪼개진다) 검색어는 사용자가 친 NFC 그대로다.
 * 라틴 문자는 NFD 여도 글자가 그대로라 멀쩡하지만, 한글은 쪼개진 자모와
 * 완성된 글자를 비교하게 되어 무엇을 쳐도 걸리지 않는다.
 *
 * 그래서 양쪽을 NFC 로 맞춘 뒤 비교한다. 이 앱은 화면이 전부 한글이라 이걸
 * 빼먹으면 검색이 사실상 없는 것과 같다.
 *
 * 점수는 매기지 않고 들어 있는지만 본다. 목록은 이미 뜻이 있는 순서로
 * (앱은 실행 중인 것 먼저, 그다음 가나다) 정렬해 두었고, 퍼지 점수로 그
 * 순서를 흔드는 것보다 그대로 두는 편이 찾기 쉽다. 띄어쓰기로 끊은 조각이
 * 모두 들어 있어야 맞는 것으로 본다.
 */

const fold = (text: string) => text.normalize('NFC').toLowerCase()

export function matches(value: string, search: string): number {
  const query = fold(search.trim())
  if (!query) return 1
  const haystack = fold(value)
  return query.split(/\s+/).every((term) => haystack.includes(term)) ? 1 : 0
}
