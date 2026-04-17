const NUMBER_WORDS = new Map([
    ['a', 1],
    ['an', 1],
    ['one', 1],
    ['won', 1],
    ['wun', 1],
    ['wan', 1],
    ['van', 1],
    ['ek', 1],
    ['1', 1],
    ['two', 2],
    ['do', 2],
    ['2', 2],
    ['three', 3],
    ['teen', 3],
    ['tin', 3],
    ['3', 3],
    ['four', 4],
    ['char', 4],
    ['chaar', 4],
    ['4', 4],
    ['five', 5],
    ['paanch', 5],
    ['panch', 5],
    ['5', 5],
    ['six', 6],
    ['chhe', 6],
    ['cheh', 6],
    ['6', 6],
    ['seven', 7],
    ['saat', 7],
    ['sat', 7],
    ['7', 7],
    ['eight', 8],
    ['aath', 8],
    ['8', 8],
    ['nine', 9],
    ['nau', 9],
    ['9', 9],
    ['ten', 10],
    ['das', 10],
    ['dus', 10],
    ['10', 10],
    ['eleven', 11],
    ['gyarah', 11],
    ['gyaarah', 11],
    ['11', 11],
    ['twelve', 12],
    ['barah', 12],
    ['baarah', 12],
    ['12', 12],
]);

const MODE_KEYWORDS = {
    delivery: ['delivery', 'home delivery', 'ghar bhejo', 'ghar', 'deliver'],
    pickup: ['pickup', 'pick up', 'parcel', 'take away', 'takeaway', 'carry out'],
    'dine-in': ['dine in', 'dinein', 'table', 'on table'],
};

const CLEAR_ALL_PATTERNS = [
    /\bclear all\b/g,
    /\bclear cart\b/g,
    /\bempty cart\b/g,
    /\ball clear\b/g,
    /\bsab clear\b/g,
    /\bsab hata do\b/g,
    /\bsab hatao\b/g,
    /\bsab hata\b/g,
];

const SUBTRACT_PATTERNS = [
    /\bminus\b/g,
    /\bmines\b/g,
    /\bminas\b/g,
    /\bminez\b/g,
    /\bless\b/g,
    /\bsubtract\b/g,
    /\bsubstract\b/g,
    /\breduce\b/g,
    /\bghata do\b/g,
    /\bghatao\b/g,
    /\bghata\b/g,
    /\bkam karo\b/g,
    /\bkam kar\b/g,
    /\bkam\b/g,
];

const CLEAR_ITEM_PATTERNS = [
    /\bclear\b/g,
    /\bremove\b/g,
    /\bdelete\b/g,
    /\bhata do\b/g,
    /\bhatao\b/g,
    /\bhata\b/g,
    /\bnikal do\b/g,
    /\bnikalo\b/g,
    /\bnikal\b/g,
];

const PORTION_SYNONYMS = {
    half: ['half', 'aadha', 'adha', '1/2'],
    full: ['full', 'ful,', 'Phool', 'poora', 'pura', 'whole'],
    regular: ['regular', 'normal', 'standard'],
    unit: ['unit', 'piece', 'pcs', 'pc'],
};

const COMMAND_NOISE_TOKENS = new Set([
    'add',
    'please',
    'plz',
    'bro',
    'bhai',
    'bhiya',
    'bhaiya',
    'kar',
    'kardo',
    'karna',
    'karne',
    'karni',
    'karnihai',
    'karnahe',
    'de',
    'dena',
    'dene',
    'bhej',
    'bhejo',
    'bhejna',
    'dalo',
    'daalo',
    'dal',
    'daldo',
    'mein',
    'me',
    'mai',
    'ke',
    'ki',
    'ko',
    'par',
    'pe',
    'liye',
    'liya',
    'wali',
    'wala',
    'waale',
    'waali',
    'existing',
    'cart',
    'mode',
    'this',
    'item',
    'items',
    'order',
    'current',
    'bill',
    'customer',
    'for',
    'to',
    'the',
    'a',
    'an',
]);

const LOW_SIGNAL_TOKENS = new Set([
    'hai',
    'hain',
    'tha',
    'thi',
    'thae',
    'di',
    'na',
    'ji',
    'and',
    'aur',
]);

const SEGMENT_DELIMITER_TOKENS = new Set([
    'aur',
    'and',
    'plus',
    'then',
    'phir',
    'fir',
    'next',
]);

const OPTIONAL_ALIAS_MODIFIER_TOKENS = new Set([
    'plain',
    'butter',
    'masala',
    'special',
    'extra',
    'fresh',
    'regular',
    'full',
    'half',
]);

const GENERIC_ALIAS_STOP_TOKENS = new Set([
    ...OPTIONAL_ALIAS_MODIFIER_TOKENS,
    ...LOW_SIGNAL_TOKENS,
]);

