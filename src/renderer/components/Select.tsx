/**
 * Radix Select 를 토큰에 맞춰 다시 칠한 것.
 *
 * 드롭다운을 직접 만들지 않는다. 포커스 트랩과 키보드 이동, 스크린리더
 * 처리가 이미 되어 있다. 기본 테마를 그대로 두면 웹 대시보드처럼 보이므로
 * 색과 간격과 반경만 tokens.css 로 바꾼다.
 */

import * as RadixSelect from '@radix-ui/react-select'
import { IconChevron } from '../icons'

export interface Option {
  value: string
  label: string
  /** 왼쪽에 붙는 짧은 식별자. 키 이름 같은 것. */
  tag?: string
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

export function Select({ value, options, onChange, ariaLabel }: Props) {
  const current = options.find((option) => option.value === value)
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
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item key={option.value} value={toRadix(option.value)} className="select-item">
                {option.tag ? <span className="tag">{option.tag}</span> : null}
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
