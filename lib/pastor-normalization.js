const { getEnv } = require("./google-auth");

const TITLE_PATTERNS = [
  { regex: /\bpasteure?\b/i, title: "Pasteur" },
  { regex: /\bpastor\b/i, title: "Pasteur" },
  { regex: /\bpst\b/i, title: "Pasteur" },
  { regex: /\bpast\b/i, title: "Pasteur" },
  { regex: /\bévangéliste\b/i, title: "Évangéliste" },
  { regex: /\bevangeliste\b/i, title: "Évangéliste" },
  { regex: /\bev\b/i, title: "Évangéliste" },
  { regex: /\bproph[eè]tesse\b/i, title: "Prophétesse" },
  { regex: /\bproph[eè]te\b/i, title: "Prophète" },
  { regex: /\bpr[eé]dicatrice\b/i, title: "Prédicatrice" },
  { regex: /\bpredricatrice\b/i, title: "Prédicatrice" },
  { regex: /\bpredicatrice\b/i, title: "Prédicatrice" },
  { regex: /\bpr[eé]dicateur\b/i, title: "Prédicateur" },
  { regex: /\bpredicateur\b/i, title: "Prédicateur" },
  { regex: /\bdiacre\b/i, title: "Diacre" },
  { regex: /\bserviteur\b/i, title: "Serviteur" },
  { regex: /\bfr[eè]re\b/i, title: "Frère" },
  { regex: /\bap[oô]tre\b/i, title: "Apôtre" }
];

