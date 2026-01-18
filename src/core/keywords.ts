// Hardcoded stopwords list (simplified)
const STOPWORDS = new Set([
  "the", "is", "a", "an", "to", "of", "and", "in", "on", "at", "for", "with",
  "fix", "add", "remove", "update", "delete", "create", "make", "implement",
  "please", "help", "todo", "bug", "issue", "error", "fail", "failed"
]);

export function extractKeywords(instruction: string): string[] {
  // 1. Normalize & Tokenize (split by non-alphanumeric)
  const tokens = instruction.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
  
  // 2. Filter & Select
  const keywords = tokens
    .filter(t => t.length >= 3)       // Length >= 3
    .filter(t => !STOPWORDS.has(t));  // Exclude stopwords
    
  // 3. Take top 3
  const selected = keywords.slice(0, 3);
  
  // 4. Fallback: if no keywords extracted, try to take tokens with sufficient length
  if (selected.length === 0) {
    const fallback = tokens.find(t => t.length >= 3);
    if (fallback) selected.push(fallback);
  }
  
  return selected;
}