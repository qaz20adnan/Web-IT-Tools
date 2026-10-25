import {
  ArchiveRestore,
  BookMarked,
  BookOpen,
  Cloud,
  Container,
  Cpu,
  Database,
  FileText,
  FolderLock,
  GraduationCap,
  History,
  Info,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareCode,
  Network,
  Plug,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Activity,
  Boxes,
  GraduationCap as GradCap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/i18n'
import type { Permission } from '@/types'

export interface NavItem {
  to: string
  labelKey: TranslationKey
  icon: LucideIcon
  end?: boolean
  permission?: Permission
}

export interface NavGroup {
  id: string
  labelKey: TranslationKey
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'dashboard',
    labelKey: 'nav.group.dashboard',
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
    ],
  },
  {
    id: 'ai-copilot',
    labelKey: 'nav.group.aiCopilot',
    items: [
      { to: '/copilot', labelKey: 'nav.copilot', icon: MessageSquareCode },
      { to: '/lab', labelKey: 'nav.troubleshootingLab', icon: Sparkles },
    ],
  },
  {
    id: 'diagnostics',
    labelKey: 'nav.group.diagnostics',
    items: [
      { to: '/diagnostics', labelKey: 'nav.diagnostics', icon: Activity },
      { to: '/security-lab', labelKey: 'nav.securityLab', icon: FolderLock },
    ],
  },
  {
    id: 'assistant',
    labelKey: 'nav.group.assistant',
    items: [
      { to: '/english-coach', labelKey: 'nav.englishCoach', icon: GraduationCap },
    ],
  },
  {
    id: 'research',
    labelKey: 'nav.group.research',
    items: [
      { to: '/research', labelKey: 'nav.research', icon: LifeBuoy },
    ],
  },
  {
    id: 'servers',
    labelKey: 'nav.group.servers',
    items: [
      { to: '/windows-server', labelKey: 'nav.windows', icon: Server },
      { to: '/microsoft-365', labelKey: 'nav.m365', icon: Cloud },
      { to: '/datacenter', labelKey: 'nav.datacenter', icon: Database },
      { to: '/backup', labelKey: 'nav.backup', icon: ArchiveRestore },
      { to: '/cloud', labelKey: 'nav.cloud', icon: Container },
    ],
  },
  {
    id: 'networks',
    labelKey: 'nav.group.networks',
    items: [
      { to: '/network-tools', labelKey: 'nav.network', icon: Network },
    ],
  },
  {
    id: 'security',
    labelKey: 'nav.group.security',
    items: [
      { to: '/cybersecurity', labelKey: 'nav.security', icon: ShieldCheck },
    ],
  },
  {
    id: 'knowledge',
    labelKey: 'nav.group.knowledge',
    items: [
      { to: '/kb', labelKey: 'nav.kb', icon: BookMarked },
      { to: '/solutions', labelKey: 'nav.solutions', icon: BookOpen },
      { to: '/docs', labelKey: 'nav.docs', icon: FileText },
    ],
  },
  {
    id: 'workspace',
    labelKey: 'nav.group.workspace',
    items: [
      { to: '/workspace', labelKey: 'nav.workspace', icon: FolderLock },
      { to: '/saved', labelKey: 'nav.saved', icon: BookMarked },
      { to: '/history', labelKey: 'nav.history', icon: History },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.group.system',
    items: [
      { to: '/settings', labelKey: 'nav.settings', icon: Settings },
      { to: '/account', labelKey: 'nav.account', icon: Activity },
      { to: '/providers', labelKey: 'nav.providers', icon: Plug },
      { to: '/admin', labelKey: 'nav.admin', icon: Shield, permission: 'users.read' },
      { to: '/about', labelKey: 'nav.about', icon: Info },
    ],
  },
]

export const FLAT_NAV = NAV_GROUPS.flatMap((group) => group.items)

export const EXTRA_ICONS = {
  Server,
  Cpu,
  Boxes,
  GraduationCap: GradCap,
} as const

export type { LucideIcon }
