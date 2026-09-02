/**
 * 날씨.
 *
 * Open-Meteo 를 쓴다. 키가 필요 없고 가입도 없다. 도시 이름을 좌표로 바꾸는
 * 것도 같은 곳에서 한다. 좌표는 이름이 바뀌지 않는 한 다시 묻지 않는다.
 *
 * 바깥으로 나가는 유일한 기본 키다. 도시 이름 말고는 아무것도 보내지 않는다.
 * 날씨를 보드에 올리지 않으면 이 소스는 아예 켜지지 않는다.
 */

import { INK, OK, WARN, blank, card } from '../render.js'
import { key, pick, source } from '../registry.js'

const F = 'weather' as const

export const WEATHER = 'weather.now'

const DEFAULT_PLACE = '서울'
const TIMEOUT_MS = 8000

export interface WeatherValue {
  place: string
  tempC: number
  feelsC: number | null
  code: number
  highC: number | null
  lowC: number | null
  rainPct: number | null
  windMs: number | null
}

/**
 * WMO 코드를 짧은 말로 옮긴다.
 *
 * 라벨은 95px 안에서 오른쪽 보조값과 자리를 나눠 쓴다. 한글 네 글자를 넣으면
 * 보조값이 통째로 사라지므로 두세 글자로 끊는다.
 */
