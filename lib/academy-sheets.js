const { getAccessToken, getEnv } = require("./google-auth");
const { fetchSheetRange } = require("./sheets");

const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const DEFAULT_ACADEMY_SHEET_ID = "1w29EuGn99c7nHpMBD1T9LhwMIqIpdtyi5QXtKq8WB5I";

function getAcademySpreadsheetId() {
  return getEnv("ACADEMY_ATTENDANCE_SPREADSHEET_ID", DEFAULT_ACADEMY_SHEET_ID);
}

async function loadAcademySheetData() {
  const spreadsheetId = getAcademySpreadsheetId();
  const accessToken = await getAccessToken([GOOGLE_OAUTH_SCOPE]);

  const [classes, lessons, students, attendance] = await Promise.all([
    fetchSheetRange(spreadsheetId, "CLASSES!A1:Z", accessToken),
    fetchSheetRange(spreadsheetId, "LESSONS!A1:Z", accessToken),
    fetchSheetRange(spreadsheetId, "STUDENTS!A1:Z", accessToken),
    fetchSheetRange(spreadsheetId, "LESSON_ATTENDANCE!A1:Z", accessToken)
  ]);

  return {
    spreadsheetId,
    classes,
    lessons,
    students,
    attendance
  };
}

module.exports = {
  getAcademySpreadsheetId,
  loadAcademySheetData
};
