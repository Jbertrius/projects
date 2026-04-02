const { loadLocalEnv } = require("../lib/env");

loadLocalEnv();

const { listUsers, syncMembersToUsers } = require("../lib/auth");

async function main() {
  const users = await listUsers();
  const admin = users.find((user) => user.role === "admin" && user.is_active);

  if (!admin) {
    throw new Error("Aucun admin actif n'a ete trouve pour lancer la migration.");
  }

  const result = await syncMembersToUsers(admin);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
