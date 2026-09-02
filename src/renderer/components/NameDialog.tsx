/**
 * 이름을 받는 작은 대화상자.
 *
 * Electron 렌더러에는 window.prompt 가 없다. 직접 만들지 않고 Radix Dialog 를
 * 쓴다. 포커스 트랩과 Esc 처리가 이미 되어 있다.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  title: string
  initial: string
  confirmLabel: string
  onClose: () => void
  onConfirm: (name: string) => void
}

export function NameDialog({ open, title, initial, confirmLabel, onClose, onConfirm }: Props) {
  const [name, setName] = useState(initial)

  useEffect(() => {
    if (open) setName(initial)
  }, [open, initial])

  const submit = () => {
    const trimmed = name.trim()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay">
          <Dialog.Content className="palette" aria-label={title}>
            <Dialog.Title
              style={{
                margin: 0,
                padding: 'var(--space-3) var(--space-4) 0',
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--w-strong)',
                letterSpacing: 'var(--tracking-title)',
              }}
            >
              {title}
            </Dialog.Title>
            <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
              <input
                className="input"
                autoFocus
                value={name}
                placeholder="이름"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-3)',
                }}
              >
                <button className="button" onClick={onClose}>
                  취소
                </button>
                <button className="button primary" onClick={submit}>
                  {confirmLabel}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
