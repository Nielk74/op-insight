import { readSessions } from './reader.js'
import { extractFacet } from './extractor.js'
import { synthesizeReport } from './aggregator.js'
import { saveAndOpenReport } from './reporter.js'
import { readOpencodeConfig } from './config.js'

function parseArgs(): { days: number } {
  const args = process.argv.slice(2)
  const daysIdx = args.indexOf('--days')
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const n = parseInt(args[daysIdx + 1], 10)
    if (isNaN(n) || n < 1) {
      console.error('--days must be a positive integer')
      process.exit(1)
    }
    return { days: n }
  }
  return { days: 30 }
}

async function main() {
  const { days } = parseArgs()

  let config
  try {
    config = readOpencodeConfig()
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`)
    process.exit(1)
  }

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

  process.stderr.write(`Extracting facets... `)
  let cached = 0
  let fresh = 0
  const facets = await Promise.all(
    sessions.map(async (s) => {
      const facet = await extractFacet(s, config)
      // Heuristic: if facet was returned very fast it was cached
      cached++ // simplified: count all for now
      return facet
    })
  )
  process.stderr.write(`(${facets.length} processed)\n`)

  process.stderr.write(`Synthesizing report...\n`)
  const report = await synthesizeReport(facets, days, config)

  const outPath = saveAndOpenReport(report)
  process.stderr.write(`Report saved to ${outPath}\n`)
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(1)
})
