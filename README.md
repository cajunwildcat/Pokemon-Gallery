# Pokémon Gallery

The gallery reads card details from the generated `tcgdex-database.json`. It does not import `data.json` automatically; each person manages their own collection in the app.

Use **Import collection** on the My Collection tab to load a collection JSON file or an export from the Android app [TCG Hub](https://play.google.com/store/apps/details?id=com.jacobgreenland.tcghub_pokemon&hl=en_US). The app maps known McDonald's promo IDs (`mcd1p`, `mcd2p`, and `mcd4p`–`mcd13p`) and `base6` to their TCGdex equivalents while importing. `mcd3p` is not mapped because the local TCGdex catalog has no corresponding McDonald's 2013 set. The **Save collection** button exports cards, binder pages, and featured Pokédex choices as `collection.json`. In browsers that support the file picker, choose where to save it; otherwise, the browser downloads the file. To have a collection load automatically on a browser with no saved local draft, place `collection.json` beside `index.html`. Browser security prevents a static site from silently writing to its project folder, so choose that folder in the save picker or move the downloaded file there.

Unsaved edits are kept as a local browser draft and trigger the browser's built-in warning when you try to leave the page. Browser security does not allow a custom save prompt during tab close; use **Save collection** to export the file before leaving.

Collection editing controls are available only when the page is opened on `localhost`, `127.0.0.1`, or `::1`. On other hosts, the gallery is read-only: visitors can still browse tabs, search, filter, inspect cards, and view saved binder pages. To publish a shared collection on GitHub Pages or another static host, include the intended `collection.json`; hosted content is public and the hidden controls are not access control.

To refresh the local database with the full TCGdex catalog, run:

```sh
node build-data.js
```

The updater fetches the TCGdex catalog and set metadata for every set, then reuses full card records already present in the local database and downloads only missing cards, independent of the contents of `data.json`. Pricing fields returned by TCGdex are discarded and not included in the local database. It preserves the API's set order and each set's card order. The gallery's default set sort follows those orders, and the Master Sets and Pokédex tabs use the same local database. The updater uses card IDs returned by each set endpoint, avoiding failed lookups caused by guessing numeric ID padding. You do not need to rebuild the database just to change your collection.

The database remains minified JSON for simple, dependency-free browser loading. When hosting the site, enabling HTTP Brotli or gzip compression can reduce transfer size substantially while the browser continues to read the same JSON file. The database is about 40 MB uncompressed without pricing and about 4 MB when gzip-compressed; a custom binary format would add parsing/tooling complexity and is unnecessary if the host can compress static assets.

The gallery has four views: **My Collection** shows owned cards and can sort by Pokédex number without combining cards for the same Pokémon; **Master Sets** browses and searches cards grouped by set, and can sort sets by release order or completion percentage; **Pokédex** groups Pokémon cards by National Pokédex number; and **Binder** lets you create and arrange custom pages with 2–6 rows and columns. Cards can be added from Master Sets and Pokédex, with a quick unlimited-copy action or a variant picker. Binder pages and featured Pokédex cards are included in `collection.json`. Choose owned cards for binder pockets, or enable Planning mode in the card picker to include the full catalog; unowned planned cards are marked in the binder. Search in My Collection and Master Sets can match Pokémon names (including special forms through Pokédex IDs) and set card numbers, for example `Sandshrew 62`. Master Sets search is debounced by 250 ms and does not search card descriptions. Unowned cards appear in grayscale in Master Sets and Pokédex. For Pokémon with multiple owned cards, use the selector to choose the featured card.

Set ID aliases can be configured in `SET_ID_MAPPINGS` in `build-data.js`; keep the browser mapping in `app.js` in sync. The `base6` → `lc` mapping retains Legendary Collection aliases. Known McDonald's promo aliases map to the TCGdex collections for 2011, 2012, 2014–2019, and 2021–2024. Each alias adds source-set card IDs to the local database so existing inventory IDs continue to work.

Failures are recorded in `build-data-errors.log`; failed set/card records are skipped while the remaining data is downloaded. The log is replaced on each run, so it only contains errors from the most recent update. A catalog or other fatal build error is logged before the script exits unsuccessfully.

Serve this folder over HTTP to view the page, for example:

```sh
python -m http.server 8000
```

The GitHub Actions workflow also refreshes the database weekly and can be run manually from the Actions tab.
