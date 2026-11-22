// Pure presentation only. Facts come from a projected instance, never from names.
const reasons = { 'unverified-identity': 'Open unavailable: terminal identity is unverified',
  'not-current-live': 'Open unavailable: terminal is stale or absent',
  'missing-or-ambiguous-route-evidence': 'Open unavailable: current route is unverified',
  'outside-current-filters': 'Outside current filters', 'context-only': 'Context for a child that needs you' };
export function actionReason(instance) {
  return instance.navigation.enabled ? 'Open available' : reasons[instance.navigation.reason]
    ?? ('Open unavailable: ' + instance.navigation.reason);
}
export function rowContext(instance) {
  const { row, context } = instance;
  const project = row.project.displayName || 'Unassigned';
  const parent = context.parent?.displayLabel ?? (context.parentResolution === 'none' ? 'Not reported'
    : 'Unknown (' + (context.parentResolution ?? 'unresolved') + ')');
  const route = row.core.alias ? 'Route ' + row.core.alias : 'Local route';
  const machine = row.core.hostLabel ? row.core.hostLabel + ' · ' + route : route + ' (host unknown)';
  return { project, parent, machine: machine + (row.core.verified ? '' : ' · identity unverified'),
    context: row.executionContext.label || 'Context unknown' };
}
export function detailFields(instance) {
  const { row } = instance, context = rowContext(instance);
  const field = (id, label, value) => ({ id, label, value });
  const fields = [field('name', 'Name', row.displayLabel), field('project', 'Project', context.project),
    field('parent', 'Parent', context.parent), field('machine', 'Machine / route', context.machine),
    field('context', 'Execution context', context.context),
    field('state', 'State', [instance.display.error ?? instance.status, row.lifecycle, row.freshness].filter(Boolean).join(' · '))];
  if (row.project.resolution && row.project.id == null) fields[1].value += ' (' + row.project.resolution + ')';
  if (row.roster.state === 'waiting') fields.push(field('waiting', 'Waiting', instance.display.detail ?? 'Waiting detail unavailable'));
  fields.push(field('provider', 'Work item / project provider', row.providerBadge?.accessibleName ?? 'Unknown'),
    field('availability', 'Action availability', actionReason(instance)));
  if (instance.outsideFilters.length) fields.push(field('filters', 'Outside filters', instance.outsideFilters.join(' · ')));
  if (instance.identityDiagnostic) fields.push(field('diagnostic', 'Identity diagnostic', instance.identityDiagnostic));
  return fields;
}
export const detailLabel = instance => detailFields(instance).map(f => f.label + ': ' + f.value).join(' · ');

// Avoid common combining/joining boundaries where feasible without Intl. A run
// longer than the page budget must still split; every UTF-16 source span survives.
const continuation = char => /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f\u200d]/u.test(char)
  || (char.codePointAt(0) >= 0x1f3fb && char.codePointAt(0) <= 0x1f3ff);
export function detailPages(fields) {
  const pages = [];
  for (const [fieldIndex, field] of fields.entries()) {
    const points = Array.from(field.value), spans = [];
    let start = 0, offset = 0;
    do {
      let end = start, newlines = 0;
      while (end < points.length && end - start < 64) {
        if (points[end] === '\n' && ++newlines > 3) break;
        end++;
      }
      if (end < points.length) {
        // Prefer a whitespace boundary, retaining that whitespace in its source span.
        let boundary = end;
        while (boundary > start && !/\s/u.test(points[boundary - 1])) boundary--;
        if (boundary > start) end = boundary;
        let safe = end;
        while (safe > start && (continuation(points[safe]) || points[safe - 1] === '\u200d')) safe--;
        if (safe > start) end = safe;
      }
      const text = points.slice(start, end).join('');
      spans.push({ fieldIndex, fieldId: field.id, label: field.label, start: offset, end: offset + text.length, text });
      offset += text.length; start = end;
    } while (start < points.length);
    for (const [index, span] of spans.entries()) pages.push({ ...span, fieldPage: index + 1, fieldPages: spans.length });
  }
  return pages;
}
