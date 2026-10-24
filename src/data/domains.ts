import type { ProblemCategory } from '@/types'
import type { TranslationKey } from '@/i18n'

export interface DomainMeta {
  id: ProblemCategory
  labelKey: TranslationKey
  route: string
  icon: string
  description: { en: string; ar: string }
  toolCategories: string[]
  accent: string
}

export const DOMAINS: DomainMeta[] = [
  {
    id: 'windows-client',
    labelKey: 'domain.windows-client',
    route: '/windows-server?domain=windows-client',
    icon: 'Monitor',
    description: {
      en: 'Boot, update, driver, performance and sign-in issues on Windows 10 and 11.',
      ar: 'مشاكل الإقلاع والتحديث والتعريفات والأداء وتسجيل الدخول في Windows 10 و11.',
    },
    toolCategories: ['windows'],
    accent: 'from-sky-500/15',
  },
  {
    id: 'windows-server',
    labelKey: 'domain.windows-server',
    route: '/windows-server?domain=windows-server',
    icon: 'Server',
    description: {
      en: 'Active Directory, DNS, DHCP, Group Policy, RDP, replication and file services.',
      ar: 'Active Directory وDNS وDHCP وGroup Policy وRDP والتكرار وخدمات الملفات.',
    },
    toolCategories: ['windows', 'server'],
    accent: 'from-blue-500/15',
  },
  {
    id: 'printing',
    labelKey: 'domain.printing',
    route: '/windows-server?domain=printing',
    icon: 'Printer',
    description: {
      en: 'Spooler failures, drivers, TCP/IP ports and shared printing on Windows Server.',
      ar: 'أعطال Spooler والتعريفات ومنافذ TCP/IP والطباعة المشتركة على Windows Server.',
    },
    toolCategories: ['windows'],
    accent: 'from-amber-500/15',
  },
  {
    id: 'microsoft-365',
    labelKey: 'domain.microsoft-365',
    route: '/microsoft-365',
    icon: 'Cloud',
    description: {
      en: 'Outlook, Teams, OneDrive, SharePoint, Exchange Online, activation and licensing.',
      ar: 'Outlook وTeams وOneDrive وSharePoint وExchange Online والتفعيل والتراخيص.',
    },
    toolCategories: ['windows'],
    accent: 'from-cyan-500/15',
  },
  {
    id: 'networking',
    labelKey: 'domain.networking',
    route: '/network-tools',
    icon: 'Network',
    description: {
      en: 'TCP/IP, DNS, DHCP, VLANs, routing, MTU, VPN and packet-level troubleshooting.',
      ar: 'TCP/IP وDNS وDHCP وVLAN والتوجيه وMTU وVPN والتشخيص على مستوى الحزم.',
    },
    toolCategories: ['network'],
    accent: 'from-teal-500/15',
  },
  {
    id: 'linux',
    labelKey: 'domain.linux',
    route: '/windows-server?domain=linux',
    icon: 'Terminal',
    description: {
      en: 'systemd, SSH, storage, packages and networking on RHEL, Ubuntu and Debian.',
      ar: 'systemd وSSH والتخزين والحزم والشبكات على RHEL وUbuntu وDebian.',
    },
    toolCategories: ['server', 'developer'],
    accent: 'from-orange-500/15',
  },
  {
    id: 'cybersecurity',
    labelKey: 'domain.cybersecurity',
    route: '/cybersecurity',
    icon: 'ShieldCheck',
    description: {
      en: 'Hardening, identity security, incident response, vulnerability management and CVEs.',
      ar: 'التحصين وأمن الهويات والاستجابة للحوادث وإدارة الثغرات وCVE.',
    },
    toolCategories: ['security'],
    accent: 'from-rose-500/15',
  },
  {
    id: 'datacenter',
    labelKey: 'domain.datacenter',
    route: '/datacenter',
    icon: 'Database',
    description: {
      en: 'VMware, Hyper-V, Proxmox, RAID, storage, clustering and capacity planning.',
      ar: 'VMware وHyper-V وProxmox وRAID والتخزين والتجميع وتخطيط السعة.',
    },
    toolCategories: ['server'],
    accent: 'from-indigo-500/15',
  },
  {
    id: 'backup-dr',
    labelKey: 'domain.backup-dr',
    route: '/backup',
    icon: 'ArchiveRestore',
    description: {
      en: '3-2-1 strategy, immutable backups, RPO/RTO, restore tests and DR runbooks.',
      ar: 'استراتيجية 3-2-1 والنسخ غير القابلة للتغيير وRPO/RTO واختبارات الاستعادة وخطط التعافي.',
    },
    toolCategories: ['server', 'data'],
    accent: 'from-emerald-500/15',
  },
  {
    id: 'cloud-devops',
    labelKey: 'domain.cloud-devops',
    route: '/cloud',
    icon: 'Container',
    description: {
      en: 'AWS, Azure, GCP, Docker, Kubernetes, Terraform, CI/CD and observability.',
      ar: 'AWS وAzure وGCP وDocker وKubernetes وTerraform وCI/CD والمراقبة.',
    },
    toolCategories: ['developer', 'data'],
    accent: 'from-violet-500/15',
  },
  {
    id: 'other',
    labelKey: 'domain.other',
    route: '/solutions',
    icon: 'Wrench',
    description: {
      en: 'Cross-domain procedures that do not fit a single platform.',
      ar: 'إجراءات عابرة للمجالات لا تنتمي إلى منصة واحدة.',
    },
    toolCategories: [],
    accent: 'from-slate-500/15',
  },
]

export function getDomain(id: ProblemCategory): DomainMeta {
  return DOMAINS.find((domain) => domain.id === id) ?? DOMAINS[DOMAINS.length - 1]
}
