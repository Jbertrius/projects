const { loadLocalEnv } = require("../lib/env");
const { syncAcademySheetToFirestore } = require("../lib/firestore");

async function main() {
  loadLocalEnv();
  const result = await syncAcademySheetToFirestore();
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
