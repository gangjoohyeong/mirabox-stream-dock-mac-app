/** 단색 라인 아이콘. 이모지를 아이콘으로 쓰지 않는다. */

interface Props {
  size?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 14 14',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IconLayers = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <path d="M7 1.8 12.2 4.6 7 7.4 1.8 4.6z" />
    <path d="M1.8 7.4 7 10.2l5.2-2.8" />
  </svg>
)

export const IconChevron = ({ size = 12 }: Props) => (
  <svg {...base(size)}>
    <path d="M4.5 5.5 7 8l2.5-2.5" />
  </svg>
)

export const IconPlus = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <path d="M7 3.2v7.6M3.2 7h7.6" />
  </svg>
)

export const IconCheck = ({ size = 12 }: Props) => (
  <svg {...base(size)}>
    <path d="M3.4 7.3 5.8 9.7 10.6 4.6" />
  </svg>
)

export const IconGrid = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <rect x="1.8" y="1.8" width="4" height="4" rx="1" />
    <rect x="8.2" y="1.8" width="4" height="4" rx="1" />
    <rect x="1.8" y="8.2" width="4" height="4" rx="1" />
    <rect x="8.2" y="8.2" width="4" height="4" rx="1" />
  </svg>
)

export const IconPulse = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <path d="M1.5 7h2.6l1.6-3.6 2.2 7.2 1.5-3.6h3.1" />
  </svg>
)
