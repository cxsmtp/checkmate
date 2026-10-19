import { templateExplanation } from './knowledge.js';

/**
 * Plain-language explanations for every finding, from the built-in knowledge
 * base (src/knowledge.js, keyed by CWE and keywords). Scanning and detection are
 * Checkmarx One's; this only puts words around what it found. No external model.
 */
export function explainFindings(fusionOnly, others) {
  for (const f of [...fusionOnly, ...others]) f.explanation = templateExplanation(f);
}
