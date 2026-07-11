import { describe, expect, it, vi } from "vitest";
import { NakdanError, nakdan, vocalize } from "../src/index.js";

// A real Nakdan response shape for "שלום עולם." (captured from the live API).
const RAW = [
  { word: "שלום", sep: false, options: ["שָׁלוֹם", "שְׁלוֹם", "שָׁלֹם"], fconfident: true },
  { word: " ", sep: true, options: [] },
  { word: "עולם", sep: false, options: ["עוֹלָם", "עוֹלַם", "עֹלָם"], fconfident: false },
  { word: ". ", sep: true, options: [] },
];

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
    expect(r.text).toBe("שָׁלוֹם עוֹלָם. ");
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
    expect(await vocalize("שלום עולם.", { fetch: f })).toBe("שָׁלוֹם עוֹלָם. ");
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

  it("times out via AbortError", async () => {
    const f = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof fetch;
    await expect(nakdan("שלום", { fetch: f, timeoutMs: 5 })).rejects.toThrow(/timed out/);
  });
});
