const { loadLocalEnv } = require("../lib/env");
const { deleteEmptyAcademyClasses } = require("../lib/firestore");

loadLocalEnv();

async function main() {
  console.log("Recherche des classes vides dans Firestore...");
  const result = await deleteEmptyAcademyClasses();

  if (!result.deleted.length) {
    console.log("Aucune classe vide trouvee. La base est deja propre.");
    return;
  }

  console.log(`${result.deleted.length} classe(s) supprimee(s) :`);
  result.deleted.forEach((id) => console.log(`  - ${id}`));
}

main().catch((err) => {
  console.error("Erreur :", err.message || err);
  process.exit(1);
});
