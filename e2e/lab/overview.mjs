// Whole-app screenshots in both themes and widths. Used by the lead to review.
import { openApp, seed, shot, snippetId } from "./helpers.mjs";

await seed();
const hash = await snippetId("binary_search.py");
for (const theme of ["dark", "light"]) {
  for (const [w, h, tag] of [[1280, 760, "desktop"], [390, 780, "phone"]]) {
    const { browser, page, errors } = await openApp({ theme, width: w, height: h, hash });
    await shot(page, `overview-${theme}-${tag}`);
    if (errors.length) console.log(`[${theme}/${tag}] errors:\n  ` + errors.join("\n  "));
    await browser.close();
  }
}
