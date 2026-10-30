import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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

vi.mock('@/context/DiagnosticsContext', () => ({
  useDiagnostics: () => ({
    records: [],
    favorites: [],
    addRecord: vi.fn(),
    removeRecord: vi.fn(),
    clearRecords: vi.fn(),
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
  }),
  diagnosticToolLabel: (tool: string) => tool,
}))

import { CapacityTool } from '../src/components/tools/CapacityTool'
import { CertDecodeTool } from '../src/components/tools/CertDecodeTool'
import { CidrOverlapTool } from '../src/components/tools/CidrOverlapTool'
import { CsvJsonTool } from '../src/components/tools/CsvJsonTool'
import { MtuTool } from '../src/components/tools/MtuTool'
import { parsePortList, PortCheckTool } from '../src/components/tools/PortCheckTool'
import { SpeedTestTool } from '../src/components/tools/SpeedTestTool'
import { TextDiffTool } from '../src/components/tools/TextDiffTool'

describe('toolkit additions', () => {
  it('computes VXLAN payload MTU and TCP MSS from the default 1500-byte link', () => {
    render(<MtuTool />)
    expect(screen.getByText('50 B')).toBeInTheDocument()
    expect(screen.getAllByText('1450 B').length).toBeGreaterThan(1)
    expect(screen.getByText('1410 B')).toBeInTheDocument()
  })

  it('separates the IEC and JEDEC reading of a 4 TB disk', () => {
    render(<CapacityTool />)
    expect(screen.getAllByText('4,000,000,000,000').length).toBeGreaterThan(0)
    expect(screen.getByText('3.64 TiB')).toBeInTheDocument()
    expect(screen.getByText('4.00 TB')).toBeInTheDocument()
    expect(screen.getByText('9.05 %')).toBeInTheDocument()
  })

  it('reports the containment conflicts and out-of-subnet gateway in the seeded plan', () => {
    render(<CidrOverlapTool />)
    expect(screen.getByText(/Fail — \d+ conflict/)).toBeInTheDocument()
    expect(screen.getByText('10.0.0.128/25')).toBeInTheDocument()
    expect(screen.getByText('10.0.1.64/26')).toBeInTheDocument()
    expect(screen.getAllByText('Conflict').length).toBeGreaterThan(0)
    expect(screen.getByText('10.0.3.1')).toBeInTheDocument()
  })

  it('invites a PEM block when the decoder has nothing to work on', () => {
    render(<CertDecodeTool />)
    expect(screen.getByText('Paste a PEM block to decode it.')).toBeInTheDocument()
  })

  it('mounts the diff view with both panes empty', () => {
    render(<TextDiffTool />)
    expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByPlaceholderText(/ServerRoot/).length).toBe(2)
  })

  it('mounts the CSV/JSON converter with its empty states', () => {
    render(<CsvJsonTool />)
    expect(screen.getByText('Paste CSV to convert it.')).toBeInTheDocument()
    expect(screen.getByText('JSON output')).toBeInTheDocument()
  })

  it('mounts the speed test with its phases idle', () => {
    render(<SpeedTestTool />)
    expect(screen.getByText('Internet Speed Test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run test/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Latency probes')).toBeInTheDocument()
    expect(screen.queryByText(/Mbps/)).not.toBeInTheDocument()
  })

  it('seeds the port checker with three ports and caps the selection at eight', () => {
    render(<PortCheckTool />)
    expect(screen.getByText('Public Port & DDNS Reachability')).toBeInTheDocument()
    expect(screen.getByText(/3\/8/)).toBeInTheDocument()
    expect(screen.getAllByText('443').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('DDNS hostname or IP')).toHaveValue('')
    expect(parsePortList('22, 990 x 70000 443')).toEqual([22, 990, 443])
  })
})
