# Pokémon Gallery

The gallery reads your collection from `data.json` and card details from the generated `tcgdex-database.json`.

The imported collection data is expected in the export format provided by the Android app [TCG Hub](https://play.google.com/store/apps/details?id=com.jacobgreenland.tcghub_pokemon&hl=en_US). Place its exported JSON file in the project as `data.json`.

To refresh the local database with the full TCGdex catalog, run:

```sh
node build-data.js
```

The updater fetches the TCGdex catalog and downloads full card records for every set and card returned by the API, independent of the contents of `data.json`. Pricing fields returned by TCGdex are discarded and not included in the local database. It preserves the API's set order and each set's card order. The gallery's default set sort follows those orders, and the Master Sets and Pokédex tabs use the same local database. The updater uses card IDs returned by each set endpoint, avoiding failed lookups caused by guessing numeric ID padding. You do not need to rebuild the database just to change your collection.

The database remains minified JSON for simple, dependency-free browser loading. When hosting the site, enabling HTTP Brotli or gzip compression can reduce transfer size substantially while the browser continues to read the same JSON file. The database is about 40 MB uncompressed without pricing and about 4 MB when gzip-compressed; a custom binary format would add parsing/tooling complexity and is unnecessary if the host can compress static assets.

The gallery has three views: **My Collection** shows owned cards and can sort by Pokédex number without combining cards for the same Pokémon; **Master Sets** browses and searches cards grouped by set; and **Pokédex** groups Pokémon cards by National Pokédex number. Search in My Collection and Master Sets can match Pokémon names (including special forms through Pokédex IDs) and set card numbers, for example `Sandshrew 62`. Master Sets search is debounced by 250 ms and does not search card descriptions. Unowned cards appear in grayscale in the latter two views. For Pokémon with multiple owned cards, use the selector to choose the featured card.

Set ID aliases can be configured in `SET_ID_MAPPINGS` in `build-data.js`. The initial `base6` → `lc` mapping downloads Legendary Collection from TCGdex and adds `base6-*` card-ID aliases to the local database so existing inventory IDs continue to work.

Failures are recorded in `build-data-errors.log`; failed set/card records are skipped while the remaining data is downloaded. The log is replaced on each run, so it only contains errors from the most recent update. A catalog or other fatal build error is logged before the script exits unsuccessfully.

Serve this folder over HTTP to view the page, for example:

```sh
python -m http.server 8000
```

The GitHub Actions workflow also refreshes the database weekly and can be run manually from the Actions tab.
