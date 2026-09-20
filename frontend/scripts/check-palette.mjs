import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Three base colours, plus the two signal colours of the debug panel's true/false lamps.
const allowed = new Set(['#17233C', '#F6F4EE', '#2F6F68', '#2E8B57', '#C2413A'])
const forbiddenFunction = /\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\s*\(/gi
const gradient = /\bgradient\b/gi
const hex = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/gi
const namedUtility = /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?\b/gi
const namedLiteral = /(['"])(?:black|white|red|orange|yellow|green|blue|purple|pink|gray|grey)\1/gi
const cssNamedLiteral = /:\s*(?:black|white|red|orange|yellow|green|blue|purple|pink|gray|grey)\b/gi

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(target) : [target]
  }))).flat()
}

const failures = []
const srcDirectory = fileURLToPath(new URL('../src/', import.meta.url))
for (const file of await filesUnder(srcDirectory)) {
  if (!/\.(css|ts|tsx)$/.test(file)) continue
  const source = await readFile(file, 'utf8')
  for (const value of source.match(hex) ?? []) {
    if (!allowed.has(value.toUpperCase())) failures.push(`${file}: ${value}`)
  }
  if (forbiddenFunction.test(source)) failures.push(`${file}: color function`)
  forbiddenFunction.lastIndex = 0
  if (gradient.test(source)) failures.push(`${file}: gradient`)
  gradient.lastIndex = 0
  for (const value of source.match(namedUtility) ?? []) {
    failures.push(`${file}: ${value}`)
  }
  for (const value of source.match(namedLiteral) ?? []) {
    failures.push(`${file}: ${value}`)
  }
  for (const value of source.match(cssNamedLiteral) ?? []) {
    failures.push(`${file}: ${value}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
