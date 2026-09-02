/**
 * Radix Select 를 토큰에 맞춰 다시 칠한 것.
 *
 * 드롭다운을 직접 만들지 않는다. 포커스 트랩과 키보드 이동, 스크린리더
 * 처리가 이미 되어 있다. 기본 테마를 그대로 두면 웹 대시보드처럼 보이므로
 * 색과 간격과 반경만 tokens.css 로 바꾼다.
 *
 * 항목이 스물이 넘으면 평평한 목록으로는 못 찾는다. 어디서 온 항목인지로
 * 묶고, 묶음 이름 앞에 기기 표식과 같은 색 점을 찍는다.
 */

import * as RadixSelect from '@radix-ui/react-select'
import { IconChevron } from '../icons'

export interface Option {
  value: string
  label: string
  /** 왼쪽에 붙는 짧은 식별자. 키 이름 같은 것. */
  tag?: string
  /** 묶음 이름. 없으면 묶지 않는다. */
  group?: string
  /** 묶음 색. 같은 묶음의 첫 항목 것을 쓴다. */
  groupColor?: string
}

/** Radix 는 빈 문자열 값을 허용하지 않는다. 컴포넌트 안에서만 쓰는 표식으로 바꾼다. */
const NONE = '__none__'
const toRadix = (value: string) => (value === '' ? NONE : value)
const fromRadix = (value: string) => (value === NONE ? '' : value)

interface Props {
  value: string
  options: Option[]
  onChange: (value: string) => void
  ariaLabel: string
}

function Row({ option }: { option: Option }) {
  return (
    <RadixSelect.Item value={toRadix(option.value)} className="select-item">
      {option.tag ? <span className="tag">{option.tag}</span> : null}
      <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
    </RadixSelect.Item>
  )
}

export function Select({ value, options, onChange, ariaLabel }: Props) {
  const current = options.find((option) => option.value === value)

  // 등록 순서를 그대로 묶음 순서로 쓴다. 정렬하면 관련된 것끼리 흩어진다.
  const groups: { name: string; color?: string; items: Option[] }[] = []
  for (const option of options) {
    const name = option.group ?? ''
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.items.push(option)
    else groups.push({ name, color: option.groupColor, items: [option] })
  }

  return (
    <RadixSelect.Root value={toRadix(value)} onValueChange={(next) => onChange(fromRadix(next))}>
      <RadixSelect.Trigger className="select-trigger" aria-label={ariaLabel}>
        <span>{current?.label ?? '고르기'}</span>
        <RadixSelect.Icon>
          <IconChevron />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="select-content" position="popper" sideOffset={4}>
          {/* 항목이 서른 개가 넘는다. 더 있다는 것을 보여 줘야 한다 */}
          <RadixSelect.ScrollUpButton className="select-scroll">
            <IconChevron />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport>
            {groups.map((group, index) =>
              group.name ? (
                <RadixSelect.Group key={`${group.name}-${index}`}>
                  <RadixSelect.Label className="select-group">
                    <span className="dot" style={{ background: group.color ?? 'currentColor' }} />
                    {group.name}
                  </RadixSelect.Label>
                  {group.items.map((option) => (
                    <Row key={option.value} option={option} />
                  ))}
                </RadixSelect.Group>
              ) : (
                group.items.map((option) => <Row key={option.value} option={option} />)
              ),
            )}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="select-scroll">
            <IconChevron />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
