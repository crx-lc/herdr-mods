// Spaces list from Herdr's own Space data, in the stock sidebar's order and look.
// Pure: the caller passes spaces(), machines(), the shared avatar colors and folds.
// No git, no exec: the stock list's repo/ahead-behind tail is not reproduced here.

// Avatar fills for stored color names, as the stock Spaces list draws them.
export const SPACE_MARKS = Object.freeze({ ansi6: '#22a99a', ansi3: '#e3814f', ansi4: '#5b8def', ansi5: '#8b7cf6', ansi2: '#3fae6a', ansi1: '#d9649a' });
export const LOCAL_MACHINE = 'This computer';

const validName = value => typeof value === 'string' && !!value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const color = value => typeof value === 'string' && (/^#[0-9a-fA-F]{6}$/.test(value) || /^[a-z][a-z0-9_]{0,31}$/.test(value)) ? value : null;
export const machineKey = machine => 'spaces:machine:' + (machine ?? 'local');
export const spaceKey = id => 'space:' + id;

// A space's tail is its branch, only where unusual: not main/master, not its own name.
export function branchTail(space) {
  const branch = validName(space?.branch) ? space.branch.trim() : '';
  if (!branch || ['main', 'master'].includes(branch) || branch.toLowerCase() === String(space?.name ?? '').trim().toLowerCase()) return '';
  return branch;
}

// Rows: one header per machine once a remote machine is known (this computer first,
// then remote machines by name), each followed by its Spaces in Herdr's order.
export function spaceRows({ spaces = [], machines = [] } = {}, { colors = {}, folds = {} } = {}) {
  const list = (Array.isArray(spaces) ? spaces : []).filter(s => s && validName(s.id));
  const seen = new Set();
  const unique = list.filter(s => !seen.has(s.id) && seen.add(s.id));
  const machineOf = s => (validName(s.machine) ? s.machine : null);
  const remote = [...new Set([...unique.map(machineOf).filter(Boolean),
    ...(Array.isArray(machines) ? machines : []).map(m => m?.name).filter(validName)])].sort();
  const grouped = remote.length > 0;
  const rows = [];
  for (const machine of [null, ...remote]) {
    const mine = unique.filter(s => machineOf(s) === machine);
    const state = (Array.isArray(machines) ? machines : []).find(m => (m?.name ?? null) === machine);
    const key = machineKey(machine), collapsed = folds[key] === true;
    if (grouped) rows.push({ kind: 'machine', key, machine, label: machine ?? LOCAL_MACHINE,
      ready: state?.layout === 'ready', loading: state?.layout === 'loading', collapsed, count: mine.length });
    if (grouped && collapsed) continue;
    for (const space of mine) {
      const name = validName(space.name) ? space.name.trim() : space.id;
      rows.push({ kind: 'space', key: spaceKey(space.id), id: space.id, machine, name,
        initial: (Array.from(name)[0] ?? '?').toUpperCase(), color: color(colors?.[space.id]) ?? 'ansi6',
        active: space.active === true, branch: branchTail(space), status: space.status ?? null });
    }
  }
  return rows;
}

// A stored color name or hex as a fill, the same way the stock list resolves it.
export const spaceFill = (name, theme = {}) => name.startsWith('#') ? name : SPACE_MARKS[name] ?? theme[name] ?? SPACE_MARKS.ansi6;
