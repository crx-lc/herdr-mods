// Pure presentation only. Facts come from a projected instance, never from names.
const reasons = { 'unverified-identity': 'Open unavailable: terminal identity is unverified',
  'not-current-live': 'Open unavailable: terminal is stale or absent',
  'missing-or-ambiguous-route-evidence': 'Open unavailable: current route is unverified',
  'outside-current-filters': 'Outside current filters', 'context-only': 'Context for a child that needs you',
  'multiple-panes': 'Open unavailable: more than one pane shows this terminal',
  'pane-tab-unverified': 'Open unavailable: its pane is not in a tab on its own machine',
  'machine-not-ready': 'Open unavailable: its machine is not connected or not ready',
  'invalid-route': 'Open unavailable: its address does not match its machine',
  'pane-model-invalid': 'Open unavailable: the pane list is inconsistent',
  'ambiguous-terminal': 'Open unavailable: more than one terminal has this address',
  'ambiguous-incarnation': 'Open unavailable: more than one terminal has this address',
  'incarnation-unknown': 'Open unavailable: terminal start time is unknown',
  'terminal-changed': 'Open unavailable: the terminal changed since the list was drawn',
  'pane-evidence-stale': 'Not opened: the list changed; try again',
  'projection-state-changed': 'Not opened: the list changed; try again',
  'target-changed': 'Not opened: the pane changed; try again',
  'not-actionable-instance': 'Not opened: this row is no longer in the list',
  'identity-changed': 'Not opened: the terminal changed; try again' };
export const reasonText = reason => reasons[reason] ?? ('Open unavailable: ' + reason);
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
  // Compact row facts: only what is known. Unknown project/context stay in Details.
  return { project, parent, machineSummary: row.core.hostLabel ? row.core.hostLabel + ' · ' + route : route,
    machineShort: row.core.hostLabel ?? (row.core.alias || 'This computer'),
    knownProject: row.project.id ? project : null,
    knownContext: row.executionContext.id ? row.executionContext.label : null,
    machine: machine + (row.core.verified ? '' : ' · identity unverified'),
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
  // Name the unbound label literally; it is shown, never used to group.
  const token = row.project.resolution === 'unbound' ? row.project.evidence?.[0]?.token : null;
  if (token) fields[1].value += ': label herdr.project=' + token + (row.core.verified ? ' has no local binding' : ' needs a verified Core to bind');
  const repository = instance.placement?.repository;
  fields.splice(2, 0, field('repository', 'Repository', repository ?? 'Not verified'));
  if (row.roster.state === 'waiting') fields.push(field('waiting', 'Waiting', instance.display.detail ?? 'Waiting detail unavailable'));
  fields.push(field('provider', 'Work item / project provider', row.providerBadge?.accessibleName ?? 'Unknown'),
    field('availability', 'Action availability', actionReason(instance)));
  if (instance.outsideFilters.length) fields.push(field('filters', 'Outside filters', instance.outsideFilters.join(' · ')));
  if (instance.identityDiagnostic) fields.push(field('diagnostic', 'Identity diagnostic', instance.identityDiagnostic));
  return fields;
}
export const detailLabel = instance => detailFields(instance).map(f => f.label + ': ' + f.value).join(' · ');

// Hover is a short, pre-wrapped summary; the full facts stay in Info and the
// accessibility label. Each logical line is capped, then wrapped at spaces.
export const HOVER_WIDTH = 40, HOVER_LINE_CAP = 80;
const clip = (value, limit) => { const points = Array.from(value); return points.length > limit ? points.slice(0, limit - 1).join('') + '…' : value; };
export function wrapText(value, width = HOVER_WIDTH) {
  const lines = [];
  let line = [];
  for (const word of value.split(/\s+/).filter(Boolean)) {
    let points = Array.from(word);
    while (points.length) {
      const room = width - (line.length ? line.length + 1 : 0);
      if (points.length <= room) { line = line.length ? [...line, ' ', ...points] : points; points = []; }
      else if (line.length) { lines.push(line.join('')); line = []; }
      else { lines.push(points.slice(0, width).join('')); points = points.slice(width); }
    }
  }
  if (line.length) lines.push(line.join(''));
  return lines.join('\n');
}
export function hoverText(instance, status) {
  const lines = [instance.row.displayLabel + ' · ' + status];
  if (!instance.navigation.enabled) lines.push(actionReason(instance));
  return lines.map(line => wrapText(clip(line.replace(/\s+/g, ' ').trim(), HOVER_LINE_CAP))).join('\n');
}

// Avoid common combining/joining boundaries where feasible without Intl. A run
// longer than the page budget must still split; every UTF-16 source span survives.
const continuation = char => /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f\u200d]/u.test(char)
  || (char.codePointAt(0) >= 0x1f3fb && char.codePointAt(0) <= 0x1f3ff)
  || (char.codePointAt(0) >= 0xe0020 && char.codePointAt(0) <= 0xe007f);
const regional = char => { const cp = char.codePointAt(0); return cp >= 0x1f1e6 && cp <= 0x1f1ff; };
function pageBoundaries(points) {
  const safe = [true];
  let indicators = 0;
  for (let end = 1; end < points.length; end++) {
    const before = points[end - 1], after = points[end];
    indicators = regional(before) ? indicators + 1 : 0;
    safe[end] = !continuation(after) && before !== '\u200d'
      && !(before === '\r' && after === '\n')
      && !(regional(after) && indicators % 2 === 1);
  }
  return safe;
}
export function detailPages(fields) {
  const pages = [];
  for (const [fieldIndex, field] of fields.entries()) {
    const points = Array.from(field.value), spans = [], safe = pageBoundaries(points);
    let start = 0, offset = 0;
    do {
      let end = start, newlines = 0;
      while (end < points.length && end - start < 64) {
        if ((points[end] === '\n' || (points[end] === '\r' && points[end + 1] !== '\n')) && ++newlines > 3) break;
        end++;
      }
      if (end < points.length) {
        // Prefer a whitespace boundary, retaining that whitespace in its source span.
        const limit = end;
        let boundary = end;
        while (boundary > start && !/\s/u.test(points[boundary - 1])) boundary--;
        if (boundary > start) end = boundary;
        let boundaryEnd = end;
        while (boundaryEnd > start && !safe[boundaryEnd]) boundaryEnd--;
        if (boundaryEnd === start) {
          boundaryEnd = limit;
          while (boundaryEnd > start && !safe[boundaryEnd]) boundaryEnd--;
        }
        // Pathological graphemes longer than a page split at the bounded limit.
        // This preserves progress and every source code point, not full UAX #29.
        end = boundaryEnd > start ? boundaryEnd : limit;
      }
      const text = points.slice(start, end).join('');
      spans.push({ fieldIndex, fieldId: field.id, label: field.label, start: offset, end: offset + text.length, text });
      offset += text.length; start = end;
    } while (start < points.length);
    for (const [index, span] of spans.entries()) pages.push({ ...span, fieldPage: index + 1, fieldPages: spans.length });
  }
  return pages;
}
