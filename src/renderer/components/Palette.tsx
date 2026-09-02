/**
 * 명령 팔레트.
 *
 * cmdk 위에 토큰만 다시 입혔다. 이 앱의 정체성은 시각보다 키보드에 있다.
 * 모든 동작이 여기에서 닿아야 한다.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'

export interface PaletteCommand {
  id: string
  group: string
  /** 묶음 이름 앞 점의 색. 기기 표식과 같은 값이다. */
  groupColor?: string
  label: string
  /** 이름 뒤에 흐리게 붙는 설명. 이름과 같은 농도로 두면 둘 다 안 읽힌다. */
  detail?: string
  shortcut?: string
  run: () => void
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: PaletteCommand[]
}

export function Palette({ open, onOpenChange, commands }: Props) {
  // 등록 순서를 유지한다. 사전순으로 섞으면 관련된 것끼리 흩어진다.
  const groups: { name: string; color?: string; items: PaletteCommand[] }[] = []
  for (const command of commands) {
    const found = groups.find((group) => group.name === command.group)
    if (found) found.items.push(command)
    else groups.push({ name: command.group, color: command.groupColor, items: [command] })
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay">
          <Dialog.Content className="palette" aria-label="명령">
            <Dialog.Title className="sr-only" style={{ display: 'none' }}>
              명령
            </Dialog.Title>
            <Command loop>
              <Command.Input placeholder="명령을 입력하거나 검색" autoFocus />
              <Command.List>
                <Command.Empty>맞는 명령이 없다</Command.Empty>
                {groups.map((group) => (
                  <Command.Group
                    key={group.name}
                    heading={
                      <>
                        <span className="dot" style={{ background: group.color ?? 'currentColor' }} />
                        {group.name}
                      </>
                    }
                  >
                    {group.items.map((command) => (
                      <Command.Item
                        key={command.id}
                        value={`${group.name} ${command.label} ${command.detail ?? ''}`}
                        onSelect={() => {
                          command.run()
                          onOpenChange(false)
                        }}
                      >
                        <span className="name">{command.label}</span>
                        {command.detail ? <span className="detail">{command.detail}</span> : null}
                        {command.shortcut ? <kbd className="shortcut">{command.shortcut}</kbd> : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
