import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppProvider } from './context/AppContext'
import { AuthProvider } from './context/AuthContext'
import { LibraryProvider } from './context/LibraryContext'
import { ProvidersProvider } from './context/ProvidersContext'
import { ToastProvider } from './context/ToastContext'
import './styles/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <ToastProvider>
            <AuthProvider>
              <ProvidersProvider>
                <LibraryProvider>
                  <App />
                </LibraryProvider>
              </ProvidersProvider>
            </AuthProvider>
          </ToastProvider>
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
