/**
 * Some JKM courses are printed under two codes: the semester-1 timetable sheets carry the
 * new code, while students from Semester 2 upwards register the old/official code (the
 * JMSK repeat-class memo lists it that way). The rule mirrors the Bahasa Kebangsaan A
 * semester rule, and it is enforced in the planner's Bahagian B dropdown and the upload
 * review so a student is never pointed at the wrong code for their semester.
 */
import { semesterFromCohort } from './bahasaKebangsaan';

const normalize = (value?: string | null): string =>
  String(value || '').toUpperCase().replace(/\s+/g, '');

/**
 * Engineering Science: `DBS10082` on the Semester 1 timetable sheets (new cohorts,
 * Sesi II 2026/2027); `DBS10042` in the Programme Information and for Semester 2+
 * repeats (Sesi I 2026/2027, JMSK MK sections).
 */
export const COURSE_CODE_SEMESTERS: Record<string, number[]> = {
  DBS10082: [1],
  DBS10042: [2, 3, 4, 5, 6]
};

const COUNTERPART_CODES: Record<string, string> = {
  DBS10082: 'DBS10042',
  DBS10042: 'DBS10082'
};

export function semesterRuleForCourse(courseCode?: string | null): number[] | null {
  const allowed = COURSE_CODE_SEMESTERS[normalize(courseCode)];
  return allowed ? allowed : null;
}

/**
 * Message explaining why a code cannot be registered in that cohort, or null when the
 * code is allowed (or the cohort carries no semester, e.g. a `DBS10042-MKS1` section).
 */
export function courseSemesterIssue(courseCode?: string | null, cohort?: string | null): string | null {
  const code = normalize(courseCode);
  const allowed = COURSE_CODE_SEMESTERS[code];
  const semester = semesterFromCohort(String(cohort || ''));
  if (!allowed || semester === null || allowed.includes(semester)) return null;

  const allowedLabel = allowed.length === 1 && allowed[0] === 1 ? 'Semester 1' : 'Semester 2 ke atas';
  const counterpart = COUNTERPART_CODES[code];
  const suffix = counterpart ? ` Pelajar ${cohort} (Semester ${semester}) mesti mendaftar ${counterpart}.` : '';
  return `${code} hanya untuk ${allowedLabel}.${suffix}`;
}
