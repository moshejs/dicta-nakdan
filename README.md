# dicta-nakdan

Typed, zero-dependency client for **[Dicta](https://dicta.org.il/)'s free Nakdan API** — automatic Hebrew **vocalization** (adding niqqud / nikud to unpointed text), with per-word alternatives and confidence.

```
npm install dicta-nakdan
```

## Why

Adding niqqud (vowel points) to Hebrew text is genuinely hard — it's a context-dependent NLP problem, not a lookup. Dicta, a nonprofit, offers a remarkably good vocalizer for free, but its raw API returns a terse word-array format with no types and no documented contract. This wraps it in a clean, typed TypeScript API and normalizes the response — so you can add nikud in one call.

```ts
import { vocalize, nakdan } from "dicta-nakdan";

await vocalize("שלום עולם");  // "שָׁלוֹם עוֹלָם"

const r = await nakdan("בראשית ברא אלהים", { genre: "rabbinic" });
r.text;                        // the fully pointed string
r.words[0].vocalized;          // "בְּרֵאשִׁית"
r.words[0].options;            // the vocalizations Dicta considered, best first
r.words[0].confident;          // whether Dicta was sure
```

## API

- **`vocalize(text, opts?)`** → the pointed string (the common case).
- **`nakdan(text, opts?)`** → `{ text, words }`, where each word is `{ word, vocalized, isSeparator, options, confident }`. Separators (spaces, punctuation, and also digits and Latin text) are kept in order, and `word` is the token exactly as it appears in your input, so `words.map(w => w.word).join("")` gives back the input.

**`opts`**: `genre` (`"modern"` default, `"rabbinic"`, or `"poetry"`), `fetch` (inject for tests/proxies), `endpoint` (override the pinned API URL), `timeoutMs` (default 30000, covering the whole response), `signal` (an `AbortSignal` to cancel). Empty or non-Hebrew input, an unknown genre, HTTP failures (with Dicta's error message when it sends one), timeouts, aborts, and unexpected responses all throw `NakdanError`.

### What comes back

- Dicta's API echoes a normalized copy of your text: it drops existing niqqud and bidi marks, straightens ׳ ״ and curly quotes to `'` `"`, and turns no-break spaces into plain ones. This client lines the tokens back up with your input, so the pointed text keeps your own spacing and punctuation (צה״ל → צַהַ״ל, not צַהַ"ל). If the tokens ever fail to line up, it falls back to Dicta's text.
- Dicta marks prefix boundaries in its options with `|` (בְּ|בֵית). They're removed from `vocalized`, `options` and `text`.
- Words in the pointed text follow pointing conventions and can lose a mater lectionis: בבוקר comes back as בַּבֹּקֶר.
- Input that already has niqqud gets Dicta's own vocalization in place of it.
- There's no chunking. The endpoint handled 15,000 characters in about 10 seconds in testing; raise `timeoutMs` for very long texts.

The mocked test suite runs offline against a captured real response; `npm run smoke` calls the live API.

## A note on the upstream service

Dicta is a nonprofit and the Nakdan API is offered free with no formal published contract; its endpoints are version-numbered. This package pins a working endpoint and lets you override it via `opts.endpoint` if Dicta rolls a new version. Please use the service considerately.

## Related

By the same author: [`mispar`](https://github.com/moshejs/mispar) (Hebrew gematria, 13 classical methods) and [Gamatria](https://gamatria.vercel.app), a gematria search engine over the Tanakh and Mishnah.

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
