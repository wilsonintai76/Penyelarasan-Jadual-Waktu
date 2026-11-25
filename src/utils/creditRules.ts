/**
 * Study-load rule printed on Borang PK01: below 12 or above 20 credit hours the student
 * needs written approval from the Ketua Jabatan. Keep the three screens on one source.
 */
export const MIN_CREDITS = 12;
export const MAX_CREDITS = 20;

export const isBelowCreditLoad = (totalCredits: number): boolean => totalCredits < MIN_CREDITS;
export const isAboveCreditLoad = (totalCredits: number): boolean => totalCredits > MAX_CREDITS;
