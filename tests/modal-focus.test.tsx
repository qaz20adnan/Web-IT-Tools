import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { Modal } from '@/components/ui'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * Queries that read the accessibility tree can treat an inert subtree as
 * inaccessible, and the whole point here is that the background goes inert, so
 * background elements are reached through the DOM rather than by role.
 */
function firstButton(container: HTMLElement): HTMLElement {
  return container.querySelector('button') as HTMLElement
}

function overlays(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.fixed'))
}

function TwoFields() {
  return (
    <Modal open onClose={() => undefined} title="Two fields">
      <input data-testid="first" />
      <input data-testid="second" />
    </Modal>
  )
}

describe('the dialog leaves the page behind it alone', () => {
  it('marks the background inert while it is open', () => {
    const { container } = render(<TwoFields />)
    expect(container.hasAttribute('inert')).toBe(true)
    // The overlay is a sibling of the rendered tree in <body>, so it must not be
    // inerted along with the page.
    expect(overlays()[0].hasAttribute('inert')).toBe(false)
  })

  it('lifts the inert again when it closes, so the app is not left disabled', () => {
    // Closing by re-render rather than unmounting the tree: RTL's cleanup removes
    // the container from <body>, which would make the assertion below vacuous.
    function Demo({ open }: { open: boolean }) {
      return open ? <TwoFields /> : <span>closed</span>
    }
    const { container, rerender } = render(<Demo open />)
    expect(container.hasAttribute('inert')).toBe(true)
    rerender(<Demo open={false} />)
    expect(container.hasAttribute('inert')).toBe(false)
    expect(document.querySelectorAll('body > [inert]')).toHaveLength(0)
  })

  it('leaves focus on the control the dialog content claimed for itself', () => {
    // The command palette autofocuses its search input on mount. The dialog's own
    // 30 ms timer looks for the first control in the panel, and the header's close
    // button comes first in document order, so an unconditional focus() there
    // takes the caret out of the box the person is about to type into.
    vi.useFakeTimers()
    function Demo() {
      return (
        <Modal open onClose={() => undefined} title="Palette">
          <input autoFocus data-testid="claimed" />
          <input data-testid="other" />
        </Modal>
      )
    }
    render(<Demo />)
    const claimed = screen.getByTestId('claimed')
    expect(document.activeElement).toBe(claimed)

    act(() => {
      vi.advanceTimersByTime(40)
    })
    expect(document.activeElement).toBe(claimed)
  })

  it('restores the document scroll lock when the dialog closes', () => {
    function Demo({ open }: { open: boolean }) {
      return open ? <TwoFields /> : <span>closed</span>
    }
    const { rerender } = render(<Demo open />)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Demo open={false} />)
    expect(document.body.style.overflow).toBe('')
  })

  it('inerts the dialog underneath and frees it again when the top one closes', () => {
    // AppShell mounts the command palette, so a page dialog and the palette can
    // be open together; only the newest one may take keyboard.
    function Stacked() {
      const [topOpen, setTopOpen] = useState(true)
      return (
        <>
          <Modal open onClose={() => undefined} title="Under">
            <span>under</span>
          </Modal>
          <button type="button" onClick={() => setTopOpen(false)}>
            Dismiss top
          </button>
          {topOpen ? (
            <Modal open onClose={() => setTopOpen(false)} title="Over">
              <span>over</span>
            </Modal>
          ) : null}
        </>
      )
    }
    const { container } = render(<Stacked />)
    const [under, over] = overlays()
    expect(under.hasAttribute('inert')).toBe(true)
    expect(over.hasAttribute('inert')).toBe(false)

    fireEvent.click(firstButton(container))
    expect(under.hasAttribute('inert')).toBe(false)
    expect(container.hasAttribute('inert')).toBe(true)
  })
})

