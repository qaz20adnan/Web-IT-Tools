import { handler as adminHandler } from '../netlify/functions/admin'
import { handler as aiAnalyzeHandler } from '../netlify/functions/ai-analyze'
import { handler as aiChatHandler } from '../netlify/functions/ai-chat'
import { handler as aiModelsHandler } from '../netlify/functions/ai-models'
import { handler as aiScriptHandler } from '../netlify/functions/ai-script'
import { handler as aiTestHandler } from '../netlify/functions/ai-test'
import { handler as authHandler } from '../netlify/functions/auth'
import { handler as contentHandler } from '../netlify/functions/content'
import { handler as contentAdminHandler } from '../netlify/functions/content-admin'
import { handler as healthHandler } from '../netlify/functions/health'
import { handler as netAnalyzerHandler } from '../netlify/functions/net-analyzer'
import { handler as netDnsHandler } from '../netlify/functions/net-dns'
import { handler as netHttpHandler } from '../netlify/functions/net-http'
import { handler as netLatencyHandler } from '../netlify/functions/net-latency'
import { handler as netPathHandler } from '../netlify/functions/net-path'
import { handler as netPortHandler } from '../netlify/functions/net-port'
import { handler as netPrinterHandler } from '../netlify/functions/net-printer'
import { handler as netTlsHandler } from '../netlify/functions/net-tls'
import { handler as netUrlHandler } from '../netlify/functions/net-url'
import { handler as newsHandler } from '../netlify/functions/news'
import { handler as researchHandler } from '../netlify/functions/research'
import { handler as workspaceHandler } from '../netlify/functions/workspace'

import { createVercelDispatcher, type RouteTable } from './serverless'

/**
 * The public /api paths, exactly as the frontend and netlify.toml address them.
 * Each entry calls the untouched handler in netlify/functions through the
 * adapter, so Netlify, `npm run dev` and Vercel execute the same code.
 */
export const routes: RouteTable = {
  'admin': adminHandler,
  'ai/analyze': aiAnalyzeHandler,
  'ai/chat': aiChatHandler,
  'ai/models': aiModelsHandler,
  'ai/script': aiScriptHandler,
  'ai/test': aiTestHandler,
  'auth': authHandler,
  'content': contentHandler,
  'content/admin': contentAdminHandler,
  'health': healthHandler,
  'net/analyzer': netAnalyzerHandler,
  'net/dns': netDnsHandler,
  'net/http': netHttpHandler,
  'net/latency': netLatencyHandler,
  'net/path': netPathHandler,
  'net/port': netPortHandler,
  'net/printer': netPrinterHandler,
  'net/tls': netTlsHandler,
  'net/url': netUrlHandler,
  'news': newsHandler,
  'research': researchHandler,
  'workspace': workspaceHandler,
}

export default createVercelDispatcher(routes)
