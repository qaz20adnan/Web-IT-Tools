import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppProvider } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LibraryProvider } from './context/LibraryContext'
import { DiagnosticsProvider } from './context/DiagnosticsContext'
import { ProvidersProvider } from './context/ProvidersContext'
import { ToastProvider } from './context/ToastContext'
import { setActiveStorageUser } from './lib/storage'
import './styles/index.css'

function UserDataProviders() {
  const { account } = useAuth()
  const scope = account?.profile?.id ?? 'guest'
  setActiveStorageUser(scope)
  return (
    <ProvidersProvider key={`providers:${scope}`} userId={scope}>
      <LibraryProvider key={`library:${scope}`} userId={scope}>
        <DiagnosticsProvider key={`diagnostics:${scope}`} userId={scope}>
          <App />
        </DiagnosticsProvider>
      </LibraryProvider>
    </ProvidersProvider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <ToastProvider>
            <AuthProvider>
              <UserDataProviders />
            </AuthProvider>
          </ToastProvider>
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
