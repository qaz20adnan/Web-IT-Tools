import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileSearch, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, RiskBadge } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useDiagnostics, diagnosticToolLabel, type DiagnosticStatus } from '@/context/DiagnosticsContext'
import { useToast } from '@/context/ToastContext'
import { buildReportMarkdown, reportFilename } from '@/lib/report'
import { downloadTextFile, truncate } from '@/lib/utils'
import { formatDateTime } from '@/i18n'
import type { HistoryEntry } from '@/types'

const STATUS_TONES: Record<DiagnosticStatus, 'success' | 'warning' | 'danger' | 'primary'> = {
  success: 'success',
  partial: 'warning',
  failure: 'danger',
  blocked: 'warning',
  error: 'danger',
}

export function HistoryPage() {
  const { t, settings } = useApp()
  const { history, removeHistory, clearHistory } = useLibrary()
  const { records, removeRecord, clearRecords } = useDiagnostics()
  const { notify } = useToast()
  const [selected, setSelected] = useState<HistoryEntry | null>(null)
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const isEmpty = history.length === 0 && records.length === 0

  const exportEntry = (entry: HistoryEntry) => {
    if (!entry.analysis) return
    downloadTextFile(reportFilename(entry.title), buildReportMarkdown(entry.analysis, entry.input, settings.language), 'text/markdown;charset=utf-8')
    notify('success', t('history.export'))
  }

  return (
    <div className="animate-in">
      <PageHeader
        title={t('history.title')}
        subtitle={t('history.subtitle')}
        badge={<Badge>{t('history.count', { count: history.length + records.length })}</Badge>}
        actions={
          !isEmpty ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm(t('history.clearConfirm'))) {
                  clearHistory()
                  clearRecords()
                }
              }}
            >
              {t('history.clear')}
            </Button>
          ) : null
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={<FileSearch className="h-8 w-8" />}
          title={t('history.empty')}
          description={t('history.subtitle')}
          action={
            <Link to="/lab" className="btn btn-primary text-sm">
              {t('nav.lab')}
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {history.map((entry) => (
            <Card key={entry.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="primary">{t(`domain.${entry.category}`)}</Badge>
                  <RiskBadge risk={entry.priority === 'critical' ? 'critical' : entry.priority} />
                  <span className="text-[10px] text-subtle">{formatDateTime(entry.createdAt, settings.language)}</span>
                </div>
                <p className="mt-1 text-sm font-medium">{entry.title}</p>
                <p className="line-clamp-1 text-xs text-muted">{truncate(entry.summary, 180)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="secondary" icon={<FileSearch className="h-3.5 w-3.5" />} onClick={() => setSelected(entry)}>
                  {t('history.open')}
                </Button>
                <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportEntry(entry)} aria-label={t('history.export')} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeHistory(entry.id)} aria-label={t('history.delete')} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {records.length > 0 ? (
        <Card>
          <CardHeader
            title={L('Tool runs', 'سجل تشغيل الأدوات')}
            subtitle={L('Every probe the platform executed, with the target and the verdict it returned.', 'كل فحص نفّذته المنصة مع الهدف والنتيجة التي عاد بها.')}
            icon={<FileSearch className="h-4 w-4" />}
          />
          <div className="stagger divide-y divide-line">
            {records.map((record) => (
              <div key={record.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="primary">{diagnosticToolLabel(record.tool)}</Badge>
                    <Badge tone={STATUS_TONES[record.status]}>{record.status}</Badge>
                    <span className="text-[10px] text-subtle">{formatDateTime(record.createdAt, settings.language)}</span>
                    {typeof record.latencyMs === 'number' ? <span className="text-[10px] font-mono text-subtle" dir="ltr">{record.latencyMs} ms</span> : null}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium" dir="auto">{record.target}</p>
                  <p className="line-clamp-1 text-xs text-muted" dir="auto">{truncate(record.summary, 180)}</p>
                </div>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeRecord(record.id)} aria-label={t('history.delete')} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? selected.title : ''} size="lg">
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">{t(`domain.${selected.category}`)}</Badge>
              <RiskBadge risk={selected.priority === 'critical' ? 'critical' : selected.priority} />
              <span className="text-[10px] text-subtle">{formatDateTime(selected.createdAt, settings.language)}</span>
            </div>
            <p className="text-sm text-muted">{selected.summary}</p>
            {selected.analysis ? (
              <>
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.causes')}</h3>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                    {selected.analysis.causes.map((cause, index) => (
                      <li key={index}>{cause.cause} ({t(`likelihood.${cause.likelihood}`)})</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.diagnosticSteps')}</h3>
                  <ol className="list-inside list-decimal space-y-1 text-sm text-muted">
                    {selected.analysis.diagnosticSteps.map((step) => (
                      <li key={step.order}>
                        <span className="font-medium text-text">{step.title}</span> — {step.detail}
                      </li>
                    ))}
                  </ol>
                </section>
                {selected.analysis.sources.length > 0 ? (
                  <section>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('common.sources')}</h3>
                    <ul className="space-y-1">
                      {selected.analysis.sources.map((source, index) => (
                        <li key={index}>
                          <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <div className="flex justify-end">
                  <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportEntry(selected)}>
                    {t('history.export')}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

export default HistoryPage
