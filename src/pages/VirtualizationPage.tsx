import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Gauge,
  HardDrive,
  Info,
  MemoryStick,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Stat,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { readJson, scopedStorageKey, writeJson } from '@/lib/storage'
import { uid } from '@/lib/utils'

/* ------------------------------- Model ------------------------------- */

type Hypervisor = 'vmware' | 'hyperv' | 'proxmox'

interface VmRow {
  id: string
  name: string
  vcpu: number
  ramGb: number
  storageGb: number
  hypervisor: Hypervisor
}

interface HostConfig {
  hostRamGb: number
  hostPhysicalCores: number
  thinProvisioned: boolean
}

interface ChecklistData {
  checked: Record<string, boolean>
  snapshotDays: number
  datastoreThresholdPct: number
}

interface MigrationData {
  vmCount: number
  avgRamGb: number
  windowMinutes: number
  throughputMBps: number
}

interface VirtualizationState {
  vms: VmRow[]
  host: HostConfig
  checklist: ChecklistData
  migration: MigrationData
}

const STORAGE_KEY = 'nexora.virtualization.v1'

const HYPERVISORS: Array<{ id: Hypervisor; label: [string, string] }> = [
  { id: 'vmware', label: ['VMware vSphere', 'VMware vSphere'] },
  { id: 'hyperv', label: ['Microsoft Hyper-V', 'Microsoft Hyper-V'] },
  { id: 'proxmox', label: ['Proxmox VE', 'Proxmox VE'] },
]

const CHECKLIST_ITEMS: Array<{
  id: string
  text: (ctx: { snap: number; ds: number }) => [string, string]
  detail: [string, string]
}> = [
  {
    id: 'snapshots',
    text: ({ snap }) => [
      `No snapshots older than ${snap} days left running`,
      `لا توجد لقطات أقدم من ${snap} يومًا متروكة قيد التشغيل`,
    ],
    detail: [
      'Long-lived snapshots hurt performance and grow delta chains; consolidate or remove them.',
      'اللقطات طويلة الأمد تُضعف الأداء وتُضخّم سلاسل الفروق؛ قم بدمجها أو حذفها.',
    ],
  },
  {
    id: 'tools',
    text: () => [
      'VMware Tools / Integration Services current on all guests',
      'أدوات VMware / خدمات التكامل محدَّثة على جميع الضيوف',
    ],
    detail: [
      'Outdated guest agents break quiesced backups, graceful shutdown and time sync.',
      'الوكلاء القدماء داخل الضيف يُعطّلون النسخ الاحتياطي المتسق والإيقاف السلس ومزامنة الوقت.',
    ],
  },
  {
    id: 'datastores',
    text: ({ ds }) => [
      `No datastore above ${ds}% used capacity`,
      `لا يوجد مخزن بيانات تجاوزت مساحته المستخدمة ${ds}%`,
    ],
    detail: [
      'Near-full datastores risk snapshot/backup failures and VM stun; keep headroom and alerts.',
      'المخازن الممتلئة تقريبًا تُعرّض اللقطات والنسخ للفشل وتُجمّد الأجهزة؛ حافظ على هامش وتنبيهات.',
    ],
  },
  {
    id: 'backup',
    text: () => [
      'Backup jobs verified with a recent test restore',
      'وظائف النسخ الاحتياطي تم التحقق منها باستعادة تجريبية حديثة',
    ],
    detail: [
      'Unverified backups are guesses; restore a sample to prove recoverability.',
      'النسخ غير المتحقق منها مجرد تخمين؛ استعِن بعينة لإثبات قابلية الاستعادة.',
    ],
  },
  {
    id: 'ha',
    text: () => [
      'HA failover capacity reserved for the planned number of host failures',
      'سعة توافُل HA محجوزة لعدد أعطال المضيف المخطط',
    ],
    detail: [
      'Confirm admission control leaves enough CPU/RAM slots to restart affected VMs.',
      'تأكد من أن تحكم القبول يترك مجالا كافية لوحدة المعالجة والذاكرة لإعادة تشغيل الأجهزة المتأثرة.',
    ],
  },
  {
    id: 'ntp',
    text: () => [
      'NTP synchronized on every host (not just the first)',
      'NTP متزامن على كل مضيف (وليس الأول فقط)',
    ],
    detail: [
      'Clock skew across hosts corrupts logs, authentication and cluster health checks.',
      'انحراف الساعة بين المضيفين يُفسد السجلات والمصادقة وفحوص صحة العنقود.',
    ],
  },
  {
    id: 'firmware',
    text: () => [
      'Firmware / BIOS baselines aligned across hosts',
      'العتثية الثابتة / BIOS متوافقة عبر المضيفين',
    ],
    detail: [
      'Mixed firmware levels cause EVC/CPU feature mismatches that block live migration.',
      'اختلاف مستويات العثية يسبّب عدم تطابق ميزات المعالج الذي يمنع النقل الحي.',
    ],
  },
  {
    id: 'vlan',
    text: () => [
      'VM network port-group / VLAN sanity (IDs and uplink redundancy)',
      'سلامة مجموعات منافذ شبكة الأجهزة / VLAN (المعرّفات وتكرار الوصلات الصاعدة)',
    ],
    detail: [
      'Verify VLAN IDs, trunk ranges and at least two uplinks so a path loss is survivable.',
      'تحقق من معرّفات VLAN ونطاقات الوصلة الواحدة ووصلة صاعدة واحدة على الأقل ليعمر فقد المسار.',
    ],
  },
]