function condition(code: number): string {
  if (code === 0) return '맑음'
  if (code <= 2) return '구름'
  if (code === 3) return '흐림'
  if (code <= 48) return '안개'
  if (code <= 57) return '이슬비'
  if (code <= 67) return '비'
  if (code <= 77) return '눈'
  if (code <= 82) return '소나기'
  if (code <= 86) return '눈비'
  return '뇌우'
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

/**
 * 한글 도시명 대응표.
 *
 * Open-Meteo 의 지명 검색은 한글로는 아무것도 찾지 못한다. 결과는 한글로 주면서
 * 질의는 로마자만 받는다. 자주 쓸 만한 곳만 미리 옮겨 두고, 없으면 사용자가
 * 영문으로 적게 안내한다.
 */
const KOREAN: Record<string, string> = {
  서울: 'Seoul', 부산: 'Busan', 대구: 'Daegu', 인천: 'Incheon', 광주: 'Gwangju',
  대전: 'Daejeon', 울산: 'Ulsan', 세종: 'Sejong', 수원: 'Suwon', 성남: 'Seongnam',
  용인: 'Yongin', 고양: 'Goyang', 부천: 'Bucheon', 안양: 'Anyang', 화성: 'Hwaseong',
  창원: 'Changwon', 김해: 'Gimhae', 포항: 'Pohang', 전주: 'Jeonju', 청주: 'Cheongju',
  천안: 'Cheonan', 춘천: 'Chuncheon', 강릉: 'Gangneung', 원주: 'Wonju', 제주: 'Jeju',
  서귀포: 'Seogwipo', 목포: 'Mokpo', 여수: 'Yeosu', 경주: 'Gyeongju', 안동: 'Andong',
}

const hasHangul = (text: string) => /[가-힣]/.test(text)

/** 도시 이름 하나당 한 번만 묻는다. */
const coords = new Map<string, { lat: number; lon: number; name: string }>()

async function locate(place: string) {
  const hit = coords.get(place)
  if (hit) return hit
  // '서울시', '서울특별시' 처럼 뒤에 붙는 말은 떼고 본다
  const bare = place.replace(/(특별시|광역시|특별자치[시도]|시|군|구)$/, '')
  const query = KOREAN[place] ?? KOREAN[bare] ?? place
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(query)}&count=1&language=ko&format=json`
  const data = await getJson(url)
  const first = data?.results?.[0]
  if (!first) {
    throw new Error(
      hasHangul(query)
        ? `'${place}' 를 찾지 못했다. 영문으로 적어 보라 (예: Seoul)`
        : `'${place}' 를 찾지 못했다`,
    )
  }
  const found = { lat: first.latitude, lon: first.longitude, name: first.name ?? place }
  coords.set(place, found)
  return found
}

let place = DEFAULT_PLACE

/** 키 설정에서 도시를 바꾸면 다음 수집부터 그 도시를 본다. */
export function setPlace(next: string): void {
  const trimmed = next.trim()
  if (trimmed && trimmed !== place) place = trimmed
}

source(WEATHER, 900, async (): Promise<WeatherValue> => {
  const spot = await locate(place)
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${spot.lat}&longitude=${spot.lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    // 풍속은 기본이 km/h 다. m/s 로 달라고 해야 키에 적은 단위와 맞는다
    '&wind_speed_unit=ms&timezone=auto&forecast_days=1'
  const data = await getJson(url)
  const now = data?.current ?? {}
  const day = data?.daily ?? {}
  const first = (list: unknown): number | null =>
    Array.isArray(list) && typeof list[0] === 'number' ? list[0] : null

  return {
    place: spot.name,
    tempC: Math.round(now.temperature_2m ?? 0),
    feelsC: typeof now.apparent_temperature === 'number' ? Math.round(now.apparent_temperature) : null,
    code: Number(now.weather_code ?? 0),
    highC: first(day.temperature_2m_max) == null ? null : Math.round(first(day.temperature_2m_max)!),
    lowC: first(day.temperature_2m_min) == null ? null : Math.round(first(day.temperature_2m_min)!),
    rainPct: first(day.precipitation_probability_max),
    windMs: typeof now.wind_speed_10m === 'number' ? Math.round(now.wind_speed_10m * 10) / 10 : null,
  }
})

const PLACE_OPTION = {
  name: 'place',
  label: '도시',
  kind: 'text' as const,
  placeholder: DEFAULT_PLACE,
}

/** 도시 설정은 키마다 있지만 소스는 하나다. 마지막에 그린 키의 도시를 따른다. */
function apply(options: Record<string, string>): void {
  setPlace(options.place ?? '')
}

key({
  name: 'weather', label: 'WEATHER', summary: '현재 기온과 하늘 상태', family: F,
  sources: [WEATHER], options: [PLACE_OPTION],
  render: (index, state, options) => {
    apply(options)
    const value = pick<WeatherValue>(state, WEATHER)
    if (!value) return blank(index, '날씨', '--', F)
    return card(index, {
      label: condition(value.code),
      value: `${value.tempC}°`,
      right: value.highC != null && value.lowC != null ? `${value.highC}/${value.lowC}` : null,
      // 기온은 늘 또렷하게 둔다. 회색은 이 앱에서 '값이 없거나 낡았다' 는 뜻이다
      valueColor: INK,
      family: F,
    })
  },
})

key({
  name: 'rain', label: 'RAIN', summary: '오늘 강수 확률', family: F,
  sources: [WEATHER], options: [PLACE_OPTION],
  render: (index, state, options) => {
    apply(options)
    const value = pick<WeatherValue>(state, WEATHER)
    if (value?.rainPct == null) return blank(index, 'RAIN', '--', F)
    const color = value.rainPct >= 60 ? WARN : value.rainPct >= 30 ? INK : OK
    return card(index, {
      label: 'RAIN', value: `${value.rainPct}%`, valueColor: color,
      bandPct: value.rainPct, bandColor: color, family: F,
    })
  },
})

key({
  name: 'feels', label: 'FEELS', summary: '체감 온도와 바람', family: F,
  sources: [WEATHER], options: [PLACE_OPTION],
  render: (index, state, options) => {
    apply(options)
    const value = pick<WeatherValue>(state, WEATHER)
    if (value?.feelsC == null) return blank(index, 'FEELS', '--', F)
    return card(index, {
      label: '체감',
      value: `${value.feelsC}°`,
      right: value.windMs == null ? null : `${value.windMs}m`,
      valueColor: INK,
      family: F,
    })
  },
})
