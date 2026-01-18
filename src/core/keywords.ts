// 硬编码停用词表（精简版）
const STOPWORDS = new Set([
  "the", "is", "a", "an", "to", "of", "and", "in", "on", "at", "for", "with",
  "fix", "add", "remove", "update", "delete", "create", "make", "implement",
  "please", "help", "todo", "bug", "issue", "error", "fail", "failed"
]);

export function extractKeywords(instruction: string): string[] {
  // 1. 归一化 & 拆词 (非字母数字分隔)
  const tokens = instruction.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
  
  // 2. 过滤 & 筛选
  const keywords = tokens
    .filter(t => t.length >= 3)       // 长度 >= 3
    .filter(t => !STOPWORDS.has(t));  // 排除停用词
    
  // 3. 取前 3 个
  const selected = keywords.slice(0, 3);
  
  // 4. 兜底：如果没提取到，尝试取原始 tokens 中长度够的
  if (selected.length === 0) {
    const fallback = tokens.find(t => t.length >= 3);
    if (fallback) selected.push(fallback);
  }
  
  return selected;
}