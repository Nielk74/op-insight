import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractFacet, serializeSession, CHUNK_SIZE } from '../src/extractor.js'
import type { Session } from '../src/types.js'

vi.mock('../src/llm.js', () => ({
  callLlm: vi.fn(),
}))
import { callLlm } from '../src/llm.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
  }
})
import * as fs from 'node:fs'

const mockSession: Session = {
  id: 'ses_abc',
  projectId: 'proj_1',
  createdAt: Date.now() - 5000,
  updatedAt: Date.now(),
  messages: [
    { role: 'user', parts: [{ type: 'text', content: 'Fix the bug' }] },
    { role: 'assistant', parts: [{ type: 'text', content: 'Done' }] },
  ],
}

const mockFacet = {
  sessionId: 'ses_abc',
  projectName: 'MyProject',
  summary: 'Fixed a bug',
  toolsUsed: ['edit'],
  repeatedInstructions: [],
  frictionPoints: [],
  codeQualityPatterns: [],
  workflowPatterns: [],
}

describe('serializeSession', () => {
  it('serializes messages to readable text', () => {
    const text = serializeSession(mockSession)
    expect(text).toContain('user: Fix the bug')
    expect(text).toContain('assistant: Done')
  })
})

describe('extractFacet', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns cached facet when cache is fresh', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: mockSession.updatedAt + 1000 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockFacet))

    const result = await extractFacet(mockSession)

    expect(result).toEqual(mockFacet)
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('calls LLM when no cache exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(callLlm).mockResolvedValue(JSON.stringify(mockFacet))

    const result = await extractFacet(mockSession)

    expect(callLlm).toHaveBeenCalledOnce()
    expect(result.sessionId).toBe('ses_abc')
    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  it('calls LLM when cache is stale', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: mockSession.updatedAt - 1000 } as fs.Stats)
    vi.mocked(callLlm).mockResolvedValue(JSON.stringify(mockFacet))

    await extractFacet(mockSession)

    expect(callLlm).toHaveBeenCalledOnce()
  })
})
