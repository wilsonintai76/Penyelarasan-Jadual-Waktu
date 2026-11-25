/**
 * "Pilih satu" detection shared by the planner and the upload review.
 *
 * Two courses of the same cohort that occupy the same class slot are registration
 * alternatives (Sukan / Kelab-Persatuan / Unit Beruniform, or Sains Teknologi Islam vs
 * Nilai Masyarakat Malaysia) — a student registers only one of them.
 */

export interface ChoiceSchedule {
  Day: string;
  Start_Time: string;
  End_Time: string;
}

export interface ChoiceCandidate {
  Cohort: string;
  Course_Code: string;
  Credit: number;
  slots: ChoiceSchedule[];
}

const toMinutes = (value: string): number => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
};

export function slotSignature(pkg: ChoiceCandidate): string {
  return pkg.slots
    .map(slot => `${slot.Day}|${slot.Start_Time}|${slot.End_Time}`)
    .sort()
    .join(';');
}

/**
 * Alternatives either sit in exactly the same slots, or share a slot long enough to
 * cover the course's weekly hours with the same credit (one option simply has extra
 * sessions the other does not). Courses that merely overlap without covering the shared
 * hours are left alone — that is a genuine clash, not a choice (e.g. Engineering
 * Mathematics 1 and 2 scheduled in the same slot of one cohort).
 */
export function areChoiceAlternatives(a: ChoiceCandidate, b: ChoiceCandidate): boolean {
  if (!a.slots?.length || !b.slots?.length) return false;
  if (slotSignature(a) === slotSignature(b)) return true;
  if (Number(a.Credit || 0) !== Number(b.Credit || 0)) return false;
  const required = Math.max(60, Number(a.Credit || 0) * 60);
  return a.slots.some(slotA =>
    b.slots.some(
      slotB =>
        slotA.Day === slotB.Day &&
        slotA.Start_Time === slotB.Start_Time &&
        slotA.End_Time === slotB.End_Time &&
        toMinutes(slotA.End_Time) - toMinutes(slotA.Start_Time) >= required
    )
  );
}

/** The slot every member of a choice group shares (what the group is scheduled in). */
export function sharedChoiceSlot(members: ChoiceCandidate[]): ChoiceSchedule | undefined {
  if (!members.length) return undefined;
  return (
    members[0].slots.find(slot =>
      members.every(member =>
        member.slots.some(
          other =>
            other.Day === slot.Day &&
            other.Start_Time === slot.Start_Time &&
            other.End_Time === slot.End_Time
        )
      )
    ) || members[0].slots[0]
  );
}

/** Choice groups (2+ courses) inside each cohort, chained choices kept together. */
export function findChoiceGroups<T extends ChoiceCandidate>(packages: T[]): T[][] {
  const byCohort = new Map<string, T[]>();
  packages.forEach(pkg => {
    if (!pkg.slots || pkg.slots.length === 0) return;
    const bucket = byCohort.get(pkg.Cohort) || [];
    if (!bucket.some(existing => existing.Course_Code === pkg.Course_Code)) bucket.push(pkg);
    byCohort.set(pkg.Cohort, bucket);
  });

  const groups: T[][] = [];
  byCohort.forEach(bucket => {
    const parent = bucket.map((_, index) => index);
    const find = (index: number): number =>
      parent[index] === index ? index : (parent[index] = find(parent[index]));
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (areChoiceAlternatives(bucket[i], bucket[j])) parent[find(i)] = find(j);
      }
    }

    const components = new Map<number, T[]>();
    bucket.forEach((pkg, index) => {
      const root = find(index);
      components.set(root, [...(components.get(root) || []), pkg]);
    });
    components.forEach(members => {
      if (members.length >= 2) groups.push(members);
    });
  });

  return groups;
}

/** Stable key identifying a course pair that is an alternative within a cohort. */
export function choicePairKey(cohort: string, codeA: string, codeB: string): string {
  const codes = [codeA, codeB].map(code => String(code || '').toUpperCase()).sort();
  return `${String(cohort || '').toUpperCase()}|${codes[0]}|${codes[1]}`;
}
