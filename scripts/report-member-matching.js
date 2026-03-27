const { loadLocalEnv } = require("../lib/env");
const { loadGoogleSheetsData } = require("../lib/sheets");

async function main() {
  loadLocalEnv();
  const data = await loadGoogleSheetsData();
  const meetings = data.meetings || [];

  const summary = {
    exact: 0,
    fuzzy: 0,
    partial: 0,
    unmatched: 0
  };

  const unmatchedCompleteNames = new Map();
  const partialUnmatchedNames = new Map();

  for (const meeting of meetings) {
    const status = meeting.member_match_status || "unmatched";
    summary[status] = (summary[status] || 0) + 1;

    const unmatched = String(meeting.member_unmatched_names || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const targetMap = status === "partial" ? partialUnmatchedNames : unmatchedCompleteNames;

    for (const name of unmatched) {
      targetMap.set(name, (targetMap.get(name) || 0) + 1);
    }
  }

  function toSortedList(map) {
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
        unmatchedComplete: {
          rows: summary.unmatched,
          names: toSortedList(unmatchedCompleteNames)
        },
        partial: {
          rows: summary.partial,
          unresolvedFragments: toSortedList(partialUnmatchedNames)
        }
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
