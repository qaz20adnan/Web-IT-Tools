import { escapeHtml } from './utils'

function safeHref(raw: string): string | null {
  const unescaped = raw
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
  try {
    const url = new URL(unescaped, 'https://nexora.invalid')
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return null
    if (unescaped.startsWith('mailto:')) return escapeHtml(unescaped)
    return escapeHtml(url.toString())
  } catch {
    return null
  }
}

function inline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const safe = safeHref(href)
    if (!safe) return label
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`
  })
  return out
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = line.match(/^```([\w-]*)\s*$/)
    if (fence) {
      const language = fence[1]
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      html.push(
        `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`,
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`)
      index += 1
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      html.push('<hr />')
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      html.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`)
      continue
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^[-*+]\s+/, ''))}</li>`)
        index += 1
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\d+[.)]\s+/, ''))}</li>`)
        index += 1
      }
      html.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    if (/^\|.*\|$/.test(line.trim()) && index + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[index + 1].trim())) {
      const headers = line.split('|').slice(1, -1).map((cell) => `<th>${inline(cell.trim())}</th>`)
      index += 2
      const rows: string[] = []
      while (index < lines.length && /^\|.*\|$/.test(lines[index].trim())) {
        const cells = lines[index].split('|').slice(1, -1).map((cell) => `<td>${inline(cell.trim())}</td>`)
        rows.push(`<tr>${cells.join('')}</tr>`)
        index += 1
      }
      html.push(`<table><thead><tr>${headers.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#{1,6}\s|```|>\s?|[-*+]\s|\d+[.)]\s)/.test(lines[index]) &&
      !/^\|.*\|$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    html.push(`<p>${inline(paragraph.join('\n')).replaceAll('\n', '<br />')}</p>`)
  }

  return html.join('\n')
}
