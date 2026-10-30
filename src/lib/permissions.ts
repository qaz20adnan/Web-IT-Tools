export const READ = 4
export const WRITE = 2
export const EXEC = 1

export const SETUID = 0o4000
export const SETGID = 0o2000
export const STICKY = 0o1000

export const MODE_MASK = 0o7777

export type FileKind = 'file' | 'dir' | 'link'
export type TriadKey = 'owner' | 'group' | 'other'

export interface Triad {
  key: TriadKey
  shift: number
  special: number
  withExec: string
  withoutExec: string
}

export const TRIADS: Triad[] = [
  { key: 'owner', shift: 6, special: SETUID, withExec: 's', withoutExec: 'S' },
  { key: 'group', shift: 3, special: SETGID, withExec: 's', withoutExec: 'S' },
  { key: 'other', shift: 0, special: STICKY, withExec: 't', withoutExec: 'T' },
]

const KIND_BY_TYPE_CHAR: Record<string, FileKind> = { '-': 'file', d: 'dir', l: 'link' }

export function ownerBits(mode: number): number {
  return (mode >> 6) & 7
}

export function groupBits(mode: number): number {
  return (mode >> 3) & 7
}

export function otherBits(mode: number): number {
  return mode & 7
}

export function triadBits(mode: number, triad: Triad): number {
  return (mode >> triad.shift) & 7
}

export function hasSpecialBit(mode: number, bit: number): boolean {
  return (mode & bit) !== 0
}

export function toggleTriadBit(mode: number, triad: Triad, bit: number): number {
  return (mode ^ (bit << triad.shift)) & MODE_MASK
}

export function toggleSpecialBit(mode: number, bit: number): number {
  return (mode ^ bit) & MODE_MASK
}

export function triadSymbolic(value: number, special: boolean, withExec: string, withoutExec: string): string {
  const read = value & READ ? 'r' : '-'
  const write = value & WRITE ? 'w' : '-'
  const exec = value & EXEC
  const execChar = special ? (exec ? withExec : withoutExec) : exec ? 'x' : '-'
  return `${read}${write}${execChar}`
}

export function toSymbolic(mode: number, kind: FileKind): string {
  const prefix = kind === 'dir' ? 'd' : kind === 'link' ? 'l' : '-'
  const body = TRIADS.map((triad) =>
    triadSymbolic(triadBits(mode, triad), hasSpecialBit(mode, triad.special), triad.withExec, triad.withoutExec),
  ).join('')
  return prefix + body
}

export function toOctal(mode: number): string {
  return (mode & MODE_MASK).toString(8).padStart(4, '0')
}

export function parseOctal(input: string): number | null {
  const text = input.trim()
  if (!/^[0-7]{3,4}$/.test(text)) return null
  return parseInt(text, 8)
}

export interface SymbolicMode {
  mode: number
  kind: FileKind | null
}

export function parseSymbolic(input: string): SymbolicMode | null {
  const text = input.trim()
  let kind: FileKind | null = null
  let body = text
  if (text.length === 10) {
    kind = KIND_BY_TYPE_CHAR[text[0]] ?? null
    if (kind === null) return null
    body = text.slice(1)
  }
  if (body.length !== 9) return null

  let mode = 0
  let special = 0
  for (let index = 0; index < TRIADS.length; index += 1) {
    const triad = TRIADS[index]
    const [read, write, exec] = body.slice(index * 3, index * 3 + 3)
    if (read !== 'r' && read !== '-') return null
    if (write !== 'w' && write !== '-') return null
    let value = 0
    if (read === 'r') value |= READ
    if (write === 'w') value |= WRITE
    if (exec === 'x') value |= EXEC
    else if (exec === triad.withExec) {
      value |= EXEC
      special |= triad.special
    } else if (exec === triad.withoutExec) special |= triad.special
    else if (exec !== '-') return null
    mode |= value << triad.shift
  }
  return { mode: (mode | special) & MODE_MASK, kind }
}
