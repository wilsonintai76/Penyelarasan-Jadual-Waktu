import { CurriculumData, CurriculumLibrary, MasterTimetableEntry } from '../types';
import { normalizeCourseCode } from './prerequisiteEngine';

export interface TimetableIssue {
  code: string;
  message: string;
  count: number;
  samples: string[];
}

export interface TimetableValidationResult {
  errors: TimetableIssue[];
  warnings: TimetableIssue[];
  stats: {
    slots: number;
    cohorts: number;
    courses: number;
    minWeeklyHours: number;
    medianWeeklyHours: number;
  };
}

const VALID_DAYS = ['ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT'];

// Contact-hour floors are deliberately loose: they exist to catch a broken
// extraction (missing rows, shifted columns), not to police curriculum design.
const MIN_COURSES_PER_COHORT = 4;
const MIN_WEEKLY_HOURS = 12;
const MAX_WEEKLY_HOURS = 32;

const toMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const addIssue = (
  bucket: Map<string, TimetableIssue>,
  code: string,
  message: string,
  sample: string
) => {
  const existing = bucket.get(code);
  if (existing) {
    existing.count += 1;
    if (existing.samples.length < 3) existing.samples.push(sample);
    return;
  }
  bucket.set(code, { code, message, count: 1, samples: [sample] });
};

/**
 * Course code -> course name taken from every programme curriculum, merged by code.
 * Used to detect a shifted name column in an extraction.
 */
export function buildCanonicalNameMap(
  curricula: CurriculumData | CurriculumLibrary | null | undefined
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!curricula) return map;

  const documents: CurriculumData[] = 'documents' in curricula
    ? Object.values((curricula as CurriculumLibrary).documents || {})
    : [curricula as CurriculumData];

  documents.forEach(document => {
    const courses = (document && document.courses) || {};
    Object.entries(courses).forEach(([code, course]) => {
      const key = normalizeCourseCode(code);
      const name = String((course && course.name) || '').trim();
      if (key && name && !map[key]) map[key] = name;
    });
  });

  return map;
}

/**
 * Structural and plausibility checks for a staged master timetable.
 * Errors block publishing; warnings mean "look at this before publishing".
 */
