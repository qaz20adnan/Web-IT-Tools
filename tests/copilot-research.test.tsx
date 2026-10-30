import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/context/AppContext', () => ({
  useApp: () => ({ t: (key: string) => key, settings: { language: 'en' } }),
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))

vi.mock('@/context/ProvidersContext', () => ({
  useProviders: () => ({ credentials: null, hasClientProvider: true }),
}))

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    data: {
      ok: true,
      time: '',
      version: '1.0.0',
      services: {
        ai: { configured: true, provider: 'openrouter', model: 'm' },
        vision: { configured: false },
        research: { configured: false, providers: [], grounded: { configured: true, webSearchEnabled: true, model: 'gemini-flash-latest' } },
        news: { configured: true, customFeeds: false },
        database: { configured: false },
        contentAdmin: { configured: false },
      },
    },
  }),
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual, copyToClipboard: vi.fn(async () => true), uid: (() => { let n = 0; return () => `id-${(n += 1)}` })() }
})

const sendChat = vi.fn()

vi.mock('@/services/api', () => ({
  ApiError: class extends Error {},
  sendChat: (...args: unknown[]) => sendChat(...args),
}))

import { copyToClipboard } from '@/lib/utils'
import { CopilotPage } from '../src/pages/CopilotPage'
import { extractCommands } from '../src/lib/answerParts'

function renderPage() {
  return render(
    <MemoryRouter>
      <CopilotPage />
    </MemoryRouter>,
  )
}

const groundedAnswer = {
  content: 'Restart the spooler.\n\n```powershell\nRestart-Service spooler\n```\n',
  provider: 'gemini',
  model: 'gemini-flash-latest',
  engine: 'google-search-grounding',
  searchUsed: true,
  searchQueries: ['print spooler crash windows server 2022'],
  searchRequests: 2,
  elapsedMs: 3120,
  sources: [
    { url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/printer-issues', title: 'learn.microsoft.com', host: 'learn.microsoft.com' },
    { url: 'https://support.microsoft.com/en-us/topic/kb5034441', title: 'support.microsoft.com', host: 'support.microsoft.com' },
  ],
}

describe('extractCommands', () => {
  it('returns only fenced command lines, never prose', () => {
    expect(extractCommands('Run this:\n```cmd\nnslookup -type=SRV _xmpp._tcp.example.com\n```\nthen check DNS')).toEqual([
      'nslookup -type=SRV _xmpp._tcp.example.com',
    ])
    expect(extractCommands('no code here')).toEqual([])
    expect(extractCommands('```sh\n$ systemctl restart named\n> echo done\n```')).toEqual(['systemctl restart named', 'echo done'])
  })
})

describe('Copilot research answers', () => {
  it('renders every returned citation as a safe new-tab link', async () => {
    sendChat.mockResolvedValueOnce(groundedAnswer)
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('copilot.placeholder'), { target: { value: 'Why does the spooler crash?' } })
    fireEvent.keyDown(screen.getByPlaceholderText('copilot.placeholder'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('copilot.research.sources')).toBeInTheDocument())

    const links = screen.getAllByRole('link', { name: /learn\.microsoft\.com|support\.microsoft\.com/ })
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.getAttribute('rel')).toContain('noreferrer')
    }
    expect(screen.getByText(/print spooler crash windows server 2022/)).toBeInTheDocument()
    expect(screen.getByText(/copilot\.research\.live/)).toBeInTheDocument()
  })

  it('sends the selected assistant mode to the backend', async () => {
    sendChat.mockResolvedValueOnce(groundedAnswer)
    renderPage()
    fireEvent.change(screen.getByLabelText('copilot.assistant'), { target: { value: 'on' } })
    fireEvent.change(screen.getByPlaceholderText('copilot.placeholder'), { target: { value: 'latest patch?' } })
    fireEvent.keyDown(screen.getByPlaceholderText('copilot.placeholder'), { key: 'Enter' })
    await waitFor(() => expect(sendChat).toHaveBeenCalled())
    expect(sendChat.mock.calls[0]?.[2]).toBe('on')
  })

  it('states plainly when an answer has no search backing', async () => {
    sendChat.mockResolvedValueOnce({ ...groundedAnswer, searchUsed: false, searchQueries: [], sources: [] })
    renderPage()
    fireEvent.change(screen.getByLabelText('copilot.assistant'), { target: { value: 'on' } })
    fireEvent.change(screen.getByPlaceholderText('copilot.placeholder'), { target: { value: 'anything' } })
    fireEvent.keyDown(screen.getByPlaceholderText('copilot.placeholder'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('copilot.research.noSources')).toBeInTheDocument())
    expect(screen.queryByText('copilot.research.sources')).not.toBeInTheDocument()
  })

  it('copies only the commands the answer actually contains', async () => {
    sendChat.mockResolvedValueOnce(groundedAnswer)
    renderPage()
    fireEvent.change(screen.getByLabelText('copilot.assistant'), { target: { value: 'on' } })
    fireEvent.change(screen.getByPlaceholderText('copilot.placeholder'), { target: { value: 'fix it' } })
    fireEvent.keyDown(screen.getByPlaceholderText('copilot.placeholder'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('copilot.research.sources')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /copilot\.research\.copyCommands/ }))
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('Restart-Service spooler'))

    vi.mocked(copyToClipboard).mockClear()
    sendChat.mockResolvedValueOnce({ ...groundedAnswer, content: 'No commands in this reply.', sources: [] })
    fireEvent.change(screen.getByPlaceholderText('copilot.placeholder'), { target: { value: 'again' } })
    fireEvent.keyDown(screen.getByPlaceholderText('copilot.placeholder'), { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByText('copilot.research.noSources').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('button', { name: /copilot\.research\.copyCommands/ }).at(-1)).toBeDisabled()
  })
})
