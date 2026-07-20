const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  throw new Error("CLAUDE_API_KEY is not set. (Placeholder single-key setup per A4/C2 Q1 -- will be a per-user encrypted DB lookup once E2 exists.)");
}

export const CLAUDE_API_KEY = apiKey;

// The model the analysis engine actually calls -- validation (A4 Q11) must
// target this exact model, not a cheaper stand-in.
export const CLAUDE_MODEL = "claude-sonnet-5";