export function validateTimetableSlots(
  entries: MasterTimetableEntry[],
  options: { knownCourseNames?: Record<string, string> } = {}
): TimetableValidationResult {
  const knownCourseNames = options.knownCourseNames || {};
  const errors = new Map<string, TimetableIssue>();
  const warnings = new Map<string, TimetableIssue>();

  const weeklyMinutes = new Map<string, number>();
  const cohortCourses = new Map<string, Set<string>>();
  const slotKeys = new Set<string>();

  entries.forEach((entry, index) => {
    const label = `${entry.Cohort || '?'} ${entry.Course_Code || '?'} ${entry.Day || '?'} ${entry.Start_Time || '?'}`;
    const cohort = String(entry.Cohort || '').trim().toUpperCase();
    const code = String(entry.Course_Code || '').trim().toUpperCase();
    const day = String(entry.Day || '').trim().toUpperCase();
    const start = toMinutes(entry.Start_Time);
    const end = toMinutes(entry.End_Time);

    if (!cohort) addIssue(errors, 'MISSING_COHORT', 'Baris tanpa kod seksyen (Cohort)', `baris ${index + 1}`);
    if (!code) addIssue(errors, 'MISSING_COURSE', 'Baris tanpa kod kursus', `baris ${index + 1}`);
    if (!VALID_DAYS.includes(day)) addIssue(errors, 'INVALID_DAY', 'Hari tidak sah (Isnin–Jumaat)', label);
    if (start === null || end === null) {
      addIssue(errors, 'INVALID_TIME', 'Format masa tidak sah (HH:MM)', label);
    } else if (start >= end) {
      addIssue(errors, 'INVALID_RANGE', 'Masa tamat tidak melebihi masa mula', label);
    }

    if (cohort && code && day && entry.Start_Time) {
      const key = `${cohort}|${code}|${day}|${entry.Start_Time}`;
      if (slotKeys.has(key)) addIssue(errors, 'DUPLICATE_SLOT', 'Slot berganda (seksyen + kursus + hari + masa)', label);
      slotKeys.add(key);
    }

    if (cohort) {
      if (!cohortCourses.has(cohort)) cohortCourses.set(cohort, new Set());
      if (code) cohortCourses.get(cohort)!.add(code);
      if (start !== null && end !== null && end > start) {
        weeklyMinutes.set(cohort, (weeklyMinutes.get(cohort) || 0) + (end - start));
      }
    }
  });

  // Overlapping slots inside one cohort mean the grid was read out of alignment.
  const byCohortDay = new Map<string, MasterTimetableEntry[]>();
  entries.forEach(entry => {
    const key = `${String(entry.Cohort || '').trim().toUpperCase()}|${String(entry.Day || '').trim().toUpperCase()}`;
    if (!byCohortDay.has(key)) byCohortDay.set(key, []);
    byCohortDay.get(key)!.push(entry);
  });
  byCohortDay.forEach(rows => {
    const sorted = [...rows].sort(
      (a, b) => (toMinutes(a.Start_Time) || 0) - (toMinutes(b.Start_Time) || 0)
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prevEnd = toMinutes(sorted[i - 1].End_Time);
      const currentStart = toMinutes(sorted[i].Start_Time);
      if (prevEnd !== null && currentStart !== null && prevEnd > currentStart) {
        addIssue(
          errors,
          'COHORT_OVERLAP',
          'Dua kursus bertindih pada masa yang sama dalam seksyen yang sama',
          `${sorted[i].Cohort} ${sorted[i].Day} ${sorted[i - 1].Course_Code}/${sorted[i].Course_Code}`
        );
      }
    }
  });

  const hours = Array.from(weeklyMinutes.values()).map(minutes => minutes / 60);
  cohortCourses.forEach((courses, cohort) => {
    const hoursThisCohort = (weeklyMinutes.get(cohort) || 0) / 60;
    if (courses.size < MIN_COURSES_PER_COHORT) {
      addIssue(
        warnings,
        'LOW_COURSE_COUNT',
        `Seksyen dengan kurang daripada ${MIN_COURSES_PER_COHORT} kursus (mungkin baris hilang semasa ekstrak)`,
        `${cohort}: ${courses.size} kursus`
      );
    }
    if (hoursThisCohort < MIN_WEEKLY_HOURS) {
      addIssue(
        warnings,
        'LOW_WEEKLY_HOURS',
        `Seksyen dengan kurang daripada ${MIN_WEEKLY_HOURS} jam kuliah seminggu`,
        `${cohort}: ${hoursThisCohort.toFixed(1)} jam`
      );
    }
    if (hoursThisCohort > MAX_WEEKLY_HOURS) {
      addIssue(
        warnings,
        'HIGH_WEEKLY_HOURS',
        `Seksyen dengan lebih daripada ${MAX_WEEKLY_HOURS} jam kuliah seminggu`,
        `${cohort}: ${hoursThisCohort.toFixed(1)} jam`
      );
    }
  });

  // A code whose name disagrees with the curriculum means the name column was
  // read out of alignment (a shifted row), the most common extraction failure.
  const knownCodes = Object.keys(knownCourseNames);
  if (knownCodes.length > 0) {
    const unknownCodes = new Set<string>();
    let mismatchedNames = 0;
    entries.forEach(entry => {
      const code = normalizeCourseCode(entry.Course_Code);
      const expected = code ? knownCourseNames[code] : '';
      if (!code) return;
      if (!expected) {
        unknownCodes.add(code);
        return;
      }
      const actual = String(entry.Course_Name || '').trim();
      if (actual && actual !== expected) mismatchedNames += 1;
    });

    if (mismatchedNames > 0) {
      addIssue(
        warnings,
        'NAME_MISMATCH',
        'Nama kursus tidak sepadan dengan kurikulum (lajur nama mungkin tergeser)',
        `${mismatchedNames} baris, akan dibetulkan semasa terbit`
      );
    }
    if (unknownCodes.size > 0) {
      addIssue(
        warnings,
        'UNKNOWN_CODES',
        'Kod kursus tiada dalam kurikulum program (program mungkin belum ada dokumen kurikulum)',
        Array.from(unknownCodes).sort().slice(0, 6).join(', ')
      );
    }
  }

  const sortedHours = hours.sort((a, b) => a - b);
  const median = sortedHours.length
    ? sortedHours[Math.floor(sortedHours.length / 2)]
    : 0;

  if (sortedHours.length > 3 && (median < 18 || median > 30)) {
    addIssue(
      warnings,
      'IMPLAUSIBLE_LOAD',
      'Median jam kuliah setiap seksyen di luar julat munasabah 18-30 jam',
      `median ${median.toFixed(1)} jam`
    );
  }

  return {
    errors: Array.from(errors.values()).sort((a, b) => b.count - a.count),
    warnings: Array.from(warnings.values()).sort((a, b) => b.count - a.count),
    stats: {
      slots: entries.length,
      cohorts: cohortCourses.size,
      courses: new Set(entries.map(entry => String(entry.Course_Code || '').toUpperCase())).size,
      minWeeklyHours: sortedHours.length ? sortedHours[0] : 0,
      medianWeeklyHours: median
    }
  };
}
