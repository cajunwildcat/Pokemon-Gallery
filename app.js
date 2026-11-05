        const grid = document.getElementById("card-grid");
        const searchInput = document.getElementById("search");
        const filterElements = {
            set: document.getElementById("set-filter"),
            type: document.getElementById("type-filter"),
            rarity: document.getElementById("rarity-filter"),
            variant: document.getElementById("variant-filter"),
            illustrator: document.getElementById("illustrator-filter")
        };
        const sortSelect = document.getElementById("sort-order");
        const dialog = document.getElementById("card-dialog");
        const artDialog = document.getElementById("art-dialog");
        const missingImageUrl = "./assets/missing_image.webp";
        const masterSetList = document.getElementById("master-set-list");
        const pokedexGrid = document.getElementById("pokedex-grid");
        const pokedexSearch = document.getElementById("pokedex-search");
        const masterSetSearch = document.getElementById("master-set-search");
        const masterSetSort = document.getElementById("master-set-sort");
        const tabs = [...document.querySelectorAll(".view-tab")];
        let collection = [];
        let databaseSets = {};
        let setOrder = new Map();
        let availableSets = [];
        let allCardsById = new Map();
        let ownedCardsByApiId = new Map();
        let pokedexEntries = [];
        const speciesDexIds = new Map();
        const failedPokedexImageCards = new Set();
        const featuredPokedexCards = new Map();
        let pokedexRendered = false;

        function escapeHtml(value) {
            return String(value ?? "").replace(/[&<>"']/g, character => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
            })[character]);
        }

        function formatVariant(value) {
            return String(value || "standard").replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
        }

        function normalizeCardId(cardId) {
            return cardId.replace(/^(.*-)(\d+)$/, (_, prefix, number) => `${prefix}${number.replace(/^0+(?=\d)/, "")}`);
        }

        function normalizePokemonName(name) {
            let normalized = String(name || "").split(/\s*&\s*/)[0].trim();
            normalized = normalized
                .replace(/^(?:(?:alolan|galarian|hisuian|paldean|hisui|galar|paldea|mega|primal|radiant|shining|ancient|dark|light|team aqua's|team magma's|team plasma's|team rocket's|rocket's|m)\s+)+/i, "")
                .replace(/\s*\([^)]*\)\s*$/, "")
                .replace(/\s+(?:origin|therian|sky|attack|defense|speed|school|complete|10%|50%)\s+forme?$/i, "")
                .trim();

            const formSuffix = /(?:\s+|\s*[-–—]\s*)(?:lv\.?\s*x|e4|gl|fb|sp|prime|legend|break|delta(?:\s+species)?|δ|gx|vmax|vstar|v-union|ex|v|g|c)\s*$/i;
            let previous;
            do {
                previous = normalized;
                normalized = normalized.replace(formSuffix, "").trim();
            } while (normalized !== previous);

            return normalized;
        }

        function imageUrl(card) {
            const image = card.details?.image;
            return image ? `${image}/high.webp` : "";
        }

        function fallbackImageUrl(card) {
            const image = card.details?.image;
            return image ? `${image}/low.webp` : "";
        }

        function handleCardImageError(image, card, options = {}) {
            const lowResolutionImage = fallbackImageUrl(card);
            if (lowResolutionImage && image.dataset.lowResolutionTried !== "true") {
                image.dataset.lowResolutionTried = "true";
                image.src = lowResolutionImage;
                return;
            }
            if (options.preserveImageAlt && options.onImageUnavailable?.(card)) return;
            if (image.getAttribute("src") !== missingImageUrl) {
                image.src = missingImageUrl;
                return;
            }
            image.removeAttribute("src");
            image.alt = options.alt || `${cardName(card)} card image unavailable`;
        }

        function cardName(card) { return card.details?.name || card.cardId; }
        function setName(card) { return card.details?.set?.name || card.cardId.split("-")[0].toUpperCase(); }

        function compareText(a, b) {
            return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
        }

        function addSearchClearButton(input, button) {
            const updateVisibility = () => { button.hidden = !input.value; };
            input.addEventListener("input", updateVisibility);
            button.addEventListener("click", () => {
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.focus();
            });
            return updateVisibility;
        }

        function cardGroupId(card) {
            return normalizeCardId(card.details?.id || card.cardId);
        }

        function setCardOrder(card) {
            const setId = card.details?.set?.id;
            const cardIds = databaseSets[setId]?.cardIds || [];
            const index = cardIds.indexOf(cardGroupId(card));
            return index < 0 ? Number.MAX_SAFE_INTEGER : index;
        }

        function setCatalogOrder(card) {
            return setOrder.get(card.details?.set?.id) ?? Number.MAX_SAFE_INTEGER;
        }

        function cardDexNumber(card) {
            const dexIds = (card.details?.dexId || [])
                .map(Number)
                .filter(dexId => Number.isInteger(dexId) && dexId > 0);
            return dexIds.length ? Math.min(...dexIds) : Number.MAX_SAFE_INTEGER;
        }

        function normalizeCardNumber(value) {
            return String(value || "").replace(/^0+(?=\d)/, "");
        }

        function pokemonSearch(query) {
            const match = query.trim().match(/^(.+?)(?:\s+#?(\d+))?$/);
            if (!match) return null;
            const name = normalizePokemonName(match[1]).toLocaleLowerCase();
            const dexIds = speciesDexIds.get(name);
            return dexIds ? { dexIds, cardNumber: match[2] || null } : null;
        }

        function cardMatchesSearch(card, query, includeDescription = true) {
            const pokemonQuery = pokemonSearch(query);
            if (pokemonQuery) {
                const hasSpecies = (card.details?.dexId || []).some(dexId =>
                    pokemonQuery.dexIds.has(Number(dexId))
                );
                return hasSpecies && (!pokemonQuery.cardNumber
                    || normalizeCardNumber(card.details?.localId) === normalizeCardNumber(pokemonQuery.cardNumber));
            }

            const detail = card.details || {};
            const searchable = [
                cardName(card), card.cardId, detail.localId, setName(card),
                detail.rarity, ...(includeDescription ? [detail.description] : []),
                detail.illustrator, ...(detail.types || [])
            ].filter(Boolean).join(" ").toLocaleLowerCase();
            return searchable.includes(query.trim().toLocaleLowerCase());
        }

        function debounce(callback, delay) {
            let timeoutId;
            return (...args) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => callback(...args), delay);
            };
        }

        function cardVariants(card) {
            return card.variants || [{ variantId: card.variantId, count: card.count }];
        }

        function sortCards(cards) {
            if (sortSelect.value === "added") {
                return cards.sort((a, b) => a.inventoryOrder - b.inventoryOrder);
            }

            return cards.sort((a, b) => {
                let primary = 0;
                if (sortSelect.value === "name") {
                    primary = compareText(cardName(a), cardName(b));
                } else if (sortSelect.value === "rarity") {
                    primary = compareText(a.details?.rarity, b.details?.rarity);
                } else if (sortSelect.value === "count") {
                    primary = b.count - a.count;
                } else if (sortSelect.value === "pokedex") {
                    primary = cardDexNumber(a) - cardDexNumber(b)
                        || setCatalogOrder(a) - setCatalogOrder(b)
                        || setCardOrder(a) - setCardOrder(b);
                } else {
                    primary = setCatalogOrder(a) - setCatalogOrder(b)
                        || setCardOrder(a) - setCardOrder(b);
                }

                return primary
                    || compareText(cardGroupId(a), cardGroupId(b))
                    || a.inventoryOrder - b.inventoryOrder;
            });
        }

        function groupInventoryCards(cards, cardDetails) {
            const groupedCards = new Map();
            for (const [inventoryOrder, inventoryCard] of cards.entries()) {
                const normalizedId = normalizeCardId(inventoryCard.cardId);
                let card = groupedCards.get(normalizedId);
                if (!card) {
                    card = {
                        ...inventoryCard,
                        cardId: normalizedId,
                        count: 0,
                        variants: [],
                        inventoryOrder,
                        details: cardDetails[normalizedId] || null
                    };
                    groupedCards.set(normalizedId, card);
                }

                const count = Number(inventoryCard.count) || 0;
                card.count += count;
                const variantId = inventoryCard.variantId || "standard";
                const variant = card.variants.find(item => item.variantId === variantId);
                if (variant) variant.count += count;
                else card.variants.push({ variantId, count });
            }
            return [...groupedCards.values()];
        }

        function cardFromDetails(details, ownedCard = null) {
            if (ownedCard) return ownedCard;
            return {
                cardId: normalizeCardId(details.id),
                count: 0,
                variants: [],
                inventoryOrder: Number.MAX_SAFE_INTEGER,
                details
            };
        }

        function hasUnlimitedVariant(details) {
            return Boolean(details.variants?.normal)
                || (details.variants_detailed || []).some(variant => variant.type === "normal");
        }

        function shuffled(items) {
            const result = [...items];
            for (let index = result.length - 1; index > 0; index -= 1) {
                const swapIndex = Math.floor(Math.random() * (index + 1));
                [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
            }
            return result;
        }

        function buildPokedexEntries(detailsList) {
            speciesDexIds.clear();
            const uniqueCards = new Map();
            for (const details of detailsList) {
                if (details.id) uniqueCards.set(normalizeCardId(details.id), details);
            }

            const entries = new Map();
            const nameToDexId = new Map();

            for (const details of uniqueCards.values()) {
                if (details.category !== "Pokemon") continue;
                const dexIds = [...new Set((details.dexId || [])
                    .map(Number)
                    .filter(dexId => Number.isInteger(dexId) && dexId > 0))];
                for (const dexId of dexIds) {
                    if (!entries.has(dexId)) entries.set(dexId, { dexId, cards: new Map(), nameCounts: new Map() });
                    entries.get(dexId).cards.set(normalizeCardId(details.id), details);
                }

                const pokemonName = normalizePokemonName(details.name);
                if (pokemonName) {
                    const normalizedName = pokemonName.toLocaleLowerCase();
                    if (!speciesDexIds.has(normalizedName)) speciesDexIds.set(normalizedName, new Set());
                    for (const dexId of dexIds) speciesDexIds.get(normalizedName).add(dexId);
                    if (dexIds.length === 1) {
                        const entry = entries.get(dexIds[0]);
                        entry.nameCounts.set(pokemonName, (entry.nameCounts.get(pokemonName) || 0) + 1);
                        if (!nameToDexId.has(normalizedName)) nameToDexId.set(normalizedName, dexIds[0]);
                    }
                }
            }

            for (const details of uniqueCards.values()) {
                if (details.category !== "Pokemon" || details.dexId?.length) continue;
                const dexId = nameToDexId.get(normalizePokemonName(details.name).toLocaleLowerCase());
                if (dexId) entries.get(dexId).cards.set(normalizeCardId(details.id), details);
            }

            return [...entries.values()].map(entry => {
                const candidates = [...entry.nameCounts.entries()]
                    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || compareText(a[0], b[0]));
                const cardList = [...entry.cards.values()];
                const ownedCards = new Map();
                for (const details of cardList) {
                    const ownedCard = ownedCardsByApiId.get(normalizeCardId(details.id));
                    if (ownedCard) ownedCards.set(cardGroupId(ownedCard), ownedCard);
                }
                const ownedCardList = [...ownedCards.values()].sort((a, b) => a.inventoryOrder - b.inventoryOrder);
                const imageCandidates = [
                    ...shuffled(cardList.filter(details => details.image && hasUnlimitedVariant(details))),
                    ...shuffled(cardList.filter(details => details.image && !hasUnlimitedVariant(details)))
                ];
                const featuredCard = ownedCardList[0] || cardFromDetails(
                    imageCandidates.length ? imageCandidates[0] : cardList[0]
                );
                return {
                    dexId: entry.dexId,
                    name: candidates[0]?.[0] || `Pokémon #${entry.dexId}`,
                    cards: cardList,
                    ownedCards: ownedCardList,
                    ownedCount: ownedCardList.reduce((sum, card) => sum + card.count, 0),
                    imageCandidates: imageCandidates.map(details => cardFromDetails(details)),
                    featuredCard
                };
            }).sort((a, b) => a.dexId - b.dexId);
        }

        function masterSetCardEntries(setId) {
            const details = databaseSets[setId];
            if (!details) return [];
            return (details.cardIds || []).flatMap(cardId => {
                const cardDetails = allCardsById.get(normalizeCardId(cardId));
                if (!cardDetails) return [];
                const ownedCard = ownedCardsByApiId.get(normalizeCardId(cardDetails.id));
                return [{
                    card: cardFromDetails(cardDetails, ownedCard),
                    unowned: !ownedCard
                }];
            });
        }

        function renderMasterSetCards(content, entries) {
            const grid = document.createElement("div");
            grid.className = "card-grid";
            if (!entries.length) {
                grid.innerHTML = '<div class="empty-state"><strong>No cards available</strong>This set has no matching cached card records.</div>';
            } else {
                for (const entry of entries) grid.append(renderCard(entry.card, { unowned: entry.unowned }));
            }
            content.append(grid);
        }

        function renderMasterSetList() {
            const query = masterSetSearch.value.trim().toLocaleLowerCase();
            masterSetList.replaceChildren();
            let visibleSetCount = 0;
            let matchingCardCount = 0;
            const sets = availableSets.map((catalogSet, releaseOrder) => {
                const setDetails = databaseSets[catalogSet.id];
                const cardIds = setDetails?.cardIds || [];
                const totalCount = cardIds.length || catalogSet.cardCount?.total || 0;
                const ownedCount = cardIds.filter(cardId => {
                    const cardDetails = allCardsById.get(normalizeCardId(cardId));
                    return cardDetails && ownedCardsByApiId.has(normalizeCardId(cardDetails.id));
                }).length;
                return { catalogSet, setDetails, cardIds, ownedCount, totalCount, releaseOrder };
            });
            if (masterSetSort.value !== "release") {
                sets.sort((a, b) => {
                    const completionA = a.totalCount ? a.ownedCount / a.totalCount : 0;
                    const completionB = b.totalCount ? b.ownedCount / b.totalCount : 0;
                    const completionOrder = masterSetSort.value === "most-complete"
                        ? completionB - completionA
                        : completionA - completionB;
                    return completionOrder || a.releaseOrder - b.releaseOrder;
                });
            }
            for (const { catalogSet, setDetails, cardIds, ownedCount, totalCount } of sets) {
                const setNameText = setDetails?.name || catalogSet.name || catalogSet.id;
                const setMatches = query
                    && `${setNameText} ${catalogSet.id}`.toLocaleLowerCase().includes(query);
                const matchingCards = query && !setMatches
                    ? masterSetCardEntries(catalogSet.id).filter(entry =>
                        cardMatchesSearch(entry.card, query, false)
                    )
                    : null;
                if (query && !setMatches && !matchingCards.length) continue;
                visibleSetCount += 1;
                if (query && !setMatches) matchingCardCount += matchingCards.length;

                const progress = totalCount ? Math.round((ownedCount / totalCount) * 100) : 0;
                const setGroup = document.createElement("details");
                setGroup.className = "master-set";
                setGroup.innerHTML = `
                    <summary>
                        <span class="master-set-summary">
                            ${setDetails?.logo ? `<img class="master-set-logo" src="${escapeHtml(setDetails.logo)}.webp" alt="" loading="lazy">` : ""}
                            <span class="master-set-overview">
                                <span class="master-set-name">${escapeHtml(setNameText)}</span>
                                <span class="master-set-progress-row">
                                    <span class="master-set-progress" role="progressbar" aria-label="${escapeHtml(setNameText)} collection progress" aria-valuemin="0" aria-valuemax="${totalCount}" aria-valuenow="${ownedCount}">
                                        <span style="width: ${progress}%"></span>
                                    </span>
                                    <span class="master-set-summary-meta">${ownedCount} / ${totalCount}</span>
                                </span>
                            </span>
                        </span>
                    </summary>
                    <div class="master-set-content"></div>`;
                const logo = setGroup.querySelector(".master-set-logo");
                if (logo) {
                    logo.addEventListener("error", () => {
                        if (logo.getAttribute("src") !== missingImageUrl) logo.src = missingImageUrl;
                        else logo.removeAttribute("src");
                    });
                }
                const content = setGroup.querySelector(".master-set-content");
                const renderCards = () => {
                    if (setGroup.dataset.rendered) return;
                    if (!setDetails) {
                        content.textContent = "Card data for this set is unavailable in the local database.";
                    } else {
                        renderMasterSetCards(content, matchingCards || masterSetCardEntries(catalogSet.id));
                    }
                    setGroup.dataset.rendered = "true";
                };
                setGroup.addEventListener("toggle", () => {
                    if (!setGroup.open || setGroup.dataset.rendered) return;
                    renderCards();
                });
                masterSetList.append(setGroup);
                if (query && !setMatches) {
                    setGroup.open = true;
                    renderCards();
                }
            }
            if (query && !visibleSetCount) {
                const empty = document.createElement("div");
                empty.className = "empty-state";
                empty.innerHTML = "<strong>No sets or cards match this search</strong>Try a different card, Pokémon, or set name.";
                masterSetList.append(empty);
            }
            document.getElementById("master-set-count").textContent = `${visibleSetCount} of ${availableSets.length} sets${matchingCardCount ? ` · ${matchingCardCount} matching cards` : ""}`;
        }

        function renderPokedex() {
            const query = pokedexSearch.value.trim().toLocaleLowerCase();
            const entries = pokedexEntries.filter(entry => (
                !query
                || entry.name.toLocaleLowerCase().includes(query)
                || String(entry.dexId).includes(query.replace(/^#/, ""))
            ));
            pokedexRendered = true;
            pokedexGrid.replaceChildren();
            if (!entries.length) {
                const empty = document.createElement("div");
                empty.className = "empty-state";
                empty.innerHTML = "<strong>No Pokémon match this search</strong>Try another name or Pokédex number.";
                pokedexGrid.append(empty);
            }
            for (const entry of entries) {
                const owned = entry.ownedCards.length > 0;
                const featuredId = featuredPokedexCards.get(entry.dexId);
                const featured = entry.ownedCards.find(card => cardGroupId(card) === featuredId)
                    || entry.featuredCard;
                featuredPokedexCards.set(entry.dexId, cardGroupId(featured));

                const renderPokemonCard = selectedCard => {
                    const cardElement = renderCard(selectedCard, {
                        unowned: !owned,
                        preserveImageAlt: !owned,
                        onImageUnavailable: !owned ? failedCard => {
                            failedPokedexImageCards.add(cardGroupId(failedCard));
                            const nextCard = entry.imageCandidates.find(candidate =>
                                !failedPokedexImageCards.has(cardGroupId(candidate))
                            );
                            if (nextCard) {
                                entry.featuredCard = nextCard;
                                cardElement.replaceWith(renderPokemonCard(nextCard));
                                return true;
                            }
                            return false;
                        } : null
                    });
                    cardElement.classList.add("pokemon-card");
                    cardElement.querySelector(".card-name").textContent = entry.name;
                    cardElement.querySelector(".card-number").textContent = `#${String(entry.dexId).padStart(3, "0")}`;
                    cardElement.querySelector(".set-name").textContent = `${setName(selectedCard)} · ${selectedCard.details?.localId || ""}`;
                    const countElement = cardElement.querySelector(".owned-count");
                    if (owned) {
                        countElement.textContent = `×${entry.ownedCount}`;
                        countElement.setAttribute("aria-label", `${entry.ownedCount} cards owned`);
                    } else {
                        cardElement.querySelector(".unowned-count").textContent = "Not collected";
                    }

                    if (entry.ownedCards.length > 1) {
                        const select = document.createElement("select");
                        select.className = "featured-card-select";
                        select.setAttribute("aria-label", `Featured card for ${entry.name}`);
                        for (const ownedCard of entry.ownedCards) {
                            const option = new Option(
                                `${setName(ownedCard)} · ${ownedCard.details.localId} ${cardName(ownedCard)}`,
                                cardGroupId(ownedCard),
                                false,
                                cardGroupId(ownedCard) === cardGroupId(selectedCard)
                            );
                            select.add(option);
                        }
                        select.addEventListener("change", () => {
                            featuredPokedexCards.set(entry.dexId, select.value);
                            renderPokedex();
                        });
                        cardElement.querySelector(".card-info").append(select);
                    } else if (owned) {
                        const note = document.createElement("span");
                        note.className = "featured-card-label";
                        note.textContent = "Your featured card";
                        cardElement.querySelector(".card-info").append(note);
                    }
                    return cardElement;
                };
                const cardElement = renderPokemonCard(featured);
                pokedexGrid.append(cardElement);
            }
            document.getElementById("pokedex-count").textContent = `${entries.length} of ${pokedexEntries.length} Pokémon`;
        }

        function addFilterOptions(select, values, placeholder) {
            const sortedValues = [...values].filter(Boolean).sort((a, b) => a.localeCompare(b));
            select.replaceChildren(new Option(placeholder, ""));
            for (const value of sortedValues) select.add(new Option(value, value));
        }

        function populateFilters() {
            addFilterOptions(filterElements.set, new Set(collection.map(setName)), "All sets");
            addFilterOptions(filterElements.type, new Set(collection.flatMap(card => card.details?.types || [])), "All types");
            addFilterOptions(filterElements.rarity, new Set(collection.map(card => card.details?.rarity)), "All rarities");
            addFilterOptions(filterElements.variant, new Set(collection.flatMap(card =>
                cardVariants(card).map(variant => formatVariant(variant.variantId))
            )), "All variants");
            addFilterOptions(filterElements.illustrator, new Set(collection.map(card => card.details?.illustrator)), "All illustrators");
        }

        function renderCard(card, options = {}) {
            const detail = card.details || {};
            const tags = [...(detail.types || []), detail.rarity].filter(Boolean)
                .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
            const variants = cardVariants(card).map(variant =>
                `<span class="tag">${escapeHtml(formatVariant(variant.variantId))}</span>`
            ).join("");
            const cardElement = document.createElement("article");
            cardElement.className = "card";
            if (options.unowned) cardElement.classList.add("unowned");
            cardElement.innerHTML = `
                <button class="card-image-button" type="button" aria-label="View ${escapeHtml(cardName(card))} details">
                    <img class="card-image" src="${escapeHtml(imageUrl(card) || missingImageUrl)}" alt="${escapeHtml(cardName(card))} Pokémon card" loading="lazy">
                </button>
                <div class="card-info">
                    <div class="card-name-line">
                        <h2 class="card-name">${escapeHtml(cardName(card))}</h2>
                        <span class="card-number">${escapeHtml(detail.localId || card.cardId)}</span>
                    </div>
                    <p class="set-name">${escapeHtml(setName(card))}</p>
                    <div class="tag-row">${tags || '<span class="tag">Details unavailable</span>'}</div>
                    ${variants ? `<div class="tag-row variant-row" aria-label="Owned variants">${variants}</div>` : ""}
                    <div class="card-bottom">
                        <span>${detail.hp ? `${escapeHtml(detail.hp)} HP` : ""}</span>
                        ${options.unowned
                            ? '<span class="unowned-count">Not collected</span>'
                            : `<span class="owned-count">×${escapeHtml(card.count)}</span>`}
                    </div>
                </div>`;
            cardElement.querySelector(".card-image-button").addEventListener("click", () => renderDetails(card));
            const image = cardElement.querySelector("img");
            image.addEventListener("error", () => handleCardImageError(image, card, options));
            return cardElement;
        }

        function visibleCards() {
            const query = searchInput.value.trim().toLocaleLowerCase();
            return collection.filter(card => {
                const detail = card.details || {};
                return (!query || cardMatchesSearch(card, query))
                    && (!filterElements.set.value || setName(card) === filterElements.set.value)
                    && (!filterElements.type.value || (detail.types || []).includes(filterElements.type.value))
                    && (!filterElements.rarity.value || detail.rarity === filterElements.rarity.value)
                    && (!filterElements.variant.value || cardVariants(card).some(variant =>
                        formatVariant(variant.variantId) === filterElements.variant.value
                    ))
                    && (!filterElements.illustrator.value || detail.illustrator === filterElements.illustrator.value);
            });
        }

        function renderCollection() {
            const cards = sortCards(visibleCards());
            document.getElementById("results-count").textContent = `${cards.length} of ${collection.length} unique cards`;
            grid.replaceChildren();
            if (!cards.length) {
                const empty = document.createElement("div");
                empty.className = "empty-state";
                empty.innerHTML = collection.length
                    ? "<strong>No cards match these filters</strong>Try a different search or reset the filters."
                    : "<strong>Your collection is empty</strong>Add cards to data.json to see them here.";
                grid.append(empty);
                return;
            }
            for (const card of cards) grid.append(renderCard(card));
        }

        function detailSection(title, body) {
            return body ? `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${body}</section>` : "";
        }

        function renderDetails(card) {
            const detail = card.details || {};
            const set = detail.set || {};
            const attacks = (detail.attacks || []).map(attack =>
                `<li><strong>${escapeHtml(attack.name)}</strong> · ${escapeHtml((attack.cost || []).join(", ") || "No cost")} ${attack.damage ? `· ${escapeHtml(attack.damage)} damage` : ""}${attack.effect ? `<br><span>${escapeHtml(attack.effect)}</span>` : ""}</li>`
            ).join("");
            const abilities = (detail.abilities || []).map(ability =>
                `<li><strong>${escapeHtml(ability.name)}</strong>${ability.type ? ` · ${escapeHtml(ability.type)}` : ""}${ability.effect ? `<br><span>${escapeHtml(ability.effect)}</span>` : ""}</li>`
            ).join("");
            const variants = cardVariants(card).map(variant =>
                `<li><strong>${escapeHtml(formatVariant(variant.variantId))}</strong> · Owned ×${escapeHtml(variant.count)}</li>`
            ).join("");
            const setCount = set.cardCount?.total ? `${set.cardCount.total} cards in set` : "";
            const description = detail.description || "";
            const illustrator = detail.illustrator || "";
            const stats = [
                detail.category,
                detail.stage,
                detail.hp ? `${detail.hp} HP` : "",
                detail.types?.join(" / ")
            ].filter(Boolean).join(" · ");

            document.getElementById("dialog-content").innerHTML = `
                <div class="dialog-heading">
                    <div><h2 id="dialog-title">${escapeHtml(cardName(card))}</h2><p class="dialog-subtitle">${escapeHtml(setName(card))} · ${escapeHtml(detail.localId || card.cardId)}</p></div>
                    <button class="close-button" type="button" aria-label="Close card details">✕</button>
                </div>
                <div class="detail-layout">
                    <img class="detail-image" src="${escapeHtml(imageUrl(card) || missingImageUrl)}" alt="${escapeHtml(cardName(card))} Pokémon card">
                    <div>
                        ${detailSection("Card", `<p>${escapeHtml(stats || "Card details unavailable")}${detail.rarity ? `<br>${escapeHtml(detail.rarity)}` : ""}<br>Owned ×${escapeHtml(card.count)}</p>`)}
                        ${variants ? detailSection("Variants", `<ul class="detail-list">${variants}</ul>`) : ""}
                        ${detailSection("Illustrator", `<p>${escapeHtml(illustrator || "Not listed by TCGdex")}</p>`)}
                        ${description ? detailSection("Description", `<p>${escapeHtml(description)}</p>`) : ""}
                        ${abilities ? detailSection("Abilities", `<ul class="detail-list">${abilities}</ul>`) : ""}
                        ${attacks ? detailSection("Attacks", `<ul class="detail-list">${attacks}</ul>`) : ""}
                        ${detailSection("Set", `<p>${escapeHtml(set.name || setName(card))}${setCount ? `<br>${escapeHtml(setCount)}` : ""}${set.id ? `<br>Set code: ${escapeHtml(set.id)}` : ""}</p>`)}
                    </div>
                </div>`;
            const detailImage = dialog.querySelector(".detail-image");
            detailImage.addEventListener("click", () => {
                const enlargedImage = artDialog.querySelector(".enlarged-image");
                enlargedImage.src = detailImage.currentSrc || detailImage.src;
                enlargedImage.alt = detailImage.alt;
                enlargedImage.onerror = () => handleCardImageError(enlargedImage, card);
                artDialog.showModal();
            });
            detailImage.addEventListener("error", () => handleCardImageError(detailImage, card));
            dialog.querySelector(".close-button").addEventListener("click", () => dialog.close());
            document.body.classList.add("dialog-open");
            dialog.showModal();
        }

        async function loadCollection() {
            try {
                const [inventoryResponse, databaseResponse] = await Promise.all([
                    fetch("./data.json"),
                    fetch("./tcgdex-database.json")
                ]);
                if (!inventoryResponse.ok) throw new Error(`Could not load data.json (${inventoryResponse.status}).`);
                if (!databaseResponse.ok) throw new Error(`Could not load tcgdex-database.json (${databaseResponse.status}).`);
                const [inventory, database] = await Promise.all([
                    inventoryResponse.json(),
                    databaseResponse.json()
                ]);
                if (!Array.isArray(inventory.cards)) throw new Error("data.json must contain a cards array.");
                if (!database.cards || typeof database.cards !== "object") {
                    throw new Error("tcgdex-database.json must contain a cards object.");
                }
                document.getElementById("total-count").textContent = inventory.cards.reduce((sum, card) => sum + (Number(card.count) || 0), 0);

                databaseSets = database.sets || {};
                availableSets = database.availableSets || [];
                setOrder = new Map(availableSets.map((set, index) => [set.id, index]));
                allCardsById = new Map(Object.entries(database.cards));
                collection = groupInventoryCards(inventory.cards, database.cards);
                ownedCardsByApiId = new Map();
                for (const card of collection) {
                    if (card.details?.id) ownedCardsByApiId.set(normalizeCardId(card.details.id), card);
                    ownedCardsByApiId.set(cardGroupId(card), card);
                }
                const uniqueCardDetails = new Map();
                for (const cardDetails of Object.values(database.cards)) {
                    if (cardDetails?.id) uniqueCardDetails.set(normalizeCardId(cardDetails.id), cardDetails);
                }
                pokedexEntries = buildPokedexEntries([...uniqueCardDetails.values()]);
                document.getElementById("unique-count").textContent = collection.length;
                document.getElementById("set-count").textContent = new Set(collection.map(setName)).size;
                populateFilters();
                renderCollection();
                renderMasterSetList();
                if (document.getElementById("pokedex-tab").getAttribute("aria-selected") === "true") {
                    renderPokedex();
                }

                const missingCount = collection.filter(card => !card.details).length;
                if (missingCount) {
                    const status = document.getElementById("status");
                    status.className = "error";
                    status.textContent = `${missingCount} card${missingCount === 1 ? "" : "s"} missing from the local database. Run node build-data.js and reload.`;
                }
            } catch (error) {
                document.getElementById("results-count").textContent = "Could not load your collection.";
                const status = document.getElementById("status");
                status.className = "error";
                status.textContent = `${error.message} Run node build-data.js to create tcgdex-database.json, then open this page through a local web server.`;
            }
        }

        const updateCollectionClearButton = addSearchClearButton(
            searchInput,
            document.getElementById("clear-search")
        );
        addSearchClearButton(pokedexSearch, document.getElementById("clear-pokedex-search"));
        addSearchClearButton(masterSetSearch, document.getElementById("clear-master-set-search"));
        searchInput.addEventListener("input", renderCollection);
        pokedexSearch.addEventListener("input", renderPokedex);
        masterSetSearch.addEventListener("input", debounce(renderMasterSetList, 250));
        masterSetSort.addEventListener("change", renderMasterSetList);
        Object.values(filterElements).forEach(select => select.addEventListener("change", renderCollection));
        sortSelect.addEventListener("change", renderCollection);
        document.getElementById("reset-filters").addEventListener("click", () => {
            searchInput.value = "";
            Object.values(filterElements).forEach(select => { select.value = ""; });
            updateCollectionClearButton();
            renderCollection();
            searchInput.focus();
        });
        for (const tab of tabs) {
            tab.addEventListener("click", () => selectView(tab));
            tab.addEventListener("keydown", event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                let nextIndex = tabs.indexOf(tab);
                if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = tabs.length - 1;
                else nextIndex = (nextIndex + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
                selectView(tabs[nextIndex]);
                tabs[nextIndex].focus();
            });
        }
        dialog.addEventListener("click", event => {
            if (event.target !== dialog) return;
            const bounds = dialog.getBoundingClientRect();
            const clickedInside = event.clientX >= bounds.left
                && event.clientX <= bounds.right
                && event.clientY >= bounds.top
                && event.clientY <= bounds.bottom;
            if (!clickedInside) dialog.close();
        });
        dialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
        artDialog.querySelector(".art-close-button").addEventListener("click", () => artDialog.close());
        artDialog.addEventListener("click", event => {
            if (event.target !== artDialog) return;
            const bounds = artDialog.getBoundingClientRect();
            const clickedInside = event.clientX >= bounds.left
                && event.clientX <= bounds.right
                && event.clientY >= bounds.top
                && event.clientY <= bounds.bottom;
            if (!clickedInside) artDialog.close();
        });
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            if (artDialog.open) {
                event.preventDefault();
                artDialog.close();
            } else if (dialog.open) {
                event.preventDefault();
                dialog.close();
            }
        }, true);

        function selectView(activeTab) {
            for (const tab of tabs) {
                const selected = tab === activeTab;
                tab.setAttribute("aria-selected", String(selected));
                tab.tabIndex = selected ? 0 : -1;
                document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
            }
            if (activeTab.id === "pokedex-tab" && !pokedexRendered) renderPokedex();
        }

        loadCollection();
