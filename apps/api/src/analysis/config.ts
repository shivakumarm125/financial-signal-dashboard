// Optional: with no key, the pipeline makes its calls with the free rules
// engine (apps/api/src/baseline) instead of Claude. An empty string counts as
// unset, because GitHub Actions passes a missing secret as "".
const apiKey = process.env.CLAUDE_API_KEY?.trim() || undefined;

export const CLAUDE_API_KEY = apiKey;
export const claudeEnabled = apiKey !== undefined;

// The model the analysis engine actually calls -- validation (A4 Q11) must
// target this exact model, not a cheaper stand-in.
export const CLAUDE_MODEL = "claude-sonnet-5";
