/**
 * Robustly extract a JSON object from LLM output that may contain
 * markdown fences, preamble text, or trailing commentary.
 */
export function extractJson<T>(raw: string): T {
  // 1. Direct parse
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    // continue
  }

  // 2. Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T
    } catch {
      // continue
    }
  }

  // 3. Extract first {...} block (handles leading/trailing prose)
  const objMatch = trimmed.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T
    } catch {
      // continue
    }
  }

  throw new Error(`Could not extract JSON from response:\n${raw.slice(0, 400)}`)
}
