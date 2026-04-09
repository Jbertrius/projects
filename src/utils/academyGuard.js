function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function inspectAcademyPayload(input = {}) {
  const classCode = String(input.classCode || "").trim();
  const lessonTitle = String(input.lessonTitle || "").trim();
  const instructor = String(input.instructor || "").trim();

  const normalizedClassCode = normalize(classCode);
  const normalizedLessonTitle = normalize(lessonTitle);
  const normalizedInstructor = normalize(instructor);

  const reasons = [];

  const explicitTestClassCodes = new Set(["cls01", "cls_01", "demo", "test"]);
  const explicitTestTitles = new Set(["lesson 1", "test lesson", "demo lesson"]);
  const explicitTestInstructors = new Set(["jean dupont", "john doe", "jane doe"]);

  if (explicitTestClassCodes.has(normalizedClassCode)) {
    reasons.push(`classCode:${classCode}`);
  }

  if (/^cls\d+$/i.test(classCode)) {
    reasons.push(`classCodePattern:${classCode}`);
  }

  if (explicitTestTitles.has(normalizedLessonTitle)) {
    reasons.push(`lessonTitle:${lessonTitle}`);
  }

  if (/^lesson\s+\d+$/i.test(lessonTitle)) {
    reasons.push(`lessonTitlePattern:${lessonTitle}`);
  }

  if (explicitTestInstructors.has(normalizedInstructor)) {
    reasons.push(`instructor:${instructor}`);
  }

  return {
    shouldReject: reasons.length > 0,
    reasons,
    fingerprint: {
      classCode,
      lessonTitle,
      instructor
    }
  };
}

module.exports = {
  inspectAcademyPayload
};
