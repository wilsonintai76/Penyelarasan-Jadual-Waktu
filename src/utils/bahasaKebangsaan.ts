/**
 * Bahasa Kebangsaan A is a conditional general-studies course: only students who did not
 * obtain a credit in Bahasa Melayu at SPM have to register it. It is scheduled in the
 * cohort timetable for everybody, so the planner drops it unless the student says
 * otherwise.
 */
export const BAHASA_KEBANGSAAN_CODES = ['MPU22042', 'MPU22422', 'MPU22212'];

const normalize = (value: string): string => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');

export function isBahasaKebangsaanA(courseCode: string, courseName?: string): boolean {
  if (BAHASA_KEBANGSAAN_CODES.includes(String(courseCode || '').toUpperCase())) return true;
  return normalize(courseName || '').startsWith('BAHASAKEBANGSAAN');
}
