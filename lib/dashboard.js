function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

function slugMonth(value) {
  return String(value || "").trim().slice(0, 3) || "N/A";
}

function normalizeMember(row) {
  return {
    id: row.id || row.member_id || row.name,
    name: row.name || "Membre inconnu",
    zone: row.zone || "Non définie",
    departmentRole: row.department_role || row.role || "",
    status: row.status || "À suivre"
  };
}

function normalizeMeeting(row) {
  const memberIds = String(row.member_ids || row.member_id || row.member || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const canonicalNames = String(row.member_names_canonical || row.member_name || row.member || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    id: row.id || "",
    memberId: row.member_id || row.member || "",
    memberIds,
    memberName: row.member_name || row.member || "",
    canonicalNames,
    pastorName: row.pastor_name || row.pastor || "",
    meetingDate: row.meeting_date || row.date || "",
    reportDate: row.report_date || "",
    month: row.month || row.meeting_month || "",
    zone: row.zone || "",
    calendarLogged: parseBoolean(row.calendar_logged || row.calendar_synced || false),
    matchStatus: row.member_match_status || "",
    unmatchedNames: row.member_unmatched_names || ""
  };
}

function normalizeTraining(row) {
  return {
    id: row.id || "",
    memberId: row.member_id || row.member || "",
    memberName: row.member_name || row.member || "",
    cohort: row.cohort || "Cohorte 1",
    week: row.week || "S1",
    attendance: toNumber(row.attendance, 0),
    completed: toNumber(row.completed || row.completed_modules || row.validation_count, 0),
    completionScore: toNumber(row.completion_score || row.progress || 0, 0),
    enrolled: parseBoolean(row.enrolled || true)
  };
}

function groupBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

function indexMeetingsByMember(meetings) {
  const index = {};

  for (const meeting of meetings) {
    const keys =
      meeting.memberIds.length > 0
        ? meeting.memberIds
        : [meeting.memberId || meeting.memberName || "unknown"];

    for (const key of keys) {
      index[key] = index[key] || [];
      index[key].push(meeting);
    }
  }

  return index;
}

function buildDashboard(source) {
  const members = (source.members || []).map(normalizeMember);
  const meetings = (source.meetings || []).map(normalizeMeeting);
  const trainingSessions = (source.trainingSessions || []).map(normalizeTraining);
  const memberLookup = members.reduce((acc, member) => {
    acc[String(member.id)] = member;
    return acc;
  }, {});

  const memberMeetingGroups = indexMeetingsByMember(meetings);
  const memberTrainingGroups = groupBy(trainingSessions, (session) => session.memberId || session.memberName || "unknown");
  const monthGroups = groupBy(meetings, (meeting) => slugMonth(meeting.month || meeting.meetingDate));
  const weekGroups = groupBy(trainingSessions, (session) => session.week);

  const monthlyMeetings = Object.entries(monthGroups)
    .map(([month, rows]) => ({ month, value: rows.length }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const memberSummaries = members.map((member) => {
    const key = member.id;
    const memberMeetings = memberMeetingGroups[key] || [];
    const training = memberTrainingGroups[key] || [];
    const pastors = new Set(memberMeetings.map((item) => item.pastorName).filter(Boolean)).size;
    const formation = training.length
      ? Math.round(training.reduce((sum, item) => sum + item.completionScore, 0) / training.length)
      : 0;

    return {
      id: member.id,
      name: member.name,
      zone: member.zone,
      departmentRole: member.departmentRole,
      meetings: memberMeetings.length,
      pastors,
      formation,
      status: member.status
    };
  });

  memberSummaries.sort((a, b) => b.meetings - a.meetings || b.formation - a.formation);

  const formationTimeline = Object.entries(weekGroups)
    .map(([week, rows]) => ({
      week,
      attendance: rows.reduce((sum, row) => sum + row.attendance, 0),
      completed: rows.reduce((sum, row) => sum + row.completed, 0)
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const activeMembers = memberSummaries.filter((member) => member.meetings > 0).length;
  const inactiveMembers = memberSummaries.filter((member) => member.meetings === 0).length;
  const enrolledMembers = new Set(
    trainingSessions.filter((item) => item.enrolled).map((item) => item.memberId || item.memberName).filter(Boolean)
  ).size;
  const calendarLogged = meetings.filter((item) => item.calendarLogged).length;
  const meetingRecords = meetings.map((meeting) => {
    const matchedMembers = meeting.memberIds
      .map((memberId) => memberLookup[String(memberId)])
      .filter(Boolean);

    return {
      id: meeting.id,
      meetingDate: meeting.meetingDate,
      month: meeting.month,
      zone: meeting.zone,
      pastorName: meeting.pastorName,
      calendarLogged: meeting.calendarLogged,
      matchStatus: meeting.matchStatus,
      unmatchedNames: meeting.unmatchedNames,
      memberIds: meeting.memberIds,
      memberNames: meeting.canonicalNames.length ? meeting.canonicalNames : [meeting.memberName].filter(Boolean),
      memberZones: Array.from(new Set(matchedMembers.map((member) => member.zone).filter(Boolean))),
      memberStatuses: Array.from(new Set(matchedMembers.map((member) => member.status).filter(Boolean)))
    };
  });

  const period = source.meta?.period || new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return {
    meta: {
      policyName: source.meta?.policyName || "Evolution des membres",
      period,
      refreshLabel: source.meta?.refreshLabel || "Synchronisation Google Sheets"
    },
    kpis: [
      {
        label: "Pasteurs rencontrés",
        value: new Set(meetings.map((item) => item.pastorName).filter(Boolean)).size,
        delta: `${meetings.length} rencontres déclarées`,
        tone: "positive"
      },
      {
        label: "Membres actifs",
        value: activeMembers,
        delta: `${inactiveMembers} sans activité`,
        tone: inactiveMembers > 0 ? "warning" : "positive"
      },
      {
        label: "Sessions déclarées",
        value: meetings.length,
        delta: `${calendarLogged} synchronisées calendrier`,
        tone: "neutral"
      },
      {
        label: "Inscrits formation",
        value: enrolledMembers,
        delta: `${memberSummaries.length ? Math.round((enrolledMembers / memberSummaries.length) * 100) : 0}% du département`,
        tone: "neutral"
      }
    ],
    monthlyMeetings,
    meetingRecords,
    members: memberSummaries,
    formationTimeline,
    pipeline: [
      { label: "Rencontres planifiées", value: source.pipeline?.planned ?? meetings.length },
      { label: "Rapports reçus", value: source.pipeline?.reported ?? meetings.length },
      { label: "Ajouts calendrier", value: source.pipeline?.calendarLogged ?? calendarLogged },
      { label: "Suivis à faire", value: source.pipeline?.followUps ?? inactiveMembers }
    ]
  };
}

module.exports = {
  buildDashboard
};
