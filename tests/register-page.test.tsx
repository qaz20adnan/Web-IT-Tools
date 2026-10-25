import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RegisterPage } from '../src/pages/RegisterPage'

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  config: null as null | { localMode: boolean; passwordMinLength: number; passwordMaxLength: number },
}))

vi.mock('@/context/AppContext', () => ({
  useApp: () => ({
    t: (key: string) => key,
    settings: { language: 'en' },
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    status: 'idle',
    account: null,
    signUp: mocks.signUp,
    configured: true,
    config: mocks.config,
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )
}

describe('RegisterPage', () => {
  beforeEach(() => {
    mocks.signUp.mockReset()
    mocks.config = null
  })

  it('renders exactly username, email and password', () => {
    const { container } = renderPage()

    expect(container.querySelectorAll('input')).toHaveLength(3)
    expect(screen.getByLabelText(/auth.username/)).toBeInTheDocument()
    expect(screen.getByLabelText(/auth.email/)).toBeInTheDocument()
    expect(screen.getByLabelText(/auth.password/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/auth.confirmPassword/)).not.toBeInTheDocument()
  })

  it('submits the three registration fields', async () => {
    mocks.signUp.mockResolvedValueOnce({ ok: true, needsVerification: true })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/auth.username/), 'adnan_92')
    await user.type(screen.getByLabelText(/auth.email/), 'adnan@example.com')
    await user.type(screen.getByLabelText(/auth.password/), '12345678')
    await user.click(screen.getByRole('button', { name: 'auth.signUp' }))

    expect(mocks.signUp).toHaveBeenCalledWith({
      username: 'adnan_92',
      email: 'adnan@example.com',
      password: '12345678',
    })
  })

  it('rejects a password shorter than eight characters', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/auth.username/), 'adnan_92')
    await user.type(screen.getByLabelText(/auth.email/), 'adnan@example.com')
    await user.type(screen.getByLabelText(/auth.password/), '1234567')
    await user.click(screen.getByRole('button', { name: 'auth.signUp' }))

    expect(screen.getByRole('alert')).toHaveTextContent('auth.passwordHint')
    expect(mocks.signUp).not.toHaveBeenCalled()
  })

  it('allows a very short password in local development mode', async () => {
    mocks.config = { localMode: true, passwordMinLength: 1, passwordMaxLength: 1024 }
    mocks.signUp.mockResolvedValueOnce({ ok: true })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/auth.username/), 'adnan_92')
    await user.type(screen.getByLabelText(/auth.email/), 'adnan@example.com')
    await user.type(screen.getByLabelText(/auth.password/), 'x')
    await user.click(screen.getByRole('button', { name: 'auth.signUp' }))

    expect(screen.getByText('auth.localAuthNotice')).toBeInTheDocument()
    expect(mocks.signUp).toHaveBeenCalledWith({
      username: 'adnan_92',
      email: 'adnan@example.com',
      password: 'x',
    })
  })

  it('rejects an invalid username before calling the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/auth.username/), 'bad name')
    await user.type(screen.getByLabelText(/auth.email/), 'adnan@example.com')
    await user.type(screen.getByLabelText(/auth.password/), 'strong-password')
    await user.click(screen.getByRole('button', { name: 'auth.signUp' }))

    expect(screen.getByRole('alert')).toHaveTextContent('auth.invalidUsername')
    expect(mocks.signUp).not.toHaveBeenCalled()
  })
})
