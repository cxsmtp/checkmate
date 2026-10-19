import { templateExplanation, fusionExplanation } from './knowledge.js';

/**
 * Plain-language explanations for every finding, from the built-in knowledge
 * base (src/knowledge.js, keyed by CWE and keywords). Scanning and detection are
 * Checkmarx One's; this only puts words around what it found. No external model.
 */
export function explainFindings(fusionOnly, others, profile = {}) {
  for (const f of [...fusionOnly, ...others]) f.explanation = templateExplanation(f);
  // Ready before anyone asks: why the deterministic engines did not report it, and why Fusion did.
  for (const f of fusionOnly) Object.assign(f.explanation, fusionExplanation(f, profile));
}
