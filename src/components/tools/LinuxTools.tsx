import { useMemo, useState } from 'react'
import { FileKey2, Lock, Terminal } from 'lucide-react'
import { Alert, Card, CardHeader, Checkbox, CopyButton, Field, Input, Select } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import {
  EXEC,
  MODE_MASK,
  READ,
  SETGID,
  SETUID,
  STICKY,
  TRIADS,
  WRITE,
  groupBits,
  hasSpecialBit,
  otherBits,
  ownerBits,
  parseOctal,
  parseSymbolic,
  toOctal,
  toSymbolic,
  toggleSpecialBit,
  toggleTriadBit,
  triadBits,
  triadSymbolic,
  type FileKind,
} from '@/lib/permissions'

function accessWords(value: number, who: string, L: (en: string, ar: string) => string): string {
  const parts: string[] = []
  if (value & READ) parts.push(L('read', 'قراءة'))
  if (value & WRITE) parts.push(L('write', 'كتابة'))
  if (value & EXEC) parts.push(L('execute/traverse', 'تنفيذ/اجتياز'))
  if (parts.length === 0) return L(`${who} has no access`, `${who} لا يملك أي صلاحية`)
  return `${who}: ${parts.join(' + ')}`
}

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

export function PermissionsTool() {
  const L = useLabels()
  const [mode, setMode] = useState(0o755)
  const [type, setType] = useState<FileKind>('file')
  const [octalText, setOctalText] = useState('0755')
  const [symbolicText, setSymbolicText] = useState(toSymbolic(0o755, 'file'))
  const [umaskText, setUmaskText] = useState('022')

  const symbolic = useMemo(() => toSymbolic(mode, type), [mode, type])
  const octal = useMemo(() => toOctal(mode), [mode])

  const applyMode = (next: number) => {
    const clamped = next & MODE_MASK
    setMode(clamped)
    setOctalText(toOctal(clamped))
    setSymbolicText(toSymbolic(clamped, type))
  }

  const onOctal = (raw: string) => {
    setOctalText(raw)
    const parsed = parseOctal(raw)
    if (parsed === null) return
    setMode(parsed & MODE_MASK)
    setSymbolicText(toSymbolic(parsed & MODE_MASK, type))
  }

  const onSymbolic = (raw: string) => {
    setSymbolicText(raw)
    const parsed = parseSymbolic(raw)
    if (parsed === null) return
    setMode(parsed.mode)
    setOctalText(toOctal(parsed.mode))
    if (parsed.kind) setType(parsed.kind)
  }

  const onType = (next: FileKind) => {
    setType(next)
    setSymbolicText(toSymbolic(mode, next))
  }

  const symbolicError = parseOctal(octalText) === null && parseSymbolic(symbolicText) === null

  const toggleTriad = (triad: (typeof TRIADS)[number], bit: number) => {
    applyMode(toggleTriadBit(mode, triad, bit))
  }

  const toggleSpecial = (bit: number) => {
    applyMode(toggleSpecialBit(mode, bit))
  }

  const umask = parseOctal(umaskText)
  const umaskDigits = umask === null ? null : umask & 0o777
  const fileFromUmask = umaskDigits === null ? null : 0o666 & ~umaskDigits
  const dirFromUmask = umaskDigits === null ? null : 0o777 & ~umaskDigits

  const worldWritable = Boolean(mode & WRITE)
  const worldWritableSticky = worldWritable && !hasSpecialBit(mode, STICKY)
  const chmod = `chmod ${octal} <path>`

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={L('Linux file permissions', 'صلاحيات الملفات في Linux')} icon={<Lock className="h-4 w-4" />} />
        <div className="grid gap-4 p-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <Field label={L('Object type', 'نوع الكائن')} htmlFor="perm-type">
              <Select id="perm-type" value={type} onChange={(event) => onType(event.target.value as FileKind)}>
                <option value="file">{L('Regular file', 'ملف عادي')}</option>
                <option value="dir">{L('Directory', 'مجلد')}</option>
                <option value="link">{L('Symlink', 'ارتباط رمزي')}</option>
              </Select>
            </Field>
            <Field label={L('Octal mode', 'الوضع العشاري الثماني')} htmlFor="perm-octal" hint={L('Accepts 3 or 4 digits, e.g. 644 or 0755.', 'يقبل 3 أو 4 أرقام مثل 644 أو 0755.')}>
              <Input id="perm-octal" value={octalText} onChange={(event) => onOctal(event.target.value)} dir="ltr" inputMode="numeric" maxLength={4} />
            </Field>
            <Field
              label={L('Symbolic mode', 'الوضع الرمزي')}
              htmlFor="perm-symbolic"
              hint={L('9 or 10 characters. The leading character is the type.', 'من 9 إلى 10 محارف، والمحرف الأول هو النوع.')}
            >
              <Input id="perm-symbolic" value={symbolicText} onChange={(event) => onSymbolic(event.target.value)} dir="ltr" maxLength={10} className="font-mono" />
            </Field>
            {symbolicError ? (
              <Alert tone="danger">{L('Neither value is a valid mode yet. Fix the octal or the symbolic field.', 'لا يوجد حقل صالح حتى الآن. صحّح الوضع العشاري أو الرمزي.')}</Alert>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {TRIADS.map((triad) => (
                <div key={triad.key} className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-subtle" dir="ltr">
                    {triad.key === 'owner' ? L('Owner (u)', 'المالك (u)') : triad.key === 'group' ? L('Group (g)', 'المجموعة (g)') : L('Other (o)', 'الآخرون (o)')}
                  </p>
                  <p className="mt-0.5 font-mono text-sm" dir="ltr">
                    {triadSymbolic(
                      triadBits(mode, triad),
                      hasSpecialBit(mode, triad.special),
                      triad.withExec,
                      triad.withoutExec,
                    )}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {[
                      { bit: READ, label: L('Read', 'قراءة') },
                      { bit: WRITE, label: L('Write', 'كتابة') },
                      { bit: EXEC, label: triad.key === 'other' && type === 'file' ? L('Execute', 'تنفيذ') : L('Execute / traverse', 'تنفيذ / اجتياز') },
                    ].map((entry) => (
                      <Checkbox
                        key={entry.bit}
                        checked={Boolean(triadBits(mode, triad) & entry.bit)}
                        onChange={() => toggleTriad(triad, entry.bit)}
                        label={`${entry.label} (${entry.bit})`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-line p-3">
              <p className="text-xs font-semibold text-text">{L('Special bits', 'البتات الخاصة')}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Checkbox checked={hasSpecialBit(mode, SETUID)} onChange={() => toggleSpecial(SETUID)} label={L('setuid (4000)', 'setuid (‏4000)')} />
                <Checkbox checked={hasSpecialBit(mode, SETGID)} onChange={() => toggleSpecial(SETGID)} label={L('setgid (2000)', 'setgid (‏2000)')} />
                <Checkbox checked={hasSpecialBit(mode, STICKY)} onChange={() => toggleSpecial(STICKY)} label={L('sticky (1000)', 'sticky (‏1000)')} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-subtle">{L('Resulting mode', 'النتيجة')}</p>
                <p className="font-mono text-sm" dir="ltr">{symbolic}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-subtle">{L('Octal', 'عشاري ثماني')}</p>
                <p className="font-mono text-sm" dir="ltr">{octal}</p>
              </div>
            </div>

            <div className="rounded-lg border border-line p-3 text-xs text-muted">
              <p className="font-semibold text-text">{L('Effective access', 'الوصول الفعلي')}</p>
              <ul className="mt-1.5 space-y-1">
                <li>{accessWords(ownerBits(mode), L('Owner', 'المالك'), L)}</li>
                <li>{accessWords(groupBits(mode), L('Group', 'المجموعة'), L)}</li>
                <li>{accessWords(otherBits(mode), L('Everyone else', 'بقية المستخدمين'), L)}</li>
                {hasSpecialBit(mode, SETUID) ? <li>{L('setuid: a executed binary runs as the owner user, not the caller.', 'setuid: الملف المنفَّذ يعمل باسم مالك الملف لا باسم المستخدم المستدعي.')}</li> : null}
                {hasSpecialBit(mode, SETGID) ? <li>{L('setgid: on a directory, new entries inherit the directory group.', 'setgid: على المجلد ترث الملفات الجديدة مجموعة المجلد.')}</li> : null}
                {hasSpecialBit(mode, STICKY) ? <li>{L('sticky: on a shared directory only the owner may delete their own files.', 'sticky: في المجلد المشترك لا يحذف الملف إلا مالكه.')}</li> : null}
              </ul>
            </div>

            {worldWritable ? (
              <Alert tone={worldWritableSticky ? 'danger' : 'warning'} title={L('World-writable', 'قابل للكتابة من الجميع')}>
                {worldWritableSticky
                  ? L('Other users can create, replace or delete files in this location. Add the sticky bit or remove group/other write.', 'يمكن لمستخدمين آخرين إنشاء الملفات أو استبدالها أو حذفها هنا. أضف بت sticky أو أزل الكتابة للآخرين.')
                  : L('Other users can write here, but the sticky bit limits deletion to file owners.', 'يمكن للآخرين الكتابة هنا، لكن بت sticky يحصر الحذف في المالكين.')}
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded border border-line bg-[var(--code-bg)] px-2 py-1 font-mono text-xs" dir="ltr">{chmod}</code>
              <CopyButton value={chmod} label={L('Copy chmod', 'انسخ chmod')} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={L('Umask preview', 'معاينة umask')}
          subtitle={L('The mode a new file or directory gets when created under this umask.', 'الوضع الذي يحصل عليه ملف أو مجلد جديد عند إنشائه تحت هذا umask.')}
          icon={<Terminal className="h-4 w-4" />}
        />
        <div className="grid gap-4 p-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Field label="umask" htmlFor="perm-umask" hint={L('3 or 4 octal digits.', 'من 3 إلى 4 أرقام عشرية ثمانية.')}>
            <Input id="perm-umask" value={umaskText} onChange={(event) => setUmaskText(event.target.value)} dir="ltr" inputMode="numeric" maxLength={4} />
          </Field>
          {umaskDigits === null ? (
            <Alert tone="danger">{L('Enter a valid octal umask such as 022 or 077.', 'أدخل umask صالحًا مثل 022 أو 077.')}</Alert>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { kind: 'file' as const, label: L('New files', 'الملفات الجديدة'), value: fileFromUmask ?? 0, note: L('Base 666 — regular files never get execute from umask.', 'الأساس 666 — الملفات الاعتيادية لا تحصل على التنفيذ من umask.') },
                { kind: 'dir' as const, label: L('New directories', 'المجلدات الجديدة'), value: dirFromUmask ?? 0, note: L('Base 777 — directories need execute to be traversed.', 'الأساس 777 — المجلدات تحتاج التنفيذ لاجتيازها.') },
              ].map((entry) => (
                <div key={entry.label} className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-subtle">{entry.label}</p>
                  <p className="font-mono text-sm" dir="ltr">
                    {toOctal(entry.value)} · {toSymbolic(entry.value, entry.kind)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">{entry.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={L('Reading it back', 'كيف تقرأ السطر')} icon={<FileKey2 className="h-4 w-4" />} />
        <div className="space-y-2 p-4 text-xs text-muted">
          <p dir="ltr" className="font-mono">-rwsr-sr-t</p>
          <p>
            {L(
              'Character 1 is the type (- file, d directory, l symlink). The next three are the owner, then group, then everyone else. An s or t in an execute position means the execute bit is set together with setuid, setgid or sticky; a capital S or T means the special bit is set without execute.',
              'المحرف الأول هو النوع (- ملف، d مجلد، l ارتباط رمزي). الثلاثة التالية للمالك ثم المجموعة ثم بقية المستخدمين. حرف s أو t في خانة التنفيذ يعني أن بت التنفيذ مضبوط مع setuid أو setgid أو sticky، أما الحرف الكبير S أو T فيعني البت الخاص مضبوط دون تنفيذ.',
            )}
          </p>
          <p>
            {L(
              'This tool only describes modes. It never changes a file, and it does not model ACLs, SELinux or AppArmor labels, or mount options like nosuid.',
              'هذه الأداة تصف الأوضاع فقط، ولا تغيّر أي ملف، ولا تحاكي قوائم ACL أو تسميات SELinux وAppArmor أو خيارات التعليق مثل nosuid.',
            )}
          </p>
        </div>
      </Card>
    </div>
  )
}
