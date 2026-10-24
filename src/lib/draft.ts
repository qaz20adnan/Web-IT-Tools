import type { ProblemInput } from '@/types'

let labDraft: Partial<ProblemInput> | null = null

export function setLabDraft(draft: Partial<ProblemInput>): void {
  labDraft = draft
}

export function consumeLabDraft(): Partial<ProblemInput> | null {
  const draft = labDraft
  labDraft = null
  return draft
}

export function peekLabDraft(): Partial<ProblemInput> | null {
  return labDraft
}
