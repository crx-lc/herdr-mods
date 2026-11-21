// Public stock Desktop adapter. No Core identity, epoch, settings or asset proof is exported.
import { emptyEvidence } from './feed.js';
export function desktopHost(app, deadline) {
  return { terminals: app.terminals, machines: app.machines, panes: app.panes, spaces: app.spaces,
    agents: app.agents, focused: app.focused, now: () => Date.now(), evidence: emptyEvidence,
    run: (command, args) => app.run(command, args), readTextFile: app.readTextFile, deadline };
}
export function desktopLayoutHost(app) {
  const path = name => `${app.appHome()}/layouts/${name}.json`;
  return { current: () => ({ name: app.shared('layout'), tree: app.layout() }),
    readLayout: name => app.readTextFile(path(name), { on: null }),
    writeLayout: (name, text, expected) => app.writeTextFile(path(name), text, expected),
    save: (token, text) => app.writeTextFile(`${app.appHome()}/data/roster/restoration-${token}.json`, text, null),
    load: token => app.readTextFile(`${app.appHome()}/data/roster/restoration-${token}.json`, { on: null }),
    switchLayout: name => app.run('layout.switch', { name }) };
}
