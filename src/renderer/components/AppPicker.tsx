/**
 * 앱 고르기.
 *
 * 설치된 앱이 백 개가 넘는다. 펼침 목록으로는 못 찾으므로 검색이 붙는다.
 * Radix Select 에는 검색이 없어서 Popover 위에 cmdk 를 얹었다. 목록을 직접
 * 만들지 않는 이유는 늘 같다. 포커스 트랩과 키보드 이동이 이미 되어 있다.
 *
 * 고르면 번들 ID 가 저장된다. 화면에 보이는 이름과 다른 앱이 많아서 이름을
 * 저장하면 자동 전환도 실행도 조용히 어긋난다.
 */

import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/types'
import { IconChevron } from '../icons'
import { matches } from './filter'

interface Props {
  value: string
  apps: AppInfo[]
  onChange: (id: string) => void
  ariaLabel: string
  /** 아무것도 안 고른 상태에 붙일 말. 없으면 이 줄 자체가 안 나온다. */
  emptyLabel?: string
}

export function AppPicker({ value, apps, onChange, ariaLabel, emptyLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const current = apps.find((app) => app.id === value)
  // 목록에 없는 값도 지우지 않는다. 앱을 지웠거나 아직 못 훑었을 뿐일 수 있다.
  const label = current?.name ?? (value ? value : (emptyLabel ?? '고르기'))

  const choose = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="select-trigger" aria-label={ariaLabel}>
        <span className={current || !emptyLabel ? undefined : 'muted'}>{label}</span>
        <IconChevron />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="picker" align="start" sideOffset={4}>
          <Command loop filter={matches}>
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="앱 이름으로 검색"
            />
            <Command.List>
              <Command.Empty>맞는 앱이 없다</Command.Empty>
              {emptyLabel ? (
                <Command.Item value={emptyLabel} onSelect={() => choose('')}>
                  <span className="name muted">{emptyLabel}</span>
                </Command.Item>
              ) : null}
              {apps.map((app) => (
                <Command.Item
                  key={app.id}
                  // 이름으로도 번들 ID 로도 찾히게 둔다
                  value={`${app.name} ${app.id}`}
                  onSelect={() => choose(app.id)}
                >
                  <span className="name">{app.name}</span>
                  {app.running ? <span className="badge">실행 중</span> : null}
                  {app.id === value ? <span className="check">고름</span> : null}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
