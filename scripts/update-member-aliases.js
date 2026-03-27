const { loadLocalEnv } = require("../lib/env");
const { getAccessToken, getEnv } = require("../lib/google-auth");
const { fetchSheetRange, updateSheetValues } = require("../lib/sheets");

const MEMBERS_RANGE = "members!A1:Z";
const MEMBERS_HEADERS = ["id", "name", "zone", "department_role", "status", "aliases"];

const ALIAS_UPDATES = new Map([
  ["Aera", "Aera JJ"],
  ["Hanbyeol", "Hanbyeol SMN"],
  ["Kelan", "Kelan HJN"],
  ["Seojun", "Seojun Khan"],
  ["Kyung-mi", "Urielle"]
]);

function mergeAliases(currentValue, newValue) {
  const values = `${currentValue || ""};${newValue || ""}`
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(values)).join(";");
}

async function main() {
  loadLocalEnv();

  const spreadsheetId = getEnv("GOOGLE_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID.");
  }

  const accessToken = await getAccessToken(["https://www.googleapis.com/auth/spreadsheets"]);
  const members = await fetchSheetRange(spreadsheetId, MEMBERS_RANGE, accessToken);

  const updatedRows = members.map((member) => {
    const aliasToAdd = ALIAS_UPDATES.get(member.name || "");
    if (!aliasToAdd) {
      return {
        ...member,
        aliases: member.aliases || ""
      };
    }

    return {
      ...member,
      aliases: mergeAliases(member.aliases, aliasToAdd)
    };
  });

  const values = [
    MEMBERS_HEADERS,
    ...updatedRows.map((member) => MEMBERS_HEADERS.map((header) => member[header] ?? ""))
  ];

  await updateSheetValues(
    spreadsheetId,
    `members!A1:F${values.length}`,
    values,
    accessToken
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        updatedMembers: Array.from(ALIAS_UPDATES.keys()),
        totalRows: updatedRows.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message
      },
      null,
      2
    )
  );
  process.exit(1);
});
