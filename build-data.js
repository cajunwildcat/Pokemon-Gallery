const fs = require("node:fs/promises");
const path = require("node:path");

const API_ROOT = "https://api.tcgdex.net/v2/en";
const CONCURRENCY = 5;
const SET_ID_MAPPINGS = {
    base6: "lc"
};
const [outputArg = "tcgdex-database.json"] = process.argv.slice(2);
const outputPath = path.resolve(outputArg);
const errorLogPath = path.join(path.dirname(outputPath), "build-data-errors.log");
const errors = [];

function logError(message, context = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        ...context,
        message
    };
    errors.push(entry);
    console.error(`[${entry.stage || "build"}] ${message}`);
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function formatErrorLogEntry(entry, index) {
    const lines = [
        `Error ${index + 1} - ${entry.stage || "build"}`,
        `Time: ${entry.timestamp}`
    ];
    for (const key of ["setId", "cardId", "inventoryIndex", "url"]) {
        if (entry[key] !== undefined) lines.push(`${key}: ${entry[key]}`);
    }
    lines.push(`Message: ${entry.message}`);
    return lines.join("\n");
}

function normalizeCardId(cardId) {
    return cardId.replace(/^(.*-)(\d+)$/, (_, prefix, number) => (
        `${prefix}${number.replace(/^0+(?=\d)/, "")}`
    ));
}

async function fetchJson(url) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (response.ok) return response.json();

            const error = new Error(`TCGdex returned ${response.status} for ${url}.`);
            if (response.status < 500 && response.status !== 429) throw error;
            lastError = error;
            const retryAfter = Number(response.headers.get("retry-after"));
            const delay = Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : 500 * (2 ** attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            if (/^TCGdex returned 4\d{2}/.test(error.message)
                && !error.message.startsWith("TCGdex returned 429")) {
                throw error;
            }
            lastError = error;
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
        }
    }
    throw lastError;
}

async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

async function main() {
    try {
        await fs.mkdir(path.dirname(errorLogPath), { recursive: true });
        await fs.writeFile(errorLogPath, "", "utf8");

        let availableSets;
        try {
            availableSets = await fetchJson(`${API_ROOT}/sets`);
            if (!Array.isArray(availableSets)) {
                throw new Error("TCGdex set catalog did not return a list.");
            }
        } catch (error) {
            logError(errorMessage(error), { stage: "set-catalog", url: `${API_ROOT}/sets` });
            process.exitCode = 1;
            return;
        }

        const orderedSetIds = availableSets.map(set => set.id);
        const aliasesByCanonicalId = new Map();
        for (const [sourceSetId, canonicalId] of Object.entries(SET_ID_MAPPINGS)) {
            if (!aliasesByCanonicalId.has(canonicalId)) {
                aliasesByCanonicalId.set(canonicalId, new Set());
            }
            aliasesByCanonicalId.get(canonicalId).add(sourceSetId);
        }
        const sets = {};
        const cards = {};
        let downloadedCardCount = 0;

        for (const [index, setId] of orderedSetIds.entries()) {
            console.log(`Downloading ${setId} (${index + 1}/${orderedSetIds.length})`);

            let setDetails;
            try {
                setDetails = await fetchJson(`${API_ROOT}/sets/${encodeURIComponent(setId)}`);
                if (!Array.isArray(setDetails.cards)) {
                    throw new Error(`TCGdex set ${setId} did not include a cards list.`);
                }
            } catch (error) {
                logError(errorMessage(error), {
                    stage: "set",
                    setId,
                    url: `${API_ROOT}/sets/${encodeURIComponent(setId)}`
                });
                continue;
            }

            const cardDetails = await mapLimit(setDetails.cards, CONCURRENCY, async listedCard => {
                if (typeof listedCard.id !== "string" || !listedCard.id) {
                    logError("TCGdex returned a card without an ID.", {
                        stage: "card",
                        setId
                    });
                    return null;
                }

                try {
                    return await fetchJson(`${API_ROOT}/cards/${encodeURIComponent(listedCard.id)}`);
                } catch (error) {
                    logError(errorMessage(error), {
                        stage: "card",
                        setId,
                        cardId: listedCard.id,
                        url: `${API_ROOT}/cards/${encodeURIComponent(listedCard.id)}`
                    });
                    return null;
                }
            });

            const cardIds = [];
            const sourceSetIds = aliasesByCanonicalId.get(setId) || new Set();
            for (const card of cardDetails.filter(Boolean)) {
                if (typeof card.id !== "string" || !card.id) {
                    logError("TCGdex returned card details without an ID.", {
                        stage: "card",
                        setId
                    });
                    continue;
                }
                const normalizedId = normalizeCardId(card.id);
                const existing = cards[normalizedId];
                if (existing && existing.id !== card.id) {
                    logError(`Card ID normalization collision with ${existing.id}.`, {
                        stage: "card",
                        setId,
                        cardId: card.id
                    });
                    continue;
                }
                const cardData = { ...card };
                delete cardData.pricing;
                cards[normalizedId] = cardData;
                cardIds.push(normalizedId);
                for (const sourceSetId of sourceSetIds) {
                    const sourceCardId = normalizeCardId(`${sourceSetId}-${card.localId}`);
                    const sourceExisting = cards[sourceCardId];
                    if (sourceExisting && sourceExisting.id !== card.id) {
                        logError(`Card ID mapping collision with ${sourceExisting.id}.`, {
                            stage: "card",
                            setId,
                            sourceSetId,
                            cardId: sourceCardId
                        });
                        continue;
                    }
                    cards[sourceCardId] = cardData;
                }
                downloadedCardCount += 1;
            }

            const { cards: listedCards, ...setMetadata } = setDetails;
            sets[setId] = { ...setMetadata, cardIds };
            const failedCount = setDetails.cards.length - cardIds.length;
            console.log(`  Cached ${cardIds.length} cards${failedCount ? `; ${failedCount} failed` : ""}`);
        }

        const database = {
            version: 1,
            source: "TCGdex",
            availableSets: Array.isArray(availableSets)
                ? availableSets
                    .map(({ id, name, releaseDate, cardCount }) => ({ id, name, releaseDate, cardCount }))
                : [],
            sets,
            cards
        };

        await fs.writeFile(outputPath, `${JSON.stringify(database)}\n`, "utf8");
        console.log(`Wrote ${downloadedCardCount} cards from ${Object.keys(sets).length} of ${orderedSetIds.length} sets to ${outputPath}`);
        if (errors.length) {
            console.warn(`${errors.length} error(s) recorded in ${errorLogPath}`);
        } else {
            console.log(`No errors. ${errorLogPath} is empty.`);
        }
    } catch (error) {
        logError(errorMessage(error), { stage: "build" });
        process.exitCode = 1;
    } finally {
        try {
            const logContents = errors.map(formatErrorLogEntry).join("\n\n");
            await fs.writeFile(errorLogPath, logContents ? `${logContents}\n` : "", "utf8");
        } catch (error) {
            console.error(`Could not write error log ${errorLogPath}: ${errorMessage(error)}`);
            process.exitCode = 1;
        }
    }
}

main();
