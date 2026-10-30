import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/context/AppContext', () => ({
  useApp: () => ({
    t: (key: string) => key,
    settings: { language: 'en' },
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', account: null, configured: true, config: null }),
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))

import { PermissionsTool } from '../src/components/tools/LinuxTools'
import { VlsmTool } from '../src/components/tools/VlsmPlanner'
import { IncidentsPage } from '../src/pages/IncidentsPage'
import { VirtualizationPage } from '../src/pages/VirtualizationPage'

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('new engineering surfaces', () => {
  it('renders the Linux permission calculator with a valid default mode', () => {
    renderWithRouter(<PermissionsTool />)
    expect(screen.getAllByText('0755').length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue('-rwxr-xr-x')).toBeInTheDocument()
  })

  it('renders the VLSM planner and allocates the demo rows', () => {
    renderWithRouter(<VlsmTool />)
    expect(screen.getByText(/192\.168\.10\.0\/25/)).toBeInTheDocument()
    expect(screen.getByText(/192\.168\.10\.128\/27/)).toBeInTheDocument()
    expect(screen.getByText(/192\.168\.10\.160\/28/)).toBeInTheDocument()
  })

  it('renders the incident log empty state', () => {
    renderWithRouter(<IncidentsPage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('renders the virtualization module', () => {
    renderWithRouter(<VirtualizationPage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
