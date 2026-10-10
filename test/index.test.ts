import { describe, expect, it, vi } from "vitest";
import { NakdanError, nakdan, vocalize } from "../src/index.js";

// The shape of a real Nakdan response for "שלום עולם." (options trimmed).
const RAW = [
  { word: "שלום", sep: false, options: ["שָׁלוֹם", "שְׁלוֹם", "שָׁלֹם"], fconfident: true },
  { word: " ", sep: true, options: [] },
  { word: "עולם", sep: false, options: ["עוֹלָם", "עוֹלַם", "עֹלָם"], fconfident: false },
  { word: ".", sep: true, options: [] },
];

function abortError() {
  const e = new Error("This operation was aborted");
  e.name = "AbortError";
  return e;
}

/** A fetch that never answers, but rejects like the real one when aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(abortError()))),
  ) as unknown as typeof fetch;
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("nakdan — normalization", () => {
  it("returns the vocalized text and per-word detail", async () => {
    const f = mockFetch(RAW);
    const r = await nakdan("שלום עולם.", { fetch: f });
    expect(r.text).toBe("שָׁלוֹם עוֹלָם.");
    expect(r.words).toHaveLength(4);
  });

  it("marks separators and keeps their raw text", async () => {
    const f = mockFetch(RAW);
    const r = await nakdan("שלום עולם.", { fetch: f });
    const [shalom, space, olam] = r.words;
    expect(shalom).toMatchObject({
      word: "שלום",
      vocalized: "שָׁלוֹם",
      isSeparator: false,
      confident: true,
    });
    expect(shalom!.options).toHaveLength(3);
    expect(space).toMatchObject({ word: " ", vocalized: " ", isSeparator: true });
    expect(olam!.confident).toBe(false); // Dicta was unsure about עולם
  });

  it("vocalize returns just the pointed string", async () => {
    const f = mockFetch(RAW);
    expect(await vocalize("שלום עולם.", { fetch: f })).toBe("שָׁלוֹם עוֹלָם.");
  });
});

describe("request construction", () => {
  it("POSTs task/genre/data to the pinned endpoint", async () => {
    const f = mockFetch(RAW);
    await nakdan("שלום", { fetch: f });
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://nakdan-2-0.loadbalancer.dicta.org.il/api");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ task: "nakdan", genre: "modern", data: "שלום" });
  });

  it("passes the chosen genre and a custom endpoint", async () => {
    const f = mockFetch(RAW);
    await nakdan("שלום", { fetch: f, genre: "rabbinic", endpoint: "https://proxy.local/api" });
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://proxy.local/api");
    expect(JSON.parse((init as RequestInit).body as string).genre).toBe("rabbinic");
  });
});

describe("errors", () => {
  it("rejects empty and non-Hebrew input before any network call", async () => {
    const f = mockFetch(RAW);
    await expect(nakdan("", { fetch: f })).rejects.toBeInstanceOf(NakdanError);
    await expect(nakdan("   ", { fetch: f })).rejects.toBeInstanceOf(NakdanError);
    await expect(nakdan("hello world", { fetch: f })).rejects.toThrow(/Hebrew/);
    expect((f as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("throws NakdanError with status on HTTP failure", async () => {
    const f = mockFetch("nope", 500);
    await expect(nakdan("שלום", { fetch: f })).rejects.toMatchObject({
      name: "NakdanError",
      status: 500,
    });
  });

  it("throws on an unexpected (non-array) response shape", async () => {
    const f = mockFetch({ error: "bad" });
    await expect(nakdan("שלום", { fetch: f })).rejects.toThrow(/Unexpected Nakdan response/);
  });

  it("surfaces network errors as NakdanError", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(nakdan("שלום", { fetch: f })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("times out", async () => {
    await expect(nakdan("שלום", { fetch: hangingFetch(), timeoutMs: 5 })).rejects.toThrow(/timed out after 5ms/);
  });

  it("the timeout also covers a response body that never arrives", async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(abortError()))),
    })) as unknown as typeof fetch;
    await expect(nakdan("שלום", { fetch: f, timeoutMs: 5 })).rejects.toThrow(/timed out/);
  });

  it("honors a caller's AbortSignal", async () => {
    const ac = new AbortController();
    const p = nakdan("שלום", { fetch: hangingFetch(), signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
    await expect(nakdan("שלום", { fetch: hangingFetch(), signal: ac.signal })).rejects.toThrow(/aborted/);
  });

  it("includes Dicta's error message on HTTP errors", async () => {
    const f = mockFetch({ statusCode: 400, message: "One or more errors occurred!", errors: { genre: ["bad"] } }, 400);
    await expect(nakdan("שלום", { fetch: f })).rejects.toThrow(/HTTP 400: One or more errors occurred!/);
  });

  it("rejects an unknown genre or bad timeout before any network call", async () => {
    const f = mockFetch(RAW);
    // @ts-expect-error — runtime check
    await expect(nakdan("שלום", { fetch: f, genre: "biblical" })).rejects.toThrow(/Unknown genre/);
    await expect(nakdan("שלום", { fetch: f, timeoutMs: 0 })).rejects.toThrow(/timeoutMs/);
    expect((f as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("rejects malformed word entries", async () => {
    await expect(nakdan("שלום", { fetch: mockFetch([{ sep: false }]) })).rejects.toThrow(/Unexpected/);
  });
});

// Live responses (options trimmed to two) captured 2026-10-10 from the pinned endpoint.
describe("rebuilding text from real Dicta responses", () => {
  it("strips Dicta's | prefix markers from vocalizations", async () => {
    const raw = [
      { word: "בבית", sep: false, options: ["בְּ|בֵית", "בְּ|בַיִת"], fconfident: false },
      { word: "-", sep: true, options: [] },
      { word: "הספר", sep: false, options: ["הַ|סֵּפֶר", "הַ|סַּפָּר"], fconfident: false },
    ];
    const r = await nakdan("בבית-הספר", { fetch: mockFetch(raw) });
    expect(r.text).toBe("בְּבֵית-הַסֵּפֶר");
    expect(r.words[0]!.options).toEqual(["בְּבֵית", "בְּבַיִת"]);
  });

  it("keeps the input's gershayim and niqqud-bearing words", async () => {
    const input = "שָׁלוֹם\nhello עולם ירושלים״ צה״ל";
    const raw = [
      { word: "שלום", sep: false, options: ["שָׁלוֹם", "שָׁלֹם"], fconfident: true },
      { word: "\n", sep: true, options: [] },
      { word: "hello", sep: true, options: [] },
      { word: " ", sep: true, options: [] },
      { word: "עולם", sep: false, options: ["עוֹלַם", "עוֹלָם"], fconfident: false },
      { word: " ", sep: true, options: [] },
      { word: "ירושלים", sep: false, options: ["יְרוּשָׁלַיִם", "יְרוּשָׁלָיִם"], fconfident: false },
      { word: '" ', sep: true, options: [] },
      { word: 'צה"ל', sep: false, options: ['צַהַ"ל'], fconfident: false },
    ];
    const r = await nakdan(input, { fetch: mockFetch(raw) });
    expect(r.text).toBe("שָׁלוֹם\nhello עוֹלַם יְרוּשָׁלַיִם״ צַהַ״ל");
    expect(r.words.map((w) => w.word).join("")).toBe(input);
    expect(r.words[0]!.word).toBe("שָׁלוֹם"); // the input's own (pointed) text
  });

  it("keeps curly quotes, geresh, no-break spaces and bidi marks", async () => {
    const input = "ג׳ירפה “ילד” ‘ילדה’ –\u00a0אבא\t\u200fאמא  😀 \uFB2Aמש ז'אנר \r\nסוף";
    const raw = [
      { word: "ג'ירפה", sep: false, options: ["גִ'ירָפָה"], fconfident: false },
      { word: ' "', sep: true, options: [] },
      { word: "ילד", sep: false, options: ["יֶלֶד", "יֻלַּד"], fconfident: false },
      { word: "\" '", sep: true, options: [] },
      { word: "ילדה", sep: false, options: ["יַלְדָּה", "יַלְדָּהּ"], fconfident: false },
      { word: "' – ", sep: true, options: [] },
      { word: "אבא", sep: false, options: ["אַבָּא", "אָבֹא"], fconfident: false },
      { word: "\t", sep: true, options: [] },
      { word: "אמא", sep: false, options: ["אִמָּא"], fconfident: false },
      { word: "  😀 ", sep: true, options: [] },
      { word: "שמש", sep: false, options: ["שֶׁמֶשׁ", "שָׁמֶשׁ"], fconfident: false },
      { word: " ", sep: true, options: [] },
      { word: "ז'אנר", sep: false, options: ["זָ'אנֶר"], fconfident: false },
      { word: " ", sep: true, options: [] },
      { word: "\r\n", sep: true, options: [] },
      { word: "סוף", sep: false, options: ["סוֹף", "סוּף"], fconfident: false },
    ];
    const r = await nakdan(input, { fetch: mockFetch(raw) });
    expect(r.text).toBe("גִ׳ירָפָה “יֶלֶד” ‘יַלְדָּה’ –\u00a0אַבָּא\t\u200fאִמָּא  😀 שֶׁמֶשׁ זָ'אנֶר \r\nסוֹף");
    expect(r.words.map((w) => w.word).join("")).toBe(input);
  });

  it("falls back to Dicta's tokens if they don't line up with the input", async () => {
    const r = await nakdan("שלום עולם.", { fetch: mockFetch([{ word: "אחר", sep: false, options: ["אַחֵר"] }]) });
    expect(r.text).toBe("אַחֵר");
    expect(r.words[0]!.word).toBe("אחר");
  });

  it("uses the word itself when Dicta offers no options", async () => {
    const raw = [{ word: "קקק", sep: false, options: [], fconfident: false }];
    const r = await nakdan("קקק", { fetch: mockFetch(raw) });
    expect(r.text).toBe("קקק");
    expect(r.words[0]!.vocalized).toBe("קקק");
  });
});
