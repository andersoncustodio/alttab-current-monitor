const NON_WORD = /[^\p{L}\p{N}]+/u;

export function disambiguateTitles(titles) {
    if (titles.length < 2)
        return titles.slice();

    const tokens = titles.map(tokenize);
    return titles.map((title, i) => {
        const own = tokens[i];
        const others = tokens.filter((_, j) => j !== i);
        const sharedCount = maxSharedPrefixWith(own, others);
        const hasUniqueSuffix = own.length > sharedCount;

        if (sharedCount < 2 || !hasUniqueSuffix)
            return title;

        const initials = abbreviateWords(own.slice(0, sharedCount));
        const suffix = own.slice(sharedCount).join(' ');
        return `${initials} ${suffix}`;
    });
}

function maxSharedPrefixWith(own, others) {
    let best = 0;
    for (const other of others)
        best = Math.max(best, countLeadingMatches(own, other));
    return best;
}

function countLeadingMatches(a, b) {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a[i].toLowerCase() === b[i].toLowerCase())
        i++;
    return i;
}

function abbreviateWords(words) {
    return words.map(w => `${w[0].toUpperCase()}.`).join('');
}

function tokenize(text) {
    return (text ?? '').trim().split(NON_WORD).filter(Boolean);
}
