import { siteUrl } from './siteUrl';

export interface Crumb {
  name: string;
  /** Site-relative path in canonical shape: lowercase, trailing slash. */
  path: string;
}

/**
 * One BreadcrumbList builder for every page that has a path worth stating.
 *
 * Three pages each built this array inline and three others simply had no
 * breadcrumb at all, which left path context inconsistent across a fourteen-page
 * site. Home is prepended here rather than repeated at every call site, and the
 * `@id` is derived from the last crumb so nodes link instead of duplicate — the
 * stable-`@id` convention in seo.md.
 *
 * Pass the trail below Home, in order: buildBreadcrumb([{ name: 'FAQ', path: '/faq/' }]).
 */
export function buildBreadcrumb(trail: readonly Crumb[]) {
  const crumbs: Crumb[] = [{ name: 'Home', path: '/' }, ...trail];
  const last = crumbs[crumbs.length - 1];
  return {
    '@type': 'BreadcrumbList',
    '@id': `${siteUrl(last.path)}#breadcrumb`,
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: siteUrl(crumb.path),
    })),
  };
}
