export interface MasterTimetableEntry {
  Cohort: string;
  Course_Code: string;
  Course_Name: string;
  Credit: number;
  Day: "Isnin" | "Selasa" | "Rabu" | "Khamis" | "Jumaat" | string;
  Start_Time: string;
  End_Time: string;
  Venue: string;
  Lecturer: string;
  Status?: "D" | "C1" | "C2" | string;
  /** `MK` marks a repeat-class section from another department (e.g. JMSK); it can be
   *  picked as a tumpang section but is never a student's home class. */
  Section_Type?: string;
}

export interface CourseSlot {
  Day: string;
  Start_Time: string;
  End_Time: string;
  Venue: string;
  Lecturer: string;
  Status?: string;
}

export interface CoursePackage {
  key: string;
  Cohort: string;
  Program: string;
  Course_Code: string;
  Course_Name: string;
  Credit: number;
  slots: CourseSlot[];
}

export interface RepeatSelection {
  code: string;
  status: "C1" | "C2" | "D";
  preferredCohort: string | null;
}

export interface StudentInfo {
  name: string;
  regNum: string;
  phone: string;
  paName: string;
  currentCohort: string;
  session: string;
  department: string;
  deadline: string;
}

export interface ScoredCandidate {
  pkg: CoursePackage;
  clashedBase: CoursePackage[];
  droppedCredits: number;
  clashesWithOtherRepeat: boolean;
  sameProgram: boolean;
  penalty: number;
}

export interface AllocatedRepeatPackage extends CoursePackage {
  repeatStatus: "C1" | "C2" | "D";
  displayStatus: "C1" | "C2" | "D";
  scoredCandidates: ScoredCandidate[];
  clashedBasePackages: CoursePackage[];
  clashesWithOtherRepeat: boolean;
  isRescued?: boolean;
}

export interface RescuedCourse {
  originalPkg: CoursePackage;
  rescuePkg: CoursePackage;
  status: "D";
  clashedWithCodes: string[];
}

export interface AutoDroppedCourse {
  pkg: CoursePackage;
  clashedWithCodes: string[];
}

export interface CurriculumCourse {
  name: string;
  type: string;
  semesters: number[];
  credit: number;
  prerequisites: string[];
  note?: string;
}

export interface CurriculumData {
  meta: {
    programme: string;
    programmeName: string;
    version: string;
    effective: string;
    source?: string;
    totalCredits?: number;
    /**
     * Codes printed on the timetable that belong to a curriculum course under a
     * different code (alias -> official code), e.g. DBS10082 -> DBS10042.
     */
    codeAliases?: Record<string, string>;
    codeAliasNotes?: Record<string, string>;
  };
  courses: Record<string, CurriculumCourse>;
  unresolvedPrerequisites?: { courseCode: string; courseName?: string; prerequisiteName?: string; note: string }[];
  conditionalRequiredCourses?: {
    courseCode: string;
    courseName: string;
    condition: string;
    semesters?: number[];
    credit?: number;
  }[];
}

/** Curriculum documents keyed by programme code (DKM, DAD, DPU, DTP…). */
export type CurriculumLibrary = Record<string, CurriculumData>;

export interface CurriculumSummary {  programme: string;
  source: 'kv' | 'asset' | 'none';
  coursesCount: number;
  prerequisitesCount: number;
  version?: string;
  effective?: string;
  updatedAt?: string;
  filename?: string;
}

export interface CurriculumValidation {
  ok: boolean;
  programme: string;
  coursesCount: number;
  prerequisitesCount: number;
  errors: string[];
  warnings: string[];
}

export interface PrereqDroppedCourse {  pkg: CoursePackage;
  blockedBy: string;
  blockedByName: string;
  chain: string[];
  reason: string;
}

export interface RepeatPrereqViolation {
  code: string;
  prerequisiteCode: string;
  prerequisiteName: string;
  chain: string[];
}

export interface ElectiveChoiceOption {
  courseCode: string;
  courseName: string;
  credit: number;
}

/**
 * Courses that occupy exactly the same slot for one cohort and are alternatives of
 * each other, e.g. Sukan 2 / Kelab-Persatuan 2 / Unit Beruniform 2: a student takes
 * only one of them.
 */
export interface ElectiveChoiceGroup {
  key: string;
  day: string;
  startTime: string;
  endTime: string;
  options: ElectiveChoiceOption[];
  selectedCourseCode: string;
}

export interface SolverAnalysis {
  currentCohort: string;
  basePackages: CoursePackage[];
  keptBasePackages: CoursePackage[];
  sectionBPackages: (AllocatedRepeatPackage | (CoursePackage & { displayStatus: string; isRescued: boolean; originalCohort?: string }))[];
  rescuedBaseCourses: RescuedCourse[];
  autoDroppedCourses: AutoDroppedCourse[];
  prereqDroppedCourses: PrereqDroppedCourse[];
  repeatPrereqViolations: RepeatPrereqViolation[];
  manualDroppedPackages: CoursePackage[];
  electiveGroups: ElectiveChoiceGroup[];
  unselectedElectivePackages: CoursePackage[];
  /** Bahasa Kebangsaan A courses left out because the student passed Bahasa Melayu. */
  bahasaKebangsaanExemptPackages: CoursePackage[];
  /** Bahasa Kebangsaan A codes scheduled for this cohort (empty when none). */
  bahasaKebangsaanCourseCodes: string[];
  creditsA: number;
  creditsB: number;
  totalCredits: number;
}

export type TimetableChangeSource =
  | "web_pdf_upload"
  | "web_json_upload"
  | "desktop_kv"
  | "google_sheets_csv"
  | "external_json"
  | "json_import"
  | "sheets_sync"
  | "manual_edit"
  | "reset";

export interface TimetableChangeLogEntry {
  id: string;
  timestamp: string;
  source: TimetableChangeSource;
  filename?: string;
  previousSlots: number;
  newSlots: number;
  deltaSlots: number;
  cohortsCount: number;
  engineLabel?: string;
  signature?: string;
  notes?: string;
}

export interface SystemSettings {
  session: string;
  deadline: string;
  department: string;
  institutionName: string;
  logoUrl: string;
  logoFilename?: string;
  logoStorage: "r2" | "default";
  updatedAt?: string;
}

