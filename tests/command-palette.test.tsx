import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CommandPalette } from '@/components/layout/CommandPalette'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), cycleTheme: vi.fn() }))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))

vi.mock('@/context/AppContext', () => ({
  useApp: () => ({
    t: (key: string) => key,
    settings: { language: 'en' },
    setLanguage: () => undefined,
    cycleTheme: mocks.cycleTheme,
  }),
}))

function open() {
  render(<CommandPalette open onClose={() => undefined} />)
  return screen.getByRole('combobox') as HTMLInputElement
}

/** The element the combobox claims is active, or null when the id points at nothing. */
function activeOption(input: HTMLElement): HTMLElement | null {
  const id = input.getAttribute('aria-activedescendant')
  return id === null ? null : document.getElementById(id)
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => {
  mocks.navigate.mockReset()
  mocks.cycleTheme.mockReset()
})

afterEach(cleanup)

describe('the palette tells assistive technology which option is active', () => {
  it('points at a rendered, selected option inside the list it controls', () => {
    const input = open()
    const list = document.getElementById(input.getAttribute('aria-controls') as string)
    expect(list?.getAttribute('role')).toBe('listbox')
    // The list shown is the filtered remainder, not the full set.
    expect(input.getAttribute('aria-autocomplete')).toBe('list')

    const option = activeOption(input)
    expect(option).not.toBeNull()
    expect(option?.getAttribute('role')).toBe('option')
    expect(option?.getAttribute('aria-selected')).toBe('true')
    expect(list?.contains(option)).toBe(true)
  })

  it('moves the pointer with the arrows and keeps exactly one option selected', () => {
    const input = open()
    const first = activeOption(input)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const second = activeOption(input)
    expect(second).not.toBe(first)
    expect(second?.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryAllByRole('option', { selected: true })).toHaveLength(1)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(activeOption(input)).toBe(first)
  })

  it('jumps to the ends of the list with Home and End', () => {
    const input = open()
    const options = screen.getAllByRole('option')

    fireEvent.keyDown(input, { key: 'End' })
    expect(activeOption(input)).toBe(options[options.length - 1])

    fireEvent.keyDown(input, { key: 'Home' })
    expect(activeOption(input)).toBe(options[0])
  })

  it('never leaves the pointer outside the option range', () => {
    const input = open()
    const options = screen.getAllByRole('option')

    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(activeOption(input)).toBe(options[0])

    for (let i = 0; i < options.length + 3; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(activeOption(input)).toBe(options[options.length - 1])
  })

  it('runs the option it is pointing at when Enter is pressed', () => {
    const input = open()
    // The first entry is the "new analysis" action.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.navigate).toHaveBeenCalledWith('/lab')
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
  })

  it('runs the option it moved to, not the one it started on', () => {
    const input = open()
    // Actions come first in the list, so the second entry is the theme switch.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.cycleTheme).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('puts the pointer back on the first remaining option when the query shrinks the list', () => {
    const input = open()
    fireEvent.keyDown(input, { key: 'End' })
    expect(activeOption(input)).toBe(screen.getAllByRole('option').slice(-1)[0])

    // One keystroke: the list gets shorter and the pointer moves with it in the
    // same commit, so no frame ever names an option that is gone.
    type(input, 'theme')
    const option = activeOption(input)
    expect(option).not.toBeNull()
    expect(option?.textContent).toContain('command.actionToggleTheme')
    expect(document.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(1)
  })

  it('points at nothing when the filter matches nothing', () => {
    const input = open()
    fireEvent.keyDown(input, { key: 'End' })
    type(input, 'zzzzzzzzz')

    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    expect(activeOption(input)).toBeNull()
    expect(screen.queryAllByRole('option', { selected: true })).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})

describe('the grouped list is valid ARIA', () => {
  it('labels every group and keeps ids unique', () => {
    open()
    const groups = screen.getAllByRole('group')
    expect(groups.length).toBeGreaterThan(0)

    for (const group of groups) {
      const labelId = group.getAttribute('aria-labelledby')
      expect(labelId).toBeTruthy()
      expect(document.getElementById(labelId as string)?.textContent).toBeTruthy()
      expect(within(group).getAllByRole('option').length).toBeGreaterThan(0)
    }

    const ids = screen.getAllByRole('option').map((option) => option.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('command-option-'))).toBe(true)
  })

  it('groups the options under the heading the person can see', () => {
    open()
    const actions = screen.getByRole('group', { name: 'command.actions' })
    expect(within(actions).getByRole('option', { selected: true }).textContent).toContain('command.actionNewAnalysis')
  })
})
