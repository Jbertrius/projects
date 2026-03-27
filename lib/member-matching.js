function removeDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeName(value) {
  return removeDiacritics(value)
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAliases(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitMemberNames(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return [];
  }

  return value
    .replace(/\s+(et|and)\s+/gi, ",")
    .replace(/\s*&\s*/g, ",")
    .replace(/\s*\/\s*/g, ",")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripParentheticalContent(value) {
  return String(value || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function countVowels(value) {
  return (String(value || "").match(/[aeiouy]/gi) || []).length;
}

function looksLikeShortCode(value) {
  const clean = normalizeName(value).replace(/\s+/g, "");
  return clean.length >= 2 && clean.length <= 4 && countVowels(clean) <= 1;
}

function generateCandidateVariants(value) {
  const base = stripParentheticalContent(value);
  const variants = new Set([base]);
  const tokens = base.split(/\s+/).filter(Boolean);

  while (tokens.length > 1 && looksLikeShortCode(tokens[tokens.length - 1])) {
    tokens.pop();
    variants.add(tokens.join(" "));
  }

  return Array.from(variants).filter(Boolean);
}

function levenshteinDistance(a, b) {
  const source = normalizeName(a);
  const target = normalizeName(b);

  if (!source) {
    return target.length;
  }

  if (!target) {
    return source.length;
  }

  const matrix = Array.from({ length: source.length + 1 }, () => new Array(target.length + 1).fill(0));

  for (let i = 0; i <= source.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= target.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= target.length; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
}

function buildMemberDirectory(members) {
  return members.map((member) => {
    const aliases = splitAliases(member.aliases || member.alias_names || "");
    const allNames = [member.name, ...aliases].filter(Boolean);
    const normalizedNames = Array.from(new Set(allNames.map(normalizeName).filter(Boolean)));

    return {
      id: member.id || "",
      name: member.name || "",
      zone: member.zone || "",
      aliases,
      normalizedNames
    };
  });
}

function findBestMemberMatch(candidateName, directory) {
  const candidates = generateCandidateVariants(candidateName).map(normalizeName).filter(Boolean);

  if (candidates.length === 0) {
    return { match: null, confidence: "none", distance: null };
  }

  for (const candidate of candidates) {
    for (const member of directory) {
      if (member.normalizedNames.includes(candidate)) {
        return { match: member, confidence: "exact", distance: 0 };
      }
    }
  }

  const scored = [];
  for (const candidate of candidates) {
    for (const member of directory) {
      for (const name of member.normalizedNames) {
        const distance = levenshteinDistance(candidate, name);
        scored.push({ member, distance, name, candidate });
      }
    }
  }

  scored.sort((a, b) => a.distance - b.distance || a.name.length - b.name.length);
  const best = scored[0];
  const second = scored[1];

  if (!best) {
    return { match: null, confidence: "none", distance: null };
  }

  const maxDistance = best.candidate.length <= 5 ? 1 : 2;
  const clearLead = !second || second.distance - best.distance >= 1;

  if (best.distance <= maxDistance && clearLead) {
    return { match: best.member, confidence: "fuzzy", distance: best.distance };
  }

  return { match: null, confidence: "none", distance: best.distance };
}

function trySplitCompoundMembers(candidateName, directory) {
  const tokens = stripParentheticalContent(candidateName).split(/\s+/).filter(Boolean);

  if (tokens.length < 2) {
    return null;
  }

  const matched = [];
  const unmatched = [];

  for (const token of tokens) {
    const result = findBestMemberMatch(token, directory);
    if (result.match && result.confidence === "exact") {
      matched.push({
        input: token,
        id: result.match.id,
        name: result.match.name,
        confidence: "exact"
      });
    } else if (!looksLikeShortCode(token)) {
      unmatched.push(token);
    }
  }

  if (matched.length >= 2) {
    return {
      matched,
      unmatched
    };
  }

  return null;
}

function tryExtractKnownMemberSubstrings(candidateName, directory) {
  const raw = stripParentheticalContent(candidateName);
  const normalizedRaw = normalizeName(raw);

  if (!normalizedRaw || normalizedRaw.length < 4) {
    return null;
  }

  const matches = [];

  for (const member of directory) {
    for (const normalizedName of member.normalizedNames) {
      if (normalizedName.length < 4) {
        continue;
      }

      if (normalizedRaw.includes(normalizedName)) {
        matches.push({
          member,
          normalizedName
        });
      }
    }
  }

  matches.sort((a, b) => b.normalizedName.length - a.normalizedName.length);

  const unique = [];
  const seenIds = new Set();
  for (const item of matches) {
    if (!seenIds.has(item.member.id)) {
      seenIds.add(item.member.id);
      unique.push(item);
    }
  }

  if (unique.length === 0) {
    return null;
  }

  let remainder = normalizedRaw;
  const matched = [];

  for (const item of unique) {
    if (remainder.includes(item.normalizedName)) {
      remainder = remainder.replace(item.normalizedName, " ").replace(/\s+/g, " ").trim();
      matched.push({
        input: candidateName,
        id: item.member.id,
        name: item.member.name,
        confidence: "exact"
      });
    }
  }

  if (matched.length === 0) {
    return null;
  }

  const unresolved = remainder ? [remainder] : [];

  return {
    matched,
    unmatched: unresolved
  };
}

function resolveMeetingMembers(rawValue, members) {
  const directory = Array.isArray(members) && members[0]?.normalizedNames ? members : buildMemberDirectory(members);
  const parts = splitMemberNames(rawValue);
  const matched = [];
  const unmatched = [];

  for (const part of parts) {
    const result = findBestMemberMatch(part, directory);
    if (result.match) {
      matched.push({
        input: part,
        id: result.match.id,
        name: result.match.name,
        confidence: result.confidence
      });
    } else {
      const compound = trySplitCompoundMembers(part, directory);
      if (compound) {
        matched.push(...compound.matched);
        unmatched.push(...compound.unmatched);
      } else {
        const substringExtraction = tryExtractKnownMemberSubstrings(part, directory);
        if (substringExtraction) {
          matched.push(...substringExtraction.matched);
          unmatched.push(...substringExtraction.unmatched);
        } else {
          unmatched.push(part);
        }
      }
    }
  }

  const uniqueMatched = [];
  const seenIds = new Set();
  for (const item of matched) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      uniqueMatched.push(item);
    }
  }

  let status = "unmatched";
  if (uniqueMatched.length > 0 && unmatched.length === 0) {
    status = uniqueMatched.some((item) => item.confidence === "fuzzy") ? "fuzzy" : "exact";
  } else if (uniqueMatched.length > 0 && unmatched.length > 0) {
    status = "partial";
  }

  return {
    raw: rawValue || "",
    matched: uniqueMatched,
    unmatched,
    status
  };
}

module.exports = {
  buildMemberDirectory,
  normalizeName,
  resolveMeetingMembers,
  splitAliases,
  splitMemberNames
};