const NOISE_PATTERNS = [
  /\b1er\b/gi,
  /\b1st\b/gi,
  /\bpremi[eè]re?\b/gi,
  /\bmannams?\b/gi,
  /\brencontres?\b/gi,
  /\bdiscussion\b/gi,
  /\bmaraude\b/gi,
  /\bvisite\b/gi,
  /\bpr[eé]sentation\b/gi,
  /\bconference\b/gi,
  /\bconf[eé]rence\b/gi,
  /\bfriendly\b/gi,
  /\bfor peace ct\b/gi,
  /\bcep\b/gi,
  /\bgmcs\b/gi,
  /\bavec\b/gi,
  /\bdu\b/gi,
  /\bdes\b/gi,
  /\bla\b/gi,
  /\ble\b/gi,
  /\bl['’]/gi,
  /\bson pr[eé]nom\b/gi
];

const AMBIGUOUS_PATTERNS = [
  /\bconference\b/i,
  /\bconf[eé]rence\b/i,
  /\bpeace\b/i,
  /\bcit[eé]\b/i,
  /\b[eé]glise\b/i
];

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function slugify(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCaseWords(value) {
  return normalizeWhitespace(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (["de", "du", "des", "la", "le", "d"].includes(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function normalizeLookup(value) {
  return normalizeWhitespace(
    stripAccents(value)
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
  );
}

function removeParentheticalContent(value) {
  return String(value || "").replace(/\([^)]*\)/g, " ");
}

function simplifyRawPastor(value) {
  let text = normalizeWhitespace(String(value || "").replace(/\r?\n/g, " "));
  text = removeParentheticalContent(text);
  text = text.replace(/[+/,;|]/g, " ");

  for (const pattern of NOISE_PATTERNS) {
    text = text.replace(pattern, " ");
  }

  text = text.replace(/\b\d+[a-z]?\b/gi, " ");
  text = text.replace(/\b[a-z]{0,2}\d+[a-z]*\b/gi, " ");
  text = text.replace(/\s+-\s+/g, " ");
  return normalizeWhitespace(text);
}

function detectTitle(value) {
  for (const pattern of TITLE_PATTERNS) {
    if (pattern.regex.test(value)) {
      return pattern.title;
    }
  }
  return "";
}

function extractNameAroundTitle(rawValue) {
  const source = normalizeWhitespace(removeParentheticalContent(rawValue).replace(/\r?\n/g, " "));
  const titleRegex =
    /\b(?:pasteure?|pastor|pst|past|évangéliste|evangeliste|ev|proph[eè]tesse|proph[eè]te|pr[eé]dicatrice|predricatrice|predicatrice|pr[eé]dicateur|predicateur|diacre|serviteur|fr[eè]re|ap[oô]tre)\b\s+(.+)$/i;
  const match = source.match(titleRegex);
  if (!match) {
    return "";
  }

  let candidate = match[1];
  candidate = candidate.replace(/\b(?:de|du)\s+(?:cologne|strasbourg|nancy|metz|paris|rouen|lille)\b.*$/i, " ");
  candidate = candidate.replace(/\b(?:presentation|présentation|cep|gmcs)\b.*$/i, " ");
  candidate = candidate.replace(/\b(?:avec|for|friendly)\b.*$/i, " ");
  candidate = candidate.replace(/\b(?:son prénom|ntc)\b.*$/i, " ");
  candidate = candidate.replace(/[+/,;|].*$/g, " ");
  candidate = candidate.replace(/\b\d+[a-z]?\b/gi, " ");
  return normalizeWhitespace(candidate);
}

function looksLikePastorName(value) {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) {
    return false;
  }

  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0 || parts.length > 5) {
    return false;
  }

  const badTokens = ["conference", "peace", "eglise", "visite", "friendly", "presentation", "mannam"];
  if (parts.some((part) => badTokens.includes(stripAccents(part).toLowerCase()))) {
    return false;
  }

  return /^[A-Za-zÀ-ÿ' -]+$/.test(cleaned);
}

function resolvePastorLocally(rawValue) {
  const raw = normalizeWhitespace(rawValue);
  if (!raw) {
    return {
      raw,
      canonicalName: "",
      title: "",
      method: "empty",
      confidence: 0,
      needsReview: true
    };
  }

  const title = detectTitle(raw);
  const extracted = extractNameAroundTitle(raw);
  const simplified = simplifyRawPastor(raw);
  const candidate = extracted || simplified;
  const canonicalName = titleCaseWords(candidate);
  const hasAmbiguity = AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(raw));

  if (hasAmbiguity && !title) {
    return {
      raw,
      canonicalName: "",
      title: "",
      method: "unresolved",
      confidence: 0.1,
      needsReview: true
    };
  }

  if (!looksLikePastorName(canonicalName)) {
    return {
      raw,
      canonicalName: "",
      title,
      method: "unresolved",
      confidence: 0.1,
      needsReview: true
    };
  }

  const confidence = title ? 0.88 : 0.6;
  return {
    raw,
    canonicalName,
    title,
    method: title ? "local-title" : "local-heuristic",
    confidence,
    needsReview: hasAmbiguity || confidence < 0.75
  };
}

function isForcedReviewCase(rawValue) {
  const raw = normalizeWhitespace(rawValue);
  const title = detectTitle(raw);
  const hasAmbiguity = AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(raw));
  return hasAmbiguity && !title;
}

function buildPastorCache(existingPastors) {
  const cache = new Map();

  (existingPastors || []).forEach((row) => {
    const canonicalName = normalizeWhitespace(row.name || "");
    const title = normalizeWhitespace(row.title || "");
    const pastorId = normalizeWhitespace(row.id || "");
    const needsReview = String(row.needs_review || "").toLowerCase() === "true";

    if (needsReview || !canonicalName) {
      return;
    }

    [row.name, ...(String(row.source_variants || "").split("|")), ...(String(row.aliases || "").split("|"))]
      .map(normalizeLookup)
      .filter(Boolean)
      .forEach((lookup) => {
        cache.set(lookup, {
          raw: row.name || "",
          canonicalName,
          title,
          pastorId,
          method: "cache",
          confidence: 1,
          needsReview: false
        });
      });
  });

  return cache;
}

async function resolvePastorsWithGemini(rawValues) {
  const apiKey = getEnv("GEMINI_API_KEY");
  if (!apiKey || !rawValues.length) {
    return new Map();
  }

  const prompt = [
    "You normalize names of Christian religious leaders from noisy event labels.",
    "Return strict JSON only: an array of objects.",
    "Each object must contain: raw, canonical_name, title, needs_review.",
    "Rules:",
    "- Extract only the person's name.",
    "- Remove titles from canonical_name.",
    "- Remove parentheses content and location names.",
    "- Keep title separately using one of: Pasteur, Pasteure, Évangéliste, Prophète, Prophétesse, Prédicateur, Prédicatrice, Diacre, Frère, Serviteur, Apôtre, or empty string.",
    "- If there is no clearly identified person, set canonical_name to empty string and needs_review to true.",
    "- Do not invent missing first names.",
    "",
    JSON.stringify(rawValues)
  ].join("\n");

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini pastor normalization failed with HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "[]";
  const parsed = JSON.parse(text);
  const map = new Map();

  (Array.isArray(parsed) ? parsed : []).forEach((item) => {
    const raw = normalizeWhitespace(item.raw || "");
    if (!raw) {
      return;
    }

    map.set(raw, {
      raw,
      canonicalName: titleCaseWords(item.canonical_name || ""),
      title: normalizeWhitespace(item.title || ""),
      method: "gemini-batch",
      confidence: 0.82,
      needsReview: Boolean(item.needs_review)
    });
  });

  return map;
}

async function resolvePastorBatch(rawValues, existingPastors = []) {
  const cache = buildPastorCache(existingPastors);
  const uniqueRawValues = Array.from(new Set(rawValues.map(normalizeWhitespace).filter(Boolean)));
  const resolutions = new Map();
  const geminiCandidates = [];

  uniqueRawValues.forEach((raw) => {
    const cached = cache.get(normalizeLookup(raw));
    if (cached) {
      resolutions.set(raw, cached);
      return;
    }

    const local = resolvePastorLocally(raw);
    resolutions.set(raw, local);

    if (!local.canonicalName || local.needsReview) {
      geminiCandidates.push(raw);
    }
  });

  if (geminiCandidates.length > 0 && getEnv("GEMINI_API_KEY")) {
    const chunkSize = 40;
    for (let index = 0; index < geminiCandidates.length; index += chunkSize) {
      const chunk = geminiCandidates.slice(index, index + chunkSize);
      const geminiMap = await resolvePastorsWithGemini(chunk);
      chunk.forEach((raw) => {
      const resolved = geminiMap.get(raw);
        if (resolved && resolved.canonicalName && !isForcedReviewCase(raw)) {
          resolutions.set(raw, resolved);
        }
      });
    }
  }

  const pastorIds = new Map();
  Array.from(resolutions.values()).forEach((resolution) => {
    if (isForcedReviewCase(resolution.raw)) {
      resolution.canonicalName = "";
      resolution.title = "";
      resolution.pastorId = "";
      resolution.method = "forced-review";
      resolution.needsReview = true;
      return;
    }

    if (!resolution.canonicalName) {
      return;
    }

    const key = slugify(resolution.canonicalName);
    if (!pastorIds.has(key)) {
      pastorIds.set(key, `pastor_${key}`);
    }
    resolution.pastorId = pastorIds.get(key);
  });

  return resolutions;
}

function buildPastorsSheetRows(meetingRows, existingPastors = []) {
  const grouped = new Map();
  const existingMap = new Map(
    (existingPastors || [])
      .filter((row) => normalizeWhitespace(row.id || ""))
      .map((row) => [normalizeWhitespace(row.id), row])
  );

  meetingRows.forEach((row) => {
    if (!row.pastor_id || !row.pastor_name) {
      return;
    }

    const existing = existingMap.get(row.pastor_id) || {};
    const preserveReviewedFields = Boolean(normalizeWhitespace(existing.last_reviewed_at || ""));
    const current = grouped.get(row.pastor_id) || {
      id: row.pastor_id,
      name: existing.name || row.pastor_name,
      first_name: preserveReviewedFields ? existing.first_name || "" : "",
      last_name: preserveReviewedFields ? existing.last_name || "" : "",
      title: existing.title || row.pastor_title || "",
      aliases: preserveReviewedFields ? existing.aliases || "" : "",
      church_name: preserveReviewedFields ? existing.church_name || "" : "",
      city: preserveReviewedFields ? existing.city || "" : "",
      phone: preserveReviewedFields ? existing.phone || "" : "",
      email: preserveReviewedFields ? existing.email || "" : "",
      notes: preserveReviewedFields ? existing.notes || "" : "",
      source_variants: new Set(),
      meeting_count: 0,
      first_meeting_date: row.meeting_date || "",
      last_meeting_date: row.meeting_date || "",
      source: "google_calendar",
      needs_review: preserveReviewedFields ? existing.needs_review || "false" : "false",
      last_reviewed_at: preserveReviewedFields ? existing.last_reviewed_at || "" : ""
    };

    current.source_variants.add(row.pastor_name_raw || row.pastor_name);
    current.meeting_count += 1;
    if (row.meeting_date && (!current.first_meeting_date || row.meeting_date < current.first_meeting_date)) {
      current.first_meeting_date = row.meeting_date;
    }
    if (row.meeting_date && (!current.last_meeting_date || row.meeting_date > current.last_meeting_date)) {
      current.last_meeting_date = row.meeting_date;
    }
    if (String(row.pastor_needs_review) === "true") {
      current.needs_review = "true";
    }

    grouped.set(row.pastor_id, current);
  });

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      source_variants: Array.from(row.source_variants).sort().join(" | ")
    }))
    .sort((a, b) => b.meeting_count - a.meeting_count || a.name.localeCompare(b.name));
}

module.exports = {
  buildPastorsSheetRows,
  resolvePastorBatch
};
