// Live smoke test against the real Dicta Nakdan API (not run in CI).
// Usage: npm run smoke
import { nakdan, vocalize } from "../dist/index.js";

const text = "שלום עולם. אני כותב קוד.";
const pointed = await vocalize(text);
console.log(`input:  ${text}`);
console.log(`nakdan: ${pointed}`);

const full = await nakdan("בראשית ברא אלהים", { genre: "rabbinic" });
console.log(`words: ${full.words.filter((w) => !w.isSeparator).length}`);
for (const w of full.words.filter((x) => !x.isSeparator)) {
  console.log(`  ${w.word} → ${w.vocalized}  (${w.options.length} options, confident=${w.confident})`);
}
if (pointed.includes("|")) throw new Error("prefix markers leaked into the output");
console.log("SMOKE OK");
