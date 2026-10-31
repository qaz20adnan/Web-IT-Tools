import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ErrorBoundary } from '../src/components/ErrorBoundary'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function Thrower(): null {
  throw new Error('the page exploded')
}

describe('ErrorBoundary contains the failure instead of taking the app with it', () => {
  it('renders the fallback for a throwing child while its siblings stay alive', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <nav>navigation is still here</nav>
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('This part of the interface failed to render')).toBeInTheDocument()
    // The point of H-9: the shell around the crashed subtree keeps rendering.
    expect(screen.getByText('navigation is still here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    spy.mockRestore()
  })

  it('offers a plain anchor home, because the root boundary sits outside BrowserRouter', () => {
    const source = readFileSync(join(ROOT, 'src', 'components', 'ErrorBoundary.tsx'), 'utf8')
    expect(source).toContain('<a href="/"')
    // Importing the router at all would make the root fallback throw a second
    // error, since main.tsx mounts this boundary above <BrowserRouter>.
    expect(source).not.toContain('react-router-dom')
  })
})

describe('the route tree has its own boundary', () => {
  it('wraps the routes per pathname so the shell and navigation survive a page crash', () => {
    const app = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8')
    expect(app).toContain('<ErrorBoundary key={pathname}>')
    // The boundary has to be *inside* the routes component, not around AppShell.
    const boundaryIndex = app.indexOf('<ErrorBoundary key={pathname}>')
    expect(app.indexOf('<Routes>', boundaryIndex)).toBeGreaterThan(boundaryIndex)
    expect(app.indexOf('</ErrorBoundary>')).toBeGreaterThan(app.indexOf('</Routes>'))
    expect(app).toMatch(/<AppShell>\s*<PageRoutes \/>/)
  })

  it('keeps the root boundary as the last resort', () => {
    const main = readFileSync(join(ROOT, 'src', 'main.tsx'), 'utf8')
    expect(main).toContain('<ErrorBoundary>')
    expect(main.indexOf('<ErrorBoundary>')).toBeLessThan(main.indexOf('<BrowserRouter>'))
  })
})
