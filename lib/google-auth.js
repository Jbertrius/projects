const crypto = require("crypto");
const fs = require("fs");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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

function readServiceAccountConfig() {
  const jsonRaw = getEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  const jsonPath = getEnv("GOOGLE_SERVICE_ACCOUNT_JSON_PATH");

  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw);
      return {
        clientEmail: parsed.client_email || "",
        privateKey: parsed.private_key || ""
      };
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }

  if (jsonPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      return {
        clientEmail: parsed.client_email || "",
        privateKey: parsed.private_key || ""
      };
    } catch (error) {
      throw new Error(`Unable to read GOOGLE_SERVICE_ACCOUNT_JSON_PATH: ${error.message}`);
    }
  }

  return {
    clientEmail: getEnv("GOOGLE_CLIENT_EMAIL"),
    privateKey: getEnv("GOOGLE_PRIVATE_KEY")
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function getAccessToken(scopes) {
  const metadataToken = await tryGetMetadataAccessToken();
  if (metadataToken) {
    return metadataToken;
  }

  const { clientEmail, privateKey } = readServiceAccountConfig();

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Google service account credentials. Use GOOGLE_SERVICE_ACCOUNT_JSON_PATH, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY, or run on Cloud Run with an attached service account."
    );
  }

  const privateKeyRaw = privateKey;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: scopes.join(" "),
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

async function tryGetMetadataAccessToken() {
  try {
    const response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: {
          "Metadata-Flavor": "Google"
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return payload.access_token || null;
  } catch {
    return null;
  }
}

module.exports = {
  fetchJson,
  getAccessToken,
  getEnv
};
