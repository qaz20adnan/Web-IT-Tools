/**
 * Splits an assistant answer into the commands it contains. Only fenced blocks
 * are treated as commands so a copied buffer is always exactly what the model
 * proposed, never prose.
 */
export function extractCommands(text: string): string[] {
  const blocks = text.match(/```(?:[a-z0-9+#._-]*)\r?\n([\s\S]*?)```/gi) ?? []
  const commands: string[] = []
  for (const block of blocks) {
    const body = block.replace(/^```(?:[a-z0-9+#._-]*)\r?\n/i, '').replace(/```$/i, '')
    for (const line of body.split(/\r?\n/)) {
      const value = line.replace(/^[\s>*#-]+/, '').replace(/^\$\s?/, '').trim()
      if (value) commands.push(value)
    }
  }
  return commands.slice(0, 60)
}
