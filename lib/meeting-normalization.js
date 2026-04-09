const { resolvePastorLocally } = require("./pastor-normalization");

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookup(value) {
  return normalizeWhitespace(
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
  );
}

function normalizeMeetingDate(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) {
    return isoMatch[1];
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return raw;
}

function meetingMonthFromDate(value) {
  const date = normalizeMeetingDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return "";
  }
  return date.slice(0, 7);
}

function isSuspiciousPastorName(value) {
  const normalized = normalizeLookup(value);
  if (!normalized) {
    return true;
  }
  return /\b(academie|academy|cpe|peace|presentation|visite|planning|centre)\b/.test(normalized);
}

function inferPastorName({ pastorName, eventSummary, eventDescription }) {
  const explicit = normalizeWhitespace(pastorName);
  if (explicit && !isSuspiciousPastorName(explicit)) {
    return {
      pastor_name: explicit,
      pastor_resolution_method: "existing"
    };
  }

  const summaryResolution = resolvePastorLocally(eventSummary);
  if (summaryResolution.canonicalName && !isSuspiciousPastorName(summaryResolution.canonicalName)) {
    return {
      pastor_name: summaryResolution.canonicalName,
      pastor_resolution_method: summaryResolution.method || "summary"
    };
  }

  const descriptionResolution = resolvePastorLocally(eventDescription);
  if (descriptionResolution.canonicalName && !isSuspiciousPastorName(descriptionResolution.canonicalName)) {
    return {
      pastor_name: descriptionResolution.canonicalName,
      pastor_resolution_method: descriptionResolution.method || "description"
    };
  }

  return {
    pastor_name: "",
    pastor_resolution_method: "unresolved"
  };
}

function normalizeMeetingRecord(meeting) {
  const meeting_date = normalizeMeetingDate(meeting.meeting_date);
  const month = meetingMonthFromDate(meeting_date);
  const pastor = inferPastorName({
    pastorName: meeting.pastor_name,
    eventSummary: meeting.event_summary,
    eventDescription: meeting.event_description
  });

  return {
    ...meeting,
    meeting_date,
    report_date: normalizeMeetingDate(meeting.report_date) || meeting_date,
    month,
    pastor_name: pastor.pastor_name,
    pastor_resolution_method: pastor.pastor_resolution_method
  };
}

function buildExactMeetingKey(meeting) {
  const normalized = normalizeMeetingRecord(meeting);
  return [
    normalized.meeting_date,
    normalizeLookup(normalized.event_summary),
    normalizeLookup(normalized.pastor_name),
    normalizeLookup(normalized.member_name)
  ].join("|");
}

module.exports = {
  buildExactMeetingKey,
  inferPastorName,
  isSuspiciousPastorName,
  meetingMonthFromDate,
  normalizeMeetingDate,
  normalizeMeetingRecord
};
