const { loadLocalEnv } = require("../lib/env");
const { ensureGoogleSheetsStructure } = require("../lib/sheets");

async function main() {
  loadLocalEnv();
  const result = await ensureGoogleSheetsStructure();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
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
