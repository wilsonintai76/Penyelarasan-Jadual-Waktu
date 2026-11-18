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

export interface SolverAnalysis {
  currentCohort: string;
  basePackages: CoursePackage[];
  keptBasePackages: CoursePackage[];
  sectionBPackages: (AllocatedRepeatPackage | (CoursePackage & { displayStatus: string; isRescued: boolean; originalCohort?: string }))[];
  rescuedBaseCourses: RescuedCourse[];
  autoDroppedCourses: AutoDroppedCourse[];
  manualDroppedPackages: CoursePackage[];
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

