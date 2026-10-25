import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { serverConfig } from '../lib/env'
import { probeIppPrinter, probePorts, resolveProbeAddresses } from '../lib/net-probe'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, printerRequestSchema } from '../lib/schema'

const PRINTER_PORTS = [631, 9100, 515]

function localRuntime(): boolean {
  return (
    !process.env.NETLIFY &&
    !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    process.env.NODE_ENV !== 'production'
  )
}

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`printer:${clientIp(event, context)}`, 10, 60_000)
  const parsed = printerRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))

  const local = localRuntime()
  const allowPrivate = serverConfig.printerAllowPrivate || local
  const allowPublic = serverConfig.printerAllowPublic
  if (!allowPrivate && !allowPublic) {
    throw new HttpError(
      403,
      'blocked_host',
      'Network printer probes are disabled on this deployment. Run NEXORA locally or enable PRINTER_ALLOW_PRIVATE / PRINTER_ALLOW_PUBLIC.',
    )
  }

  const port = parsed.data.port
  if (port !== undefined && !PRINTER_PORTS.includes(port)) {
    throw new HttpError(400, 'invalid_input', `Printer diagnostics supports only ports ${PRINTER_PORTS.join(', ')}.`)
  }

  const target = await resolveProbeAddresses(parsed.data.host, { allowPrivate, allowPublic })
  const address = target.addresses[0]
  const ports = port ? [port] : PRINTER_PORTS
  const probes = await probePorts(address, ports, target.host, 1800, 3)
  const ipp = probes.some((entry) => entry.port === 631 && entry.state === 'open')
    ? await probeIppPrinter(address, target.host, 631)
    : null

  const reachable = probes.some((entry) => entry.state === 'open')
  const likelyProtocol = ipp?.ok
    ? 'IPP'
    : probes.some((entry) => entry.port === 9100 && entry.state === 'open')
      ? 'Raw TCP (JetDirect/AppSocket)'
      : probes.some((entry) => entry.port === 515 && entry.state === 'open')
        ? 'LPD'
        : probes.some((entry) => entry.port === 631 && entry.state === 'open')
          ? 'IPP port open (attributes unavailable)'
          : 'unknown'

  const notes: string[] = []
  if (!local && !allowPrivate) {
    notes.push(
      parsed.data.lang === 'ar'
        ? 'طابعات الشبكة المحلية غير قابلة للوصول من نشر سحابي. شغّل NEXORA محلياً أو استخدم سكربت PowerShell المحلي.'
        : 'Local network printers are not reachable from a cloud deployment. Run NEXORA locally or use the local PowerShell agent.',
    )
  }
  notes.push(
    parsed.data.lang === 'ar'
      ? 'هذا الفحص للقراءة فقط. إلغاء المهام وإعادة تشغيل Spooler يتطلبان سكربتاً محلياً بصلاحيات مناسبة.'
      : 'This probe is read-only. Canceling jobs and restarting the spooler require the local script with appropriate permissions.',
  )
  notes.push(
    parsed.data.lang === 'ar'
      ? 'طابعات USB لا تظهر للمتصفح. استخدم تبويب الفحص المحلي لتوليد سكربت PowerShell.'
      : 'USB printers are not visible to a browser. Use the local diagnostics tab to generate a PowerShell script.',
  )

  return json(200, {
    checkedAt: new Date().toISOString(),
    connectionType: 'network',
    target: { host: target.host, address },
    reachable,
    likelyProtocol,
    ports: probes,
    ipp,
    queue: ipp?.ok
      ? {
          name: ipp.name,
          model: ipp.model,
          state: ipp.state,
          stateReasons: ipp.stateReasons,
          queuedJobs: ipp.queuedJobs,
          acceptingJobs: ipp.acceptingJobs,
        }
      : null,
    localAgentAvailable: local,
    notes,
  })
})
