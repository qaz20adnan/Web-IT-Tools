export type Language = 'en' | 'ar'

export type ThemeId =
  | 'nexus-midnight'
  | 'cyber-pulse'
  | 'arctic-light'
  | 'graphite-pro'
  | 'deep-ocean'
  | 'emerald-console'
  | 'oled-black'
  | 'sandstone-calm'
  | 'purple-nebula'
  | 'sunset-ember'
  | 'forest-mist'
  | 'auto'

export type FontScale = 'sm' | 'md' | 'lg' | 'xl'
export type Density = 'compact' | 'comfortable' | 'spacious'
export type ExperienceLevel = 'beginner' | 'professional' | 'expert'
export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type AccentId = 'theme' | 'azure' | 'violet' | 'emerald' | 'amber' | 'rose'
export type RadiusScale = 'theme' | 'sharp' | 'soft' | 'round'
export type BackgroundStyle = 'glow' | 'plain' | 'grid' | 'dots'
export type AnimationIntensity = 'full' | 'subtle' | 'none'

export interface Settings {
  language: Language
  theme: ThemeId
  fontScale: FontScale
  density: Density
  accent: AccentId
  radius: RadiusScale
  background: BackgroundStyle
  animation: AnimationIntensity
  onboardingComplete: boolean
  reduceMotion: boolean
  storeProviderKeysInSession: boolean
  telemetryLocalOnly: boolean
}

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama' | 'custom'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  label: string
  baseUrl: string
  model: string
  fallbackModel: string
  visionModel: string
  supportsVision: boolean
  isDefault: boolean
  createdAt: string
}

export interface ProviderDraft extends Omit<ProviderConfig, 'id' | 'createdAt'> {
  apiKey: string
}

export interface HealthStatus {
  ok: boolean
  time: string
  version: string
  services: {
    ai: { configured: boolean; provider: string | null; model: string | null }
    vision: { configured: boolean }
    research: {
      configured: boolean
      providers: string[]
      grounded?: { configured: boolean; webSearchEnabled: boolean; model: string }
    }
    news: { configured: boolean; customFeeds: boolean }
    database: { configured: boolean }
    contentAdmin: { configured: boolean }
  }
}

export interface ResearchSource {
  url: string
  title: string
  host: string
}

export type WebSearchMode = 'off' | 'auto' | 'on'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  mode?: CopilotMode
  webSearch?: WebSearchMode
  meta?: {
    provider?: string
    model?: string
    tokens?: number
    engine?: string
    searchUsed?: boolean
    searchQueries?: string[]
    searchRequests?: number
    sources?: ResearchSource[]
    elapsedMs?: number
  }
}

export type CopilotMode =
  | 'beginner'
  | 'professional'
  | 'expert'
  | 'diagnostic'
  | 'script-review'
  | 'incident-response'
  | 'documentation'

export type ProblemCategory =
  | 'windows-client'
  | 'windows-server'
  | 'printing'
  | 'microsoft-365'
  | 'networking'
  | 'linux'
  | 'cybersecurity'
  | 'datacenter'
  | 'backup-dr'
  | 'cloud-devops'
  | 'other'

export interface ProblemInput {
  title: string
  description: string
  errorText: string
  logs: string
  category: ProblemCategory
  os: string
  environment: string
  recentChange: string
  experience: ExperienceLevel
  priority: Priority
  imageDataUrl?: string
  imageName?: string
}

export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type EvidenceType = 'fact' | 'inference' | 'unverified' | 'untested'

export interface Evidence {
  statement: string
  type: EvidenceType
}

export interface AnalysisCause {
  cause: string
  likelihood: 'high' | 'medium' | 'low'
  evidence: string[]
}

export interface AnalysisStep {
  order: number
  title: string
  detail: string
  command?: string
  kind: 'diagnostic' | 'change'
  risk: 'none' | 'low' | 'medium' | 'high'
  rollback?: string
}

export interface AnalysisSource {
  title: string
  url: string
  publisher?: string
  retrievedAt?: string
}

export interface AnalysisResult {
  summary: string
  category: ProblemCategory
  symptoms: string[]
  causes: AnalysisCause[]
  evidence: Evidence[]
  diagnosticSteps: AnalysisStep[]
  solutions: AnalysisStep[]
  prerequisites: string[]
  risks: string[]
  rollback: string
  missingInformation: string[]
  sources: AnalysisSource[]
  confidence: { level: ConfidenceLevel; reason: string }
  generatedAt: string
  provider: string
  model: string
  offline?: boolean
  limitations: string
}

export type VerificationStatus =
  | 'draft'
  | 'ai-generated'
  | 'source-verified'
  | 'syntax-checked'
  | 'lab-tested'
  | 'production-validated'

export interface KnowledgeArticle {
  id: string
  slug: string
  title: LocalizedText
  summary: LocalizedText
  domain: ProblemCategory
  tags: string[]
  productVersion: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  verification: VerificationStatus
  updatedAt: string
  author: string
  body: LocalizedText
  sources: AnalysisSource[]
  relatedScriptIds?: string[]
}

export interface LocalizedText {
  en: string
  ar: string
}

export type ScriptLanguage = 'powershell' | 'cmd' | 'bash' | 'python' | 'sql' | 'network'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ScriptTestStatus = 'not-executed' | 'syntax-checked' | 'lab-tested' | 'production-validated'

