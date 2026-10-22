import type { KeyboardEvent } from 'react'
import css from './settings.module.css'

export function rovingChoiceIndex(key: string, index: number, count: number, rtl = false): number | undefined {
  if (count < 1) return undefined
  let target: number
  switch (key) {
    case 'ArrowDown': target = index + 1; break
    case 'ArrowUp': target = index - 1; break
    case 'ArrowRight': target = rtl ? index - 1 : index + 1; break
    case 'ArrowLeft': target = rtl ? index + 1 : index - 1; break
    case 'Home': case 'PageUp': target = 0; break
    case 'End': case 'PageDown': target = count - 1; break
    default: return undefined
  }
  return (target + count) % count
}

export function SegmentedChoice<T extends string>({ label, value, choices, disabled, onChange }: {
  readonly label: string
  readonly value: T
  readonly choices: readonly { readonly value: T; readonly label: string }[]
  readonly disabled?: boolean
  readonly onChange: (value: T) => void
}) {
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return
    const target = rovingChoiceIndex(event.key, index, choices.length, getComputedStyle(event.currentTarget).direction === 'rtl')
    if (target === undefined) return
    event.preventDefault()
    const item = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[target]
    item?.focus({ preventScroll: true })
    onChange(choices[target]!.value)
  }
  return <div className={css.segmented} role="radiogroup" aria-label={label}>
    {choices.map((choice, index) => <button
      key={choice.value} type="button" role="radio" aria-checked={value === choice.value}
      className={css.segment} disabled={disabled} tabIndex={value === choice.value ? 0 : -1}
      onKeyDown={event => navigate(event, index)} onClick={() => onChange(choice.value)}
    >{choice.label}</button>)}
  </div>
}
