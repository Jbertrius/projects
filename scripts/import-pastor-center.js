/**
 * Import Pastor Center France data from the pastor_center.xlsx file into Firestore.
 *
 * Strategy:
 *  - New pastors: create full document with all extracted fields.
 *  - Existing pastors: PATCH only the Pastor Center fields (level, fruit, niveau, promotion,
 *    academyClass, title) without overwriting phone/email/notes/meetingCount etc.
 *
 * Usage:
 *   node scripts/import-pastor-center.js [--dry-run]
 */

const { loadLocalEnv } = require("../lib/env");
const { fetchJson, getAccessToken, getEnv } = require("../lib/google-auth");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

// ---------------------------------------------------------------------------
// Mapping: Excel promotion → Firestore academyClass code
// Classes in Firestore: CLS_157p (157P), CLS_159_2p (159-2P),
//   CLS_160_2p (160-2P), CLS_165p (165P), CLS_165_1p (165-1P)
// Pastors with "155-2 / 156-1P" are graduates with no active class — stored as-is.
// ---------------------------------------------------------------------------
const PROMOTION_TO_CLASS = {
  "155-2 / 156-1P": "155-2 / 156-1P", // graduated, no active Firestore class
  "157P / 157-1P":  "157P",
  "159P / 159-2P":  "159-2P",
  "160-2P":         "160-2P",
  "165P":           "165P",
  "165-1P":         "165-1P",
};