export interface ScriptTemplate {
  id: string
  title: LocalizedText
  description: LocalizedText
  language: ScriptLanguage
  risk: RiskLevel
  category: ProblemCategory | 'general'
  code: string
  requires: string[]
  rollback: string
  verification: 'template' | 'ai-generated' | 'reviewed' | 'tested'
  createdAt: string
  version: string
  operatingSystems?: string[]
  permissions?: string[]
  dependencies?: string[]
  expectedOutput?: LocalizedText
  usage?: LocalizedText
  validation?: LocalizedText
  sources?: AnalysisSource[]
  testStatus?: ScriptTestStatus
  testNotes?: LocalizedText
}

export interface SavedItem {
  id: string
  kind: 'article' | 'solution' | 'script' | 'news' | 'research' | 'analysis'
  title: string
  url?: string
  refId?: string
  payload?: unknown
  createdAt: string
}

export interface HistoryEntry {
  id: string
  title: string
  category: ProblemCategory
  priority: Priority
  createdAt: string
  summary: string
  analysis?: AnalysisResult
  input?: ProblemInput
}

export type KnowledgeBaseSource = 'manual' | 'troubleshooting' | 'tool'

export interface KnowledgeBaseEntry {
  id: string
  title: string
  problem: string
  solution: string
  category: ProblemCategory
  tags: string[]
  source: KnowledgeBaseSource
  createdAt: string
  updatedAt: string
}

export interface KnowledgeBaseDraft {
  id?: string
  title: string
  problem: string
  solution: string
  category: ProblemCategory
  tags: string[]
  source?: KnowledgeBaseSource
}

export interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string | null
  summary?: string
  category: string
  critical?: boolean
  fetchedAt: string
}

export interface ResearchResult {
  id: string
  title: string
  url: string
  source: string
  sourceType: 'official' | 'community' | 'informal'
  snippet: string
  publishedAt?: string | null
  retrievedAt: string
  relevance?: string
}

export interface ModelInfo {
  id: string
  provider: string
  name: string
  kind: 'chat' | 'reasoning' | 'vision' | 'code' | 'open-weights' | 'local' | 'multimodal' | 'embedding' | 'reranking'
  contextWindow: number | null
  pricing: string
  license: string
  toolCalling: 'yes' | 'partial' | 'no' | 'unknown'
  structuredOutput: 'yes' | 'partial' | 'no' | 'unknown'
  openRouterCompatible: boolean
  notes: LocalizedText
  reference: string
  verifiedAt: string
}

export type ToolCategory = 'network' | 'server' | 'windows' | 'security' | 'developer' | 'data'

export interface ToolMeta {
  id: string
  name: LocalizedText
  description: LocalizedText
  category: ToolCategory
  icon: string
  keywords: string[]
}

export interface ToastMessage {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  title?: string
  message: string
}

export type AccountRole =
  | 'owner'
  | 'admin'
  | 'super_admin'
  | 'content_manager'
  | 'technical_editor'
  | 'support_specialist'
  | 'premium_member'
  | 'standard_member'
  | 'trial_member'
  | 'suspended_member'

export type Permission =
  | 'users.read'
  | 'users.update'
  | 'users.suspend'
  | 'users.delete'
  | 'roles.assign'
  | 'content.read'
  | 'content.create'
  | 'content.update'
  | 'content.archive'
  | 'content.restore'
  | 'content.delete'
  | 'news.manage'
  | 'providers.manage'
  | 'settings.manage'
  | 'subscriptions.manage'
  | 'reports.read'
  | 'audit_logs.read'
  | 'workspace.read'
  | 'workspace.write'
  | 'ai.use'
  | 'research.read'
  | 'support.cases.read'
  | 'support.cases.update'

export type AccountStatus = 'active' | 'suspended' | 'pending'

export type FeatureKey = 'ai' | 'vision' | 'workspace' | 'research' | 'exports' | 'admin'

export interface Entitlements {
  plan: 'trial' | 'premium' | 'standard' | 'suspended'
  features: Record<FeatureKey, boolean>
  dailyAiLimit: number
  workspaceItemLimit: number
}

export interface TrialState {
  startedAt: string
  endsAt: string
  daysTotal: number
  daysRemaining: number
  hoursRemaining: number
  expired: boolean
  endingSoon: boolean
}

export interface SubscriptionState {
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired'
  planId: string
  provider: string
  currentPeriodEnd: string | null
}

export interface AccountProfile {
  id: string
  email: string
  fullName: string | null
  role: AccountRole
  status: AccountStatus
  createdAt: string | null
  emailVerified: boolean
}

export interface AccountPayload {
  configured: boolean
  databaseConfigured: boolean
  adminConfigured: boolean
  ownerConfigured: boolean
  profile: AccountProfile | null
  permissions: Permission[]
  entitlements: Entitlements | null
  trial: TrialState | null
  subscription: SubscriptionState | null
  usageToday: number
  trialDays: number
}

export interface AuthConfig {
  ok: boolean
  configured: boolean
  authConfigured: boolean
  databaseConfigured: boolean
  adminConfigured: boolean
  ownerConfigured: boolean
  trialDays: number
  siteUrl: string
  provider: 'supabase' | 'local'
  localMode: boolean
  passwordMinLength: number
  passwordMaxLength: number
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type ApiErrorCode =
  | 'not_configured'
  | 'invalid_key'
  | 'forbidden'
  | 'insufficient_credits'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_input'
  | 'payload_too_large'
  | 'blocked_host'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'already_exists'
  | 'unauthorized'
  | 'unknown'
