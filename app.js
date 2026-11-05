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
        let collection = [];
        let databaseSets = {};
        let setOrder = new Map();

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

        function imageUrl(card) {
            const image = card.details?.image;
            return image ? `${image}/high.webp` : "";
        }

        function fallbackImageUrl(card) {
            const image = card.details?.image;
            return image ? `${image}/low.webp` : "";
        }

        function cardName(card) { return card.details?.name || card.cardId; }
        function setName(card) { return card.details?.set?.name || card.cardId.split("-")[0].toUpperCase(); }

        function compareText(a, b) {
            return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
        }

        function cardGroupId(card) {
            return normalizeCardId(card.cardId);
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

        function renderCard(card, index) {
            const detail = card.details || {};
            const tags = [...(detail.types || []), detail.rarity].filter(Boolean)
                .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
            const variants = cardVariants(card).map(variant =>
                `<span class="tag">${escapeHtml(formatVariant(variant.variantId))}</span>`
            ).join("");
            const cardElement = document.createElement("article");
            cardElement.className = "card";
            cardElement.innerHTML = `
                <button class="card-image-button" type="button" aria-label="View ${escapeHtml(cardName(card))} details" data-card-index="${index}">
                    <img class="card-image" src="${escapeHtml(imageUrl(card))}" alt="${escapeHtml(cardName(card))} Pokémon card" loading="lazy">
                </button>
                <div class="card-info">
                    <div class="card-name-line">
                        <h2 class="card-name">${escapeHtml(cardName(card))}</h2>
                        <span class="card-number">${escapeHtml(detail.localId || card.cardId)}</span>
                    </div>
                    <p class="set-name">${escapeHtml(setName(card))}</p>
                    <div class="tag-row">${tags || '<span class="tag">Details unavailable</span>'}</div>
                    <div class="tag-row variant-row" aria-label="Owned variants">${variants}</div>
                    <div class="card-bottom">
                        <span>${detail.hp ? `${escapeHtml(detail.hp)} HP` : ""}</span>
                        <span class="owned-count">×${escapeHtml(card.count)}</span>
                    </div>
                </div>`;
            const image = cardElement.querySelector("img");
            image.addEventListener("error", () => {
                const fallback = fallbackImageUrl(card);
                if (fallback && image.src !== fallback) image.src = fallback;
                else image.alt = `${cardName(card)} card image unavailable`;
            }, { once: true });
            return cardElement;
        }

        function visibleCards() {
            const query = searchInput.value.trim().toLocaleLowerCase();
            return collection.filter(card => {
                const detail = card.details || {};
                const searchable = [
                    cardName(card), card.cardId, detail.localId, setName(card),
                    detail.rarity, detail.description, detail.illustrator, ...(detail.types || [])
                ].filter(Boolean).join(" ").toLocaleLowerCase();
                return (!query || searchable.includes(query))
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
                empty.innerHTML = "<strong>No cards match these filters</strong>Try a different search or reset the filters.";
                grid.append(empty);
                return;
            }
            for (const card of cards) grid.append(renderCard(card, collection.indexOf(card)));
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
                    <img class="detail-image" src="${escapeHtml(imageUrl(card))}" alt="${escapeHtml(cardName(card))} Pokémon card">
                    <div>
                        ${detailSection("Card", `<p>${escapeHtml(stats || "Card details unavailable")}${detail.rarity ? `<br>${escapeHtml(detail.rarity)}` : ""}<br>Owned ×${escapeHtml(card.count)}</p>`)}
                        ${detailSection("Variants", `<ul class="detail-list">${variants}</ul>`)}
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
                artDialog.showModal();
            });
            detailImage.addEventListener("error", () => {
                const fallback = fallbackImageUrl(card);
                if (fallback && detailImage.src !== fallback) detailImage.src = fallback;
                else detailImage.alt = `${cardName(card)} card image unavailable`;
            }, { once: true });
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
                if (!inventory.cards.length) {
                    document.getElementById("results-count").textContent = "Your collection is empty.";
                    return;
                }

                document.getElementById("total-count").textContent = inventory.cards.reduce((sum, card) => sum + (Number(card.count) || 0), 0);

                databaseSets = database.sets || {};
                setOrder = new Map((database.availableSets || []).map((set, index) => [set.id, index]));
                collection = groupInventoryCards(inventory.cards, database.cards);
                document.getElementById("unique-count").textContent = collection.length;
                document.getElementById("set-count").textContent = new Set(collection.map(setName)).size;
                populateFilters();
                renderCollection();

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

        searchInput.addEventListener("input", renderCollection);
        Object.values(filterElements).forEach(select => select.addEventListener("change", renderCollection));
        sortSelect.addEventListener("change", renderCollection);
        document.getElementById("reset-filters").addEventListener("click", () => {
            searchInput.value = "";
            Object.values(filterElements).forEach(select => { select.value = ""; });
            renderCollection();
            searchInput.focus();
        });
        grid.addEventListener("click", event => {
            const button = event.target.closest("[data-card-index]");
            if (button) renderDetails(collection[Number(button.dataset.cardIndex)]);
        });
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

        loadCollection();
