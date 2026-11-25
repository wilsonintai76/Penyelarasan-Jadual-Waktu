/**
 * Bahasa Kebangsaan A is a conditional general-studies course: only students who did not
 * obtain a credit in Bahasa Melayu at SPM have to register it. It is scheduled in the
 * cohort timetable for everybody, so the planner drops it unless the student says
 * otherwise.
 *
 * The official code follows the same session rule as the rest of the MPU set:
 * Semester 1 (new cohort, Sesi II 2026/2027) = MPU22422, Semester 2 and above (older
 * cohort, Sesi I 2026/2027) = MPU22042. Both are declared as `conditionalRequiredCourses`
 * in the programme curriculum, so the list is read from there; the constants below are a
 * fallback for programmes whose curriculum document is not uploaded yet.
 */
export const BAHASA_KEBANGSAAN_CODES = ['MPU22422', 'MPU22042', 'MPU22212'];

const normalize = (value?: string): string => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');

/** Official code by semester: MPU22422 (Sem 1, kohort baharu) / MPU22042 (Sem 2 ke atas). */
export const BAHASA_KEBANGSAAN_SEMESTERS: Record<string, number[]> = {
  MPU22422: [1],
  MPU22042: [2, 3, 4, 5, 6]
};

export function isBahasaKebangsaanA(
  courseCode: string,
  courseName?: string,
  declaredCodes: string[] = BAHASA_KEBANGSAAN_CODES
): boolean {
  const code = String(courseCode || '').toUpperCase();
  if (BAHASA_KEBANGSAAN_CODES.includes(code) || declaredCodes.includes(code)) return true;
  return normalize(courseName || '').startsWith('BAHASAKEBANGSAAN');
}

/** Semester number of a cohort code such as `DKM2-S1` (null when not recognisable). */
export function semesterFromCohort(cohort: string): number | null {
  const match = /^[A-Z]{3}(\d+)-S\d+$/i.exec(String(cohort || '').trim());
  return match ? Number(match[1]) : null;
}

/**
 * Message explaining why a Bahasa Kebangsaan A code cannot be registered in that cohort,
 * or null when the code matches the semester.
 */
export function bahasaKebangsaanSemesterIssue(courseCode: string, cohort: string): string | null {
  const code = String(courseCode || '').toUpperCase();
  const allowed = BAHASA_KEBANGSAAN_SEMESTERS[code];
  const semester = semesterFromCohort(cohort);
  if (!allowed || semester === null || allowed.includes(semester)) return null;

  const onlySemesterOne = allowed.length === 1 && allowed[0] === 1;
  const counterpart = onlySemesterOne ? 'MPU22042' : 'MPU22422';
  return `${code} (Bahasa Kebangsaan A) hanya untuk ${onlySemesterOne ? 'Semester 1' : 'Semester 2 ke atas'}. Pelajar ${cohort} (Semester ${semester}) mesti mendaftar ${counterpart}.`;
}

/** Codes declared as Bahasa Kebangsaan A by any loaded curriculum document. */
export function collectBahasaKebangsaanCodes(curricula: unknown): string[] {
  const documents: unknown[] = Array.isArray(curricula) ? curricula : Object.values((curricula || {}) as object);
  const codes = new Set<string>();

  documents.forEach(document => {
    if (!document || typeof document !== 'object') return;
    const entry = document as {
      courses?: Record<string, { name?: string }>;
      conditionalRequiredCourses?: { courseCode?: string; courseName?: string }[];
    };

    (entry.conditionalRequiredCourses || []).forEach(conditional => {
      const code = String(conditional.courseCode || '').toUpperCase();
      if (code && normalize(conditional.courseName) === 'BAHASAKEBANGSAANA') codes.add(code);
    });
    Object.entries(entry.courses || {}).forEach(([code, course]) => {
      if (normalize(course?.name) === 'BAHASAKEBANGSAANA') codes.add(code.toUpperCase());
    });
  });

  return Array.from(codes);
}