const DEVANAGARI_WORD_PATTERN = /[\u0900-\u097F]+/g;
const DEVANAGARI_DIGITS = {
    '०': '0',
    '१': '1',
    '२': '2',
    '३': '3',
    '४': '4',
    '५': '5',
    '६': '6',
    '७': '7',
    '८': '8',
    '९': '9',
};
const DEVANAGARI_WORD_REPLACEMENTS = new Map([
    ['एक', 'ek'],
    ['दो', 'do'],
    ['तीन', 'teen'],
    ['चार', 'chaar'],
    ['पांच', 'paanch'],
    ['पाँच', 'paanch'],
    ['छह', 'chhe'],
    ['सात', 'saat'],
    ['आठ', 'aath'],
    ['नौ', 'nau'],
    ['दस', 'das'],
    ['ग्यारह', 'gyarah'],
    ['बारह', 'barah'],
    ['आधा', 'aadha'],
    ['हाफ', 'half'],
    ['फुल', 'full'],
    ['पूरा', 'poora'],
    ['पूराा', 'poora'],
    ['तन्दूरी', 'tandoori'],
    ['तंदूरी', 'tandoori'],
    ['रोटी', 'roti'],
    ['नान', 'naan'],
    ['बटर', 'butter'],
    ['मलाई', 'malai'],
    ['चाप', 'chaap'],
    ['पराठा', 'paratha'],
    ['कढ़ाई', 'kadhai'],
    ['कड़ाई', 'kadhai'],
    ['कडाई', 'kadhai'],
    ['पनीर', 'paneer'],
    ['दाल', 'daal'],
    ['कुलचा', 'kulcha'],
    ['भटूरा', 'bhatura'],
    ['भटूरे', 'bhature'],
    ['मसाला', 'masala'],
    ['कम', 'kam'],
    ['हटाओ', 'hatao'],
    ['हटा', 'hata'],
    ['डिलीवरी', 'delivery'],
    ['पार्सल', 'parcel'],
    ['टेबल', 'table'],
]);
const DEVANAGARI_INDEPENDENT_VOWELS = {
    'अ': 'a',
    'आ': 'aa',
    'इ': 'i',
    'ई': 'i',
    'उ': 'u',
    'ऊ': 'u',
    'ए': 'e',
    'ऐ': 'ai',
    'ओ': 'o',
    'औ': 'au',
    'ऋ': 'ri',
    'ऑ': 'o',
};
const DEVANAGARI_MATRAS = {
    'ा': 'aa',
    'ि': 'i',
    'ी': 'i',
    'ु': 'u',
    'ू': 'u',
    'े': 'e',
    'ै': 'ai',
    'ो': 'o',
    'ौ': 'au',
    'ृ': 'ri',
    'ॅ': 'e',
    'ॉ': 'o',
};
const DEVANAGARI_CONSONANTS = {
    'क': 'k',
    'ख': 'kh',
    'ग': 'g',
    'घ': 'gh',
    'ङ': 'ng',
    'च': 'ch',
    'छ': 'chh',
    'ज': 'j',
    'झ': 'jh',
    'ञ': 'ny',
    'ट': 't',
    'ठ': 'th',
    'ड': 'd',
    'ढ': 'dh',
    'ण': 'n',
    'त': 't',
    'थ': 'th',
    'द': 'd',
    'ध': 'dh',
    'न': 'n',
    'प': 'p',
    'फ': 'f',
    'ब': 'b',
    'भ': 'bh',
    'म': 'm',
    'य': 'y',
    'र': 'r',
    'ल': 'l',
    'व': 'v',
    'श': 'sh',
    'ष': 'sh',
    'स': 's',
    'ह': 'h',
    'क़': 'k',
    'ख़': 'kh',
    'ग़': 'g',
    'ज़': 'z',
    'ड़': 'd',
    'ढ़': 'dh',
    'फ़': 'f',
    'य़': 'y',
};

