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
r.words[0].options;            // alternative vocalizations Dicta considered
r.words[0].confident;          // whether Dicta was sure
```

## API

- **`vocalize(text, opts?)`** → the pointed string (the common case).
- **`nakdan(text, opts?)`** → `{ text, words }`, where each word is `{ word, vocalized, isSeparator, options, confident }` — separators (spaces, punctuation) are preserved in order so you can reconstruct or re-render the text.

**`opts`**: `genre` (`"modern"` default, `"rabbinic"`, or `"poetry"`), `fetch` (inject for tests/proxies), `endpoint` (override the pinned API URL), `timeoutMs` (default 30000). Empty or non-Hebrew input, HTTP failures, timeouts, and unexpected responses all throw `NakdanError`.

The mocked test suite runs offline against a captured real response; `npm run smoke` calls the live API.

## A note on the upstream service

Dicta is a nonprofit and the Nakdan API is offered free with no formal published contract; its endpoints are version-numbered. This package pins a working endpoint and lets you override it via `opts.endpoint` if Dicta rolls a new version. Please use the service considerately.

## Related

By the same author: [`mispar`](https://github.com/moshejs/mispar) (Hebrew gematria, 13 classical methods) and [Gamatria](https://gamatria.vercel.app), a gematria search engine over the Tanakh and Mishnah.

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
