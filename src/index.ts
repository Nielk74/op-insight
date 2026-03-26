import { readSessions } from './reader.js'
import { extractFacet, extractErrorFacet, serializeSession } from './extractor.js'
import { synthesizeReport } from './aggregator.js'
import { saveAndOpenReport } from './reporter.js'

function parseArgs(): { days: number; topic?: string; errors: boolean; limit?: number } {
  const args = process.argv.slice(2)

  const daysIdx = args.indexOf('--days')
  let days = 30
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const n = parseInt(args[daysIdx + 1], 10)
    if (isNaN(n) || n < 1) {
      console.error('--days must be a positive integer')
      process.exit(1)
    }
    days = n
  }

  const topicIdx = args.indexOf('--topic')
  const topic = topicIdx !== -1 ? args[topicIdx + 1] : undefined
  if (topicIdx !== -1 && !topic) {
    console.error('--topic requires a value, e.g. --topic "typescript"')
    process.exit(1)
  }

  const limitIdx = args.indexOf('--limit')
  let limit: number | undefined
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    const n = parseInt(args[limitIdx + 1], 10)
    if (isNaN(n) || n < 1) {
      console.error('--limit must be a positive integer')
      process.exit(1)
    }
    limit = n
  }

  const errors = args.includes('--errors')

  return { days, topic, errors, limit }
}

async function main() {
  const { days, topic, errors, limit } = parseArgs()

  process.stderr.write(`Reading sessions from opencode.db... `)
  let sessions
  try {
    sessions = readSessions(days)
  } catch (e) {
    console.error(`\nError: ${(e as Error).message}`)
    process.exit(1)
  }
  process.stderr.write(`(${sessions.length} sessions found)\n`)

  if (sessions.length === 0) {
    console.error(`No sessions found in the last ${days} days.`)
    process.exit(0)
  }

  // Apply session limit (most recent sessions first, already ordered by time)
  if (limit && sessions.length > limit) {
    sessions = sessions.slice(-limit)
    process.stderr.write(`Session limit: using ${sessions.length} most recent sessions\n`)
  }

  // Filter by topic keyword if requested
  if (topic) {
    const needle = topic.toLowerCase()
    const before = sessions.length
    sessions = sessions.filter((s) => serializeSession(s).toLowerCase().includes(needle))
    process.stderr.write(`Topic filter "${topic}": ${sessions.length}/${before} sessions match\n`)
    if (sessions.length === 0) {
      console.error(`No sessions matched topic "${topic}".`)
      process.exit(0)
    }
  }

  const mode = errors ? 'error' : 'full'
  process.stderr.write(`Extracting facets [mode: ${mode}] (${sessions.length} sessions)...\n`)
  const facets = []
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]
    const label = (s.title ?? s.id.slice(0, 12)).slice(0, 40)
    process.stderr.write(`  [${i + 1}/${sessions.length}] ${label} ... `)
    const start = Date.now()
    const facet = errors ? await extractErrorFacet(s) : await extractFacet(s)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    process.stderr.write(`done (${elapsed}s)\n`)
    facets.push(facet)
  }

  process.stderr.write(`Synthesizing report...\n`)
  const report = await synthesizeReport(facets, days)

  const outPath = saveAndOpenReport(report)
  process.stderr.write(`Report saved to ${outPath}\n`)
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(1)
})
