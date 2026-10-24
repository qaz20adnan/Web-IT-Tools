import { z } from 'zod'

export const CATEGORIES = [
  'windows-client',
  'windows-server',
  'printing',
  'microsoft-365',
  'networking',
  'linux',
  'cybersecurity',
  'datacenter',
  'backup-dr',
  'cloud-devops',
  'other',
] as const

export const MODES = ['beginner', 'professional', 'expert', 'diagnostic', 'script-review', 'incident-response', 'documentation'] as const

export const chatRequestSchema = z.object({
  mode: z.enum(MODES).default('professional'),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(20000),
      }),
    )
    .min(1)
    .max(30),
})

export const problemInputSchema = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().min(10).max(20000),
  errorText: z.string().max(8000).default(''),
  logs: z.string().max(20000).default(''),
  category: z.enum(CATEGORIES).default('other'),
  os: z.string().max(200).default(''),
  environment: z.string().max(500).default(''),
  recentChange: z.string().max(2000).default(''),
  experience: z.enum(['beginner', 'professional', 'expert']).default('professional'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  imageDataUrl: z.string().max(6 * 1024 * 1024).optional(),
  imageName: z.string().max(200).optional(),
})

export const analyzeRequestSchema = z.object({ input: problemInputSchema })

const stepSchema = z.object({
  order: z.number().int().min(1).max(50),
  title: z.string().min(1).max(300),
  detail: z.string().min(1).max(4000),
  command: z.string().max(4000).optional(),
  kind: z.enum(['diagnostic', 'change']),
  risk: z.enum(['none', 'low', 'medium', 'high']),
  rollback: z.string().max(2000).optional(),
})

export const analysisSchema = z.object({
  summary: z.string().min(1).max(4000),
  category: z.enum(CATEGORIES),
  symptoms: z.array(z.string().max(500)).max(20),
  causes: z.array(z.object({
    cause: z.string().min(1).max(600),
    likelihood: z.enum(['high', 'medium', 'low']),
    evidence: z.array(z.string().max(600)).max(10),
  })).max(12),
  evidence: z.array(z.object({ statement: z.string().max(800), type: z.enum(['fact', 'inference', 'unverified', 'untested']) })).max(20),
  diagnosticSteps: z.array(stepSchema).max(20),
  solutions: z.array(stepSchema).max(20),
  prerequisites: z.array(z.string().max(500)).max(15),
  risks: z.array(z.string().max(500)).max(15),
  rollback: z.string().max(4000),
  missingInformation: z.array(z.string().max(500)).max(15),
  sources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000), publisher: z.string().max(200).optional(), retrievedAt: z.string().max(50).optional() })).max(12),
  confidence: z.object({ level: z.enum(['high', 'medium', 'low']), reason: z.string().max(1200) }),
  limitations: z.string().max(2000),
})

export const scriptRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), prompt: z.string().trim().min(10).max(8000), language: z.string().max(40) }),
  z.object({ action: z.literal('review'), code: z.string().trim().min(1).max(30000), language: z.string().max(40) }),
])

export const scriptResultSchema = z.object({
  code: z.string().max(40000),
  feedback: z.string().min(1).max(8000),
})

export const researchRequestSchema = z.object({
  query: z.string().trim().min(3).max(500),
  officialOnly: z.boolean().default(false),
})

export const dnsRequestSchema = z.object({
  host: z.string().trim().min(1).max(300),
  type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'SRV']).default('A'),
})

export const tlsRequestSchema = z.object({
  host: z.string().trim().min(1).max(300),
  port: z.number().int().min(1).max(65535).optional(),
})

export const analyzerRequestSchema = z.object({
  host: z.string().trim().max(300).optional(),
  ddns: z.string().trim().max(300).optional(),
  ports: z.array(z.number().int().min(1).max(65535)).min(1).max(12).optional(),
  lang: z.enum(['en', 'ar']).default('en'),
})

export const printerRequestSchema = z.object({
  host: z.string().trim().min(1).max(300),
  port: z.number().int().min(1).max(65535).optional(),
  lang: z.enum(['en', 'ar']).default('en'),
})

export function flattenZod(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
}
