const { loadLocalEnv } = require("../lib/env");
const { syncSheetsToFirestore } = require("../lib/firestore");

async function main() {
  loadLocalEnv();
  const result = await syncSheetsToFirestore();
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
