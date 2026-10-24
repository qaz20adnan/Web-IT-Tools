import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileSearch, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Modal, PageHeader, RiskBadge } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useToast } from '@/context/ToastContext'
import { buildReportMarkdown, reportFilename } from '@/lib/report'
import { downloadTextFile, truncate } from '@/lib/utils'
import { formatDateTime } from '@/i18n'
import type { HistoryEntry } from '@/types'

export function HistoryPage() {
  const { t, settings } = useApp()
  const { history, removeHistory, clearHistory } = useLibrary()
  const { notify } = useToast()
  const [selected, setSelected] = useState<HistoryEntry | null>(null)

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
        badge={<Badge>{t('history.count', { count: history.length })}</Badge>}
        actions={
          history.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm(t('history.clearConfirm'))) clearHistory()
              }}
            >
              {t('history.clear')}
            </Button>
          ) : null
        }
      />

      {history.length === 0 ? (
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
