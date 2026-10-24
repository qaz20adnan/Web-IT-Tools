import { useMemo, useState } from 'react'
import { Bookmark, Download, ExternalLink, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useToast } from '@/context/ToastContext'
import { downloadTextFile, truncate } from '@/lib/utils'
import { formatDateTime } from '@/i18n'
import type { SavedItem } from '@/types'

const KINDS: SavedItem['kind'][] = ['article', 'solution', 'script', 'news', 'research', 'analysis']

export function SavedPage() {
  const { t, settings } = useApp()
  const { saved, removeSaved, clearSaved } = useLibrary()
  const { notify } = useToast()
  const [kind, setKind] = useState<'all' | SavedItem['kind']>('all')
  const [preview, setPreview] = useState<SavedItem | null>(null)

  const filtered = useMemo(
    () => (kind === 'all' ? saved : saved.filter((item) => item.kind === kind)),
    [saved, kind],
  )

  const exportAll = () => {
    downloadTextFile('nexora-saved-items.json', JSON.stringify(saved, null, 2), 'application/json')
    notify('success', t('saved.export'))
  }

  return (
    <div className="animate-in">
      <PageHeader
        title={t('saved.title')}
        subtitle={t('saved.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Field label={t('saved.filterKind')} htmlFor="saved-filter" className="!gap-1">
              <Select id="saved-filter" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="min-w-36">
                <option value="all">{t('common.all')}</option>
                {KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {t(`saved.kind.${entry}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportAll} disabled={saved.length === 0}>
              {t('saved.export')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm(t('settings.clearSaved') + '?')) clearSaved()
              }}
              disabled={saved.length === 0}
            >
              {t('common.clear')}
            </Button>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="h-8 w-8" />}
          title={t('saved.empty')}
          description={t('saved.subtitle')}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <Badge tone="primary">{t(`saved.kind.${item.kind}`)}</Badge>
                <span className="text-[10px] text-subtle">{formatDateTime(item.createdAt, settings.language)}</span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm font-medium">{item.title}</p>
              <div className="mt-auto flex items-center gap-1.5 pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ExternalLink className="h-3.5 w-3.5" />}
                  onClick={() => {
                    if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
                    else setPreview(item)
                  }}
                >
                  {t('common.open')}
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeSaved(item.id)} aria-label={t('saved.remove')} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview ? truncate(preview.title, 80) : ''} size="lg">
        {preview ? (
          <div className="space-y-2">
            <p className="text-xs text-subtle">{t(`saved.kind.${preview.kind}`)} · {formatDateTime(preview.createdAt, settings.language)}</p>
            <pre className="max-h-[50vh] overflow-auto rounded-lg border border-line bg-[var(--code-bg)] p-3 text-xs" dir="ltr">
              {JSON.stringify(preview.payload ?? { title: preview.title, url: preview.url }, null, 2)}
            </pre>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

export default SavedPage