function transliterateDevanagariWord(word = '') {
    const directMatch = DEVANAGARI_WORD_REPLACEMENTS.get(String(word || '').trim());
    if (directMatch) return directMatch;

    let output = '';
    for (let index = 0; index < word.length; index += 1) {
        const current = word[index];
        const pair = `${current}${word[index + 1] || ''}`;
        const triple = `${pair}${word[index + 2] || ''}`;

        if (triple === 'क्ष') {
            output += 'ksh';
            index += 2;
            continue;
        }
        if (triple === 'ज्ञ') {
            output += 'gya';
            index += 2;
            continue;
        }
        if (triple === 'श्र') {
            output += 'shr';
            index += 2;
            continue;
        }
        if (triple === 'त्र') {
            output += 'tr';
            index += 2;
            continue;
        }

        if (DEVANAGARI_DIGITS[current]) {
            output += DEVANAGARI_DIGITS[current];
            continue;
        }
        if (DEVANAGARI_INDEPENDENT_VOWELS[current]) {
            output += DEVANAGARI_INDEPENDENT_VOWELS[current];
            continue;
        }
        if (current === 'ं' || current === 'ँ') {
            output += 'n';
            continue;
        }
        if (current === 'ः') {
            output += 'h';
            continue;
        }
        if (current === '़' || current === '्') {
            continue;
        }

        let consonant = DEVANAGARI_CONSONANTS[current];
        if (!consonant && DEVANAGARI_CONSONANTS[pair]) {
            consonant = DEVANAGARI_CONSONANTS[pair];
            index += 1;
        }
        if (consonant) {
            const next = word[index + 1] || '';
            if (DEVANAGARI_MATRAS[next]) {
                output += consonant + DEVANAGARI_MATRAS[next];
                index += 1;
                continue;
            }
            if (next === '्') {
                output += consonant;
                index += 1;
                continue;
            }
            output += `${consonant}a`;
            continue;
        }

        output += current;
    }

    return output
        .replace(/aai/g, 'ai')
        .replace(/aae/g, 'ae')
        .replace(/ii+/g, 'i')
        .replace(/uu+/g, 'u')
        .replace(/([bcdfghjklmnpqrstvwxyz])a$/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

function transliterateDevanagariText(value = '') {
    return String(value || '').replace(DEVANAGARI_WORD_PATTERN, (word) => (
        transliterateDevanagariWord(word)
    ));
}

function normalizeBasicText(value = '') {
    return transliterateDevanagariText(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\bhaa?f\b/g, ' half ')
        .replace(/\bpoora+\b/g, ' full ')
        .replace(/\baadha+\b|\badha+\b/g, ' aadha ')
        .replace(/\bmalai\s+(?:sahab|saab|shaab|shab)\b/g, ' malai chaap ')
        .replace(/\bmines\b|\bminas\b|\bminez\b/g, ' minus ')
        .replace(/\bchap\b/g, ' chaap ')
        .replace(/\bchaap+\b/g, ' chaap ')
        .replace(/\bchapati\b|\bchapathi\b|\bchappati\b/g, ' chapati ')
        .replace(/\brot+i+\b|\brot+y\b|\brothi\b|\brodi\b|\brody\b|\broti\b/g, ' roti ')
        .replace(/\bnaanh\b|\bnan\b/g, ' naan ')
        .replace(/\bbutar\b|\bbatar\b|\bbuter\b|\bbuttar\b/g, ' butter ')
        .replace(/\btanduri\b/g, ' tandoori ')
        .replace(/\btandoor+i+\b/g, ' tandoori ')
        .replace(/\btandori\b|\btandoory\b|\btan doori\b/g, ' tandoori ')
        .replace(/\bkadai\b|\bkadai\b|\bkadahi\b/g, ' kadhai ')
        .replace(/\bparatha\b/g, ' paratha ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeVoiceText(value = '') {
    return normalizeBasicText(value)
        .replace(/[^a-z0-9\s/-]/g, ' ')
        .replace(/[/-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function compactText(value = '') {
    return normalizeVoiceText(value).replace(/[^a-z0-9]/g, '');
}

function tokenize(value = '') {
    return normalizeVoiceText(value).split(' ').filter(Boolean);
}

function normalizePhoneticToken(token = '') {
    const compact = compactText(token);
    if (!compact) return '';

    const collapsed = compact
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/[cq]/g, 'k')
        .replace(/x/g, 'ks')
        .replace(/[vw]/g, 'v')
        .replace(/[dt]/g, 't')
        .replace(/[sz]/g, 's')
        .replace(/[bp]/g, 'b')
        .replace(/([a-z])\1+/g, '$1');

    if (collapsed.length <= 1) return collapsed;
    return `${collapsed[0]}${collapsed.slice(1).replace(/[aeiou]/g, '')}`;
}

function toPhoneticTokens(value = '') {
    return tokenize(value)
        .map((token) => normalizePhoneticToken(token))
        .filter(Boolean);
}

function buildPortionSynonymLookup() {
    const lookup = new Map();
    Object.entries(PORTION_SYNONYMS).forEach(([canonical, aliases]) => {
        aliases.forEach((alias) => {
            lookup.set(normalizeVoiceText(alias), canonical);
        });
    });
    return lookup;
}

const PORTION_LOOKUP = buildPortionSynonymLookup();

function parseNumberToken(token = '') {
    const normalized = normalizeVoiceText(token);
    if (!normalized) return null;
    if (NUMBER_WORDS.has(normalized)) {
        return NUMBER_WORDS.get(normalized);
    }
    const parsed = parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isCommandNoiseToken(token = '') {
    return COMMAND_NOISE_TOKENS.has(normalizeVoiceText(token));
}

function isLowSignalToken(token = '') {
    return LOW_SIGNAL_TOKENS.has(normalizeVoiceText(token));
}

function detectExplicitMode(transcript = '') {
    const normalized = normalizeVoiceText(transcript);
    if (!normalized) return null;

    if (/\b(delivery|deliver|home delivery)\b/.test(normalized)) return 'delivery';
    if (/\b(pickup|pick up|parcel|takeaway|take away|carry out)\b/.test(normalized)) return 'pickup';
    if (/\b(dinein|dine in|table)\b/.test(normalized)) return 'dine-in';
    return null;
}

function extractTableReference(transcript = '') {
    const normalized = normalizeVoiceText(transcript);
    if (!normalized) return { value: '', cleanedText: normalized };

    const patterns = [
        /\btable\s*(?:number|no|num)?\s*([a-z0-9-]+)\b/,
        /\bt\s*([0-9]{1,3})\b/,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match) continue;
        const reference = String(match[1] || '').trim();
        if (!reference) continue;
        return {
            value: reference,
            cleanedText: normalized.replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
        };
    }

    return { value: '', cleanedText: normalized };
}

function removeModeHints(transcript = '') {
    return normalizeVoiceText(transcript)
        .replace(/\bhome delivery\b/g, ' ')
        .replace(/\bdelivery\b/g, ' ')
        .replace(/\bpick up\b/g, ' ')
        .replace(/\bpickup\b/g, ' ')
        .replace(/\bparcel\b/g, ' ')
        .replace(/\btake away\b/g, ' ')
        .replace(/\btakeaway\b/g, ' ')
        .replace(/\bdine in\b/g, ' ')
        .replace(/\bdinein\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildSaleOption(name, price, label = name) {
    return {
        name: String(name || '').trim() || 'regular',
        label: String(label || name || '').trim() || 'Regular',
        price: Number(price || 0),
    };
}

function getItemSaleOptions(item = {}, isStoreOutlet = false) {
    if (isStoreOutlet) {
        const fallbackPrice = Number(item?.price ?? item?.portions?.[0]?.price ?? 0);
        return [buildSaleOption('unit', fallbackPrice, 'Unit')];
    }
    if (Array.isArray(item?.portions) && item.portions.length > 0) {
        return item.portions.map((portion) => buildSaleOption(portion?.name, portion?.price, portion?.name));
    }
    return [buildSaleOption('regular', item?.price, 'Regular')];
}

function getItemAvailableStock(item = {}) {
    const raw = item?.availableStock ?? item?.available;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isVoiceSelectableItem(item = {}) {
    if (item?.isAvailable === false) return false;
    const availableStock = getItemAvailableStock(item);
    return availableStock === null || availableStock > 0;
}

function uniqueStrings(values = []) {
    return [...new Set(values.map((value) => normalizeVoiceText(value)).filter(Boolean))];
}

function uniqueTokens(values = []) {
    const tokenSet = new Set();
    values.forEach((value) => {
        tokenize(value).forEach((token) => {
            if (token) tokenSet.add(token);
        });
    });
    return Array.from(tokenSet);
}

function buildReducedAliases(baseName = '') {
    const tokens = tokenize(baseName);
    if (!tokens.length) return [];

    const aliases = [];
    const meaningfulTokens = tokens.filter((token) => !GENERIC_ALIAS_STOP_TOKENS.has(token));

    const pushAliasGroup = (group = []) => {
        const alias = group.filter(Boolean).join(' ').trim();
        if (alias) aliases.push(alias);
    };

    const tokenSource = meaningfulTokens.length > 0 ? meaningfulTokens : tokens;
    pushAliasGroup([tokens[tokens.length - 1]]);
    pushAliasGroup(tokens.slice(-2));
    pushAliasGroup([tokens[0], tokens[tokens.length - 1]]);

    if (tokenSource.length > 0 && tokenSource.length < tokens.length) {
        pushAliasGroup(tokenSource);
    }

    if (tokenSource.length >= 1) {
        const lastToken = tokenSource[tokenSource.length - 1];
        if (lastToken.length >= 3) {
            pushAliasGroup([lastToken]);
        }
    }

    if (tokenSource.length >= 2) {
        pushAliasGroup(tokenSource.slice(-2));
        pushAliasGroup([tokenSource[0], tokenSource[tokenSource.length - 1]]);
    }

    tokenSource.forEach((token) => {
        if (token.length >= 5) {
            pushAliasGroup([token]);
        }
    });

    return aliases;
}

function buildEntryAliases(item = {}, saleOptions = []) {
    const baseName = String(item?.name || '').trim();
    const aliases = [baseName];
    if (baseName.includes('&')) aliases.push(baseName.replace(/&/g, 'and'));
    aliases.push(...buildReducedAliases(baseName));

    const tags = Array.isArray(item?.tags) ? item.tags : [];
    tags.forEach((tag) => {
        if (tag) aliases.push(String(tag));
    });

    saleOptions.forEach((option) => {
        if (!option?.label || !baseName) return;
        aliases.push(`${option.label} ${baseName}`);
        aliases.push(`${baseName} ${option.label}`);
        buildReducedAliases(`${option.label} ${baseName}`).forEach((alias) => aliases.push(alias));
    });

    return uniqueStrings(aliases);
}

export function buildVoiceMenuIndex(menu = {}, openItems = [], businessType = 'restaurant') {
    const isStoreOutlet = String(businessType || '').trim().toLowerCase() === 'store';
    const entries = [];

    Object.entries(menu || {}).forEach(([categoryId, items]) => {
        if (!Array.isArray(items)) return;
        items.forEach((item) => {
            if (!item?.id || !isVoiceSelectableItem(item)) return;
            const saleOptions = getItemSaleOptions(item, isStoreOutlet);
            const aliases = buildEntryAliases(item, saleOptions);
            entries.push({
                entryId: String(item.id),
                itemId: String(item.id),
                categoryId,
                item,
                name: String(item.name || '').trim(),
                normalizedName: normalizeVoiceText(item.name),
                compactName: compactText(item.name),
                tokens: tokenize(item.name),
                aliases,
                keywordTokens: uniqueTokens(aliases),
                phoneticKeywordTokens: uniqueStrings(aliases.flatMap((alias) => toPhoneticTokens(alias))),
                saleOptions: saleOptions.map((option) => ({
                    ...option,
                    normalizedName: normalizeVoiceText(option.name),
                    normalizedLabel: normalizeVoiceText(option.label),
                    compactLabel: compactText(option.label),
                })),
            });
        });
    });

    (Array.isArray(openItems) ? openItems : []).forEach((item) => {
        if (!item?.id || !isVoiceSelectableItem(item)) return;
        const saleOptions = [buildSaleOption('regular', item?.price, 'Regular')];
        const aliases = buildEntryAliases(item, saleOptions);
        entries.push({
            entryId: String(item.id),
            itemId: String(item.id),
            categoryId: 'open-items',
            item,
            name: String(item.name || '').trim(),
            normalizedName: normalizeVoiceText(item.name),
            compactName: compactText(item.name),
            tokens: tokenize(item.name),
            aliases,
            keywordTokens: uniqueTokens(aliases),
            phoneticKeywordTokens: uniqueStrings(aliases.flatMap((alias) => toPhoneticTokens(alias))),
            saleOptions: saleOptions.map((option) => ({
                ...option,
                normalizedName: normalizeVoiceText(option.name),
                normalizedLabel: normalizeVoiceText(option.label),
                compactLabel: compactText(option.label),
            })),
        });
    });

    return entries;
}

function computeEditDistance(left = '', right = '') {
    const a = compactText(left);
    const b = compactText(right);
    if (!a || !b) return Number.MAX_SAFE_INTEGER;
    if (a === b) return 0;

    const previous = new Array(b.length + 1);
    const current = new Array(b.length + 1);

    for (let j = 0; j <= b.length; j += 1) {
        previous[j] = j;
    }

    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + cost
            );
        }
        for (let j = 0; j <= b.length; j += 1) {
            previous[j] = current[j];
        }
    }

    return previous[b.length];
}

function scoreTokenOverlap(leftTokens = [], rightTokens = []) {
    if (!leftTokens.length || !rightTokens.length) return 0;
    const rightSet = new Set(rightTokens);
    const common = leftTokens.filter((token) => rightSet.has(token)).length;
    if (common <= 0) return 0;
    const recall = common / leftTokens.length;
    const precision = common / rightTokens.length;
    return (recall * 0.65) + (precision * 0.35);
}

function scoreLooseTokenPair(leftToken = '', rightToken = '') {
    const left = compactText(leftToken);
    const right = compactText(rightToken);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) {
        return 0.92;
    }

    const maxLength = Math.max(left.length, right.length, 1);
    const distance = computeEditDistance(left, right);
    if (!Number.isFinite(distance) || distance >= Number.MAX_SAFE_INTEGER) return 0;
    const score = Math.max(0, 1 - (distance / maxLength));
    return score >= 0.72 ? score : 0;
}

function scoreLooseTokenOverlap(leftTokens = [], rightTokens = []) {
    if (!leftTokens.length || !rightTokens.length) return 0;
    let matchedScore = 0;
    leftTokens.forEach((leftToken) => {
        let bestScore = 0;
        rightTokens.forEach((rightToken) => {
            bestScore = Math.max(bestScore, scoreLooseTokenPair(leftToken, rightToken));
        });
        matchedScore += bestScore;
    });
    return matchedScore / leftTokens.length;
}

function scoreBestTokenPair(leftTokens = [], rightTokens = []) {
    if (!leftTokens.length || !rightTokens.length) return 0;
    let bestScore = 0;
    leftTokens.forEach((leftToken) => {
        rightTokens.forEach((rightToken) => {
            bestScore = Math.max(bestScore, scoreLooseTokenPair(leftToken, rightToken));
        });
    });
    return bestScore;
}

function scoreTextSimilarity(phrase = '', candidate = '') {
    const normalizedPhrase = normalizeVoiceText(phrase);
    const normalizedCandidate = normalizeVoiceText(candidate);
    if (!normalizedPhrase || !normalizedCandidate) return 0;
    if (normalizedPhrase === normalizedCandidate) return 1;

    const phraseCompact = compactText(normalizedPhrase);
    const candidateCompact = compactText(normalizedCandidate);
    const phraseTokens = tokenize(normalizedPhrase);
    const candidateTokens = tokenize(normalizedCandidate);
    const phrasePhoneticTokens = phraseTokens.map((token) => normalizePhoneticToken(token)).filter(Boolean);
    const candidatePhoneticTokens = candidateTokens.map((token) => normalizePhoneticToken(token)).filter(Boolean);
    let score = 0;

    if (phraseCompact && candidateCompact) {
        if (phraseCompact === candidateCompact) return 0.99;
        if (candidateCompact.startsWith(phraseCompact) || phraseCompact.startsWith(candidateCompact)) {
            score = Math.max(score, 0.78);
        }
        if (candidateCompact.includes(phraseCompact) || phraseCompact.includes(candidateCompact)) {
            score = Math.max(score, 0.68);
        }
    }

    const tokenScore = scoreTokenOverlap(phraseTokens, candidateTokens);
    score = Math.max(score, tokenScore * 0.88);
    const looseTokenScore = scoreLooseTokenOverlap(phraseTokens, candidateTokens);
    score = Math.max(score, looseTokenScore * 0.92);
    const bestLiteralTokenScore = scoreBestTokenPair(phraseTokens, candidateTokens);
    const phoneticTokenScore = scoreTokenOverlap(phrasePhoneticTokens, candidatePhoneticTokens);
    score = Math.max(score, phoneticTokenScore * 0.9);
    const phoneticLooseScore = scoreLooseTokenOverlap(phrasePhoneticTokens, candidatePhoneticTokens);
    score = Math.max(score, phoneticLooseScore * 0.94);
    const bestPhoneticTokenScore = scoreBestTokenPair(phrasePhoneticTokens, candidatePhoneticTokens);

    const maxLength = Math.max(phraseCompact.length, candidateCompact.length, 1);
    const editDistance = computeEditDistance(normalizedPhrase, normalizedCandidate);
    if (Number.isFinite(editDistance) && editDistance < Number.MAX_SAFE_INTEGER) {
        const editScore = Math.max(0, 1 - (editDistance / maxLength));
        const hasTokenSignal = (
            tokenScore > 0 ||
            looseTokenScore >= 0.72 ||
            phoneticTokenScore > 0 ||
            phoneticLooseScore >= 0.72
        );
        const hasContainmentSignal = (
            candidateCompact.startsWith(phraseCompact) ||
            phraseCompact.startsWith(candidateCompact) ||
            candidateCompact.includes(phraseCompact) ||
            phraseCompact.includes(candidateCompact)
        );
        if (hasTokenSignal || hasContainmentSignal) {
            score = Math.max(score, editScore * 0.76);
        } else {
            score = Math.max(score, editScore * 0.1);
        }
    }

    if (phraseTokens.length === 1 && candidateTokens.length >= 1) {
        const hasLiteralSignal = (
            tokenScore > 0 ||
            bestLiteralTokenScore >= 0.68 ||
            candidateCompact.includes(phraseCompact) ||
            phraseCompact.includes(candidateCompact)
        );
        if (!hasLiteralSignal && bestPhoneticTokenScore >= 0.95) {
            score = Math.min(score, 0.44);
        }
    }

    return Math.min(1, score);
}

function resolveRequestedPortion(portionTokens = []) {
    const normalized = normalizeVoiceText(portionTokens.join(' '));
    if (!normalized) return '';
    return PORTION_LOOKUP.get(normalized) || normalized;
}

function pickDefaultSaleOption(entry = {}) {
    const options = Array.isArray(entry?.saleOptions) ? entry.saleOptions : [];
    if (options.length <= 1) return options[0] || null;

    const priorities = ['regular', 'full', 'unit'];
    for (const priority of priorities) {
        const match = options.find((option) => option.normalizedName === priority || option.normalizedLabel === priority);
        if (match) return match;
    }
    return options[0] || null;
}

function resolvePortionMatch(entry = {}, requestedPortion = '') {
    const options = Array.isArray(entry?.saleOptions) ? entry.saleOptions : [];
    if (!options.length) return { option: null, matched: false, score: 0 };
    if (!requestedPortion) {
        return { option: pickDefaultSaleOption(entry), matched: false, score: 0 };
    }

    const normalizedRequest = normalizeVoiceText(requestedPortion);
    const scored = options
        .map((option) => {
            const score = Math.max(
                scoreTextSimilarity(normalizedRequest, option.normalizedName),
                scoreTextSimilarity(normalizedRequest, option.normalizedLabel)
            );
            return { option, score };
        })
        .sort((left, right) => right.score - left.score);

    const top = scored[0];
    if (!top) {
        return { option: pickDefaultSaleOption(entry), matched: false, score: 0 };
    }

    const confident = top.score >= 0.82;
    return {
        option: confident ? top.option : (options.length === 1 ? top.option : null),
        matched: confident,
        score: top.score,
    };
}

function isGenericPhrase(phrase = '') {
    const tokens = tokenize(phrase).filter((token) => !isLowSignalToken(token));
    return tokens.length <= 1;
}

function buildCandidatePreview(entry = {}, portionOption = null, score = 0) {
    return {
        entryId: entry.entryId,
        itemId: entry.itemId,
        name: entry.name,
        categoryId: entry.categoryId,
        portionName: portionOption?.label || portionOption?.name || '',
        confidence: Number(score.toFixed(3)),
        portionOptions: (entry.saleOptions || []).map((option) => option.label || option.name),
    };
}

function getFamilyCandidates(candidates = [], phraseTokens = []) {
    const terminalToken = phraseTokens[phraseTokens.length - 1] || '';
    if (!terminalToken) return [];

    return candidates.filter((candidate) => (
        Array.isArray(candidate?.entry?.tokens) &&
        candidate.entry.tokens.includes(terminalToken)
    ));
}

function getExactEntryMatches(menuIndex = [], normalizedPhrase = '', requestedPortion = '') {
    if (!normalizedPhrase) return [];

    return menuIndex
        .filter((entry) => (
            entry?.normalizedName === normalizedPhrase ||
            (Array.isArray(entry?.aliases) && entry.aliases.includes(normalizedPhrase))
        ))
        .map((entry) => ({
            entry,
            entryScore: entry.normalizedName === normalizedPhrase ? 1 : 0.99,
            confidence: entry.normalizedName === normalizedPhrase ? 1 : 0.99,
            exactKeywordCoverage: 1,
            looseKeywordCoverage: 1,
            phoneticKeywordCoverage: 1,
            portionMatch: resolvePortionMatch(entry, requestedPortion),
        }))
        .sort((left, right) => right.confidence - left.confidence);
}

function getMenuFamilyCandidates(menuIndex = [], phraseTokens = [], requestedPortion = '') {
    const terminalToken = phraseTokens[phraseTokens.length - 1] || '';
    if (!terminalToken) return [];

    return menuIndex
        .filter((entry) => (
            Array.isArray(entry?.tokens) &&
            entry.tokens.includes(terminalToken)
        ))
        .map((entry) => {
            const portionMatch = resolvePortionMatch(entry, requestedPortion);
            const score = Math.max(
                scoreTextSimilarity(phraseTokens.join(' '), entry.name),
                ...entry.aliases.map((alias) => scoreTextSimilarity(phraseTokens.join(' '), alias))
            );
            return {
                entry,
                confidence: score,
                portionMatch,
            };
        })
        .sort((left, right) => right.confidence - left.confidence);
}

function buildEntryPortionCandidates(entry = {}, score = 0) {
    const options = Array.isArray(entry?.saleOptions) ? entry.saleOptions : [];
    if (!options.length) {
        return [buildCandidatePreview(entry, null, score)];
    }
    return options.map((option) => buildCandidatePreview(entry, option, score));
}

function extractCartAction(transcript = '') {
    const normalized = normalizeVoiceText(transcript);
    if (!normalized) {
        return {
            action: 'add',
            cleanedText: '',
        };
    }

    let action = 'add';
    let cleanedText = normalized;

    const matchesPattern = (patterns = []) => patterns.some((pattern) => (
        new RegExp(pattern.source, pattern.flags).test(normalized)
    ));
    const stripPatterns = (patterns = []) => {
        patterns.forEach((pattern) => {
            cleanedText = cleanedText.replace(new RegExp(pattern.source, pattern.flags), ' ');
        });
    };

    if (matchesPattern(CLEAR_ALL_PATTERNS)) {
        action = 'clear-all';
        stripPatterns(CLEAR_ALL_PATTERNS);
    } else if (matchesPattern(SUBTRACT_PATTERNS)) {
        action = 'subtract';
        stripPatterns(SUBTRACT_PATTERNS);
    } else if (matchesPattern(CLEAR_ITEM_PATTERNS)) {
        action = 'clear-item';
        stripPatterns(CLEAR_ITEM_PATTERNS);
    }

    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
    return {
        action,
        cleanedText,
    };
}

function matchVoiceItemPhrase(phrase = '', menuIndex = [], requestedPortion = '', options = {}) {
    const commandAction = String(options?.commandAction || 'add').trim() || 'add';
    const normalizedPhrase = normalizeVoiceText(phrase);
    if (!normalizedPhrase) {
        return {
            status: 'empty',
            confidence: 0,
            candidates: [],
        };
    }

    const phraseTokens = tokenize(normalizedPhrase).filter((token) => !shouldSkipToken(token));
    const phrasePhoneticTokens = phraseTokens.map((token) => normalizePhoneticToken(token)).filter(Boolean);
    const exactMatches = getExactEntryMatches(menuIndex, normalizedPhrase, requestedPortion);

    if (exactMatches.length === 1) {
        const exactTop = exactMatches[0];
        const needsPortionConfirmation = (
            commandAction === 'add' &&
            !requestedPortion &&
            Array.isArray(exactTop?.entry?.saleOptions) &&
            exactTop.entry.saleOptions.length > 1
        );

        if (needsPortionConfirmation) {
            return {
                status: 'pending',
                confidence: exactTop.confidence,
                reason: 'portion-required',
                candidates: buildEntryPortionCandidates(exactTop.entry, exactTop.confidence),
            };
        }

        const selectedOption = exactTop.portionMatch.option || pickDefaultSaleOption(exactTop.entry);
        return {
            status: 'resolved',
            confidence: exactTop.confidence,
            selectedEntry: exactTop.entry,
            selectedOption,
            candidates: buildEntryPortionCandidates(exactTop.entry, exactTop.confidence),
        };
    }

    if (exactMatches.length > 1) {
        return {
            status: 'pending',
            confidence: exactMatches[0]?.confidence || 0.99,
            reason: 'ambiguous-match',
            candidates: exactMatches
                .slice(0, 8)
                .flatMap((candidate) => buildEntryPortionCandidates(candidate.entry, candidate.confidence)),
        };
    }

    const scored = menuIndex
        .map((entry) => {
            const entryScore = Math.max(
                scoreTextSimilarity(normalizedPhrase, entry.name),
                ...entry.aliases.map((alias) => scoreTextSimilarity(normalizedPhrase, alias))
            );
            if (entryScore <= 0.16) return null;

            const portionMatch = resolvePortionMatch(entry, requestedPortion);
            let confidence = entryScore;
            const exactKeywordCoverage = phraseTokens.length
                ? phraseTokens.filter((token) => entry.keywordTokens?.includes(token)).length / phraseTokens.length
                : 0;
            const looseKeywordCoverage = phraseTokens.length
                ? scoreLooseTokenOverlap(phraseTokens, entry.keywordTokens || [])
                : 0;
            const phoneticKeywordCoverage = phrasePhoneticTokens.length
                ? scoreLooseTokenOverlap(phrasePhoneticTokens, entry.phoneticKeywordTokens || [])
                : 0;

            if (exactKeywordCoverage >= 1) {
                confidence = Math.min(1, confidence + 0.12);
            } else if (looseKeywordCoverage >= 0.85) {
                confidence = Math.min(1, confidence + 0.07);
            } else if (phoneticKeywordCoverage >= 0.86) {
                confidence = Math.min(1, confidence + 0.06);
            } else if (exactKeywordCoverage >= 0.5) {
                confidence = Math.min(1, confidence + 0.04);
            }

            if (phraseTokens.length >= 2) {
                const missingLiteralTokens = phraseTokens.filter((token) => !(entry.keywordTokens || []).includes(token));
                if (missingLiteralTokens.length === 0) {
                    confidence = Math.min(1, confidence + 0.12);
                } else if (missingLiteralTokens.length > 0) {
                    const missingRatio = missingLiteralTokens.length / phraseTokens.length;
                    confidence = Math.max(0, confidence - (0.14 + (missingRatio * 0.18)));
                }
            }

            if (requestedPortion) {
                if (portionMatch.option && portionMatch.matched) {
                    confidence = Math.min(1, confidence + 0.08);
                } else if (Array.isArray(entry.saleOptions) && entry.saleOptions.length > 1) {
                    confidence = Math.max(0, confidence - 0.16);
                }
            }

            return {
                entry,
                entryScore,
                confidence,
                exactKeywordCoverage,
                looseKeywordCoverage,
                phoneticKeywordCoverage,
                portionMatch,
            };
        })
        .filter(Boolean)
        .sort((left, right) => right.confidence - left.confidence);

    const candidates = scored.slice(0, 4);
    const top = candidates[0] || null;
    const second = candidates[1] || null;
    const margin = top ? top.confidence - (second?.confidence || 0) : 0;
    const phraseIsGeneric = isGenericPhrase(normalizedPhrase);

    if (!top) {
        return {
            status: 'unresolved',
            confidence: 0,
            candidates: [],
        };
    }

    const candidatePreviews = candidates.map((candidate) =>
        buildCandidatePreview(candidate.entry, candidate.portionMatch.option || pickDefaultSaleOption(candidate.entry), candidate.confidence)
    );
    const familyCandidates = getFamilyCandidates(candidates, phraseTokens);
    const menuFamilyCandidates = getMenuFamilyCandidates(menuIndex, phraseTokens, requestedPortion);
    const familyCandidateSource = menuFamilyCandidates.length > familyCandidates.length
        ? menuFamilyCandidates
        : familyCandidates;
    const familyCandidatePreviews = familyCandidateSource.map((candidate) => (
        buildCandidatePreview(candidate.entry, candidate.portionMatch.option || pickDefaultSaleOption(candidate.entry), candidate.confidence)
    ));
    const needsPortionConfirmation = (
        commandAction === 'add' &&
        !requestedPortion &&
        Array.isArray(top?.entry?.saleOptions) &&
        top.entry.saleOptions.length > 1 &&
        (top.confidence >= 0.76 || top.entryScore >= 0.7)
    );
    const topEntryIsClearEnough = Boolean(
        top && (
            top.confidence >= 0.82 ||
            (top.confidence >= 0.76 && margin >= 0.12) ||
            top.exactKeywordCoverage >= 1
        )
    );
    const sharedFamilyAmbiguous = (
        familyCandidateSource.length > 1 &&
        (
            phraseTokens.length === 1 ||
            top.exactKeywordCoverage < 1
        )
    );

    const singleCandidateRecovery = (
        candidates.length === 1 &&
        phraseTokens.length >= 2 &&
        top.entryScore >= 0.42 &&
        (
            top.exactKeywordCoverage >= 0.5 ||
            top.looseKeywordCoverage >= 0.78 ||
            top.phoneticKeywordCoverage >= 0.82
        )
    );

    const autoResolve = (
        top.confidence >= 0.91 ||
        (top.confidence >= 0.84 && margin >= 0.13) ||
        singleCandidateRecovery ||
        (phraseIsGeneric && top.confidence >= 0.78 && top.exactKeywordCoverage >= 1 && margin >= 0.2) ||
        (!phraseIsGeneric && top.confidence >= 0.78 && margin >= 0.18)
    ) && Boolean(top.portionMatch.option || pickDefaultSaleOption(top.entry));

    if (needsPortionConfirmation && topEntryIsClearEnough) {
        return {
            status: 'pending',
            confidence: top.confidence,
            reason: 'portion-required',
            candidates: buildEntryPortionCandidates(top.entry, top.confidence),
        };
    }

    if (sharedFamilyAmbiguous) {
        return {
            status: 'pending',
            confidence: top.confidence,
            reason: 'family-ambiguous',
            candidates: familyCandidatePreviews.length > 0 ? familyCandidatePreviews.slice(0, 8) : candidatePreviews,
        };
    }

    if (!autoResolve) {
        return {
            status: candidates.length > 0 ? 'pending' : 'unresolved',
            confidence: top.confidence,
            reason: candidates.length > 0 ? 'ambiguous-match' : 'no-match',
            candidates: candidatePreviews,
        };
    }

    const selectedOption = top.portionMatch.option || pickDefaultSaleOption(top.entry);
    return {
        status: 'resolved',
        confidence: top.confidence,
        selectedEntry: top.entry,
        selectedOption,
        candidates: candidatePreviews,
    };
}

function shouldSkipToken(token = '') {
    return isCommandNoiseToken(token) || isLowSignalToken(token);
}

function extractItemSegments(transcript = '') {
    const cleaned = removeModeHints(transcript);
    const tokens = tokenize(cleaned);
    const segments = [];

    let current = {
        quantity: null,
        portionTokens: [],
        nameTokens: [],
    };

    const flushCurrent = () => {
        const phrase = current.nameTokens.join(' ').trim();
        if (phrase) {
            segments.push({
                phrase,
                quantity: current.quantity || 1,
                requestedPortion: resolveRequestedPortion(current.portionTokens),
            });
        }
        current = {
            quantity: null,
            portionTokens: [],
            nameTokens: [],
        };
    };

    tokens.forEach((token) => {
        if (SEGMENT_DELIMITER_TOKENS.has(token)) {
            if (current.nameTokens.length > 0 || current.quantity !== null || current.portionTokens.length > 0) {
                flushCurrent();
            }
            return;
        }

        if (shouldSkipToken(token)) return;

        const quantity = parseNumberToken(token);
        if (quantity !== null) {
            if (current.nameTokens.length > 0 || current.quantity !== null) {
                flushCurrent();
            }
            current.quantity = quantity;
            return;
        }

        const normalizedToken = normalizeVoiceText(token);
        if (PORTION_LOOKUP.has(normalizedToken)) {
            current.portionTokens.push(normalizedToken);
            return;
        }

        current.nameTokens.push(normalizedToken);
    });

    flushCurrent();

    if (segments.length > 0) return segments;

    const fallbackPhrase = tokens.filter((token) => !shouldSkipToken(token)).join(' ').trim();
    if (!fallbackPhrase) return [];
    return [{
        phrase: fallbackPhrase,
        quantity: 1,
        requestedPortion: '',
    }];
}

export function findVoiceTableMatch(manualTables = [], reference = '') {
    const normalizedReference = normalizeVoiceText(reference);
    if (!normalizedReference) return null;

    const compactReference = compactText(normalizedReference);
    const parsedReferenceNumber = parseNumberToken(normalizedReference);
    const numericReference = normalizedReference.match(/[0-9]+/)?.[0] || (parsedReferenceNumber !== null ? String(parsedReferenceNumber) : '');

    const scored = (Array.isArray(manualTables) ? manualTables : [])
        .map((table) => {
            const tableName = String(table?.name || '').trim();
            const normalizedName = normalizeVoiceText(tableName);
            if (!normalizedName) return null;

            let score = Math.max(
                scoreTextSimilarity(normalizedReference, normalizedName),
                scoreTextSimilarity(compactReference, compactText(normalizedName))
            );

            const tableNumber = normalizedName.match(/[0-9]+/)?.[0] || '';
            if (numericReference && tableNumber && numericReference === tableNumber) {
                score = Math.max(score, 0.96);
            }

            return score > 0.2 ? { table, score } : null;
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

    const top = scored[0];
    const second = scored[1];
    if (!top) return null;

    if (top.score >= 0.86 || (top.score >= 0.72 && (top.score - (second?.score || 0)) >= 0.14)) {
        return top.table;
    }

    return null;
}

export function parseManualOrderVoiceCommand({
    transcript = '',
    menuIndex = [],
    manualTables = [],
    currentMode = 'delivery',
} = {}) {
    const normalizedTranscript = normalizeVoiceText(transcript);
    const actionExtraction = extractCartAction(normalizedTranscript);
    const explicitMode = detectExplicitMode(actionExtraction.cleanedText || normalizedTranscript);
    const tableExtraction = extractTableReference(actionExtraction.cleanedText || normalizedTranscript);
    const requestedTableReference = tableExtraction.value || '';
    const desiredMode = requestedTableReference ? 'dine-in' : (explicitMode || currentMode || 'delivery');
    const matchedTable = requestedTableReference ? findVoiceTableMatch(manualTables, requestedTableReference) : null;

    const itemSegments = extractItemSegments(tableExtraction.cleanedText);
    const items = itemSegments.map((segment, index) => {
        const match = matchVoiceItemPhrase(segment.phrase, menuIndex, segment.requestedPortion, {
            commandAction: actionExtraction.action,
        });
        return {
            lineId: `voice-line-${index + 1}`,
            spokenText: segment.phrase,
            quantity: segment.quantity,
            requestedPortion: segment.requestedPortion,
            commandAction: actionExtraction.action,
            ...match,
        };
    });

    return {
        rawTranscript: transcript,
        normalizedTranscript,
        cartAction: actionExtraction.action,
        explicitMode,
        desiredMode,
        requestedTableReference,
        matchedTableId: matchedTable?.id || null,
        matchedTableName: matchedTable?.name || '',
        items,
    };
}

export function serializeVoiceResolverPayload(parsedCommand = {}) {
    return {
        transcript: parsedCommand.rawTranscript || '',
        explicitMode: parsedCommand.explicitMode || null,
        desiredMode: parsedCommand.desiredMode || null,
        requestedTableReference: parsedCommand.requestedTableReference || null,
        unresolvedItems: (parsedCommand.items || [])
            .filter((item) => item.status === 'pending' && Array.isArray(item.candidates) && item.candidates.length > 0)
            .map((item) => ({
                lineId: item.lineId,
                spokenText: item.spokenText,
                quantity: item.quantity,
                requestedPortion: item.requestedPortion || null,
                commandAction: item.commandAction || 'add',
                reason: item.reason || null,
                candidates: item.candidates,
            })),
    };
}
