import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('UI boundary caught an error', error, info.componentStack)
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      const arabic = document.documentElement.lang === 'ar'
      return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <div className="card card-pad max-w-lg text-center">
            <img src="/icons/adnan-tech-favicon.svg" width={40} height={40} alt="" aria-hidden className="mx-auto mb-4 rounded-lg" />
            <h1 className="text-lg font-bold">{arabic ? 'فشل عرض هذا الجزء من الواجهة' : 'This part of the interface failed to render'}</h1>
            <p className="mt-2 text-sm text-muted">
              {arabic
                ? 'تم احتواء الخطأ ليبقى باقي التطبيق يعمل. أعد تحميل الصفحة أو ارجع إلى لوحة التحكم.'
                : 'The error was contained so the rest of the app keeps working. Reload the page or return to the dashboard.'}
            </p>
            {import.meta.env.DEV ? (
              <pre className="mt-3 overflow-auto rounded border border-line bg-[var(--code-bg)] p-2 text-start text-xs" dir="ltr">
                {this.state.error.message}
              </pre>
            ) : null}
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                {arabic ? 'إعادة التحميل' : 'Reload'}
              </button>
              {/* A plain anchor, not <Link>: this same boundary is also mounted at
                  the root, outside BrowserRouter, where router context is absent. */}
              <a href="/" className="btn btn-secondary">
                {arabic ? 'لوحة التحكم' : 'Dashboard'}
              </a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
