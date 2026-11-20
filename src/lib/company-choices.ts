/**
 * @file The labels of companies where someone picks one (a select, a filter
 * menu). Company names may repeat and only the URL name is unique, so a
 * company whose name another in the same choice shares shows its URL name
 * too. Pure and client-safe: the caller passes the translated label.
 */

/** A company to choose from: what tells companies apart in a choice. */
export interface ChoosableCompany {
  /** Its name. */
  name: string;
  /** Its URL name, unique across companies. */
  slug: string;
}

/**
 * The form two names are compared in: trimmed and lower-cased, so names
 * that read the same to people ("Adiutor", "adiutor ") count as the same.
 *
 * @param name - A company's name.
 * @returns The form to compare.
 */
function comparedName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Gives each company its label in a choice: its name, or, when another
 * company in the same choice has the same name, the label that adds its URL
 * name. The order stays as it is.
 *
 * @param companies - The companies in the choice.
 * @param withUrlName - The label with the URL name, e.g. "Adiutor Tests (adiutor-tests)".
 * @returns The companies, each with its `label`.
 */
export function companyChoiceLabels<T extends ChoosableCompany>(
  companies: readonly T[],
  withUrlName: (company: T) => string,
): (T & { label: string })[] {
  const counts = new Map<string, number>();
  companies.forEach(({ name }) => {
    const key = comparedName(name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return companies.map((company) => ({
    ...company,
    label: (counts.get(comparedName(company.name)) ?? 0) > 1 ? withUrlName(company) : company.name,
  }));
}