const DEFAULT_STATE: VirtualizationState = {
  vms: [
    { id: uid('vm'), name: 'APP-DB-01', vcpu: 8, ramGb: 32, storageGb: 500, hypervisor: 'vmware' },
    { id: uid('vm'), name: 'WEB-02', vcpu: 2, ramGb: 4, storageGb: 60, hypervisor: 'hyperv' },
  ],
  host: { hostRamGb: 256, hostPhysicalCores: 24, thinProvisioned: true },
  checklist: { checked: {}, snapshotDays: 7, datastoreThresholdPct: 80 },
  migration: { vmCount: 8, avgRamGb: 16, windowMinutes: 30, throughputMBps: 500 },
}

function toNum(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function clampInt(value: number, min: number): number {
  if (!Number.isFinite(value) || value < min) return min
  return Math.floor(value)
}

function isVmRow(value: unknown): value is VmRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<VmRow>
  return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.vcpu === 'number'
}

function normalizeState(raw: unknown): VirtualizationState {
  const base = DEFAULT_STATE
  if (!raw || typeof raw !== 'object') return base
  const data = raw as Partial<VirtualizationState>
  const vms = Array.isArray(data.vms) ? data.vms.filter(isVmRow) : base.vms
  return {
    vms: vms.length ? vms : base.vms,
    host: {
      hostRamGb: typeof data.host?.hostRamGb === 'number' ? data.host.hostRamGb : base.host.hostRamGb,
      hostPhysicalCores:
        typeof data.host?.hostPhysicalCores === 'number' ? data.host.hostPhysicalCores : base.host.hostPhysicalCores,
      thinProvisioned: typeof data.host?.thinProvisioned === 'boolean' ? data.host.thinProvisioned : base.host.thinProvisioned,
    },
    checklist: {
      checked: data.checklist?.checked && typeof data.checklist.checked === 'object' ? data.checklist.checked : {},
      snapshotDays:
        typeof data.checklist?.snapshotDays === 'number' ? clampInt(data.checklist.snapshotDays, 1) : base.checklist.snapshotDays,
      datastoreThresholdPct:
        typeof data.checklist?.datastoreThresholdPct === 'number'
          ? Math.min(100, Math.max(1, Math.round(data.checklist.datastoreThresholdPct)))
          : base.checklist.datastoreThresholdPct,
    },
    migration: {
      vmCount: typeof data.migration?.vmCount === 'number' ? Math.max(0, Math.round(data.migration.vmCount)) : base.migration.vmCount,
      avgRamGb: typeof data.migration?.avgRamGb === 'number' ? data.migration.avgRamGb : base.migration.avgRamGb,
      windowMinutes:
        typeof data.migration?.windowMinutes === 'number' ? data.migration.windowMinutes : base.migration.windowMinutes,
      throughputMBps:
        typeof data.migration?.throughputMBps === 'number' ? data.migration.throughputMBps : base.migration.throughputMBps,
    },
  }
}

/* --------------------------- Right-sizing math --------------------------- */

type NoteKind = 'over' | 'under'

interface VmEvaluation {
  vm: VmRow
  notes: Array<{ kind: NoteKind; text: [string, string] }>
}

function evaluateVm(vm: VmRow, host: HostConfig): VmEvaluation {
  const notes: VmEvaluation['notes'] = []
  const cores = host.hostPhysicalCores

  if (vm.vcpu > 8 && cores > 0 && cores < 16) {
    notes.push({
      kind: 'over',
      text: [
        'More than 8 vCPUs on one VM while the host has fewer than 16 physical cores.',
        'أكثر من 8 وحدات معالجة افتراضية على جهاز واحد بينما يملك المضيف أقل من 16 نواة فعلية.',
      ],
    })
  }
  if (cores > 0 && vm.vcpu > cores) {
    notes.push({
      kind: 'over',
      text: [
        'Single VM requests more vCPUs than the host has physical cores — expect co-scheduling contention.',
        'جهاز واحد يطلب وحدات معالجة افتراضية أكثر من الأنوية الفعلية للمضيف — توقّع تنافسًا في الجدولة.',
      ],
    })
  }
  if (vm.ramGb >= 32) {
    notes.push({
      kind: 'over',
      text: [
        'Large RAM allocation — a candidate for balloon / idle-memory review (measure real guest usage first).',
        'تخصيص ذاكرة كبير — مرشّح لمراجعة بالوننغ/الاسترداد للذاكرة الخاملة (قِس الاستخدام الفعلي للضيف أولًا).',
      ],
    })
  }
  if (vm.storageGb >= 500 && !host.thinProvisioned) {
    notes.push({
      kind: 'over',
      text: [
        'Large thick-provisioned disk — consider thin provisioning once datastore headroom is confirmed.',
        'قرص كبير بتهيئة سميكة — فكّر في التهيئة الرقيقة بعد التأكد من هامش مساحة مخزن البيانات.',
      ],
    })
  }
  if (vm.ramGb > 0 && vm.ramGb < 2) {
    notes.push({
      kind: 'under',
      text: [
        'Under 2 GB RAM — often under-provisioned for a modern server guest; validate against the workload.',
        'أقل من 2 جيجابايت ذاكرة — غالبًا أقل من اللازم لضيف خادم حديث؛ تحقّق مقابل حجم العمل.',
      ],
    })
  }
  return { vm, notes }
}

