        const SET_ID_MAPPINGS = {
            base6: "lc",
            mcd1p: "2011bw",
            mcd2p: "2012bw",
            mcd4p: "2014xy",
            mcd5p: "2015xy",
            mcd6p: "2016xy",
            mcd7p: "2017sm",
            mcd8p: "2018sm",
            mcd9p: "2019sm",
            mcd10p: "2021swsh",
            mcd11p: "2022swsh",
            mcd12p: "2023sv",
            mcd13p: "2024sv"
        };
        const NATIONAL_POKEDEX_SIZE = 1025;
        const COLLECTION_STORAGE_KEY = "pokemon-gallery-collection-draft";
        const LOCAL_EDIT_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
        const CAN_EDIT_COLLECTION = LOCAL_EDIT_HOSTS.has(location.hostname);
        document.body.classList.toggle("local-edit-mode", CAN_EDIT_COLLECTION);
        if (!CAN_EDIT_COLLECTION) {
            document.getElementById("pokedex-description").textContent =
                "Pokémon are ordered by National Pokédex number. Owned cards are highlighted.";
            document.getElementById("binder-description").textContent =
                "Browse the saved binder pages and their card layouts.";
        }
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
        const binderPages = [];
        let activeBinderPageId = null;
        let binderPickerTarget = null;
        let binderStorageError = "";
        let lastBinderDropAt = 0;
        let collectionData = { version: 1, cards: [], binder: { pages: [], activePageId: null }, featuredPokedexCards: {} };
        let collectionDirty = false;
        let initialLoadComplete = false;
        let collectionNeedsRender = false;
        let collectionDraftPersistTimeout = null;
        let activeFloatingMenu = null;
        let nextFloatingMenuId = 0;
        const tabs = [...document.querySelectorAll(".view-tab")];
        let collection = [];
        let databaseSets = {};
        let setOrder = new Map();
        let availableSets = [];
        let allCardsById = new Map();
        let catalogCards = [];
        let ownedCardsByApiId = new Map();
        let pokedexEntries = [];
        const speciesDexIds = new Map();
        const failedPokedexImageCards = new Set();
        const featuredPokedexCards = new Map();
        const pokedexEntriesByCardId = new Map();
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

        function normalizeCollectionCardId(cardId) {
            if (typeof cardId !== "string" || !cardId.trim()) {
                throw new Error("Every collection card must have a non-empty cardId.");
            }
            const normalizedId = normalizeCardId(cardId.trim());
            const separator = normalizedId.lastIndexOf("-");
            if (separator < 1) return normalizedId;
            const setId = normalizedId.slice(0, separator);
            const mappedSetId = SET_ID_MAPPINGS[setId] || setId;
            return normalizeCardId(`${mappedSetId}${normalizedId.slice(separator)}`);
        }

        function normalizeBinderState(binder) {
            if (!binder || typeof binder !== "object" || !Array.isArray(binder.pages)) {
                throw new Error("Binder data must include a pages array.");
            }
            const pages = binder.pages.map(page => {
                if (!page || !Number.isInteger(page.rows) || page.rows < 2 || page.rows > 6
                    || !Number.isInteger(page.columns) || page.columns < 2 || page.columns > 6
                    || !Array.isArray(page.slots) || page.slots.length !== page.rows * page.columns) {
                    throw new Error("A binder page has invalid dimensions or pockets.");
                }
                return {
                    id: String(page.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
                    rows: page.rows,
                    columns: page.columns,
                    slots: page.slots.map(slot => {
                        if (slot === null) return null;
                        if (!slot || typeof slot.cardId !== "string") {
                            throw new Error("A binder pocket has invalid card data.");
                        }
                        return {
                            cardId: normalizeCollectionCardId(slot.cardId),
                            planned: Boolean(slot.planned)
                        };
                    })
                };
            });
            const activePageId = pages.some(page => page.id === binder.activePageId)
                ? binder.activePageId
                : pages[0]?.id || null;
            return { pages, activePageId };
        }

        function normalizeCollectionDocument(document) {
            if (!document || typeof document !== "object" || !Array.isArray(document.cards)) {
                throw new Error("Collection JSON must contain a cards array.");
            }
            const cards = document.cards.map(card => {
                if (!card || typeof card !== "object") {
                    throw new Error("Collection cards must be JSON objects.");
                }
                const count = Number(card.count);
                if (!Number.isInteger(count) || count < 1) {
                    throw new Error(`Card ${card.cardId || "(unknown)"} must have a positive integer count.`);
                }
                return {
                    cardId: normalizeCollectionCardId(card.cardId),
                    variantId: typeof card.variantId === "string" && card.variantId.trim()
                        ? card.variantId.trim()
                        : "unlimited",
                    count
                };
            });
            const hasBinder = Object.prototype.hasOwnProperty.call(document, "binder");
            const hasFeaturedCards = Object.prototype.hasOwnProperty.call(document, "featuredPokedexCards");
            const featuredPokedexCards = {};
            if (hasFeaturedCards) {
                if (!document.featuredPokedexCards || typeof document.featuredPokedexCards !== "object"
                    || Array.isArray(document.featuredPokedexCards)) {
                    throw new Error("featuredPokedexCards must be a Pokémon-to-card-ID object.");
                }
                for (const [dexId, cardId] of Object.entries(document.featuredPokedexCards)) {
                    if (!/^\d+$/.test(dexId) || Number(dexId) < 1) {
                        throw new Error(`Pokédex entry ${dexId} is invalid.`);
                    }
                    if (typeof cardId !== "string") throw new Error(`Featured card for Pokédex #${dexId} is invalid.`);
                    featuredPokedexCards[dexId] = normalizeCollectionCardId(cardId);
                }
            }
            return {
                version: 1,
                cards,
                binder: hasBinder ? normalizeBinderState(document.binder) : null,
                featuredPokedexCards,
                hasBinder,
                hasFeaturedCards
            };
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

        function availableCardVariants(card) {
            const names = new Map([["unlimited", "Unlimited"]]);
            const flags = card.details?.variants || {};
            const mappings = {
                firstEdition: "first",
                holo: "holo",
                reverse: "reverse",
                wPromo: "promo"
            };
            for (const [source, variantId] of Object.entries(mappings)) {
                if (flags[source]) names.set(variantId, formatVariant(variantId));
            }
            for (const variant of cardVariants(card)) {
                if (variant.variantId) names.set(variant.variantId, formatVariant(variant.variantId));
            }
            return [...names.entries()];
        }

        function addCardToCollection(card, variantId) {
            if (!CAN_EDIT_COLLECTION) return;
            const cardId = normalizeCollectionCardId(card.details?.id || card.cardId);
            const existing = collectionData.cards.find(entry =>
                entry.cardId === cardId && entry.variantId === variantId
            );
            if (existing) existing.count += 1;
            else collectionData.cards.push({ cardId, variantId, count: 1 });
            let ownedCard = ownedCardsByApiId.get(cardId);
            const isNewUniqueCard = !ownedCard;
            if (ownedCard) {
                ownedCard.count += 1;
                const ownedVariant = ownedCard.variants.find(variant => variant.variantId === variantId);
                if (ownedVariant) ownedVariant.count += 1;
                else ownedCard.variants.push({ variantId, count: 1 });
            } else {
                ownedCard = groupInventoryCards(
                    [{ cardId, variantId, count: 1 }],
                    allCardsById
                )[0];
                ownedCard.inventoryOrder = collectionData.cards.length - 1;
                collection.push(ownedCard);
                ownedCardsByApiId.set(cardId, ownedCard);
            }
            refreshCollectionAfterCardAdd(cardId, ownedCard, isNewUniqueCard);
            markCollectionDirty();
            document.getElementById("collection-file-status").textContent =
                `Added ${cardName(card)} (${formatVariant(variantId)}) to your collection.`;
            document.getElementById("collection-file-status").className = "";
        }

        function setVariantQuantity(card, variantId, quantity) {
            if (!CAN_EDIT_COLLECTION || !Number.isInteger(quantity) || quantity < 0) return;
            const cardId = normalizeCollectionCardId(card.details?.id || card.cardId);
            const existingEntries = collectionData.cards.filter(entry => entry.cardId === cardId);
            const variantCounts = new Map();
            for (const entry of existingEntries) {
                variantCounts.set(entry.variantId, (variantCounts.get(entry.variantId) || 0) + entry.count);
            }
            if ((variantCounts.get(variantId) || 0) === quantity) return;
            if (quantity > 0) variantCounts.set(variantId, quantity);
            else variantCounts.delete(variantId);

            const firstEntryIndex = collectionData.cards.findIndex(entry => entry.cardId === cardId);
            const remainingEntries = collectionData.cards.filter(entry => entry.cardId !== cardId);
            const updatedEntries = availableCardVariants(card)
                .map(([availableVariantId]) => ({
                    cardId,
                    variantId: availableVariantId,
                    count: variantCounts.get(availableVariantId) || 0
                }))
                .filter(entry => entry.count > 0);
            const insertAt = firstEntryIndex < 0
                ? remainingEntries.length
                : Math.min(firstEntryIndex, remainingEntries.length);
            remainingEntries.splice(insertAt, 0, ...updatedEntries);
            collectionData.cards = remainingEntries;

            for (const entry of pokedexEntriesByCardId.get(cardId) || []) {
                if (featuredPokedexCards.get(entry.dexId) !== cardId) continue;
                const nextFeatured = entry.ownedCards.find(ownedCard =>
                    cardGroupId(ownedCard) !== cardId
                    && remainingEntries.some(inventoryCard => inventoryCard.cardId === cardGroupId(ownedCard))
                );
                if (nextFeatured) featuredPokedexCards.set(entry.dexId, cardGroupId(nextFeatured));
                else featuredPokedexCards.delete(entry.dexId);
            }
            collectionData.featuredPokedexCards = Object.fromEntries(featuredPokedexCards);
            applyCollectionDocument(currentCollectionDocument(), { dirty: true });
            const updatedCard = ownedCardsByApiId.get(cardId) || cardFromDetails(card.details);
            renderDetails(updatedCard, false, true);
            setImportStatus(`Updated ${formatVariant(variantId)} quantity for ${cardName(card)}.`);
        }

        function closeFloatingMenu(restoreFocus = false) {
            if (!activeFloatingMenu) return;
            const { button, menu, onPointerDown, onKeyDown, positionOnViewportChange } = activeFloatingMenu;
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("resize", positionOnViewportChange);
            window.removeEventListener("scroll", positionOnViewportChange, true);
            button.setAttribute("aria-expanded", "false");
            button.removeAttribute("aria-controls");
            menu.remove();
            activeFloatingMenu = null;
            if (restoreFocus && button.isConnected) button.focus();
        }

        function openFloatingMenu(button, label, options, onSelect) {
            closeFloatingMenu();
            const menu = document.createElement("div");
            menu.className = "floating-option-menu";
            menu.id = `floating-option-menu-${++nextFloatingMenuId}`;
            menu.setAttribute("role", "menu");
            menu.setAttribute("aria-label", label);
            for (const [value, optionLabel] of options) {
                const option = document.createElement("button");
                option.className = "floating-option";
                option.type = "button";
                option.textContent = optionLabel;
                option.title = optionLabel;
                option.setAttribute("role", "menuitem");
                option.addEventListener("click", () => {
                    closeFloatingMenu();
                    onSelect(value);
                });
                menu.append(option);
            }
            document.body.append(menu);

            const positionMenu = () => {
                const buttonBounds = button.getBoundingClientRect();
                const menuBounds = menu.getBoundingClientRect();
                const fitsBelow = window.innerHeight - buttonBounds.bottom >= menuBounds.height + 8;
                const top = fitsBelow
                    ? buttonBounds.bottom + 4
                    : Math.max(8, buttonBounds.top - menuBounds.height - 4);
                const left = Math.min(
                    Math.max(8, buttonBounds.right - menuBounds.width),
                    window.innerWidth - menuBounds.width - 8
                );
                menu.style.top = `${top}px`;
                menu.style.left = `${left}px`;
            };
            positionMenu();
            button.setAttribute("aria-controls", menu.id);
            button.setAttribute("aria-expanded", "true");

            const onPointerDown = event => {
                if (!menu.contains(event.target) && event.target !== button) closeFloatingMenu();
            };
            const onKeyDown = event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    closeFloatingMenu(true);
                    return;
                }
                if (event.key === "Tab") {
                    event.preventDefault();
                    const focusable = [...document.querySelectorAll(
                        "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
                    )].filter(element => !menu.contains(element) && element.getClientRects().length > 0);
                    const buttonIndex = focusable.indexOf(button);
                    const next = focusable[buttonIndex + (event.shiftKey ? -1 : 1)];
                    closeFloatingMenu();
                    next?.focus();
                    return;
                }
                const menuOptions = [...menu.querySelectorAll(".floating-option")];
                const currentIndex = menuOptions.indexOf(document.activeElement);
                let nextIndex = currentIndex;
                if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % menuOptions.length;
                else if (event.key === "ArrowUp") nextIndex = (currentIndex + menuOptions.length - 1) % menuOptions.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = menuOptions.length - 1;
                else return;
                event.preventDefault();
                menuOptions[nextIndex].focus();
            };
            const positionOnViewportChange = () => {
                if (!button.isConnected) closeFloatingMenu();
                else positionMenu();
            };
            activeFloatingMenu = { button, menu, onPointerDown, onKeyDown, positionOnViewportChange };
            document.addEventListener("pointerdown", onPointerDown, true);
            document.addEventListener("keydown", onKeyDown, true);
            window.addEventListener("resize", positionOnViewportChange);
            window.addEventListener("scroll", positionOnViewportChange, true);
            menu.querySelector(".floating-option").focus();
        }

        function renderCollectionActions(card) {
            const actions = document.createElement("div");
            actions.className = "collection-card-actions";
            const addUnlimited = document.createElement("button");
            addUnlimited.className = "add-card-button";
            addUnlimited.type = "button";
            addUnlimited.textContent = "+";
            addUnlimited.title = "Add Unlimited";
            addUnlimited.setAttribute("aria-label", `Add an unlimited ${cardName(card)} to My Collection`);
            addUnlimited.addEventListener("click", () => addCardToCollection(card, "unlimited"));

            const variantControl = document.createElement("div");
            variantControl.className = "add-variant-control";
            const openVariants = document.createElement("button");
            openVariants.className = "add-variant-button";
            openVariants.type = "button";
            openVariants.textContent = "▾";
            openVariants.title = "Select Variant";
            openVariants.setAttribute("aria-label", `Select a variant of ${cardName(card)}`);
            openVariants.setAttribute("aria-haspopup", "menu");
            openVariants.setAttribute("aria-expanded", "false");
            const variants = availableCardVariants(card).filter(([variantId]) => variantId !== "unlimited");
            openVariants.disabled = variants.length === 0;
            openVariants.addEventListener("click", () => {
                if (activeFloatingMenu?.button === openVariants) {
                    closeFloatingMenu();
                    return;
                }
                openFloatingMenu(
                    openVariants,
                    `Variants for ${cardName(card)}`,
                    variants,
                    variantId => addCardToCollection(card, variantId)
                );
            });
            variantControl.append(openVariants);
            actions.append(addUnlimited, variantControl);
            return actions;
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
                const normalizedId = normalizeCollectionCardId(inventoryCard.cardId);
                let card = groupedCards.get(normalizedId);
                if (!card) {
                    card = {
                        ...inventoryCard,
                        cardId: normalizedId,
                        count: 0,
                        variants: [],
                        inventoryOrder,
                        details: cardDetails instanceof Map
                            ? cardDetails.get(normalizedId) || null
                            : cardDetails[normalizedId] || null
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
                for (const entry of entries) {
                    grid.append(renderCard(entry.card, {
                        unowned: entry.unowned,
                        collectionActions: true
                    }));
                }
            }
            content.append(grid);
        }

        function renderMasterSetList() {
            const query = masterSetSearch.value.trim().toLocaleLowerCase();
            const expandedSetIds = new Set([...masterSetList.querySelectorAll(".master-set[open]")]
                .map(setGroup => setGroup.dataset.setId));
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
                setGroup.dataset.setId = catalogSet.id;
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
                } else if (expandedSetIds.has(catalogSet.id)) {
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
            for (const entry of entries) pokedexGrid.append(renderPokedexEntry(entry));
            updatePokedexCount();
        }

        function updatePokedexCount() {
            const ownedCount = pokedexEntries.filter(entry =>
                entry.dexId <= NATIONAL_POKEDEX_SIZE && entry.ownedCards.length > 0
            ).length;
            document.getElementById("pokedex-count").textContent =
                `${ownedCount} / ${NATIONAL_POKEDEX_SIZE} Pokémon collected`;
        }

        function renderPokedexEntry(entry) {
            const owned = entry.ownedCards.length > 0;
            const featuredId = featuredPokedexCards.get(entry.dexId);
            const featured = entry.ownedCards.find(card => cardGroupId(card) === featuredId)
                || entry.featuredCard;

            const renderPokemonCard = selectedCard => {
                const cardElement = renderCard(selectedCard, {
                    unowned: !owned,
                    hideHp: true,
                    hideVariants: true,
                    collectionActions: CAN_EDIT_COLLECTION,
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
                cardElement.dataset.dexId = String(entry.dexId);
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

                if (CAN_EDIT_COLLECTION && entry.ownedCards.length > 1) {
                    const featuredControl = document.createElement("div");
                    featuredControl.className = "featured-card-control";
                    const openSelector = document.createElement("button");
                    openSelector.className = "featured-card-button";
                    openSelector.type = "button";
                    openSelector.textContent = "↻";
                    openSelector.title = "Choose featured Pokémon card";
                    openSelector.setAttribute("aria-label", `Choose featured card for ${entry.name}`);
                    openSelector.setAttribute("aria-haspopup", "menu");
                    openSelector.setAttribute("aria-expanded", "false");
                    const choices = entry.ownedCards.map(ownedCard => [
                        cardGroupId(ownedCard),
                        `${setName(ownedCard)} · ${ownedCard.details.localId} ${cardName(ownedCard)}`
                    ]);
                    openSelector.addEventListener("click", () => {
                        if (activeFloatingMenu?.button === openSelector) {
                            closeFloatingMenu();
                            return;
                        }
                        openFloatingMenu(
                            openSelector,
                            `Featured card for ${entry.name}`,
                            choices,
                            cardId => {
                                if (cardId === cardGroupId(selectedCard)) return;
                                featuredPokedexCards.set(entry.dexId, cardId);
                                saveFeaturedPokedexCards();
                                cardElement.replaceWith(renderPokedexEntry(entry));
                            }
                        );
                    });
                    featuredControl.append(openSelector);
                    cardElement.querySelector(".card-info").append(featuredControl);
                } else if (owned) {
                    const note = document.createElement("span");
                    note.className = "featured-card-label";
                    note.textContent = CAN_EDIT_COLLECTION ? "Your featured card" : "Featured card";
                    cardElement.querySelector(".card-info").append(note);
                }
                return cardElement;
            };
            return renderPokemonCard(featured);
        }

        function currentBinderState() {
            return { pages: binderPages, activePageId: activeBinderPageId };
        }

        function currentCollectionDocument() {
            return {
                version: 1,
                exportedAt: new Date().toISOString(),
                cards: collectionData.cards,
                binder: currentBinderState(),
                featuredPokedexCards: Object.fromEntries(featuredPokedexCards)
            };
        }

        function setImportStatus(message, isError = false) {
            const status = document.getElementById("collection-file-status");
            status.textContent = message;
            status.className = isError ? "error" : "";
        }

        function updateSaveStatus(message, state = "") {
            const status = document.getElementById("save-status");
            status.textContent = message;
            status.className = state;
            document.getElementById("save-collection").disabled = !initialLoadComplete;
        }

        function persistCollectionDraft() {
            if (!CAN_EDIT_COLLECTION) return false;
            try {
                localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify({
                    dirty: collectionDirty,
                    collection: currentCollectionDocument()
                }));
                return true;
            } catch (error) {
                updateSaveStatus(`Unsaved · local backup failed: ${error.message}`, "error");
                return false;
            }
        }

        function markCollectionDirty() {
            if (!CAN_EDIT_COLLECTION) return;
            collectionDirty = true;
            updateSaveStatus("Unsaved changes", "unsaved");
            clearTimeout(collectionDraftPersistTimeout);
            collectionDraftPersistTimeout = setTimeout(() => {
                collectionDraftPersistTimeout = null;
                persistCollectionDraft();
            }, 200);
        }

        async function saveCollectionToFile() {
            if (!CAN_EDIT_COLLECTION) return;
            const fileContents = JSON.stringify(currentCollectionDocument(), null, 2);
            try {
                if (typeof window.showSaveFilePicker === "function") {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: "collection.json",
                        types: [{
                            description: "Pokémon collection JSON",
                            accept: { "application/json": [".json"] }
                        }]
                    });
                    const writable = await fileHandle.createWritable();
                    await writable.write(fileContents);
                    await writable.close();
                } else {
                    const blob = new Blob([fileContents], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "collection.json";
                    document.body.append(link);
                    link.click();
                    link.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                collectionDirty = false;
                updateSaveStatus("Saved collection.json", "");
                clearTimeout(collectionDraftPersistTimeout);
                collectionDraftPersistTimeout = null;
                persistCollectionDraft();
                setImportStatus("Saved collection.json. Place it beside the app to load it automatically on another device.");
            } catch (error) {
                if (error.name === "AbortError") return;
                updateSaveStatus(`Save failed: ${error.message}`, "error");
                setImportStatus(`Could not save collection.json: ${error.message}`, true);
            }
        }

        async function importCollectionFile(file) {
            if (!CAN_EDIT_COLLECTION) return;
            try {
                const imported = JSON.parse(await file.text());
                applyCollectionDocument(imported, { dirty: true, preserveMissingAppData: true });
                const correctedIds = (Array.isArray(imported.cards) ? imported.cards : [])
                    .filter(card => typeof card.cardId === "string")
                    .filter(card => normalizeCollectionCardId(card.cardId) !== card.cardId.trim()).length;
                setImportStatus(`Imported ${collection.length} unique cards${correctedIds ? `; corrected ${correctedIds} mapped or padded card IDs` : ""}. Save to download collection.json.`);
            } catch (error) {
                setImportStatus(`Could not import ${file.name}: ${error.message}`, true);
            }
        }

        function updateCollectionSummary() {
            document.getElementById("unique-count").textContent = collection.length;
            document.getElementById("total-count").textContent = collection.reduce((sum, card) => sum + card.count, 0);
            document.getElementById("set-count").textContent = new Set(collection.map(setName)).size;
        }

        function rebuildCollectionViews() {
            collection = groupInventoryCards(collectionData.cards, allCardsById);
            ownedCardsByApiId = new Map();
            for (const card of collection) {
                if (card.details?.id) ownedCardsByApiId.set(normalizeCardId(card.details.id), card);
                ownedCardsByApiId.set(cardGroupId(card), card);
            }

            const uniqueCardDetails = new Map();
            for (const cardDetails of allCardsById.values()) {
                if (cardDetails?.id) uniqueCardDetails.set(normalizeCardId(cardDetails.id), cardDetails);
            }
            const detailsList = [...uniqueCardDetails.values()];
            catalogCards = detailsList
                .map(details => cardFromDetails(details, ownedCardsByApiId.get(normalizeCardId(details.id))))
                .sort((a, b) => setCatalogOrder(a) - setCatalogOrder(b)
                    || setCardOrder(a) - setCardOrder(b)
                    || compareText(cardName(a), cardName(b)));
            pokedexEntries = buildPokedexEntries(detailsList);
            pokedexEntriesByCardId.clear();
            for (const entry of pokedexEntries) {
                for (const details of entry.cards) {
                    const cardId = normalizeCardId(details.id);
                    if (!pokedexEntriesByCardId.has(cardId)) pokedexEntriesByCardId.set(cardId, []);
                    pokedexEntriesByCardId.get(cardId).push(entry);
                }
            }
            updatePokedexCount();
            updateCollectionSummary();
            populateFilters();
            renderCollection();
            collectionNeedsRender = false;
            renderMasterSetList();
            renderBinder();
            if (pokedexRendered) renderPokedex();
        }

        function logMissingCollectionCards() {
            for (const card of collection) {
                if (!card.details) {
                    console.error(`Card ${card.cardId} is missing from tcgdex-database.json.`);
                }
            }
        }

        function updateRenderedCardCollectionState(cardElement, card) {
            cardElement.classList.remove("unowned");
            const count = cardElement.querySelector(".card-bottom .unowned-count, .card-bottom .owned-count");
            if (count) {
                count.className = "owned-count";
                count.textContent = `×${card.count}`;
                count.setAttribute("aria-label", `${card.count} cards owned`);
            }

            const existingVariants = cardElement.querySelector(".variant-row");
            if (card.variants.length) {
                const row = existingVariants || document.createElement("div");
                row.className = "tag-row variant-row";
                row.setAttribute("aria-label", "Owned variants");
                row.replaceChildren(...card.variants.map(variant => {
                    const tag = document.createElement("span");
                    tag.className = "tag";
                    tag.textContent = formatVariant(variant.variantId);
                    return tag;
                }));
                if (!existingVariants) cardElement.querySelector(".card-info").insertBefore(
                    row,
                    cardElement.querySelector(".card-bottom")
                );
            }
        }

        function refreshCollectionAfterCardAdd(cardId, addedCard, isNewUniqueCard) {
            updateCollectionSummary();
            collectionNeedsRender = true;
            if (document.getElementById("collection-tab").getAttribute("aria-selected") === "true"
                && collectionNeedsRender) {
                populateFilters();
                renderCollection();
                collectionNeedsRender = false;
            }

            const setId = addedCard.details?.set?.id;
            const setDetails = databaseSets[setId];
            if (isNewUniqueCard && setDetails) {
                const totalCount = setDetails.cardIds?.length || 0;
                const ownedCount = (setDetails.cardIds || []).filter(id =>
                    ownedCardsByApiId.has(normalizeCardId(id))
                ).length;
                const setGroup = [...masterSetList.querySelectorAll(".master-set")]
                    .find(element => element.dataset.setId === setId);
                if (setGroup) {
                    const progress = setGroup.querySelector(".master-set-progress");
                    const count = setGroup.querySelector(".master-set-summary-meta");
                    if (progress) {
                        progress.setAttribute("aria-valuenow", String(ownedCount));
                        progress.firstElementChild.style.width = `${totalCount ? Math.round(ownedCount / totalCount * 100) : 0}%`;
                    }
                    if (count) count.textContent = `${ownedCount} / ${totalCount}`;
                }
            }

            const cardSelectorId = CSS.escape(cardId);
            for (const cardElement of masterSetList.querySelectorAll(`.card[data-card-id="${cardSelectorId}"]`)) {
                updateRenderedCardCollectionState(cardElement, addedCard);
            }

            const affectedEntries = pokedexEntriesByCardId.get(cardId) || [];
            for (const entry of affectedEntries) {
                const previouslyOwned = entry.ownedCards.length > 0;
                entry.ownedCards = entry.ownedCards.filter(card => cardGroupId(card) !== cardId);
                entry.ownedCards.push(addedCard);
                entry.ownedCards.sort((a, b) => a.inventoryOrder - b.inventoryOrder);
                entry.ownedCount = entry.ownedCards.reduce((sum, card) => sum + card.count, 0);
                if (!previouslyOwned || !entry.ownedCards.some(card =>
                    cardGroupId(card) === featuredPokedexCards.get(entry.dexId)
                )) {
                    featuredPokedexCards.set(entry.dexId, cardId);
                }
                const existingEntry = pokedexGrid.querySelector(`.pokemon-card[data-dex-id="${entry.dexId}"]`);
                if (existingEntry) existingEntry.replaceWith(renderPokedexEntry(entry));
            }
            updatePokedexCount();
            if (isNewUniqueCard && document.getElementById("binder-tab").getAttribute("aria-selected") === "true") {
                renderBinder();
            }
        }

        function applyCollectionDocument(document, { dirty = true, preserveMissingAppData = false } = {}) {
            const normalized = normalizeCollectionDocument(document);
            const binder = normalized.hasBinder
                ? normalized.binder
                : preserveMissingAppData ? currentBinderState() : { pages: [], activePageId: null };
            const featured = normalized.hasFeaturedCards
                ? normalized.featuredPokedexCards
                : preserveMissingAppData ? Object.fromEntries(featuredPokedexCards) : {};
            collectionData = { version: 1, cards: normalized.cards, binder, featuredPokedexCards: featured };
            binderPages.splice(0, binderPages.length, ...binder.pages);
            activeBinderPageId = binder.activePageId;
            featuredPokedexCards.clear();
            for (const [dexId, cardId] of Object.entries(featured)) {
                featuredPokedexCards.set(Number(dexId), cardId);
            }
            rebuildCollectionViews();
            collectionDirty = dirty;
            updateSaveStatus(dirty ? "Unsaved changes" : "Saved", dirty ? "unsaved" : "");
            if (dirty) {
                clearTimeout(collectionDraftPersistTimeout);
                collectionDraftPersistTimeout = null;
                persistCollectionDraft();
            }
        }

        function saveBinderPages() {
            if (!CAN_EDIT_COLLECTION) return;
            collectionData.binder = currentBinderState();
            markCollectionDirty();
        }

        function saveFeaturedPokedexCards() {
            if (!CAN_EDIT_COLLECTION) return;
            collectionData.featuredPokedexCards = Object.fromEntries(featuredPokedexCards);
            markCollectionDirty();
        }

        function binderCardForId(cardId) {
            const details = allCardsById.get(normalizeCardId(cardId));
            if (!details) return null;
            return cardFromDetails(details, ownedCardsByApiId.get(normalizeCardId(details.id)));
        }

        function renderBinder() {
            const pageTabs = document.getElementById("binder-page-tabs");
            const content = document.getElementById("binder-content");
            const removePageButton = document.getElementById("remove-binder-page");
            pageTabs.replaceChildren();
            content.replaceChildren();
            removePageButton.disabled = !binderPages.length;
            if (binderStorageError) {
                const error = document.createElement("p");
                error.className = "binder-storage-error";
                error.setAttribute("role", "alert");
                error.textContent = binderStorageError;
                content.append(error);
            }

            if (!binderPages.length) {
                const empty = document.createElement("div");
                empty.className = "empty-state binder-empty";
                empty.innerHTML = CAN_EDIT_COLLECTION
                    ? "<strong>Your binder is empty</strong>Choose a page size above and add your first page."
                    : "<strong>No binder pages are available</strong>This shared collection does not include any saved binder pages.";
                content.append(empty);
                return;
            }

            for (const [index, page] of binderPages.entries()) {
                const tab = document.createElement("button");
                tab.className = "binder-page-tab";
                tab.type = "button";
                tab.textContent = `Page ${index + 1} · ${page.columns} × ${page.rows}`;
                tab.setAttribute("aria-pressed", String(page.id === activeBinderPageId));
                tab.addEventListener("click", () => {
                    activeBinderPageId = page.id;
                    if (CAN_EDIT_COLLECTION) collectionData.binder = currentBinderState();
                    renderBinder();
                });
                pageTabs.append(tab);
            }

            const page = binderPages.find(item => item.id === activeBinderPageId);
            if (!page) return;
            const grid = document.createElement("div");
            grid.className = "binder-grid";
            grid.style.gridTemplateColumns = `repeat(${page.columns}, var(--binder-pocket-width))`;
            grid.style.setProperty("--binder-columns", page.columns);
            grid.style.setProperty("--binder-pocket-width", `${90 + page.columns * 10}px`);
            grid.setAttribute("aria-label", `Binder page with ${page.columns} columns and ${page.rows} rows`);
            const pageScroll = document.createElement("div");
            pageScroll.className = "binder-page-scroll";

            page.slots.forEach((slot, index) => {
                const pocket = document.createElement("button");
                pocket.className = "binder-pocket";
                pocket.type = "button";
                pocket.draggable = CAN_EDIT_COLLECTION && Boolean(slot);
                pocket.disabled = !CAN_EDIT_COLLECTION;
                if (!CAN_EDIT_COLLECTION) pocket.setAttribute("aria-disabled", "true");
                pocket.dataset.slotIndex = String(index);
                const card = slot && binderCardForId(slot.cardId);
                if (card) {
                    pocket.classList.add("binder-pocket-filled");
                    const planned = slot.planned && !ownedCardsByApiId.has(normalizeCardId(slot.cardId));
                    const image = document.createElement("img");
                    image.className = "binder-card-image";
                    image.src = imageUrl(card) || missingImageUrl;
                    image.alt = "";
                    image.draggable = false;
                    image.addEventListener("error", () => handleCardImageError(image, card));
                    pocket.append(image);
                    if (planned) {
                        const indicator = document.createElement("span");
                        indicator.className = "binder-planned-indicator";
                        indicator.textContent = "Planned";
                        pocket.append(indicator);
                    }
                    pocket.setAttribute("aria-label", `${cardName(card)} · ${setName(card)} · pocket ${index + 1}${planned ? " · planned" : ""}. Click to change.`);
                } else {
                    pocket.classList.add("binder-pocket-empty");
                    pocket.innerHTML = '<span class="binder-pocket-plus" aria-hidden="true">+</span><span>Choose a card</span>';
                    pocket.setAttribute("aria-label", `Empty binder pocket ${index + 1}. Click to choose a card.`);
                }

                pocket.addEventListener("click", () => {
                    if (!CAN_EDIT_COLLECTION) return;
                    if (Date.now() - lastBinderDropAt < 400) return;
                    openBinderPicker(page.id, index);
                });
                pocket.addEventListener("dragstart", event => {
                    if (!CAN_EDIT_COLLECTION) {
                        event.preventDefault();
                        return;
                    }
                    event.dataTransfer.setData("text/plain", String(index));
                    event.dataTransfer.effectAllowed = "move";
                    pocket.classList.add("binder-pocket-dragging");
                });
                pocket.addEventListener("dragend", () => pocket.classList.remove("binder-pocket-dragging"));
                pocket.addEventListener("dragover", event => {
                    if (!CAN_EDIT_COLLECTION) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                });
                pocket.addEventListener("drop", event => {
                    if (!CAN_EDIT_COLLECTION) return;
                    event.preventDefault();
                    const sourceIndex = Number(event.dataTransfer.getData("text/plain"));
                    const targetIndex = index;
                    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= page.slots.length
                        || sourceIndex === targetIndex || !page.slots[sourceIndex]) return;
                    lastBinderDropAt = Date.now();
                    [page.slots[sourceIndex], page.slots[targetIndex]] = [page.slots[targetIndex], page.slots[sourceIndex]];
                    saveBinderPages();
                    renderBinder();
                });
                grid.append(pocket);
            });
            pageScroll.append(grid);
            content.append(pageScroll);
        }

        function openBinderPicker(pageId, slotIndex) {
            if (!CAN_EDIT_COLLECTION) return;
            binderPickerTarget = { pageId, slotIndex };
            const targetPage = binderPages.find(page => page.id === pageId);
            const currentSlot = targetPage?.slots[slotIndex];
            const search = document.getElementById("binder-card-search");
            const planningMode = document.getElementById("binder-planning-mode");
            search.value = "";
            planningMode.checked = false;
            document.getElementById("clear-binder-pocket").hidden = !currentSlot;
            renderBinderPickerResults();
            document.body.classList.add("dialog-open");
            document.getElementById("binder-picker-dialog").showModal();
            search.focus();
        }

        function renderBinderPickerResults() {
            const results = document.getElementById("binder-picker-results");
            const query = document.getElementById("binder-card-search").value.trim().toLocaleLowerCase();
            const planningMode = document.getElementById("binder-planning-mode").checked;
            const candidates = planningMode ? catalogCards : collection.filter(card => card.details);
            const matches = candidates.filter(card => !query || cardMatchesSearch(card, query));
            const filtered = planningMode ? matches.slice(0, 100) : matches;
            results.replaceChildren();
            if (!filtered.length) {
                const empty = document.createElement("p");
                empty.className = "empty-state";
                empty.textContent = planningMode ? "No cards match this search." : "No cards in your collection match this search.";
                results.append(empty);
                return;
            }

            if (planningMode && matches.length > filtered.length) {
                const note = document.createElement("p");
                note.className = "binder-picker-results-note";
                note.textContent = `Showing the first ${filtered.length} of ${matches.length} cards. Search to narrow the results.`;
                results.append(note);
            }
            for (const card of filtered) {
                const cardId = cardGroupId(card);
                const owned = ownedCardsByApiId.has(cardId);
                const choice = document.createElement("button");
                choice.type = "button";
                choice.className = "binder-picker-card";
                const image = document.createElement("img");
                image.src = imageUrl(card) || missingImageUrl;
                image.alt = "";
                image.addEventListener("error", () => handleCardImageError(image, card));
                const label = document.createElement("span");
                label.className = "binder-picker-card-label";
                const name = document.createElement("strong");
                name.textContent = cardName(card);
                const meta = document.createElement("small");
                meta.textContent = `${setName(card)} · ${card.details.localId || card.cardId}${owned ? " · In collection" : " · Planning"}`;
                label.append(name, meta);
                choice.append(image, label);
                choice.addEventListener("click", () => {
                    const page = binderPages.find(item => item.id === binderPickerTarget?.pageId);
                    if (!page) return;
                    page.slots[binderPickerTarget.slotIndex] = { cardId, planned: !owned };
                    activeBinderPageId = page.id;
                    saveBinderPages();
                    document.getElementById("binder-picker-dialog").close();
                    renderBinder();
                });
                results.append(choice);
            }
        }

        function addBinderPage() {
            if (!CAN_EDIT_COLLECTION) return;
            const rows = Number(document.getElementById("binder-rows").value);
            const columns = Number(document.getElementById("binder-columns").value);
            const page = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                rows,
                columns,
                slots: Array(rows * columns).fill(null)
            };
            binderPages.push(page);
            activeBinderPageId = page.id;
            saveBinderPages();
            renderBinder();
        }

        function removeActiveBinderPage() {
            if (!CAN_EDIT_COLLECTION) return;
            const pageIndex = binderPages.findIndex(page => page.id === activeBinderPageId);
            if (pageIndex < 0) return;
            const page = binderPages[pageIndex];
            const hasCards = page.slots.some(Boolean);
            const message = hasCards
                ? `Remove Page ${pageIndex + 1} and its ${page.slots.filter(Boolean).length} assigned cards?`
                : `Remove Page ${pageIndex + 1}?`;
            if (!window.confirm(message)) return;
            binderPages.splice(pageIndex, 1);
            activeBinderPageId = binderPages[Math.max(0, pageIndex - 1)]?.id
                || binderPages[0]?.id
                || null;
            saveBinderPages();
            renderBinder();
        }

        function addFilterOptions(select, values, placeholder) {
            const sortedValues = [...values].filter(Boolean).sort((a, b) => a.localeCompare(b));
            select.replaceChildren(new Option(placeholder, ""));
            for (const value of sortedValues) select.add(new Option(value, value));
        }

        function populateFilters() {
            const selectedValues = Object.fromEntries(
                Object.entries(filterElements).map(([name, select]) => [name, select.value])
            );
            addFilterOptions(filterElements.set, new Set(collection.map(setName)), "All sets");
            addFilterOptions(filterElements.type, new Set(collection.flatMap(card => card.details?.types || [])), "All types");
            addFilterOptions(filterElements.rarity, new Set(collection.map(card => card.details?.rarity)), "All rarities");
            addFilterOptions(filterElements.variant, new Set(collection.flatMap(card =>
                cardVariants(card).map(variant => formatVariant(variant.variantId))
            )), "All variants");
            addFilterOptions(filterElements.illustrator, new Set(collection.map(card => card.details?.illustrator)), "All illustrators");
            for (const [name, select] of Object.entries(filterElements)) {
                if ([...select.options].some(option => option.value === selectedValues[name])) {
                    select.value = selectedValues[name];
                }
            }
        }

        function renderCard(card, options = {}) {
            const detail = card.details || {};
            const tags = [...(detail.types || []), detail.rarity].filter(Boolean)
                .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
            const variants = options.hideVariants ? "" : cardVariants(card).map(variant =>
                `<span class="tag">${escapeHtml(formatVariant(variant.variantId))}</span>`
            ).join("");
            const cardElement = document.createElement("article");
            cardElement.className = "card";
            cardElement.dataset.cardId = cardGroupId(card);
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
                        ${options.hideHp ? "" : `<span>${detail.hp ? `${escapeHtml(detail.hp)} HP` : ""}</span>`}
                        ${options.unowned
                            ? '<span class="unowned-count">Not collected</span>'
                            : `<span class="owned-count">×${escapeHtml(card.count)}</span>`}
                    </div>
                </div>`;
            if (CAN_EDIT_COLLECTION && options.collectionActions) {
                cardElement.querySelector(".card-info").append(renderCollectionActions(card));
            }
            cardElement.querySelector(".card-image-button").addEventListener("click", () =>
                renderDetails(card, options.collectionActions, options.editableVariants)
            );
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
                    : "<strong>Your collection is empty</strong>Import a collection or add cards from Master Sets and Pokédex.";
                grid.append(empty);
                return;
            }
            for (const card of cards) grid.append(renderCard(card, {
                hideHp: true,
                editableVariants: CAN_EDIT_COLLECTION
            }));
        }

        function detailSection(title, body) {
            return body ? `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${body}</section>` : "";
        }

        function renderDetails(card, allowCollectionActions = false, editableVariants = false) {
            const detail = card.details || {};
            const set = detail.set || {};
            const attacks = (detail.attacks || []).map(attack =>
                `<li><strong>${escapeHtml(attack.name)}</strong> · ${escapeHtml((attack.cost || []).join(", ") || "No cost")} ${attack.damage ? `· ${escapeHtml(attack.damage)} damage` : ""}${attack.effect ? `<br><span>${escapeHtml(attack.effect)}</span>` : ""}</li>`
            ).join("");
            const abilities = (detail.abilities || []).map(ability =>
                `<li><strong>${escapeHtml(ability.name)}</strong>${ability.type ? ` · ${escapeHtml(ability.type)}` : ""}${ability.effect ? `<br><span>${escapeHtml(ability.effect)}</span>` : ""}</li>`
            ).join("");
            const ownedVariants = new Map();
            for (const variant of cardVariants(card)) {
                ownedVariants.set(
                    variant.variantId,
                    (ownedVariants.get(variant.variantId) || 0) + variant.count
                );
            }
            const variants = availableCardVariants(card).map(([variantId, label]) => {
                const quantity = ownedVariants.get(variantId) || 0;
                if (!editableVariants) {
                    return `<li><strong>${escapeHtml(label)}</strong> · Owned ×${escapeHtml(quantity)}</li>`;
                }
                return `<li class="variant-quantity-row" data-variant-id="${escapeHtml(variantId)}">
                    <strong>${escapeHtml(label)}</strong>
                    <div class="variant-quantity-control">
                        <button class="variant-quantity-button" type="button" data-quantity-step="-1" aria-label="Remove one ${escapeHtml(label)} copy" ${quantity === 0 ? "disabled" : ""}>−</button>
                        <input class="variant-quantity-input" type="number" min="0" step="1" value="${escapeHtml(quantity)}" aria-label="${escapeHtml(label)} copies owned">
                        <button class="variant-quantity-button" type="button" data-quantity-step="1" aria-label="Add one ${escapeHtml(label)} copy">+</button>
                    </div>
                </li>`;
            }).join("");
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
                        ${variants ? detailSection("Variants", `<ul class="detail-list variant-quantity-list">${variants}</ul>`) : ""}
                        ${detailSection("Illustrator", `<p>${escapeHtml(illustrator || "Not listed by TCGdex")}</p>`)}
                        ${description ? detailSection("Description", `<p>${escapeHtml(description)}</p>`) : ""}
                        ${abilities ? detailSection("Abilities", `<ul class="detail-list">${abilities}</ul>`) : ""}
                        ${attacks ? detailSection("Attacks", `<ul class="detail-list">${attacks}</ul>`) : ""}
                        ${detailSection("Set", `<p>${escapeHtml(set.name || setName(card))}${setCount ? `<br>${escapeHtml(setCount)}` : ""}${set.id ? `<br>Set code: ${escapeHtml(set.id)}` : ""}</p>`)}
                    </div>
                </div>`;
            if (CAN_EDIT_COLLECTION && allowCollectionActions) {
                dialog.querySelector(".detail-layout > div").append(renderCollectionActions(card));
            }
            if (CAN_EDIT_COLLECTION && editableVariants) {
                const rows = dialog.querySelectorAll(".variant-quantity-row");
                for (const row of rows) {
                    const variantId = row.dataset.variantId;
                    const input = row.querySelector(".variant-quantity-input");
                    const updateQuantity = quantity => {
                        if (!Number.isInteger(quantity) || quantity < 0) {
                            input.value = String(ownedVariants.get(variantId) || 0);
                            return;
                        }
                        setVariantQuantity(card, variantId, quantity);
                        const updatedRow = dialog.querySelector(
                            `.variant-quantity-row[data-variant-id="${CSS.escape(variantId)}"]`
                        );
                        const updatedInput = updatedRow?.querySelector(".variant-quantity-input");
                        updatedInput?.focus();
                    };
                    input.addEventListener("change", () => updateQuantity(Number(input.value)));
                    input.addEventListener("keydown", event => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            input.blur();
                        }
                    });
                    row.querySelectorAll(".variant-quantity-button").forEach(button => {
                        button.addEventListener("click", () => {
                            updateQuantity((ownedVariants.get(variantId) || 0) + Number(button.dataset.quantityStep));
                        });
                    });
                }
            }
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
            if (!dialog.open) dialog.showModal();
        }

        async function loadCollection() {
            try {
                const [databaseResponse, collectionResponse] = await Promise.all([
                    fetch("./tcgdex-database.json"),
                    fetch("./collection.json", { cache: "no-store" })
                ]);
                if (!databaseResponse.ok) throw new Error(`Could not load tcgdex-database.json (${databaseResponse.status}).`);
                if (!collectionResponse.ok && collectionResponse.status !== 404) {
                    throw new Error(`Could not load collection.json (${collectionResponse.status}).`);
                }
                const database = await databaseResponse.json();
                if (!database.cards || typeof database.cards !== "object") {
                    throw new Error("tcgdex-database.json must contain a cards object.");
                }

                databaseSets = database.sets || {};
                availableSets = database.availableSets || [];
                setOrder = new Map(availableSets.map((set, index) => [set.id, index]));
                allCardsById = new Map(Object.entries(database.cards));

                let sourceDocument = null;
                let localDraftDocument = null;
                let dirty = false;
                const localDraft = CAN_EDIT_COLLECTION
                    ? localStorage.getItem(COLLECTION_STORAGE_KEY)
                    : null;
                if (localDraft) {
                    const draft = JSON.parse(localDraft);
                    if (!draft || !draft.collection) throw new Error("The browser's saved collection draft is invalid. Import a collection JSON file to recover.");
                    localDraftDocument = draft.collection;
                    if (draft.dirty) {
                        const restoreDraft = window.confirm(
                            "An unsaved browser draft was found. Would you like to load it? Choose Cancel to discard it and load collection.json instead."
                        );
                        if (restoreDraft) {
                            sourceDocument = draft.collection;
                            dirty = true;
                        } else {
                            localStorage.removeItem(COLLECTION_STORAGE_KEY);
                            localDraftDocument = null;
                        }
                    }
                }
                if (!sourceDocument && collectionResponse.ok) {
                    sourceDocument = await collectionResponse.json();
                } else if (!sourceDocument && localDraftDocument) {
                    sourceDocument = localDraftDocument;
                } else if (!sourceDocument) {
                    sourceDocument = { version: 1, cards: [] };
                }

                if (localDraftDocument && sourceDocument !== localDraftDocument) {
                    const savedDraft = normalizeCollectionDocument(localDraftDocument);
                    if (!sourceDocument.binder && savedDraft.hasBinder) {
                        sourceDocument = { ...sourceDocument, binder: localDraftDocument.binder };
                    }
                    if (!sourceDocument.featuredPokedexCards && savedDraft.hasFeaturedCards) {
                        sourceDocument = { ...sourceDocument, featuredPokedexCards: localDraftDocument.featuredPokedexCards };
                    }
                }

                if (CAN_EDIT_COLLECTION && !sourceDocument.binder) {
                    const legacyBinder = localStorage.getItem("pokemon-gallery-binder");
                    if (legacyBinder) {
                        const binder = normalizeBinderState(JSON.parse(legacyBinder));
                        sourceDocument = { ...sourceDocument, binder };
                    }
                }
                applyCollectionDocument(sourceDocument, { dirty });
                logMissingCollectionCards();
                initialLoadComplete = true;
                updateSaveStatus(dirty ? "Unsaved changes" : "Saved", dirty ? "unsaved" : "");
            } catch (error) {
                document.getElementById("results-count").textContent = "Could not load your collection.";
                const status = document.getElementById("status");
                status.className = "error";
                status.textContent = `${error.message} Ensure tcgdex-database.json is present and open this page through a local web server.`;
                updateSaveStatus("Collection load failed", "error");
            }
        }

        const updateCollectionClearButton = addSearchClearButton(
            searchInput,
            document.getElementById("clear-search")
        );
        const collectionFileInput = document.getElementById("collection-file-input");
        document.getElementById("import-collection").addEventListener("click", () => {
            if (CAN_EDIT_COLLECTION) collectionFileInput.click();
        });
        collectionFileInput.addEventListener("change", async () => {
            if (!CAN_EDIT_COLLECTION) return;
            const [file] = collectionFileInput.files || [];
            if (!file) return;
            await importCollectionFile(file);
            collectionFileInput.value = "";
        });
        document.getElementById("save-collection").addEventListener("click", saveCollectionToFile);
        window.addEventListener("beforeunload", event => {
            if (!CAN_EDIT_COLLECTION || !collectionDirty) return;
            clearTimeout(collectionDraftPersistTimeout);
            collectionDraftPersistTimeout = null;
            persistCollectionDraft();
            event.preventDefault();
            event.returnValue = "";
        });
        addSearchClearButton(pokedexSearch, document.getElementById("clear-pokedex-search"));
        addSearchClearButton(masterSetSearch, document.getElementById("clear-master-set-search"));
        document.getElementById("add-binder-page").addEventListener("click", addBinderPage);
        document.getElementById("remove-binder-page").addEventListener("click", removeActiveBinderPage);
        document.getElementById("binder-card-search").addEventListener("input", renderBinderPickerResults);
        document.getElementById("binder-planning-mode").addEventListener("change", renderBinderPickerResults);
        document.getElementById("clear-binder-pocket").addEventListener("click", () => {
            if (!CAN_EDIT_COLLECTION) return;
            const page = binderPages.find(item => item.id === binderPickerTarget?.pageId);
            if (!page) return;
            page.slots[binderPickerTarget.slotIndex] = null;
            saveBinderPages();
            document.getElementById("binder-picker-dialog").close();
            renderBinder();
        });
        const binderPickerDialog = document.getElementById("binder-picker-dialog");
        document.getElementById("close-binder-picker").addEventListener("click", () => binderPickerDialog.close());
        binderPickerDialog.addEventListener("close", () => {
            if (!dialog.open) document.body.classList.remove("dialog-open");
        });
        binderPickerDialog.addEventListener("click", event => {
            if (event.target !== binderPickerDialog) return;
            const bounds = binderPickerDialog.getBoundingClientRect();
            const clickedInside = event.clientX >= bounds.left
                && event.clientX <= bounds.right
                && event.clientY >= bounds.top
                && event.clientY <= bounds.bottom;
            if (!clickedInside) binderPickerDialog.close();
        });
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
        dialog.addEventListener("close", () => {
            if (!binderPickerDialog.open) document.body.classList.remove("dialog-open");
        });
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
            if (activeTab.id === "binder-tab") renderBinder();
            if (activeTab.id === "collection-tab" && collectionNeedsRender) {
                populateFilters();
                renderCollection();
                collectionNeedsRender = false;
            }
        }

        loadCollection();
