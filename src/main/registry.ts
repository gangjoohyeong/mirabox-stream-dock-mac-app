/**
 * 소스와 키 등록소.
 *
 * 연동(integrations)은 여기에 자기 데이터 소스와 키를 등록한다. 코어는
 * 무엇이 등록됐는지만 알 뿐 각 연동의 사정은 모른다. 연동을 하나 추가하는
 * 일이 파일 하나 추가로 끝나게 하려는 구조다.
 *
 * 키는 자기가 필요한 소스를 선언한다. 데몬은 보드에 올라온 키가 요구하는
 * 소스만 켠다. 메일 키를 안 쓰면 Gmail 을 아예 호출하지 않는다.
 */

import type { Canvas } from '@napi-rs/canvas'
import type { Family } from './render.js'
import type { KeyOption } from '../shared/types.js'

export interface State {
  data: Record<string, unknown>
  errors: Record<string, string>
  updatedAt: Record<string, number>
}

export const emptyState = (): State => ({ data: {}, errors: {}, updatedAt: {} })

export function pick<T>(state: State, source: string): T | null {
  return (state.data[source] as T | undefined) ?? null
}

export interface Source {
  name: string
  /** 실패하면 던지면 된다. 수집기가 잡아서 오류로 남긴다. */
  fetch: () => Promise<unknown>
  /** 초 */
  every: number
  /**
   * 값 자체가 낡았을 때 조작 화면에 띄울 한 줄.
   *
   * 마지막으로 가져온 시각과 값이 만들어진 시각은 다르다. 계정 한도처럼 남이
   * 떨궈 준 파일을 읽는 소스는 방금 읽었어도 내용이 두 시간 전 것일 수 있다.
   */
  describe?: (value: unknown) => string | null
}

export type RenderFn = (
  index: number,
  state: State,
  options: Record<string, string>,
) => Canvas

export interface Key {
  name: string
  /** 키에 찍히는 짧은 이름 */
  label: string
  /** 조작 화면에 보여줄 한 줄 설명 */
  summary: string
  /** 어디서 온 키인지. 조작 화면의 묶음과 기기 표식이 여기서 나온다. */
  family: Family
  render: RenderFn
  sources: string[]
  options: KeyOption[]
}

export const SOURCES = new Map<string, Source>()
export const KEYS = new Map<string, Key>()

export function source(
  name: string,
  every: number,
  fetch: () => Promise<unknown>,
  describe?: (value: unknown) => string | null,
): void {
  SOURCES.set(name, { name, every, fetch, describe })
}

export function key(spec: {
  name: string
  label: string
  summary: string
  family?: Family
  sources?: string[]
  options?: KeyOption[]
  render: RenderFn
}): void {
  KEYS.set(spec.name, {
    name: spec.name,
    label: spec.label,
    summary: spec.summary,
    family: spec.family ?? 'system',
    render: spec.render,
    sources: spec.sources ?? [],
    options: spec.options ?? [],
  })
}

/** 이 키들을 그리는 데 필요한 소스 이름. */
export function sourcesFor(keyNames: Iterable<string>): Set<string> {
  const needed = new Set<string>()
  for (const name of keyNames) {
    for (const source of KEYS.get(name)?.sources ?? []) needed.add(source)
  }
  return needed
}
