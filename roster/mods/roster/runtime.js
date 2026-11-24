// What runs in a terminal, for its one leading icon. Pure: no Herdr imports.
//
// The only source is Herdr's own program table (`program` on each terminal: the agent's
// own report, else the program it runs). Tab titles, terminal names, roles and folders
// never pick an icon, so a shell in a tab called "Claude" stays a shell, and a Developer
// running Claude Code gets the Claude Code icon with its Developer label.

// Herdr's shipped program icons live in its home folder as icons/<name>.svg.
const HERDR_ICON = /^icons\/([a-z0-9][a-z0-9_-]{0,63})\.svg$/;
const ROSTER_SHELLS = { bash: 'bash', 'bash.exe': 'bash', powershell: 'powershell', 'powershell.exe': 'powershell', pwsh: 'powershell', 'pwsh.exe': 'powershell' };
const text = value => typeof value === 'string' && value.trim() && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;

// The fields Roster keeps from Herdr's program record; anything else is dropped.
export function programOf(input) {
  const p = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const key = text(p.key);
  if (!key) return null;
  const icon = typeof p.icon === 'string' && HERDR_ICON.test(p.icon) ? p.icon : null;
  return { key, name: text(p.name), icon, tint: p.tint === true, shell: p.shell === true, agent: p.agent === true };
}

// { source: 'roster' | 'herdr', name, color, label, known }:
// - roster/color: Roster's own color shell icons (Bash, PowerShell).
// - herdr: Herdr's icon for that program, full color unless the table marks it a tint glyph.
// - roster 'terminal' (not color, known false): nothing is known about what runs there.
export function terminalKind(program) {
  const p = program && typeof program === 'object' ? program : null;
  const unknown = { source: 'roster', name: 'terminal', color: false, label: 'Terminal', known: false };
  if (!p?.key) return unknown;
  const label = p.name ?? p.key;
  if (p.shell) {
    const own = ROSTER_SHELLS[(p.name ?? '').toLowerCase()] ?? ROSTER_SHELLS[p.key.toLowerCase()];
    if (own) return { source: 'roster', name: own, color: true, label: own === 'bash' ? 'Bash' : 'PowerShell', known: true };
  }
  // "program" is Herdr's entry for anything it does not list: no claim about what runs.
  if (p.key === 'program') return unknown;
  const icon = HERDR_ICON.exec(p.icon ?? '');
  if (icon) return { source: 'herdr', name: icon[1], color: !p.tint, label, known: true };
  return { ...unknown, label, known: p.shell || p.agent };
}
