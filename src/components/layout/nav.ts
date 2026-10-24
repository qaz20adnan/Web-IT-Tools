import {
  ArchiveRestore,
  BookMarked,
  BookOpen,
  Boxes,
  Cloud,
  Container,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  FolderLock,
  GraduationCap,
  History,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareCode,
  Network,
  Newspaper,
  Plug,
  Radar,
  Server,
  Settings,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  Bookmark,
  Info,
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
    id: 'workspace',
    labelKey: 'nav.group.workspace',
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
      { to: '/workspace', labelKey: 'nav.workspace', icon: FolderLock },
      { to: '/lab', labelKey: 'nav.lab', icon: FlaskConical },
      { to: '/copilot', labelKey: 'nav.copilot', icon: MessageSquareCode },
      { to: '/research', labelKey: 'nav.research', icon: LifeBuoy },
    ],
  },
  {
    id: 'knowledge',
    labelKey: 'nav.group.knowledge',
    items: [
      { to: '/solutions', labelKey: 'nav.solutions', icon: BookOpen },
      { to: '/scripts', labelKey: 'nav.scripts', icon: TerminalSquare },
      { to: '/docs', labelKey: 'nav.docs', icon: FileText },
      { to: '/toolkit', labelKey: 'nav.toolkit', icon: Wrench },
      { to: '/network-tools', labelKey: 'nav.network', icon: Network },
      { to: '/kb', labelKey: 'nav.kb', icon: BookMarked },
    ],
  },
  {
    id: 'domains',
    labelKey: 'nav.group.domains',
    items: [
      { to: '/windows-server', labelKey: 'nav.windows', icon: Server },
      { to: '/microsoft-365', labelKey: 'nav.m365', icon: Cloud },
      { to: '/cybersecurity', labelKey: 'nav.security', icon: ShieldCheck },
      { to: '/datacenter', labelKey: 'nav.datacenter', icon: Database },
      { to: '/backup', labelKey: 'nav.backup', icon: ArchiveRestore },
      { to: '/cloud', labelKey: 'nav.cloud', icon: Container },
    ],
  },
  {
    id: 'updates',
    labelKey: 'nav.group.updates',
    items: [
      { to: '/news', labelKey: 'nav.news', icon: Newspaper },
      { to: '/radar', labelKey: 'nav.radar', icon: Radar },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.group.system',
    items: [
      { to: '/saved', labelKey: 'nav.saved', icon: Bookmark },
      { to: '/history', labelKey: 'nav.history', icon: History },
      { to: '/providers', labelKey: 'nav.providers', icon: Plug },
      { to: '/settings', labelKey: 'nav.settings', icon: Settings },
      { to: '/account', labelKey: 'nav.account', icon: Info },
      { to: '/admin', labelKey: 'nav.admin', icon: ShieldCheck, permission: 'reports.read' },
      { to: '/about', labelKey: 'nav.about', icon: Info },
    ],
  },
]

export const FLAT_NAV = NAV_GROUPS.flatMap((group) => group.items)

export const EXTRA_ICONS = {
  Server,
  Cpu,
  Boxes,
  GraduationCap,
} as const

export type { LucideIcon }
