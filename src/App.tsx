import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { Toaster } from '@/components/ui/Toaster'
import { DashboardPage } from '@/pages/DashboardPage'

const load = <T extends Record<string, unknown>, K extends keyof T>(loader: () => Promise<T>, key: K) =>
  lazy(async () => {
    const module = await loader()
    return { default: module[key] as ComponentType<Record<string, unknown>> }
  })

const AboutPage = load(() => import('@/pages/AboutPage'), 'AboutPage')
const AccountPage = load(() => import('@/pages/AccountPage'), 'AccountPage')
const AdminPage = load(() => import('@/pages/AdminPage'), 'AdminPage')
const CheckEmailPage = load(() => import('@/pages/CheckEmailPage'), 'CheckEmailPage')
const ForgotPasswordPage = load(() => import('@/pages/ForgotPasswordPage'), 'ForgotPasswordPage')
const LoginPage = load(() => import('@/pages/LoginPage'), 'LoginPage')
const RegisterPage = load(() => import('@/pages/RegisterPage'), 'RegisterPage')
const ResetPasswordPage = load(() => import('@/pages/ResetPasswordPage'), 'ResetPasswordPage')
const VerifyEmailPage = load(() => import('@/pages/VerifyEmailPage'), 'VerifyEmailPage')
const WorkspacePage = load(() => import('@/pages/WorkspacePage'), 'WorkspacePage')
const AIModelRadarPage = load(() => import('@/pages/AIModelRadarPage'), 'AIModelRadarPage')
const ArticlePage = load(() => import('@/pages/ArticlePage'), 'ArticlePage')
const CopilotPage = load(() => import('@/pages/CopilotPage'), 'CopilotPage')
const DocsHubPage = load(() => import('@/pages/DocsHubPage'), 'DocsHubPage')
const DomainPage = load(() => import('@/pages/DomainPage'), 'DomainPage')
const HistoryPage = load(() => import('@/pages/HistoryPage'), 'HistoryPage')
const IncidentsPage = load(() => import('@/pages/IncidentsPage'), 'IncidentsPage')
const KnowledgePage = load(() => import('@/pages/KnowledgePage'), 'KnowledgePage')
const KnowledgeBasePage = load(() => import('@/pages/KnowledgeBasePage'), 'KnowledgeBasePage')
const NetworkDiagnosticsPage = load(() => import('@/pages/NetworkDiagnosticsPage'), 'NetworkDiagnosticsPage')
const NetworkToolsPage = load(() => import('@/pages/NetworkToolsPage'), 'NetworkToolsPage')
const SecurityLabPage = load(() => import('@/pages/SecurityLabPage'), 'SecurityLabPage')
const NotFoundPage = load(() => import('@/pages/NotFoundPage'), 'NotFoundPage')
const ProviderHubPage = load(() => import('@/pages/ProviderHubPage'), 'ProviderHubPage')
const ResearchPage = load(() => import('@/pages/ResearchPage'), 'ResearchPage')
const SavedPage = load(() => import('@/pages/SavedPage'), 'SavedPage')
const ScriptLabPage = load(() => import('@/pages/ScriptLabPage'), 'ScriptLabPage')
const SettingsPage = load(() => import('@/pages/SettingsPage'), 'SettingsPage')
const TechPulsePage = load(() => import('@/pages/TechPulsePage'), 'TechPulsePage')
const ToolkitPage = load(() => import('@/pages/ToolkitPage'), 'ToolkitPage')
const TroubleshootingLabPage = load(() => import('@/pages/TroubleshootingLabPage'), 'TroubleshootingLabPage')
const VirtualizationPage = load(() => import('@/pages/VirtualizationPage'), 'VirtualizationPage')

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function PageFallback() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
      <img
        src="/icons/adnan-tech-favicon.svg"
        width={34}
        height={34}
        alt=""
        aria-hidden
        className="animate-pulse rounded-xl"
      />
      <span className="text-xs text-subtle">Loading…</span>
    </div>
  )
}

function PageRoutes() {
  // Keyed per route: a page that throws blanks only the content area, and
  // navigating away rebuilds the boundary instead of leaving the shell stuck.
  const { pathname } = useLocation()
  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={<PageFallback />}>
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify" element={<VerifyEmailPage />} />
            <Route path="/check-email" element={<CheckEmailPage />} />
            <Route path="/about" element={<AboutPage />} />

            <Route
              element={
                <ProtectedRoute>
                  <Outlet />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/lab" element={<TroubleshootingLabPage />} />
              <Route path="/copilot" element={<CopilotPage />} />
              <Route path="/research" element={<ResearchPage />} />
              <Route path="/solutions" element={<KnowledgePage />} />
              <Route path="/solutions/:slug" element={<ArticlePage />} />
              <Route path="/scripts" element={<ScriptLabPage />} />
              <Route path="/docs" element={<DocsHubPage />} />
              <Route path="/toolkit" element={<ToolkitPage />} />
              <Route path="/network-tools" element={<NetworkToolsPage />} />
              <Route path="/diagnostics" element={<NetworkDiagnosticsPage />} />
              <Route path="/security-lab" element={<SecurityLabPage />} />
              <Route path="/kb" element={<KnowledgeBasePage />} />
              <Route path="/windows-server" element={<DomainPage hub="windows" />} />
              <Route path="/linux-server" element={<DomainPage hub="linux" />} />
              <Route path="/microsoft-365" element={<DomainPage hub="m365" />} />
              <Route path="/cybersecurity" element={<DomainPage hub="security" />} />
              <Route path="/datacenter" element={<DomainPage hub="datacenter" />} />
              <Route path="/virtualization" element={<VirtualizationPage />} />
              <Route path="/backup" element={<DomainPage hub="backup" />} />
              <Route path="/cloud" element={<DomainPage hub="cloud" />} />
              <Route path="/news" element={<TechPulsePage />} />
              <Route path="/radar" element={<AIModelRadarPage />} />
              <Route path="/saved" element={<SavedPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/incidents" element={<IncidentsPage />} />
              <Route path="/providers" element={<ProviderHubPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute permission="users.read">
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <AppShell>
        <PageRoutes />
      </AppShell>
      <OnboardingWizard />
      <Toaster />
    </>
  )
}

export default App

