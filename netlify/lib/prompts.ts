import type { z } from 'zod'
import type { problemInputSchema } from './schema'

type ProblemInput = z.infer<typeof problemInputSchema>

const BASE = `You are NEXORA AI, a careful senior IT engineer and technical writer.
Rules:
- Be precise and practical. Distinguish facts, inferences, unverified claims and untested steps.
- Never invent commands, registry paths, URLs, event IDs, KB numbers or vendor statements. If unsure, say so.
- Prefer read-only diagnostics before changes. Include rollback and prerequisites for every change.
- Never advise disabling security controls, exposing credentials, or destructive commands without explicit safeguards.
- Respond in the same language as the user's request (Arabic or English). Keep commands, code and error strings unchanged.
- Output only the requested format. No markdown fences around JSON.`

const MODE_GUIDANCE: Record<string, string> = {
  beginner: 'Explain in plain language, define jargon, and keep steps small and safe.',
  professional: 'Assume an experienced administrator. Be concise and include verification commands.',
  expert: 'Use precise technical detail, edge cases, and evidence-oriented reasoning.',
  diagnostic: 'Prioritize a differential diagnosis. Collect evidence before proposing fixes.',
  'script-review': 'Focus on correctness, safety, idempotency, error handling and destructive operations.',
  'incident-response': 'Prioritize containment, evidence preservation, scope, communication and reversible actions.',
  documentation: 'Produce structured, reusable documentation with prerequisites, procedure, verification and rollback.',
}

export interface ChatModePrompt {
  mode: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

export function chatPrompt(mode: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): ChatModePrompt {
  const guidance = MODE_GUIDANCE[mode] ?? MODE_GUIDANCE.professional
  return {
    mode,
    messages: [
      { role: 'system', content: `${BASE}\nMode: ${mode}. ${guidance}` },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ],
  }
}

export function analysisPrompt(input: ProblemInput): string {
  return `Analyze this IT problem and return a single JSON object with exactly these keys:
{
  "summary": string,
  "category": one of ${JSON.stringify(['windows-client', 'windows-server', 'printing', 'microsoft-365', 'networking', 'linux', 'cybersecurity', 'datacenter', 'backup-dr', 'cloud-devops', 'other'])},
  "symptoms": string[],
  "causes": [{"cause": string, "likelihood": "high"|"medium"|"low", "evidence": string[]}],
  "evidence": [{"statement": string, "type": "fact"|"inference"|"unverified"|"untested"}],
  "diagnosticSteps": [{"order": number, "title": string, "detail": string, "command": string, "kind": "diagnostic"|"change", "risk": "none"|"low"|"medium"|"high", "rollback": string}],
  "solutions": [same step shape as diagnosticSteps],
  "prerequisites": string[],
  "risks": string[],
  "rollback": string,
  "missingInformation": string[],
  "sources": [{"title": string, "url": string, "publisher": string}],
  "confidence": {"level": "high"|"medium"|"low", "reason": string},
  "limitations": string
}

Rules for this response:
- diagnosticSteps must be ordered and mostly read-only. solutions must be ordered and include rollback where relevant.
- sources must be real, official URLs you are confident about. If you cannot verify a URL, return an empty array. Never fabricate URLs.
- Do not claim the issue is fixed. Do not include markdown outside the JSON.
- If an image is attached, describe only what is visibly relevant; never infer unseen text.

PROBLEM DATA:
Title: ${input.title}
Category: ${input.category}
Priority: ${input.priority}
Experience level: ${input.experience}
OS / product: ${input.os || 'not specified'}
Environment: ${input.environment || 'not specified'}
Recent change: ${input.recentChange || 'none reported'}
Description:
${input.description}

Error text:
${input.errorText || '(none)'}

Logs:
${input.logs || '(none)'}`
}

export function scriptGeneratePrompt(goal: string, language: string): string {
  return `Create a ${language} script for this goal:
${goal}

Return JSON only: {"code": "...", "feedback": "..."}.
Requirements:
- Include a safety comment header with purpose, risk level and prerequisites.
- Prefer read-only operations. If changes are required, include -WhatIf/dry-run support where the language allows it.
- Validate inputs, avoid wildcards on destructive operations, and include error handling.
- The feedback field must summarize assumptions, risks and how to test safely.`
}

export function scriptReviewPrompt(code: string, language: string): string {
  return `Review this ${language} script for correctness and safety.

Return JSON only: {"code": "...", "feedback": "..."}.
- "code" must be the improved script or the original when no change is needed.
- "feedback" must list concrete issues by severity, destructive operations, missing validation, and safe test steps.
- Never invent cmdlets. If uncertain about a parameter, say so in feedback.

SCRIPT:
${code}`
}
