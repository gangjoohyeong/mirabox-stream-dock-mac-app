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
  const groups = commands.reduce<Record<string, PaletteCommand[]>>((acc, command) => {
    ;(acc[command.group] ??= []).push(command)
    return acc
  }, {})

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
                {Object.entries(groups).map(([group, items]) => (
                  <Command.Group key={group} heading={group}>
                    {items.map((command) => (
                      <Command.Item
                        key={command.id}
                        value={`${group} ${command.label} ${command.detail ?? ''}`}
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
