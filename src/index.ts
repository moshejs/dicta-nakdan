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
  /** Request timeout in milliseconds, covering the response body too. Default 30000. */
  timeoutMs?: number;
  /** Abort the request early (e.g. when the user navigates away). */
  signal?: AbortSignal;
}

/** One token in the Nakdan result. */
export interface NakdanWord {
  /**
   * The token exactly as it appears in your input (any niqqud, curly quotes,
   * geresh, bidi marks included), so `words.map(w => w.word).join("")`
   * rebuilds the input. For separators this is the whitespace/punctuation.
   */
  word: string;
  /** The vocalized (pointed) form — Dicta's top choice. Equals `word` for separators. */
  vocalized: string;
  /** True for whitespace/punctuation between words (Dicta also marks digits and Latin text as separators). */
  isSeparator: boolean;
  /** Vocalizations Dicta considered, most likely first (the first is `vocalized`). Empty for separators. */
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

const GENRES: readonly Genre[] = ["modern", "rabbinic", "poetry"];

// Dicta's raw per-word shape (only the fields we consume).
interface RawWord {
  word: string;
  sep?: boolean;
  options?: unknown[];
  fconfident?: boolean;
}

// Dicta marks prefix boundaries inside options with "|" (בְּ|בֵית, הַ|סֵּפֶר).
const PREFIX_MARK_RE = /\|/g;

/**
 * Dicta normalizes the text it echoes back: niqqud and bidi marks are
 * dropped, presentation forms decomposed, ׳ ‘ ’ become ' and ״ “ ” become ",
 * and no-break spaces become plain spaces. fold() applies the same mapping
 * to one input character so tokens can be lined up with the original text.
 */
function fold(ch: string): string {
  if (/[׳‘’‚′]/.test(ch)) return "'";
  if (/[״“”„″]/.test(ch)) return '"';
  if (ch !== "\t" && /[^\S\r\n]/.test(ch)) return " ";
  return ch.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
}

/**
 * Split the original input into one slice per token, or null if Dicta's
 * tokens don't line up with it (an unknown normalization — then we fall back
 * to Dicta's own token text). Characters that fold to nothing (marks, RLM)
 * stay attached to the preceding token.
 */
function alignToInput(input: string, tokens: string[]): string[] | null {
  // each folded character, with the UTF-16 offset of the input character it came from
  const folded: string[] = [];
  const source: number[] = [];
  let offset = 0;
  for (const ch of input) {
    for (const f of fold(ch)) {
      folded.push(f);
      source.push(offset);
    }
    offset += ch.length;
  }
  const starts: number[] = [];
  let pos = 0;
  for (const t of tokens) {
    const chars = [...t].flatMap((c) => [...fold(c)]);
    if (!chars.length) return null;
    for (let k = 0; k < chars.length; k++) if (folded[pos + k] !== chars[k]) return null;
    starts.push(starts.length === 0 ? 0 : source[pos]!);
    pos += chars.length;
  }
  if (pos !== folded.length) return null;
  return tokens.map((_, i) => input.slice(starts[i], starts[i + 1] ?? input.length));
}

/** Put the input's own quote characters (geresh, curly quotes) back into a vocalization. */
function restoreQuotes(vocalized: string, original: string): string {
  const quotes = [...original].filter((c) => /^['"]$/.test(fold(c)));
  let i = 0;
  const out = vocalized.replace(/['"]/g, (q) => quotes[i++] ?? q);
  return i === quotes.length ? out : vocalized;
}

function normalize(raw: RawWord[], input: string): NakdanResult {
  const slices = alignToInput(input, raw.map((r) => r.word));
  const words: NakdanWord[] = raw.map((r, i) => {
    const word = slices?.[i] ?? r.word;
    const isSeparator = r.sep === true;
    const options = isSeparator || !Array.isArray(r.options)
      ? []
      : r.options.filter((o): o is string => typeof o === "string").map((o) => o.replace(PREFIX_MARK_RE, ""));
    const top = options[0];
    const vocalized = isSeparator ? word : top === undefined ? word : slices ? restoreQuotes(top, word) : top;
    return {
      word,
      vocalized,
      isSeparator,
      options,
      confident: r.fconfident === true,
    };
  });
  return { text: words.map((w) => w.vocalized).join(""), words };
}

function isRawWord(x: unknown): x is RawWord {
  return typeof x === "object" && x !== null && typeof (x as RawWord).word === "string";
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
 * The pointed text keeps your input's own spacing and punctuation (Dicta
 * itself straightens quotes and drops some invisible characters).
 *
 * @throws {NakdanError} on empty/non-Hebrew input, an unknown genre, network
 *   failure, HTTP errors, timeout, abort, or an unexpected response shape.
 */
export async function nakdan(text: string, opts: NakdanOptions = {}): Promise<NakdanResult> {
  if (typeof text !== "string" || text.trim() === "") {
    throw new NakdanError("nakdan requires non-empty text");
  }
  if (!HEBREW_RE.test(text)) {
    throw new NakdanError("nakdan requires Hebrew text (no Hebrew characters found)");
  }

  const genre = opts.genre ?? "modern";
  if (!GENRES.includes(genre)) {
    throw new NakdanError(`Unknown genre "${String(genre)}" — expected one of: ${GENRES.join(", ")}`);
  }
  const timeoutMs = opts.timeoutMs ?? 30_000;
  if (!(timeoutMs > 0)) throw new NakdanError(`timeoutMs must be a positive number, got ${timeoutMs}`);
  const doFetch = opts.fetch ?? globalThis.fetch;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;

  const userSignal = opts.signal;
  if (userSignal?.aborted) throw new NakdanError("Nakdan request was aborted");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  userSignal?.addEventListener("abort", onAbort, { once: true });

  // The timeout and abort signal cover the whole exchange, body included.
  let raw: unknown;
  try {
    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ task: "nakdan", genre, data: text, addmorph: false, keepqq: false }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new NakdanError(`Nakdan request failed: ${(err as Error)?.message ?? String(err)}`);
    }

    if (!res.ok) {
      throw new NakdanError(`Nakdan request failed with HTTP ${res.status}${await errorDetail(res)}`, res.status);
    }

    try {
      raw = await res.json();
    } catch {
      throw new NakdanError("Nakdan returned a non-JSON response");
    }
  } catch (err) {
    if (timedOut) throw new NakdanError(`Nakdan request timed out after ${timeoutMs}ms`);
    if (userSignal?.aborted) throw new NakdanError("Nakdan request was aborted");
    throw err;
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener("abort", onAbort);
  }

  if (!Array.isArray(raw) || !raw.every(isRawWord)) {
    throw new NakdanError("Unexpected Nakdan response shape (expected an array of words)");
  }
  return normalize(raw, text);
}

/** Dicta's error message from a failed response, if it sent one (e.g. HTTP 400 on bad input). */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; errors?: unknown };
    const parts = [typeof body?.message === "string" ? body.message : "", body?.errors ? JSON.stringify(body.errors) : ""];
    const detail = parts.filter(Boolean).join(" ");
    return detail ? `: ${detail.slice(0, 500)}` : "";
  } catch {
    return "";
  }
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
