import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/context/AppContext', () => ({
  useApp: () => ({
    t: (key: string) => key,
    settings: { language: 'en' },
  }),
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))

import { SubnetTool } from '../src/components/tools/Calculators'
import { Base64Tool, TimestampTool } from '../src/components/tools/EncodingTools'
import { PermissionsTool } from '../src/components/tools/LinuxTools'
import { EventLogTool } from '../src/components/tools/WindowsTools'

describe('permission calculator wiring', () => {
  it('keeps the sticky bit inside the mode when an octal value is typed', () => {
    render(<PermissionsTool />)
    fireEvent.change(screen.getByLabelText('Octal mode'), { target: { value: '1777' } })
    expect(screen.getByDisplayValue('-rwxrwxrwt')).toBeInTheDocument()
  })

  it('parses a setuid symbolic mode written without the type character', () => {
    render(<PermissionsTool />)
    fireEvent.change(screen.getByLabelText('Symbolic mode'), { target: { value: 'rwsr-xr-x' } })
    expect(screen.getByDisplayValue('4755')).toBeInTheDocument()
  })
})

describe('base64 tool', () => {
  it('encodes RFC 4648 base64url without padding when asked', () => {
    render(<Base64Tool />)
    const input = screen.getByLabelText('Input', { selector: '#b64-input' })
    fireEvent.change(input, { target: { value: 'ÿþ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Encode' }))
    expect(screen.getByText('w7/Dvg==')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Encode' }))
    expect(screen.getByText('w7_Dvg')).toBeInTheDocument()
  })

  it('decodes URL-safe input written without padding', () => {
    render(<Base64Tool />)
    fireEvent.change(screen.getByLabelText('Input', { selector: '#b64-input' }), { target: { value: 'w7_Dvg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }))
    expect(screen.getByText('ÿþ')).toBeInTheDocument()
  })

  it('separates non-UTF-8 binary payloads from invalid base64', () => {
    render(<Base64Tool />)
    const input = screen.getByLabelText('Input', { selector: '#b64-input' })
    fireEvent.change(input, { target: { value: '/w==' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }))
    expect(screen.getByText(/not valid UTF-8 text/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '!!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }))
    expect(screen.getByText('Invalid Base64 input.')).toBeInTheDocument()
  })
})

describe('timestamp tool', () => {
  it('reads eleven digits as milliseconds and says so', () => {
    render(<TimestampTool />)
    const input = screen.getByLabelText(/Unix seconds/i, { selector: '#ts-input' })
    fireEvent.change(input, { target: { value: '17550000000' } })
    expect(screen.getByText(/Interpreted as Unix milliseconds/)).toBeInTheDocument()
    expect(screen.getByText('1970-07-23T03:00:00.000Z')).toBeInTheDocument()
  })

  it('rejects digit strings too long to interpret safely', () => {
    render(<TimestampTool />)
    fireEvent.change(screen.getByLabelText(/Unix seconds/i, { selector: '#ts-input' }), { target: { value: '1755000000000000' } })
    expect(screen.getByText('Unrecognized timestamp or date.')).toBeInTheDocument()
  })
})

describe('subnet tool', () => {
  it('explains why a leading-zero octet is rejected', () => {
    render(<SubnetTool />)
    fireEvent.change(screen.getByLabelText('IPv4 address'), { target: { value: '010.1.1.1' } })
    expect(screen.getByText(/leading zero in an IPv4 octet is ambiguous/)).toBeInTheDocument()
  })

  it('treats an empty prefix as missing input rather than /0', () => {
    render(<SubnetTool />)
    fireEvent.change(screen.getByLabelText('Prefix length'), { target: { value: '' } })
    expect(screen.getByText('Prefix length is required, from 0 to 32.')).toBeInTheDocument()
    expect(screen.getByLabelText('Prefix length')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('event log tool', () => {
  it('maps a numeric Windows event level to its name', () => {
    render(<EventLogTool />)
    fireEvent.change(screen.getByLabelText('Event log text'), {
      target: { value: '{"EventID":7031,"Level":2,"Provider":"Service Control Manager"}' },
    })
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('maps a numeric level written in a plain text line', () => {
    render(<EventLogTool />)
    fireEvent.change(screen.getByLabelText('Event log text'), { target: { value: 'EventID=7034 Level=1 Source=Kernel-Power' } })
    expect(screen.getByText('critical')).toBeInTheDocument()
  })
})