// ---------------------------------------------------------------------------
// Data extracted from pastor_center.xlsx — "Pastor Center France" sheet
// Fields: num, promotion, fullNameWithTitle, title, level, fruit, niveau
// ---------------------------------------------------------------------------
const PASTOR_CENTER_DATA = [
  { num: 1,  promotion: "155-2 / 156-1P", fullName: "Pasteur Fatoumata",                      title: "Pasteur",             level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 2,  promotion: "155-2 / 156-1P", fullName: "Pasteur Hada",                            title: "Pasteur",             level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 3,  promotion: "157P / 157-1P",  fullName: "Pasteur Mane Massoly",                    title: "Pasteur",             level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 4,  promotion: "157P / 157-1P",  fullName: "Pasteur Capitao Eduardo",                 title: "Pasteur",             level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 5,  promotion: "157P / 157-1P",  fullName: "Serviteur Wilfried Vieira",               title: "Serviteur",           level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 6,  promotion: "157P / 157-1P",  fullName: "Evangeliste Eryc Dzoungou",               title: "Evangeliste",         level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 7,  promotion: "159P / 159-2P",  fullName: "Pasteur Jean Baptiste",                   title: "Pasteur",             level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 8,  promotion: "159P / 159-2P",  fullName: "Pasteur Ernest BIMOKO",                   title: "Pasteur",             level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 9,  promotion: "159P / 159-2P",  fullName: "Pasteur Marcel Loemba",                   title: "Pasteur",             level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 10, promotion: "159P / 159-2P",  fullName: "Pasteur Koul Joseph",                     title: "Pasteur",             level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 11, promotion: "159P / 159-2P",  fullName: "Pasteur Jean Louis Louisner",             title: "Pasteur",             level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 12, promotion: "159P / 159-2P",  fullName: "Serviteur Montanier Lundy",               title: "Serviteur",           level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 13, promotion: "159P / 159-2P",  fullName: "Evangeliste Kenol Joseph",                title: "Evangeliste",         level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 14, promotion: "159P / 159-2P",  fullName: "Servante Maranata",                       title: "Servante",            level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 15, promotion: "159P / 159-2P",  fullName: "Serviteur Jean Enock",                    title: "Serviteur",           level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 16, promotion: "159P / 159-2P",  fullName: "Predicateur Nerilus Joseph",              title: "Predicateur",         level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 17, promotion: "159P / 159-2P",  fullName: "Servante Sona Seneus",                    title: "Servante",            level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 18, promotion: "159P / 159-2P",  fullName: "Pasteur Jean Hilaire",                    title: "Pasteur",             level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 19, promotion: "159P / 159-2P",  fullName: "Pasteur Corrielus Jean Louis",            title: "Pasteur",             level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 20, promotion: "159P / 159-2P",  fullName: "Pasteur Heureuse PROSPER",                title: "Pasteur",             level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 21, promotion: "159P / 159-2P",  fullName: "Pasteur Junie PROSPER",                   title: "Pasteur",             level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 22, promotion: "159P / 159-2P",  fullName: "Pasteur Jean Chavanne",                   title: "Pasteur",             level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 23, promotion: "159P / 159-2P",  fullName: "Pasteur Owel Exenat",                     title: "Pasteur",             level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 24, promotion: "159P / 159-2P",  fullName: "Serviteur Bruno Carlos",                  title: "Serviteur",           level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 25, promotion: "159P / 159-2P",  fullName: "Evangeliste Enock Valentin",              title: "Evangeliste",         level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 26, promotion: "159P / 159-2P",  fullName: "Jordan",                                  title: "",                    level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 27, promotion: "159P / 159-2P",  fullName: "Pasteur Mehou Loko",                      title: "Pasteur",             level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 28, promotion: "159P / 159-2P",  fullName: "Serviteur Ulysse Jean sauveur",           title: "Serviteur",           level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 29, promotion: "159P / 159-2P",  fullName: "Diaconesse Jeannita",                     title: "Diaconesse",          level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 30, promotion: "159P / 159-2P",  fullName: "Pasteur Jeannette",                       title: "Pasteur",             level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 31, promotion: "159P / 159-2P",  fullName: "Servante Belizaire Odette",               title: "Servante",            level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 32, promotion: "159P / 159-2P",  fullName: "Evangeliste Donac ADAGBE",                title: "Evangeliste",         level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 33, promotion: "159P / 159-2P",  fullName: "Pasteur BELLUS Leonard",                  title: "Pasteur",             level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 34, promotion: "159P / 159-2P",  fullName: "Pasteur Martin FIADONOU",                 title: "Pasteur",             level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 35, promotion: "159P / 159-2P",  fullName: "Evangeliste Tite",                        title: "Evangeliste",         level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 36, promotion: "159P / 159-2P",  fullName: "Servante Eugenie",                        title: "Servante",            level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 37, promotion: "159P / 159-2P",  fullName: "Evangeliste Edmise Joseph",               title: "Evangeliste",         level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 38, promotion: "159P / 159-2P",  fullName: "Serviteur Kenfack Geradeau",              title: "Serviteur",           level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 39, promotion: "160-2P",         fullName: "Evangeliste Jean Desimeau EXENAT",        title: "Evangeliste",         level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 40, promotion: "160-2P",         fullName: "Evangeliste Grace Dorcas NIMLIN",         title: "Evangeliste",         level: "Level A", fruit: true,  niveau: "AVANCÉ" },
  { num: 41, promotion: "160-2P",         fullName: "Pasteur Paul Kamenan Diby",               title: "Pasteur",             level: "Level A", fruit: false, niveau: "AVANCÉ" },
  { num: 42, promotion: "160-2P",         fullName: "Pasteur Joseph SAGESSE",                  title: "Pasteur",             level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 43, promotion: "160-2P",         fullName: "Pasteur Brunel PAUL",                     title: "Pasteur",             level: "Level B", fruit: true,  niveau: "AVANCÉ" },
  { num: 44, promotion: "160-2P",         fullName: "Predicateur Franck RIODIN",               title: "Predicateur",         level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 45, promotion: "160-2P",         fullName: "Evangeliste Gabriel EXENAT",              title: "Evangeliste",         level: "Level B", fruit: false, niveau: "AVANCÉ" },
  { num: 46, promotion: "160-2P",         fullName: "Evangeliste Jean ANOUX",                  title: "Evangeliste",         level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 47, promotion: "160-2P",         fullName: "Servante Bilkiss VIEIRA",                 title: "Servante",            level: "Level C", fruit: false, niveau: "AVANCÉ" },
  { num: 48, promotion: "165P",           fullName: "Pasteur TIRAT Jean Celeste",              title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 49, promotion: "165P",           fullName: "Pasteur GUEI Franck Axel Frejus",         title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 50, promotion: "165P",           fullName: "Pasteur KILI Jean Baptiste",              title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 51, promotion: "165P",           fullName: "Pasteur KOUAME Yao Lucien",               title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 52, promotion: "165P",           fullName: "Pasteur SAINT FELIX Florant",             title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 53, promotion: "165P",           fullName: "Pasteur TIZRA Ange",                      title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 54, promotion: "165P",           fullName: "Diacre BONHEUR Kenson",                   title: "Diacre",              level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 55, promotion: "165P",           fullName: "Pasteur CHERY CLAUDE",                    title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 56, promotion: "165P",           fullName: "Diacre DOH Jules",                        title: "Diacre",              level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 57, promotion: "165P",           fullName: "Predicateur CASTOR Bénissais",            title: "Predicateur",         level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 58, promotion: "165P",           fullName: "Predicateur DURAME Aristil",              title: "Predicateur",         level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 59, promotion: "165P",           fullName: "Evangeliste EDNEL Paul",                  title: "Evangeliste",         level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 60, promotion: "165P",           fullName: "Evangeliste EHOUO Angèle Chia",           title: "Evangeliste",         level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 61, promotion: "165P",           fullName: "Pasteur ELEME Samuel",                    title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 62, promotion: "165P",           fullName: "Pasteur JACQUET Kesner",                  title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 63, promotion: "165P",           fullName: "Predicateur LOUIS Dieucel",               title: "Predicateur",         level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 64, promotion: "165P",           fullName: "Pasteur BELLEUS Jean Mathilus",           title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 65, promotion: "165P",           fullName: "MORISSAINT Louiner",                      title: "",                    level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 66, promotion: "165P",           fullName: "PIERRE Marie-Yves",                       title: "",                    level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 67, promotion: "165P",           fullName: "Evangeliste KIBONGUI Lelouch",            title: "Evangeliste",         level: "Level B", fruit: true,  niveau: "INTRODUCTION" },
  { num: 68, promotion: "165P",           fullName: "Pasteur KIKOUNOU Guy Edgard",             title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 69, promotion: "165P",           fullName: "Pasteur MBOMBO MAMBA Elvire",             title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 70, promotion: "165P",           fullName: "Pasteur POLIDOR Jean",                    title: "Pasteur",             level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 71, promotion: "165P",           fullName: "Pasteur AROGA ELEGBE",                    title: "Pasteur",             level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 72, promotion: "165P",           fullName: "Diacre MAHO Rancy",                       title: "Diacre",              level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 73, promotion: "165P",           fullName: "Pasteur BLANCHARD Ronald",                title: "Pasteur",             level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 74, promotion: "165P",           fullName: "Pasteur NGOYI MAMBA Béni",                title: "Pasteur",             level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 75, promotion: "165P",           fullName: "Evangeliste MILBIN Hercule",              title: "Evangeliste",         level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 76, promotion: "165P",           fullName: "Pasteur missionnaire VOHE Guy Thierry",   title: "Pasteur missionnaire", level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 77, promotion: "165P",           fullName: "Evangeliste WOWOU Djima Iredon",          title: "Evangeliste",         level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 78, promotion: "165P",           fullName: "Evangeliste Marie Fena Misère",           title: "Evangeliste",         level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 79, promotion: "165P",           fullName: "Prophète SEKA Clovis Rolland",            title: "Prophète",            level: "Level C", fruit: false, niveau: "INTRODUCTION" },
  { num: 80, promotion: "165-1P",         fullName: "Femme de pasteur KOUL Marie Madeleine",  title: "Femme de pasteur",    level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 81, promotion: "165-1P",         fullName: "Femme de pasteur TSHIMINI TSHITE Dorcas", title: "Femme de pasteur",   level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 82, promotion: "165-1P",         fullName: "Soeur JULES sylphanie",                   title: "Soeur",               level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 83, promotion: "165-1P",         fullName: "Serviteur VILBRAIN Jean",                 title: "Serviteur",           level: "Level B", fruit: false, niveau: "INTRODUCTION" },
  { num: 84, promotion: "165-1P",         fullName: "Servante PIERNA Pascale",                 title: "Servante",            level: "Level C", fruit: false, niveau: "INTRODUCTION" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function removeDiacritics(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeName(value) {
  return removeDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPastorId(name) {
  return "pastor_" + removeDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractNameWithoutTitle(fullName, title) {
  if (!title) return fullName.trim();
  const prefix = title.trim();
  if (fullName.trim().toLowerCase().startsWith(prefix.toLowerCase())) {
    return fullName.trim().slice(prefix.length).trim();
  }
  return fullName.trim();
}

function sv(val) { return { stringValue: String(val ?? "") }; }
function bv(val) { return { booleanValue: Boolean(val) }; }
function iv(val) { return { integerValue: String(Number(val || 0)) }; }

function getFirestoreBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  if (!projectId) throw new Error("Missing FIRESTORE_PROJECT_ID.");
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

function buildFullDocument(pastor) {
  return {
    fields: {
      name: sv(pastor.name),
      firstName: sv(pastor.first_name),
      lastName: sv(pastor.last_name),
      title: sv(pastor.title),
      aliases: { arrayValue: { values: [] } },
      churchName: sv(""),
      city: sv(""),
      phone: sv(""),
      email: sv(""),
      academyClass: sv(PROMOTION_TO_CLASS[pastor.promotion] || pastor.promotion),
      classNumber: sv(""),
      cellNumber: sv(""),
      currentMission: sv(""),
      notes: sv(""),
      sourceVariants: { arrayValue: { values: [] } },
      meetingCount: iv(0),
      firstMeetingDate: sv(""),
      lastMeetingDate: sv(""),
      source: sv("pastor_center_xlsx"),
      needsReview: bv(false),
      lastReviewedAt: sv(new Date().toISOString()),
      gmcsSummitStatus: sv(""),
      gmcsSummitNote: sv(""),
      pastorLevel: sv(pastor.level),
      porteLesFruits: bv(pastor.fruit),
      niveau: sv(pastor.niveau),
      pastorCenterNum: iv(pastor.num),
    }
  };
}

function buildPatchFields(pastor) {
  return {
    fields: {
      academyClass: sv(PROMOTION_TO_CLASS[pastor.promotion] || pastor.promotion),
      pastorLevel: sv(pastor.level),
      porteLesFruits: bv(pastor.fruit),
      niveau: sv(pastor.niveau),
      pastorCenterNum: iv(pastor.num),
    }
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadLocalEnv();

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No writes will be made.\n");

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();

  // Load existing pastors to detect duplicates
  console.log("Loading existing pastors from Firestore...");
  const listUrl = `${baseUrl}/pastors?pageSize=500`;
  const listResp = await fetchJson(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const existingByNormalizedName = new Map();
  for (const doc of (listResp.documents || [])) {
    const docId = (doc.name || "").split("/").pop();
    const nameField = doc.fields?.name?.stringValue || "";
    const normalized = normalizeName(nameField);
    if (normalized) existingByNormalizedName.set(normalized, docId);
  }
  console.log(`Found ${existingByNormalizedName.size} existing pastors.\n`);

  let created = 0, updated = 0, skipped = 0;
  const results = [];

  for (const entry of PASTOR_CENTER_DATA) {
    const nameWithoutTitle = extractNameWithoutTitle(entry.fullName, entry.title);
    const pastorId = buildPastorId(nameWithoutTitle);
    const normalizedName = normalizeName(nameWithoutTitle);

    // Check for existing by generated ID or by normalized name match
    const existingIdByName = existingByNormalizedName.get(normalizedName);
    const docUrl = `${baseUrl}/pastors/${encodeURIComponent(pastorId)}`;
    let existsByExactId = false;

    if (!dryRun) {
      const checkResp = await fetch(docUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      existsByExactId = checkResp.status !== 404;
    }

    const exists = existsByExactId || Boolean(existingIdByName);

    if (exists) {
      const targetId = existsByExactId ? pastorId : existingIdByName;
      // PATCH only the Pastor Center specific fields + title if not set
      const patchDoc = buildPatchFields(entry);

      // Include title in patch if we have one (to fill in blanks)
      if (entry.title) {
        patchDoc.fields.title = sv(entry.title);
      }

      const mask = Object.keys(patchDoc.fields)
        .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
        .join("&");

      const patchUrl = `${baseUrl}/pastors/${encodeURIComponent(targetId)}?${mask}`;

      if (!dryRun) {
        await fetchJson(patchUrl, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(patchDoc)
        });
      }

      console.log(`  UPDATED  [${String(entry.num).padStart(2)}] ${targetId} — ${entry.fullName}`);
      results.push({ action: "updated", id: targetId, name: nameWithoutTitle });
      updated++;
    } else {
      const fullDoc = buildFullDocument({
        name: nameWithoutTitle,
        first_name: "",
        last_name: "",
        title: entry.title,
        promotion: entry.promotion,
        level: entry.level,
        fruit: entry.fruit,
        niveau: entry.niveau,
        num: entry.num,
      });

      if (!dryRun) {
        await fetchJson(docUrl, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(fullDoc)
        });
      }

      console.log(`  CREATED  [${String(entry.num).padStart(2)}] ${pastorId} — ${entry.fullName}`);
      results.push({ action: "created", id: pastorId, name: nameWithoutTitle });
      created++;
    }
  }

  console.log(`\n========================================`);
  console.log(`  Created : ${created}`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}`);
  console.log(`  Total   : ${PASTOR_CENTER_DATA.length}`);
  if (dryRun) console.log(`\n  (DRY RUN — nothing written)`);

  return { created, updated, skipped, results };
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
