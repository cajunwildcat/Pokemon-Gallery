# Pokémon Gallery

The gallery reads your collection from `data.json` and card details from the generated `tcgdex-database.json`.

The imported collection data is expected in the export format provided by the Android app [TCG Hub](https://play.google.com/store/apps/details?id=com.jacobgreenland.tcghub_pokemon&hl=en_US). Place its exported JSON file in the project as `data.json`.

When you change the collection, refresh the local database with:

```sh
node build-data.js
```

The updater fetches the TCGdex catalog to keep the available-set list current, then downloads full card records for every set represented in `data.json`. The gallery's default set sort follows the order of that catalog, with each set's cards following TCGdex's card order. It uses the card IDs returned by TCGdex's set data, avoiding failed lookups and retry requests caused by guessing numeric ID padding.

Set ID aliases can be configured in `SET_ID_MAPPINGS` in `build-data.js`. The initial `base6` → `lc` mapping downloads Legendary Collection from TCGdex and adds `base6-*` card-ID aliases to the local database so existing inventory IDs continue to work.

Nonfatal catalog, set, and card download failures are recorded in `build-data-errors.log`; failed records are skipped while the remaining data is downloaded. The log is replaced on each run, so it only contains errors from the most recent update. A fatal input/build error is logged before the script exits unsuccessfully.

Serve this folder over HTTP to view the page, for example:

```sh
python -m http.server 8000
```

The GitHub Actions workflow also refreshes the database weekly and can be run manually from the Actions tab.
