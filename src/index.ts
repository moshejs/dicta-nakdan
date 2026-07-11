/**
 * dicta-nakdan — typed, zero-dependency client for Dicta's free Nakdan
 * (automatic Hebrew vocalization / niqqud) API.
 *
 * Send unpointed Hebrew text, get it back with niqqud, plus per-word
 * alternatives and a confidence flag — normalized from Dicta's raw
 * word-array format into a clean TypeScript shape.
 *
 * Dicta (dicta.org.il) is a nonprofit; the tools are free. There is no formal
 * published API contract, and the service's endpoints are version-numbered,
 * so a drift-resistant default endpoint is pinned and overridable.
 */

/** Text genre — Dicta tunes vocalization to the register. */
export type Genre = "modern" | "rabbinic" | "poetry";

export interface NakdanOptions {
  /** Custom fetch implementation (testing, proxies). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Override the API endpoint (defaults to the pinned Nakdan endpoint). */
  endpoint?: string;
  /** Text genre. Default "modern". */
  genre?: Genre;
  /** Request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
}

/** One token in the Nakdan result. */
export interface NakdanWord {
  /** The token text. For separators this is the whitespace/punctuation itself. */
  word: string;
  /** The vocalized (pointed) form — Dicta's top choice. Equals `word` for separators. */
  vocalized: string;
  /** True for whitespace/punctuation between words. */
  isSeparator: boolean;
  /** Alternative vocalizations Dicta considered (most likely first), if any. */
  options: string[];
  /** Dicta's confidence in the chosen vocalization (word tokens only). */
  confident: boolean;
}

export interface NakdanResult {
  /** The fully vocalized text (all tokens' top choices concatenated). */
  text: string;
  /** Per-token detail, including separators, in order. */
  words: NakdanWord[];
}

export class NakdanError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "NakdanError";
    this.status = status;
  }
}

/** Pinned working endpoint (versioned host; override via options.endpoint). */
const DEFAULT_ENDPOINT = "https://nakdan-2-0.loadbalancer.dicta.org.il/api";

// Dicta's raw per-word shape (only the fields we consume).
interface RawWord {
  word: string;
  sep?: boolean;
  options?: string[];
  fconfident?: boolean;
}

function normalize(raw: RawWord[]): NakdanResult {
  const words: NakdanWord[] = raw.map((r) => {
    const isSeparator = r.sep === true;
    const options = Array.isArray(r.options) ? r.options : [];
    const vocalized = isSeparator ? r.word : options[0] ?? r.word;
    return {
      word: r.word,
      vocalized,
      isSeparator,
      options,
      confident: r.fconfident === true,
    };
  });
  return { text: words.map((w) => w.vocalized).join(""), words };
}

const HEBREW_RE = /[֐-׿]/;

/**
 * Vocalize Hebrew text, returning the full result (text + per-word detail).
 *
 * ```ts
 * const r = await nakdan("שלום עולם");
 * r.text;              // "שָׁלוֹם עוֹלָם"
 * r.words[0].options;  // alternative vocalizations of the first word
 * ```
 *
 * @throws {NakdanError} on empty/non-Hebrew input, network failure, timeout,
 *   or an unexpected response shape.
 */
export async function nakdan(text: string, opts: NakdanOptions = {}): Promise<NakdanResult> {
  if (typeof text !== "string" || text.trim() === "") {
    throw new NakdanError("nakdan requires non-empty text");
  }
  if (!HEBREW_RE.test(text)) {
    throw new NakdanError("nakdan requires Hebrew text (no Hebrew characters found)");
  }

  const doFetch = opts.fetch ?? globalThis.fetch;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const genre = opts.genre ?? "modern";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ task: "nakdan", genre, data: text, addmorph: false, keepqq: false }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new NakdanError(`Nakdan request timed out after ${timeoutMs}ms`);
    }
    throw new NakdanError(`Nakdan request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new NakdanError(`Nakdan request failed with HTTP ${res.status}`, res.status);

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new NakdanError("Nakdan returned a non-JSON response");
  }
  if (!Array.isArray(raw)) {
    throw new NakdanError("Unexpected Nakdan response shape (expected an array of words)");
  }
  return normalize(raw as RawWord[]);
}

/**
 * Vocalize Hebrew text and return just the pointed string — the common case.
 *
 * ```ts
 * await vocalize("שלום עולם"); // "שָׁלוֹם עוֹלָם"
 * ```
 */
export async function vocalize(text: string, opts: NakdanOptions = {}): Promise<string> {
  return (await nakdan(text, opts)).text;
}
