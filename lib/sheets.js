const crypto = require("crypto");

const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getEnv(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function parsePrivateKey(rawKey) {
  return rawKey.replace(/\\n/g, "\n");
}

function csvToRows(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const [headers, ...rows] = values;
  return rows.map((row) =>
    headers.reduce((acc, header, index) => {
      acc[String(header || "").trim()] = row[index] ?? "";
      return acc;
    }, {})
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function getAccessToken() {
  const clientEmail = getEnv("GOOGLE_CLIENT_EMAIL");
  const privateKeyRaw = getEnv("GOOGLE_PRIVATE_KEY");

  if (!clientEmail || !privateKeyRaw) {
    throw new Error("Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: GOOGLE_OAUTH_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const signatureBase = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureBase);
  signer.end();

  const signature = signer
    .sign(parsePrivateKey(privateKeyRaw))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const assertion = `${signatureBase}.${signature}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const tokenResponse = await fetchJson(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  return tokenResponse.access_token;
}

async function fetchSheetRange(spreadsheetId, range, accessToken) {
  const encodedRange = encodeURIComponent(range);
  const url = `${GOOGLE_SHEETS_BASE_URL}/${spreadsheetId}/values/${encodedRange}`;

  const payload = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return csvToRows(payload.values || []);
}

function hasGoogleSheetsConfig() {
  return Boolean(
    getEnv("GOOGLE_SPREADSHEET_ID") &&
      getEnv("GOOGLE_CLIENT_EMAIL") &&
      getEnv("GOOGLE_PRIVATE_KEY")
  );
}

async function loadGoogleSheetsData() {
  const spreadsheetId = getEnv("GOOGLE_SPREADSHEET_ID");
  const membersRange = getEnv("GOOGLE_SHEET_MEMBERS_RANGE", "members!A1:Z");
  const meetingsRange = getEnv("GOOGLE_SHEET_MEETINGS_RANGE", "meetings!A1:Z");
  const trainingRange = getEnv("GOOGLE_SHEET_TRAINING_RANGE", "training!A1:Z");

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID.");
  }

  const accessToken = await getAccessToken();
  const [members, meetings, trainingSessions] = await Promise.all([
    fetchSheetRange(spreadsheetId, membersRange, accessToken),
    fetchSheetRange(spreadsheetId, meetingsRange, accessToken),
    fetchSheetRange(spreadsheetId, trainingRange, accessToken)
  ]);

  return {
    meta: {
      policyName: "Evolution des membres",
      period: new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      refreshLabel: "Synchronisé depuis Google Sheets"
    },
    members,
    meetings,
    trainingSessions
  };
}

module.exports = {
  hasGoogleSheetsConfig,
  loadGoogleSheetsData
};