describe('focus goes back where it came from', () => {
  it('returns to the trigger when the dialog closes', async () => {
    function Demo() {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Confirm">
            <button type="button" onClick={() => setOpen(false)}>
              Close it
            </button>
          </Modal>
        </div>
      )
    }
    const { container } = render(<Demo />)
    const trigger = firstButton(container)
    trigger.focus()
    fireEvent.click(trigger)

    const inside = screen.getByRole('button', { name: 'Close it' })
    inside.focus()
    expect(document.activeElement).toBe(inside)

    fireEvent.click(inside)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('does not chase a trigger that the close also unmounted', () => {
    function Demo() {
      const [rows, setRows] = useState([1, 2])
      const [open, setOpen] = useState(false)
      return (
        <div>
          {rows.map((row) => (
            <button key={row} type="button" onClick={() => setOpen(true)}>
              Row {row}
            </button>
          ))}
          <Modal
            // Deleting the row is what closes the dialog, so the element that
            // opened it is gone before the cleanup runs.
            open={open}
            onClose={() => {
              setRows([])
              setOpen(false)
            }}
            title="Delete row"
          >
            <span>sure?</span>
          </Modal>
        </div>
      )
    }
    const { container } = render(<Demo />)
    const trigger = firstButton(container)
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.body.style.overflow).toBe('hidden')

    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow()
    expect(container.querySelector('button')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })
})

describe('the dialog opens with its content under the caret', () => {
  it('focuses the first control in the body, not the header close button', () => {
    vi.useFakeTimers()
    render(
      <Modal open onClose={() => undefined} title="Editor">
        <input data-testid="first" />
        <button type="button">Save</button>
      </Modal>,
    )
    act(() => {
      vi.advanceTimersByTime(40)
    })
    expect(document.activeElement).toBe(screen.getByTestId('first'))
  })

  it('never moves focus that the content already claimed, even further down the body', () => {
    // The body-first rule alone would be enough for the palette, whose search box
    // is the first control. A dialog that opens on a later field — the usual
    // autoFocus pattern — is the case the guard exists for.
    vi.useFakeTimers()
    render(
      <Modal open onClose={() => undefined} title="Rename">
        <input data-testid="first" />
        <input autoFocus data-testid="claimed-later" />
      </Modal>,
    )
    act(() => {
      vi.advanceTimersByTime(40)
    })
    expect(document.activeElement).toBe(screen.getByTestId('claimed-later'))
  })

  it('keeps the caret inside the panel when the body has nothing to focus', () => {
    vi.useFakeTimers()
    render(
      <Modal open onClose={() => undefined} title="Confirm">
        <span>sure?</span>
      </Modal>,
    )
    act(() => {
      vi.advanceTimersByTime(40)
    })
    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel.contains(document.activeElement)).toBe(true)
  })
})

describe('the trap still belongs to the dialog', () => {
  it('wraps Tab from the last control to the first, and back', () => {
    render(<TwoFields />)
    // The panel owns three controls, not two: the header carries its own close
    // button ahead of the children, so "first" is that button.
    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>('button, input'))
    expect(focusables).toHaveLength(3)

    focusables[2].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusables[2])
  })

  it('closes on Escape through the latest handler, not the one it first captured', () => {
    const seen: string[] = []
    function Demo({ label }: { label: string }) {
      return (
        <Modal open onClose={() => seen.push(label)} title="Escape">
          <span>content</span>
        </Modal>
      )
    }
    const { rerender } = render(<Demo label="first" />)
    rerender(<Demo label="second" />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(seen).toEqual(['second'])
  })

  it('does not pull focus back while the page re-renders behind an open dialog', () => {
    vi.useFakeTimers()
    function Page() {
      const [tick, setTick] = useState(0)
      return (
        <div>
          <button type="button" onClick={() => setTick((value) => value + 1)}>
            Re-render {tick}
          </button>
          {/* Inline onClose: a new identity on every render, which is how 11 of
              the 12 call sites pass it. */}
          <Modal open onClose={() => setTick((value) => value + 1)} title="Editor">
            <input data-testid="first" />
            <input data-testid="second" />
          </Modal>
        </div>
      )
    }
    const { container } = render(<Page />)
    act(() => {
      vi.advanceTimersByTime(30)
    })
    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel.contains(document.activeElement)).toBe(true)

    const second = screen.getByTestId('second')
    second.focus()
    fireEvent.click(firstButton(container))
    act(() => {
      vi.advanceTimersByTime(30)
    })
    expect(document.activeElement).toBe(second)
  })
})
