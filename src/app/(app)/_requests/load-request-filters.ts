/**
 * @file Loads what the views of requests (the list and the board) need
 * before they load their requests: the companies, the request settings, the
 * request types and the staff who can be assigned, and reads the page's
 * filters with them (`parseRequestFilters`). One loader, so both views
 * always offer the same filters.
 */
import type { SearchParams } from '@/lib/search-params';
import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import { getStaffPermissionsInCompanies } from '@/server/authz';
import {
  type AssignableStaffMember,
  getRequestSettings,
  listAssignableStaff,
  listRequestCompanies,
  listRequestTypes,
  type RequestCompany,
  type RequestTypeView,
} from '@/server/requests';

import { parseRequestFilters, type RequestFilters } from './request-filters';

/** What {@link loadRequestFilters} loads, with the filters read from it. */
export interface LoadedRequestFilters {
  /** The companies the viewer sees requests of. */
  companies: RequestCompany[];
  /** The request numbers' prefix and the name the staff are shown with. */
  settings: { prefix: string; staffName: string };
  /** The staff who can be assigned: for the staff only, none for everyone else. */
  assignable: AssignableStaffMember[];
  /** Every request type, archived ones too. */
  types: RequestTypeView[];
  /** The page's filters, checked against all of the above. */
  filters: RequestFilters;
}

/**
 * Loads what a view of requests filters by, in one go, and reads the page's
 * filters with it. The staff who can be assigned are loaded only for the
 * staff (`requests:view-internal`), the only ones who filter by them.
 *
 * @param actor - The viewer.
 * @param searchParams - The page's query parameters.
 * @param company - The company whose view this is (its URL name), on a company's own page.
 * @returns What was loaded, and the filters.
 */
export default async function loadRequestFilters(
  actor: Actor,
  searchParams: SearchParams,
  company: string | undefined,
): Promise<LoadedRequestFilters> {
  const [companies, settings, assignable, types] = await Promise.all([
    listRequestCompanies(appContext, actor),
    getRequestSettings(appContext),
    getStaffPermissionsInCompanies(actor).has('requests:view-internal')
      ? listAssignableStaff(appContext, actor)
      : [],
    listRequestTypes(appContext, actor),
  ]);
  const filters = parseRequestFilters({
    searchParams,
    actor,
    company,
    companies,
    types,
    assignable,
  });
  return { companies, settings, assignable, types, filters };
}
