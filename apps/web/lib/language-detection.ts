// Supported languages for multi-variant detection
const SUPPORTED_LANGUAGES = [
  'Telugu', 'Hindi', 'English', 'Tamil', 'Kannada', 'Malayalam',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Odia', 'Urdu',
  'French', 'Spanish', 'German', 'Arabic', 'Japanese', 'Korean',
  'Chinese', 'Portuguese', 'Italian',
]

// Regex to match any supported language name (word-boundary, case-insensitive)
const LANG_RE = new RegExp(
  `\\b(${SUPPORTED_LANGUAGES.join('|')})\\b`,
  'gi'
)

/**
 * Detects unique language names mentioned in a prompt.
 * Returns an array of title-cased language names.
 * Returns [] if fewer than 2 languages are found (not a multi-variant request).
 */
export function detectLanguages(prompt: string): string[] {
  const matches = Array.from(prompt.matchAll(LANG_RE))
    .map(m => m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase())
  const unique = [...new Set(matches)]
  return unique.length >= 2 ? unique : []
}

/**
 * Builds a per-language prompt by removing all other language names
 * from the original prompt, leaving only the target language.
 *
 * Example:
 *   original = "overlay 'Try this game' in Telugu, Hindi, and English"
 *   target   = "Hindi"
 *   → "overlay 'Try this game' in Hindi"
 */
export function buildLanguagePrompt(
  original: string,
  target: string,
  allLanguages: string[]
): string {
  let result = original
  for (const lang of allLanguages) {
    if (lang === target) continue
    // Remove patterns: ", Lang", " and Lang", " or Lang", "Lang, ", "Lang and "
    const l = lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape
    result = result
      .replace(new RegExp(`\\s*,\\s*${l}`, 'gi'), '')
      .replace(new RegExp(`\\s+(?:and|or)\\s+${l}`, 'gi'), '')
      .replace(new RegExp(`${l}\\s*,\\s*`, 'gi'), '')
      .replace(new RegExp(`${l}\\s+(?:and|or)\\s+`, 'gi'), '')
      .replace(new RegExp(`\\b${l}\\b`, 'gi'), '')
  }
  // Clean up double spaces, orphaned punctuation
  return result.replace(/\s+/g, ' ').replace(/\s*,\s*$/, '').trim()
}
