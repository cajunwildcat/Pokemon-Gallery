# Project Guidelines

## Project structure

- This is a dependency-free static Pokémon card gallery. `index.html` loads `styles.css` and `app.js`; keep presentation, behavior, and markup in their respective files.
- The gallery combines the owned-card inventory in `data.json` with the generated local TCGdex cache in `tcgdex-database.json`. Do not add per-card API requests to the browser.
- Card art and card/set information use TCGdex asset URLs and cached TCGdex records.

## Inventory and cache

- `data.json` entries use `cardId`, `variantId`, and `count`. Preserve this source format when changing inventory behavior.
- `build-data.js` refreshes all set metadata and downloads missing card records, reusing records already in the local cache. Run `node build-data.js` after changing builder behavior.
- Omit TCGdex pricing from generated and checked-in card records; prefer HTTP compression over introducing a custom database format for the static browser app.
- The generated database includes ordered set and card IDs; preserve the set catalog's API order and each set's returned card order. The gallery relies on these for default sorting.
- `SET_ID_MAPPINGS` in `build-data.js` maps inventory set IDs to TCGdex set IDs. Keep aliases available in the generated card cache; currently `base6` maps to `lc` and `mcd10p` maps to `2021swsh`.
- Normalize numeric card-ID padding consistently when matching inventory entries to TCGdex records.
- `build-data-errors.log` is replaced on each build and contains readable, multi-line errors from only the latest run. Failed set/card fetches are logged and skipped so the rest of the cache can be generated; fatal input/build errors should still exit unsuccessfully.

## Gallery behavior

- Group inventory entries with the same normalized card ID into one collection card. Sum total quantity and retain each variant's quantity for filters and the details dialog.
- Search should match card/set metadata and illustrator names. Keep set, type, rarity, variant, illustrator, and sort controls working together.
- The default sort follows TCGdex set catalog order and card order. Other sorts include name, rarity, collection count, and original inventory order ("Date added").
- Keep the My Collection, Master Sets, and Pokédex tabs consistent with the shared local card database; Master Sets and Pokédex highlight owned cards and gray out unowned art.
- Build Pokédex entries from Pokémon card `dexId` values, deduplicating card records and grouping multi-Pokémon cards under each associated number. Strip card-form suffixes/prefixes from displayed species names.
- Card details include all owned variants and their counts. Preserve dialog dismissal by close button, backdrop, and Escape; clicking detail art opens the enlarged art dialog.
- Keep the controls on one horizontal row; allow horizontal scrolling on narrow screens.

## Validation

- Syntax-check scripts with `node --check app.js` and `node --check build-data.js`.
- Serve the directory over HTTP (for example, `python -m http.server 8000`) to test the static page and its JSON fetches.
- When changing the data builder, run `node build-data.js` and verify the inventory IDs resolve, set order is preserved, and the latest error log is accurate.
