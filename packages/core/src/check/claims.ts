import type { RetraceEvent } from "../schema.js";

/**
 * The one place natural-language claim-matching lives, so the heuristics are
 * auditable and testable in isolation rather than scattered across rules.
 * Deliberately conservative — see plan/module-05-claim-rules.md's "honest
 * caveat": a missed claim is preferable to a false one, so the pattern list
 * stays short and literal rather than trying to generalize.
 */

export interface ExtractedClaim {
  kind: "tests-pass" | "build-passes" | "file-modified";
  seq: number;
  /** For file-modified: the path as written in the text, unnormalized. */
  subject?: string;
  /** The sentence the claim came from, for the finding's detail. */
  excerpt: string;
}

const MAX_EXCERPT_LENGTH = 120;

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_EXCERPT_LENGTH
    ? `${oneLine.slice(0, MAX_EXCERPT_LENGTH - 1)}…`
    : oneLine;
}

/** Plan/intent/prediction phrasing — "let me run the tests", "tests should pass now" — not an assertion of completed work. */
const INTENT_GUARD =
  /\b(let's|let me|i'll|i will|i'm going to|going to|need to|about to|plan to|planning to|should|would|will)\b/i;

/** The assistant relaying someone else's statement rather than asserting its own observation. */
const RELAY_GUARD =
  /\b(you said|you mentioned|you reported|as you (?:said|mentioned|noted)|according to you)\b/i;

/** Common negation — "tests don't pass", "the build isn't passing" — that a bare positive-pattern match would otherwise misread as a success claim. */
const NEGATION_GUARD = /n't|\bnot\b|\bnever\b|\bfails?\b|\bfailed\b|\bfailing\b/i;

const TESTS_PASS_PATTERNS = [
  /\ball (?:the )?tests? (?:are )?(?:now )?(?:passing|green)\b/i,
  /\btests? (?:now )?pass(?:es|ed)?\b/i,
  /\btests? are (?:now )?(?:passing|green)\b/i,
  /\btest suite (?:passes|passed|is (?:green|passing))\b/i,
];

const BUILD_PASSES_PATTERNS = [
  /\bbuild (?:now )?(?:passes|passed|succeeds?|succeeded)\b/i,
  /\bbuild is (?:passing|green|successful|clean)\b/i,
  /\bcompiles? (?:successfully|cleanly|without errors?)\b/i,
];

const MODIFICATION_VERB =
  /\b(updated|modified|changed|fixed|edited|created|added|rewrote|wrote|refactored|renamed|deleted|removed)\b/i;

/**
 * A path-shaped token: zero or more directory segments, then a filename
 * ending in a recognizable extension. Deliberately not matched against
 * prose like "the config file" — and, just as deliberately, *always*
 * requires an extension, even when a "/" is present: matching on a bare
 * separator alone (an earlier version of this pattern did) turned out to
 * false-positive heavily on ordinary slash phrases with no extension —
 * "try/catch", "npm/PyPI", "feature/thesis-alignment" (a branch name) — when
 * checked against real sessions. See this module's completion note in
 * plan/module-05-claim-rules.md.
 *
 * The final segment allows dots (`[\w.-]+`, not `[\w-]+`) so a multi-dot
 * filename like `parse.test.ts` or `index.d.ts` is captured whole rather
 * than truncated to its last `word.ext` piece.
 */
const PATH_TOKEN =
  /\b(?:[\w-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|json|ya?ml|css|scss|less|html?|txt|md|cfg|conf|toml|sql|sh|bash|c|h|cpp|hpp|cs)\b/i;

function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ");
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchSentence(sentence: string): Array<Pick<ExtractedClaim, "kind" | "subject">> {
  // A trailing colon almost always introduces what follows (a command, a
  // list, a code block) rather than asserting a completed fact on its own —
  // "Now the full build + test pass:" is a header for the verification about
  // to run, not a claim that it already did. Confirmed as a real
  // false-positive source against actual sessions (see this module's
  // completion note in plan/module-05-claim-rules.md).
  if (sentence.trim().endsWith(":")) return [];

  if (INTENT_GUARD.test(sentence) || RELAY_GUARD.test(sentence) || NEGATION_GUARD.test(sentence)) {
    return [];
  }

  const matches: Array<Pick<ExtractedClaim, "kind" | "subject">> = [];

  if (TESTS_PASS_PATTERNS.some((p) => p.test(sentence))) matches.push({ kind: "tests-pass" });
  if (BUILD_PASSES_PATTERNS.some((p) => p.test(sentence))) matches.push({ kind: "build-passes" });

  if (MODIFICATION_VERB.test(sentence)) {
    const path = sentence.match(PATH_TOKEN)?.[0];
    if (path) matches.push({ kind: "file-modified", subject: path });
  }

  return matches;
}

/**
 * Extract natural-language claims of completed work from `assistant_text`
 * events: "tests pass", "the build succeeds", "I updated src/auth.ts".
 * `thinking` events are ignored entirely — reasoning about intent to do
 * something is not a claim of having done it — and text inside fenced code
 * blocks is stripped before matching, so a code sample containing the words
 * "tests pass" isn't read as an assertion.
 */
export function extractClaims(events: RetraceEvent[]): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  for (const event of events) {
    if (event.kind !== "assistant_text") continue;
    const text = stripCodeFences(event.payload.text);

    for (const sentence of splitSentences(text)) {
      for (const match of matchSentence(sentence)) {
        claims.push({ ...match, seq: event.seq, excerpt: truncate(sentence) });
      }
    }
  }

  return claims;
}