/* -------------------------------- Page -------------------------------- */

export function VirtualizationPage() {
  const { settings } = useApp()
  const { account } = useAuth()
  const { notify } = useToast()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)

  const userId = account?.profile?.id ?? null
  const storageKey = useMemo(() => scopedStorageKey(STORAGE_KEY, userId), [userId])

  const [data, setData] = useState<VirtualizationState>(() => normalizeState(readJson<unknown>(storageKey, DEFAULT_STATE)))
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    writeJson(storageKey, data)
  }, [storageKey, data])

  const setVm = (id: string, patch: Partial<VmRow>) =>
    setData((current) => ({ ...current, vms: current.vms.map((row) => (row.id === id ? { ...row, ...patch } : row)) }))

  const addVm = () =>
    setData((current) => ({
      ...current,
      vms: [...current.vms, { id: uid('vm'), name: '', vcpu: 2, ramGb: 4, storageGb: 60, hypervisor: 'vmware' }],
    }))

  const removeVm = (id: string) => setData((current) => ({ ...current, vms: current.vms.filter((row) => row.id !== id) }))

  const setHost = (patch: Partial<HostConfig>) => setData((current) => ({ ...current, host: { ...current.host, ...patch } }))

  const setChecklist = (patch: Partial<ChecklistData>) =>
    setData((current) => ({ ...current, checklist: { ...current.checklist, ...patch } }))

  const toggleCheck = (id: string) =>
    setData((current) => ({
      ...current,
      checklist: { ...current.checklist, checked: { ...current.checklist.checked, [id]: !current.checklist.checked[id] } },
    }))

  const setMigration = (patch: Partial<MigrationData>) =>
    setData((current) => ({ ...current, migration: { ...current.migration, ...patch } }))

  const sizing = useMemo(() => {
    const totalVcpu = data.vms.reduce((sum, vm) => sum + vm.vcpu, 0)
    const totalRam = data.vms.reduce((sum, vm) => sum + vm.ramGb, 0)
    const totalStorage = data.vms.reduce((sum, vm) => sum + vm.storageGb, 0)
    const memRatio = data.host.hostRamGb > 0 ? totalRam / data.host.hostRamGb : null
    const vcpuRatio = data.host.hostPhysicalCores > 0 ? totalVcpu / data.host.hostPhysicalCores : null
    const evaluations = data.vms.map((vm) => evaluateVm(vm, data.host))
    return { totalVcpu, totalRam, totalStorage, memRatio, vcpuRatio, evaluations }
  }, [data.vms, data.host])

  const migration = useMemo(() => {
    const { vmCount, avgRamGb, windowMinutes, throughputMBps } = data.migration
    const totalRamGb = vmCount * avgRamGb
    const totalRamMb = totalRamGb * 1024
    const windowSeconds = windowMinutes * 60
    const drainSeconds = throughputMBps > 0 ? totalRamMb / throughputMBps : null
    const drainMinutes = drainSeconds === null ? null : drainSeconds / 60
    const bufferMinutes = drainMinutes === null ? null : windowMinutes - drainMinutes
    const fits = drainMinutes !== null && drainMinutes <= windowMinutes
    const tight = fits && bufferMinutes !== null && bufferMinutes < windowMinutes * 0.1
    const requiredThroughput = windowSeconds > 0 && totalRamMb > 0 ? totalRamMb / windowSeconds : null
    return { totalRamGb, totalRamMb, drainSeconds, drainMinutes, bufferMinutes, fits, tight, requiredThroughput }
  }, [data.migration])

  const checkedCount = CHECKLIST_ITEMS.filter((item) => data.checklist.checked[item.id]).length
  const checklistPercent = CHECKLIST_ITEMS.length ? Math.round((checkedCount / CHECKLIST_ITEMS.length) * 100) : 0

  const resetChecklist = () => {
    setData((current) => ({ ...current, checklist: { ...current.checklist, checked: {} } }))
    notify('success', L('Checklist reset.', 'تمت إعادة ضبط القائمة.'))
  }

  const ratioTone = (ratio: number | null): 'success' | 'warning' | undefined => {
    if (ratio === null) return undefined
    if (ratio > 1) return 'warning'
    return 'success'
  }

  const fmt = (value: number, digits = 2): string => value.toLocaleString(undefined, { maximumFractionDigits: digits })

  return (
    <div className="animate-in space-y-4">
      <PageHeader
        title={L('Virtualization & Hypervisor Planner', 'مخطط افتراضية ومضيف افتراضي')}
        subtitle={L(
          'A local sizing, inspection and maintenance-window aid for VMware vSphere, Microsoft Hyper-V and Proxmox VE. It does not connect to or discover real hosts.',
          'أداة محلية لحجم الموارد والفحص ونافذة الصيانة لبيئات VMware vSphere وMicrosoft Hyper-V وProxmox VE. لا تتصل بمضيفين حقيقيين ولا تكتشفهم.',
        )}
        badge={<Boxes className="h-5 w-5 text-primary" />}
        actions={
          <Button variant="secondary" size="sm" icon={<Info className="h-3.5 w-3.5" />} onClick={() => setInfoOpen(true)}>
            {L('How it decides', 'كيف تُقرّر')}
          </Button>
        }
      />

      <Alert tone="info" title={L('Planning aid, not monitoring', 'أداة تخطيط وليست مراقبة')}>
        {L(
          'Every figure is computed from what you type, in your browser, and saved only on this device. The checks below are general engineering guidance — validate them against your own measured guest usage and vendor documentation before acting.',
          'كل الأرقام تُحسب مما تكتبه في متصفحك وتُحفظ على هذا الجهاز فقط. الفحوص أدناه إرشادات هندسية عامة — راجِعها مقابل الاستخدام الفعلي المقاس لضيوفك ووثائق المورد قبل اتخاذ إجراء.',
        )}
      </Alert>

      {/* --------------------------- 1. Rightsizing --------------------------- */}

      <Card>
        <CardHeader
          title={L('VM rightsizing calculator', 'حاسبة ضبط حجم الأجهزة الافتراضية')}
          subtitle={L('Enter each VM and the host spec to spot over- and under-provisioning.', 'أدخل كل جهاز ومواصفات المضيف للكشف عن الإفراط أو النقص في التخصيص.')}
          icon={<Cpu className="h-4 w-4" />}
          actions={
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={addVm}>
              {L('Add VM', 'إضافة جهاز')}
            </Button>
          }
        />

        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={L('Host RAM (GB)', 'ذاكرة المضيف (GB)')} htmlFor="host-ram">
            <Input
              id="host-ram"
              type="number"
              min={0}
              dir="ltr"
              value={data.host.hostRamGb}
              onChange={(event) => setHost({ hostRamGb: toNum(event.target.value) })}
            />
          </Field>
          <Field label={L('Host physical cores', 'أنوية المضيف الفعلية')} htmlFor="host-cores">
            <Input
              id="host-cores"
              type="number"
              min={0}
              dir="ltr"
              value={data.host.hostPhysicalCores}
              onChange={(event) => setHost({ hostPhysicalCores: toNum(event.target.value) })}
            />
          </Field>
          <div className="flex items-end">
            <Checkbox
              className="w-full"
              checked={data.host.thinProvisioned}
              onChange={(event) => setHost({ thinProvisioned: event.target.checked })}
              label={L('Thin provisioning assumed', 'نفترض التهيئة الرقيقة')}
              description={L('Drives the storage note and disk heuristic.', 'تحرّك ملاحظة التخزين وقاعدة الأقراص.')}
            />
          </div>
        </div>

        {data.vms.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Boxes className="h-6 w-6" />}
              title={L('No VMs yet', 'لا توجد أجهزة بعد')}
              description={L('Add a VM to start sizing the host.', 'أضف جهازًا لبدء تخطيط حجم المضيف.')}
              action={
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={addVm}>
                  {L('Add VM', 'إضافة جهاز')}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto border-b border-line">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-start text-subtle">
                  <th className="p-2 text-start">{L('Name', 'الاسم')}</th>
                  <th className="p-2 text-start">{L('vCPU', 'vCPU')}</th>
                  <th className="p-2 text-start">{L('RAM (GB)', 'الذاكرة (GB)')}</th>
                  <th className="p-2 text-start">{L('Disk (GB)', 'القرص (GB)')}</th>
                  <th className="p-2 text-start">{L('Hypervisor', 'المضيف الافتراضي')}</th>
                  <th className="p-2 text-start">{L('Guidance', 'الإرشاد')}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {sizing.evaluations.map(({ vm, notes }) => {
                  const over = notes.filter((note) => note.kind === 'over').length
                  const under = notes.filter((note) => note.kind === 'under').length
                  const tone = notes.length === 0 ? 'success' : under > 0 && over > 0 ? 'danger' : over > 0 ? 'warning' : 'danger'
                  const label =
                    notes.length === 0
                      ? L('Balanced', 'متوازن')
                      : over > 0 && under > 0
                        ? L('Review both', 'راجع الاثنين')
                        : over > 0
                          ? L('Over-provisioned', 'إفراط في التخصيص')
                          : L('Under-provisioned', 'نقص في التخصيص')
                  return (
                    <tr key={vm.id} className="border-t border-line align-top">
                      <td className="p-1">
                        <Input aria-label={L('VM name', 'اسم الجهاز')} value={vm.name} onChange={(event) => setVm(vm.id, { name: event.target.value })} dir="ltr" />
                      </td>
                      <td className="p-1">
                        <Input
                          aria-label={L('vCPU cores', 'أنوية vCPU')}
                          type="number"
                          min={0}
                          dir="ltr"
                          value={vm.vcpu}
                          onChange={(event) => setVm(vm.id, { vcpu: toNum(event.target.value) })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          aria-label={L('RAM in GB', 'الذاكرة بالجيجابايت')}
                          type="number"
                          min={0}
                          dir="ltr"
                          value={vm.ramGb}
                          onChange={(event) => setVm(vm.id, { ramGb: toNum(event.target.value) })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          aria-label={L('Provisioned storage in GB', 'التخزين المُهيّأ بالجيجابايت')}
                          type="number"
                          min={0}
                          dir="ltr"
                          value={vm.storageGb}
                          onChange={(event) => setVm(vm.id, { storageGb: toNum(event.target.value) })}
                        />
                      </td>
                      <td className="p-1">
                        <Select
                          aria-label={L('Hypervisor', 'المضيف الافتراضي')}
                          value={vm.hypervisor}
                          onChange={(event) => setVm(vm.id, { hypervisor: event.target.value as Hypervisor })}
                        >
                          {HYPERVISORS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {L(option.label[0], option.label[1])}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="p-2">
                        <Badge tone={tone}>{label}</Badge>
                        {notes.length > 0 ? (
                          <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-muted">
                            {notes.map((note, index) => (
                              <li key={index}>{L(note.text[0], note.text[1])}</li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="p-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={L('Remove VM', 'إزالة الجهاز')}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => removeVm(vm.id)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={L('VMs / total vCPU', 'الأجهزة / إجمالي vCPU')}
            value={`${data.vms.length} / ${fmt(sizing.totalVcpu, 0)}`}
            icon={<Cpu className="h-4 w-4" />}
            tone="primary"
          />
          <Stat
            label={L('Total RAM / disk (GB)', 'إجمالي الذاكرة/القرص (GB)')}
            value={`${fmt(sizing.totalRam, 0)} / ${fmt(sizing.totalStorage, 0)}`}
            icon={<MemoryStick className="h-4 w-4" />}
          />
          <Stat
            label={L('Memory overcommit', 'الإفراط في تخصيص الذاكرة')}
            value={sizing.memRatio === null ? '—' : `${fmt(sizing.memRatio)} : 1`}
            hint={L('total VM RAM ÷ host RAM', 'إجمالي ذاكرة الأجهزة ÷ ذاكرة المضيف')}
            icon={<Gauge className="h-4 w-4" />}
            tone={ratioTone(sizing.memRatio)}
          />
          <Stat
            label={L('vCPU : physical core', 'vCPU : نواة فعلية')}
            value={sizing.vcpuRatio === null ? '—' : `${fmt(sizing.vcpuRatio)} : 1`}
            hint={L('total vCPU ÷ host cores', 'إجمالي vCPU ÷ أنوية المضيف')}
            icon={<Cpu className="h-4 w-4" />}
            tone={sizing.vcpuRatio !== null && sizing.vcpuRatio > 3 ? 'warning' : 'success'}
          />
        </div>

        <div className="space-y-2 px-4 pb-4">
          {sizing.memRatio !== null ? (
            <Alert
              tone={sizing.memRatio > 1.5 ? 'danger' : sizing.memRatio > 1 ? 'warning' : 'success'}
              title={L('Memory overcommit guidance', 'إرشاد الإفراط في الذاكرة')}
            >
              {sizing.memRatio <= 1
                ? L(
                    'Aggregate VM RAM is within the host RAM you entered — no oversubscription implied.',
                    'إجمالي ذاكرة الأجهزة ضمن ذاكرة المضيف المُدخلة — لا وجود لإفراط ضمني.',
                  )
                : L(
                    'You are above 1:1. Moderate oversubscription is common with ballooning / idle reclamation, but ratios well above ~1.5:1 typically need memory headroom, larger pages or more hosts. This is general guidance, not a vendor limit.',
                    'أنت فوق نسبة 1:1. الإفراط المعتاد شائع مع تقنيات البالوننغ واسترداد الذاكرة الخاملة، لكن النسب الأعلى بكثير من نحو 1.5:1 تتطلب عادةً هامش ذاكرة أكبر أو صفائح كبيرة أو مضيفين أكثر. هذا إرشاد عام وليس حدًّا للمورد.',
                  )}
            </Alert>
          ) : (
            <Alert tone="warning">{L('Enter the host RAM and physical cores to compute the ratios.', 'أدخل ذاكرة المضيف والأنوية الفعلية لحساب النسب.')}</Alert>
          )}

          <Alert tone="info" title={L('Thin vs thick storage', 'التخزين الرقيق مقابل السميك')}>
            {data.host.thinProvisioned
              ? L(
                  `Thin provisioning is assumed for about ${fmt(sizing.totalStorage, 0)} GB. It reclaims datastore space but risks over-commitment as guests grow — keep free-space alerts and plan for worst-case thick consumption.`,
                  `نفترض التهيئة الرقيقة لنحو ${fmt(sizing.totalStorage, 0)} جيجابايت. تستعيد مساحة مخزن البيانات لكنها تخاطر بالتجاوز مع نمو الضيوف — أبقِ تنبيهات المساحة وخطّط لأسوأ استهلاك سميك.`,
                )
              : L(
                  `Thick provisioning is assumed for about ${fmt(sizing.totalStorage, 0)} GB. It reserves capacity up front — predictable, but consumes the full figure regardless of guest usage.`,
                  `نفترض التهيئة السميكة لنحو ${fmt(sizing.totalStorage, 0)} جيجابايت. تحجز السعة مسبقًا — متوقعة، لكنها تستهلك الرقم بالكامل بصرف النظر عن استخدام الضيف.`,
                )}
          </Alert>
        </div>
      </Card>

      {/* --------------------------- 2. Checklist --------------------------- */}

      <Card>
        <CardHeader
          title={L('Operational inspection checklist', 'قائمة فحص تشغيلية')}
          subtitle={L('Tick each hypervisor maintenance check. Progress is saved on this device.', 'ضع علامة على كل فحص صيانة للمضيف الافتراضي. يُحفظ التقدّم على هذا الجهاز.')}
          icon={<ClipboardCheck className="h-4 w-4" />}
          actions={
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={resetChecklist}>
              {L('Reset', 'إعادة ضبط')}
            </Button>
          }
        />

        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L('Snapshot age threshold (days)', 'عتبة عمر اللقطة (أيام)')} htmlFor="snap-days">
              <Input
                id="snap-days"
                type="number"
                min={1}
                dir="ltr"
                value={data.checklist.snapshotDays}
                onChange={(event) => setChecklist({ snapshotDays: clampInt(toNum(event.target.value), 1) })}
              />
            </Field>
            <Field label={L('Datastore full threshold (%)', 'عتبة امتلاء مخزن البيانات (%)')} htmlFor="ds-threshold">
              <Input
                id="ds-threshold"
                type="number"
                min={1}
                max={100}
                dir="ltr"
                value={data.checklist.datastoreThresholdPct}
                onChange={(event) => setChecklist({ datastoreThresholdPct: Math.min(100, Math.max(1, Math.round(toNum(event.target.value)))) })}
              />
            </Field>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium">
                {L('Progress', 'التقدّم')} — {checkedCount}/{CHECKLIST_ITEMS.length}
              </span>
              <span className="text-subtle" dir="ltr">
                {checklistPercent}%
              </span>
            </div>
            <div className="nx-progress" role="progressbar" aria-valuenow={checklistPercent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${checklistPercent}%` }} />
            </div>
          </div>

          <div className="space-y-2.5">
            {CHECKLIST_ITEMS.map((item) => {
              const text = item.text({ snap: data.checklist.snapshotDays, ds: data.checklist.datastoreThresholdPct })
              return (
                <Checkbox
                  key={item.id}
                  checked={Boolean(data.checklist.checked[item.id])}
                  onChange={() => toggleCheck(item.id)}
                  label={L(text[0], text[1])}
                  description={L(item.detail[0], item.detail[1])}
                  className="rounded-lg border border-line bg-surface-2 p-3"
                />
              )
            })}
          </div>

          {checkedCount === CHECKLIST_ITEMS.length ? (
            <Alert tone="success" title={L('Checklist complete', 'اكتملت القائمة')}>
              {L('All maintenance checks are ticked. Re-run after any host or cluster change.', 'كل فحوص الصيانة مُعلَّمة. أعد الفحص بعد أي تغيير في المضيف أو العنقود.')}
            </Alert>
          ) : null}
        </div>
      </Card>

      {/* --------------------------- 3. Migration planner --------------------------- */}

      <Card>
        <CardHeader
          title={L('Migration / maintenance window planner', 'مخطط النقل / نافذة الصيانة')}
          subtitle={L('Estimate whether draining VMs off a host fits the window, and see the arithmetic.', 'قدّر ما إذا كان تفريغ الأجهزة من مضيف يلائم النافذة، مع عرض الحسابات.')}
          icon={<ArrowLeftRight className="h-4 w-4" />}
        />

        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={L('VMs to migrate', 'عدد الأجهزة للنقل')} htmlFor="mg-count">
            <Input
              id="mg-count"
              type="number"
              min={0}
              dir="ltr"
              value={data.migration.vmCount}
              onChange={(event) => setMigration({ vmCount: Math.round(toNum(event.target.value)) })}
            />
          </Field>
          <Field label={L('Average RAM per VM (GB)', 'متوسط ذاكرة كل جهاز (GB)')} htmlFor="mg-ram">
            <Input
              id="mg-ram"
              type="number"
              min={0}
              dir="ltr"
              value={data.migration.avgRamGb}
              onChange={(event) => setMigration({ avgRamGb: toNum(event.target.value) })}
            />
          </Field>
          <Field label={L('Maintenance window (minutes)', 'نافذة الصيانة (دقائق)')} htmlFor="mg-window">
            <Input
              id="mg-window"
              type="number"
              min={0}
              dir="ltr"
              value={data.migration.windowMinutes}
              onChange={(event) => setMigration({ windowMinutes: toNum(event.target.value) })}
            />
          </Field>
          <Field label={L('Migration throughput (MB/s)', 'إنتاجية النقل (MB/s)')} htmlFor="mg-throughput">
            <Input
              id="mg-throughput"
              type="number"
              min={0}
              dir="ltr"
              value={data.migration.throughputMBps}
              onChange={(event) => setMigration({ throughputMBps: toNum(event.target.value) })}
            />
          </Field>
        </div>

        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={L('Memory to move', 'الذاكرة المنقولة')} value={`${fmt(migration.totalRamGb, 0)} GB`} hint={`${fmt(migration.totalRamMb, 0)} MB`} icon={<MemoryStick className="h-4 w-4" />} tone="primary" />
          <Stat
            label={L('Estimated drain', 'التفريغ المقدّر')}
            value={migration.drainMinutes === null ? '—' : `${fmt(migration.drainMinutes, 1)} min`}
            hint={migration.drainSeconds === null ? L('set a throughput', 'حدّد إنتاجية') : `${fmt(migration.drainSeconds, 0)} s`}
            icon={<Gauge className="h-4 w-4" />}
          />
          <Stat
            label={L('Window', 'النافذة')}
            value={`${fmt(data.migration.windowMinutes, 0)} min`}
            icon={<CalendarClock className="h-4 w-4" />}
          />
          <Stat
            label={L('Margin', 'الهامش')}
            value={migration.bufferMinutes === null ? '—' : `${fmt(migration.bufferMinutes, 1)} min`}
            tone={migration.bufferMinutes === null ? undefined : migration.bufferMinutes < 0 ? 'warning' : 'success'}
            icon={<HardDrive className="h-4 w-4" />}
          />
        </div>

        <div className="space-y-3 px-4 pb-4">
          <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs" dir="ltr">
            <p className="mb-1 font-semibold text-subtle" dir={settings.language === 'ar' ? 'rtl' : 'ltr'}>
              {L('Arithmetic', 'الحساب')}
            </p>
            <p>
              {`${data.migration.vmCount} × ${fmt(data.migration.avgRamGb, 2)} GB = ${fmt(migration.totalRamGb, 2)} GB`} = {`${fmt(migration.totalRamMb, 0)} MB`}
            </p>
            <p>
              {data.migration.throughputMBps > 0
                ? `${fmt(migration.totalRamMb, 0)} MB ÷ ${fmt(data.migration.throughputMBps, 0)} MB/s = ${fmt(migration.drainSeconds ?? 0, 0)} s ≈ ${fmt(migration.drainMinutes ?? 0, 1)} min`
                : L('Enter a throughput greater than zero.', 'أدخل إنتاجية أكبر من صفر.')}
            </p>
          </div>

          {migration.drainMinutes === null ? (
            <Alert tone="warning">{L('Set a migration throughput greater than zero to estimate the drain.', 'حدّد إنتاجية نقل أكبر من صفر لتقدير زمن التفريغ.')}</Alert>
          ) : migration.fits ? (
            <Alert tone={migration.tight ? 'warning' : 'success'} title={migration.tight ? L('Fits, but tight', 'يلزم لكن بشدّة') : L('Fits the window', 'يلزم النافذة')}>
              {migration.tight
                ? L(
                    `The drain (~${fmt(migration.drainMinutes, 1)} min) is under the window but leaves little slack — plan for pre-copy rounds, guest dirty-page rate and brief downtime.`,
                    `التفريغ (~${fmt(migration.drainMinutes, 1)} دقيقة) أقل من النافذة لكن بهامش ضئيل — خطّط لجولات النسخ المسبق ومعدل صفحات الضيف المتغيّرة وتوقف قصير.`,
                  )
                : L(
                    `The drain (~${fmt(migration.drainMinutes, 1)} min) fits within the ${fmt(data.migration.windowMinutes, 0)}-minute window with ~${fmt(migration.bufferMinutes ?? 0, 1)} min to spare.`,
                    `التفريغ (~${fmt(migration.drainMinutes, 1)} دقيقة) يلائم نافذة ${fmt(data.migration.windowMinutes, 0)} دقيقة بهامش ~${fmt(migration.bufferMinutes ?? 0, 1)} دقيقة.`,
                  )}
            </Alert>
          ) : (
            <Alert tone="danger" title={L('Drain exceeds the window', 'التفريغ يتجاوز النافذة')}>
              {L(
                `About ${fmt(migration.drainMinutes, 1)} min is needed for a ${fmt(data.migration.windowMinutes, 0)}-min window. To fit, raise throughput to roughly ${fmt(migration.requiredThroughput ?? 0, 0)} MB/s or extend the window.`,
                `يلزم نحو ${fmt(migration.drainMinutes, 1)} دقيقة لنافذة ${fmt(data.migration.windowMinutes, 0)} دقيقة. ولإدخالها ضمن النافذة ارفع الإنتاجية إلى نحو ${fmt(migration.requiredThroughput ?? 0, 0)} MB/s أو وسّع النافذة.`,
              )}
            </Alert>
          )}

          <p className="text-[11px] text-subtle">
            {L(
              'Live migration transfers the running memory and working set, not the provisioned disk. This estimate ignores iterative pre-copy and dirty-page convergence, so treat the result as a lower bound.',
              'النقل الحي ينقل الذاكرة العاملة أثناء التشغيل وليس القرص المُهيّأ. هذا التقدير يتجاهل النسخ المسبق المتكرر وتقارب الصفحات المتغيّرة، لذا عُدّ النتيجة حدًّا أدنى.',
            )}
          </p>
        </div>
      </Card>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-[11px] text-subtle">
        <ArrowRight className="h-3 w-3" />
        {L('Results are advisory. Confirm sizing, snapshots and windows against live metrics before you change production.', 'النتائج استرشادية. تأكّد من الحجم واللقطات والنوافذ مقابل القياسات الحيّة قبل تغيير بيئة الإنتاج.')}
      </p>

      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={L('How these checks are derived', 'كيف تُشتَقّ هذه الفحوص')}
        footer={
          <Button size="sm" variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setInfoOpen(false)}>
            {L('Close', 'إغلاق')}
          </Button>
        }
      >
        <div className="space-y-3 text-sm">
          <Alert tone="info" title={L('Nothing here talks to your hosts', 'لا شيء هنا يتصل بمضيفيك')}>
            {L(
              'This page is an offline calculator and checklist. It never connects to, authenticates against, or discovers vSphere, Hyper-V or Proxmox systems.',
              'هذه الصفحة حاسبة وقائمة فحص غير متصلة. لا تتصل مطلقًا بأنظمة vSphere أو Hyper-V أو Proxmox ولا تتحقق من هويتها ولا تكتشفها.',
            )}
          </Alert>
          <p className="text-muted">
            {L(
              'The per-VM flags use simple published-general-knowledge heuristics, for example:',
              'تستخدم علامات كل جهاز إرشادات عامة منشورة بسيطة، مثل:',
            )}
          </p>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted">
            <li>{L('More than 8 vCPUs on one VM while the host has fewer than 16 physical cores.', 'أكثر من 8 وحدات معالجة افتراضية على جهاز واحد بينما يملك المضيف أقل من 16 نواة فعلية.')}</li>
            <li>{L('A single VM requesting more vCPUs than the host has cores — co-scheduling contention.', 'جهاز واحد يطلب وحدات أكثر من أنوية المضيف — تنافس جدولة.')}</li>
            <li>{L('Large RAM allocations (32 GB+) as ballooning / idle-memory candidates.', 'تخصيصات ذاكرة كبيرة (32 جيجابايت فأكثر) كمرشّحات بالوننغ/استرداد خامل.')}</li>
            <li>{L('Under 2 GB RAM on a server guest as a possible under-provisioning signal.', 'أقل من 2 جيجابايت ذاكرة لضيف خادم كانتصار محتمل لنقص التخصيص.')}</li>
          </ul>
          <p className="text-xs text-subtle">
            {L(
              'Memory and vCPU ratios compare totals against the host you entered. They are rules of thumb for capacity conversations, not supported maximums — always measure real guest usage first.',
              'تُقارَن نسب الذاكرة وvCPU بالإجماليات مقابل المضيف المُدخَل. إنها قواعد إبهام لنقاشات السعة وليست حدودًا مدعومة — قِس دائمًا الاستخدام الفعلي للضيف أولًا.',
            )}
          </p>
        </div>
      </Modal>
    </div>
  )
}

export default VirtualizationPage
