import { machineAnchor, rowAnchor, sameDisclosure, returnControl, folderActionAllowed, panelText, spaceAnchor } from './disclosure.js';
import { Controller } from './controller.js';
import { LayoutOptIn } from './layout.js';
import { desktopHost, desktopLayoutHost } from './desktop.js';
import { spaceRows, machineKey, spaceFill, spacePlace, GitIdentities, MachineOs, folderSuggestions, matchingSpace, verifyFolder } from './spaces.js';
import { actionReason, rowContext, detailLabel, hoverText, reasonText, agentFacts, homeRelative } from './detail.js';
import { terminalKind } from './runtime.js';
import { reducedMotion, readStored, writeStored, Arrivals, PULSE } from './motion.js';

// One distinct icon per status group, so each reads as its own section.
export const STATUS_ICONS = Object.freeze({ 'Needs you': 'bell', 'Child needs you': 'bell-dot', Working: 'working', Done: 'check-circle', Idle: 'pause-circle', Offline: 'offline', Stale: 'clock', Unknown: 'help-circle' });
// Stock-style working spinner frames, drawn natively by frames().
export const WORKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export function timerDeadline(cx, promise) {
  return new Promise((resolve, reject) => {
    let settled = false;
    cx.timer.after(2000, () => { if (!settled) { settled = true; reject(Error('deadline')); } });
    promise.then(v => { if (!settled) { settled = true; resolve(v); } }, e => { if (!settled) { settled = true; reject(e); } });
  });
}
export function createRosterView(kit, app, options = {}) {
  const { View, div, h_flex, v_flex, ScrollHandle, svg, image, InputState, Input } = kit;
  // Roster's own icons, shipped in the mod folder; icon paths resolve against Herdr's root.
  const icon = (name, size) => svg('mods/roster/icons/' + name + '.svg').size(size).flex_none();
  // Roster's full-color icons, and Herdr's shipped program icons (icons/<name>.svg in its
  // home; runtime.js admits only that shape). These four helpers are the only asset reads.
  const picture = (name, size) => image('mods/roster/icons/' + name + '.svg').w(size).h(size).flex_none();
  const herdrGlyph = (name, size) => svg('icons/' + name + '.svg').size(size).flex_none();
  const herdrPicture = (name, size) => image('icons/' + name + '.svg').w(size).h(size).flex_none();
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  return class Roster extends View {
    init(_props, cx) {
      this.handle = cx.focus_handle();
      this.triggerHandles = new Map([['mode:projects', cx.focus_handle()]]); this.panelScroll = ScrollHandle.new(); this.panel = null;
      this.rowScroll = ScrollHandle.new();
      this.optionsScroll = ScrollHandle.new();
      // The pinned Needs you list scrolls on its own, outside the tabs' list.
      this.pinnedScroll = ScrollHandle.new();
      this.controller = new Controller(options.host ?? desktopHost(app), { collapseUnassigned: options.collapseUnassigned ?? true,
        // Spaces is the first tab and where the panel starts: daily navigation.
        initialView: options.initialView ?? 'spaces' });
      this.optIn = new LayoutOptIn(options.layoutHost ?? desktopLayoutHost(app));
      this.reader = null; this.readerControls = [];
      this.controls = []; this.message = ''; this.selection = null; this.reading = false; this.toolsOpen = false;
      // Where the cursor was when an event last placed it; Up/Down resume there if its row vanishes.
      this.cursorAt = null;
      // "Open folder as Space…": a retained path field for remote machines, made once here.
      this.newSpace = null;
      this.pathInput = typeof InputState?.new === 'function' ? InputState.new({ placeholder: 'Folder on that machine' }) : null;
      this.pathInput?.on?.('change', (_e, cx) => {
        const ns = this.newSpace;
        if (ns?.machine && ns.folder && this.pathInput.value().trim() !== ns.folder) {
          ns.folder = null; ns.check = null; ns.confirmUnverified = false; cx.notify();
        }
      });
      this.pathInput?.on?.('submit', (_e, cx) => { if (this.newSpace) this.checkFolder(this.pathInput.value(), cx); });
      // The inline form knows when its path field holds the keyboard, so the field keeps its keys.
      this.pathInput?.on?.('focus', () => { this.inputFocused = true; if (this.newSpace) { this.newSpaceCursor = 'new-space:path'; this.place('new-space:path'); } });
      this.pathInput?.on?.('blur', () => { this.inputFocused = false; });
      // D8: whether Herdr reports a machine ready right now, from a fresh machines().
      this.isReady = machine => machineAnchor(machine, this.controller.host.machines() ?? []) !== null;
      if (!app.checking()) cx.spawn(async cx => {
        for (;;) { if (await app.nextCommand() === 'focus') this.focus(cx); }
      });
      // A new arrival in Needs you pulses the bell once; the check reads the last drawn list.
      this.arrivals = new Arrivals(); this.pulseUntil = 0;
      // Git identity for worktree nesting: the stock panel's two read-only rev-parse
      // queries, probed in the background (never in render, never under check).
      const exec = options.exec ?? app.exec, readTextFile = options.readTextFile ?? app.readTextFile;
      const ticking = !app.checking() && typeof cx.timer?.every === 'function';
      if (ticking && (typeof exec === 'function' || typeof readTextFile === 'function')) {
        const now = () => this.controller.host.now();
        if (typeof exec === 'function') this.git = new GitIdentities({ exec, now, isReady: this.isReady });
        // Machine OS for the header icons: os-release through Herdr's read-only file API.
        if (typeof readTextFile === 'function') this.os = new MachineOs({ readTextFile, now, isReady: this.isReady });
        this.machineReady = new Map();
      }
      // One gentle 1s timer: the Needs you arrival check, and the Spaces probes when there are any.
      if (ticking) cx.timer.every(1000, cx => { this.reconcilePanel(cx); this.revealSpace(); this.watchArrivals(cx); if (this.machineReady) this.pollGit(cx); });
    }
    // Watch readiness in every tab; ask about Spaces' folders on ready machines while Spaces
    // is shown; redraw on answers.
    pollGit(cx) {
      const host = this.controller.host, machines = host.machines() ?? [];
      const ready = new Set(machines.filter(m => m?.layout === 'ready').map(m => m?.name ?? null));
      // D8: a disconnect is observed whatever tab is shown, and a machine that was ready and
      // is now not ready or missing from machines() counts as disconnected. Its queued and
      // running Git work is dropped. Coming back does not trigger a retry; unknown values
      // wait for the normal schedule.
      for (const [name, was] of this.machineReady) if (was && !ready.has(name)) this.git?.cancel(name);
      this.machineReady = new Map(machines.map(m => [m?.name ?? null, m?.layout === 'ready']));
      if (this.controller.state.view !== 'spaces') return;
      const panes = host.panes();
      const places = host.spaces().filter(sp => ready.has(sp?.machine ?? null))
        .map(sp => ({ machine: sp.machine ?? null, folder: spacePlace(sp, panes) }));
      const after = (ms, fn) => cx.timer.after(ms, fn);
      this.git?.request(places, after);
      // Only machines whose Core is connected are read, so a read never has to start one.
      const platform = typeof app.window === 'function' ? app.window()?.platform ?? null : null;
      this.os?.request([...ready], platform, after);
      const gitChanged = this.git?.takeChanged() ?? false, osChanged = this.os?.takeChanged() ?? false;
      if (gitChanged || osChanged) cx.notify();
    }
    focus(cx) { this.handle.focus(); cx.notify(); }
    reduceMotion() { return reducedMotion(typeof app.settings === 'function' ? app.settings() : null, readStored(storage)); }
    watchArrivals(cx) {
      if (!this.controller.projection) return;
      const pending = this.controller.projection.instances.filter(i => i.pinned && i.kind === 'terminal').map(i => i.identity);
      if (!this.arrivals.take(pending) || this.reduceMotion()) return;
      this.pulseUntil = this.controller.host.now() + PULSE.ms;
      cx.notify();
      // Then still: one redraw after the pulse draws the bell without it.
      cx.timer.after(PULSE.ms, cx => cx.notify());
    }
    async layoutAction(operation, cx) {
      if (app.checking()) return;
      try { await operation(); this.message = 'Agents slot updated'; } catch (e) { this.message = `Layout unchanged or incomplete: ${e.message}`; }
      cx.notify();
    }
    reveal(control) {
      if (control?.rowIndex != null) this.rowScroll.scroll_to_item(control.rowIndex);
      if (control?.optionIndex != null) this.optionsScroll.scroll_to_item(control.optionIndex);
      if (control?.pinnedIndex != null) this.pinnedScroll.scroll_to_item(control.pinnedIndex);
      if (control?.panelIndex != null) this.panelScroll.scroll_to_item(control.panelIndex);
    }
    // Render never changes state or asks for a redraw (GPUI throws on cx.notify() there).
    // Everything below that moves the cursor, scrolls or closes Details runs in an event.
    place(key) {
      this.controller.cursor = key;
      const index = this.controls.findIndex(control => control.key === key);
      this.cursorAt = index < 0 ? null : { key, index };
    }
    activeReader(projection = this.controller.projection) {
      const reader = this.reader;
      const i = projection?.instances.find(i => i.key === reader?.sourceKey);
      return reader && reader.state === JSON.stringify(this.controller.state)
        && rowAnchor(i, this.controller.feed.snapshot) === reader.anchor ? reader : null;
    }
    // The same event path owns all Roster disclosures. Native picker/dialogs stay native.
    dismissPanel(cx, restore = true) {
      const panel = this.panel;
      this.panel = null; this.reader = null; this.newSpace = null; this.toolsOpen = false;
      this.readerControls = []; this.inputFocused = false; this.newSpaceCursor = null;
      if (restore && panel) {
        const projection = this.controller.render();
        const available = this.controls.filter(control => !control.instance || projection.instances.some(i => i.key === control.instance.key));
        // A missing machine's old controls cannot receive a return.
        const ready = panel.kind !== 'folder' || machineAnchor(panel.machine, this.controller.host.machines());
        const key = returnControl(ready ? panel.returnKey : null, available);
        this.place(key);
        (this.triggerHandles.get(key) ?? this.handle).focus();
      }
      cx.notify();
    }
    beginPanel(kind, anchor, returnKey, cx, extra = {}) {
      if (!anchor) return false;
      const same = sameDisclosure(this.panel, kind, anchor);
      this.dismissPanel(cx, false);
      if (same) { this.place(returnKey); (this.triggerHandles.get(returnKey) ?? this.handle).focus(); return false; }
      for (const [key, handle] of this.triggerHandles) if (key !== 'mode:projects' && !this.controls.some(control => control.key === key)) { handle.release?.(); this.triggerHandles.delete(key); }
      if (!this.triggerHandles.has(returnKey)) this.triggerHandles.set(returnKey, cx.focus_handle());
      this.panelRead = 0;
      this.panel = { kind, anchor, returnKey, ...extra };
      return true;
    }
    reconcilePanel(cx) {
      if (!this.panel) return;
      const projection = this.controller.render();
      if ((this.reader && !this.activeReader(projection)) || (this.newSpace && !this.activeNewSpace())) this.invalidatePanel(cx);
    }
    invalidatePanel(cx) {
      // Only actual native focus (or the input's focus event) authorizes a focus return.
      const held = this.inputFocused || this.handle.is_focused?.() === true
        || [...this.triggerHandles.values()].some(handle => handle.is_focused?.() === true);
      this.dismissPanel(cx, false); this.place('mode:projects');
      if (held) this.triggerHandles.get('mode:projects').focus();
    }
    activeNewSpace() {
      return this.newSpace && this.controller.state.view === 'spaces'
        && machineAnchor(this.newSpace.machine, this.controller.host.machines()) === this.newSpace.anchor;
    }
    openNewSpace(machine, cx, returnKey = 'spaces:new') {
      machine = machine ?? null;
      const anchor = machineAnchor(machine, this.controller.host.machines());
      if (!this.beginPanel('folder', anchor, returnKey, cx, { machine })) return;
      this.newSpace = { machine, anchor, returnKey, folder: null, check: null, confirmUnverified: false };
      this.pathInput?.set_value?.('');
      // The real input keeps editing keys; Tab can leave the inline form for surrounding rows.
      this.newSpaceCursor = machine && this.pathInput ? 'new-space:path' : 'new-space:pick';
      this.place(this.newSpaceCursor);
      if (machine && this.pathInput) { this.inputFocused = true; this.pathInput.focus?.(); }
      cx.notify();
    }
    closeNewSpace(cx) { this.dismissPanel(cx); }
    placeNewSpace(control, cx) {
      this.newSpaceCursor = control.key; this.place(control.key);
      if (control.input) this.pathInput?.focus?.();
      else { this.inputFocused = false; this.handle.focus(); }
      cx.notify();
    }
    // This computer: Herdr's native folder picker.
    async chooseLocalFolder(cx) {
      const pick = options.pickFolder ?? app.pickFolder;
      const ns = this.newSpace;
      if (typeof pick !== 'function' || !ns || !this.activeNewSpace()) return;
      let folder;
      try { folder = await pick({ prompt: 'Open as Space' }); }
      catch { if (this.newSpace === ns) { this.message = 'Folder picker unavailable'; cx.notify(); } return; }
      if (folder && this.newSpace === ns && this.activeNewSpace()) this.checkFolder(folder, cx); else cx.notify();
    }
    // Verify with the two read-only identity queries; a negative answer is "Not verified".
    checkFolder(folder, cx) {
      const ns = this.newSpace, target = typeof folder === 'string' ? folder.trim() : '';
      if (!ns || !this.activeNewSpace()) return;
      if (!target || /[\x00-\x1f\x7f]/.test(target)) {
        Object.assign(ns, { folder: null, check: null, confirmUnverified: false });
        this.message = 'Choose a nonempty folder without control characters'; cx.notify(); return;
      }
      Object.assign(ns, { folder: target, check: { status: 'checking' }, confirmUnverified: false });
      cx.notify();
      const exec = options.exec ?? app.exec;
      if (typeof exec !== 'function') { ns.check = { status: 'unsure' }; cx.notify(); return; }
      cx.spawn(async cx => {
        const result = await verifyFolder(exec, ns.machine, target, (ms, fn) => cx.timer.after(ms, fn), 12000, this.isReady);
        if (this.newSpace === ns && ns.folder === target) {
          if (!this.activeNewSpace()) this.dismissPanel(cx, false);
          else { ns.check = result; cx.notify(); }
        }
      });
    }
    createSpace(cx, ns = this.newSpace, folder = ns?.folder, confirmed = false) {
      if (app.checking() || this.newSpace !== ns || !this.activeNewSpace()
        || (ns.machine && this.pathInput && this.pathInput.value().trim() !== folder)
        || !folderActionAllowed(ns, machineAnchor(ns?.machine, this.controller.host.machines()), folder, confirmed)) return;
      this.controller.host.run('space.new', { machine: ns.machine ?? '', folder });
      this.closeNewSpace(cx);
    }
    openExistingSpace(ns, folder, existing, expectedAnchor, cx) {
      if (app.checking() || this.newSpace !== ns || !this.activeNewSpace()
        || (ns.machine && this.pathInput && this.pathInput.value().trim() !== folder)
        || !folderActionAllowed(ns, machineAnchor(ns.machine, this.controller.host.machines()), folder)) return;
      this.controller.observe();
      const snapshot = this.controller.feed.snapshot;
      const current = matchingSpace(ns.machine, ns.check.top, snapshot.spaces, snapshot.panes, (m, f) => this.git?.lookup(m, f) ?? null);
      if (!current || current.id !== existing.id || spaceAnchor(current, snapshot.panes) !== expectedAnchor) return;
      this.controller.host.run('space.select', { id: current.id }); this.closeNewSpace(cx);
    }
    openDetails(control, cx) {
      if (!control?.instance) return;
      const projection = this.controller.render();
      const instance = projection.instances.find(i => i.key === control.instance.key);
      const anchor = rowAnchor(instance, this.controller.feed.snapshot);
      if (!anchor || (control.anchor && anchor !== control.anchor)) return;
      if (!this.beginPanel('details', anchor, control.key, cx)) return;
      this.reader = { sourceKey: instance.key, returnKey: control.key, anchor,
        state: JSON.stringify(this.controller.state), technical: false };
      this.readerCursor = 'details:close'; this.place('details:close'); this.readerControls = [];
      cx.notify();
    }
    closeDetails(cx, returnToOrigin = true) { if (this.reader) this.dismissPanel(cx, returnToOrigin); }
    key(event, cx) {
      const chord = event.keystroke;
      const previousPanel = this.panel;
      this.reconcilePanel(cx);
      if (chord === 'escape' && previousPanel && !this.panel) { this.place('mode:projects'); this.triggerHandles.get('mode:projects').focus(); cx.stop_propagation(); cx.notify(); return; }
      if (chord === 'escape' && this.panel) { cx.stop_propagation(); this.dismissPanel(cx); return; }
      if (this.inputFocused && chord !== 'tab' && chord !== 'shift-tab') return;
      if (this.panel && ['home', 'end', 'pageup', 'pagedown'].includes(chord)) {
        const total = this.panelItems ?? 0;
        this.panelRead = chord === 'home' ? 0 : chord === 'end' ? Math.max(0, total - 1)
          : Math.max(0, Math.min(total - 1, (this.panelRead ?? 0) + (chord === 'pageup' ? -1 : 1)));
        (this.toolsOpen ? this.optionsScroll : this.panelScroll).scroll_to_item(this.panelRead); cx.stop_propagation(); return;
      }
      if (chord === 'd') {
        const selected = this.controls.find(i => i.key === this.controller.cursor);
        if (!selected?.instance) return;
        cx.stop_propagation(); this.openDetails(selected, cx); return;
      }
      if (!['up', 'down', 'tab', 'shift-tab', 'enter', 'space'].includes(chord)) return;
      cx.stop_propagation();
      const c = this.controller, controls = this.controls, count = controls.length;
      if (chord === 'enter' || chord === 'space') controls.find(i => i.key === c.cursor)?.activate(cx);
      else if (count) {
        const index = controls.findIndex(i => i.key === c.cursor), step = ['up', 'shift-tab'].includes(chord) ? -1 : 1;
        let next;
        if (index >= 0) next = (index + step + count) % count;
        else if (this.cursorAt?.key === c.cursor && this.cursorAt.index != null) {
          const at = Math.min(this.cursorAt.index, count - 1);
          next = step > 0 ? at : Math.max(0, Math.min(this.cursorAt.index, count) - 1);
        } else next = step > 0 ? 0 : count - 1;
        const control = controls[next];
        this.place(control.key); this.newSpaceCursor = control.key; this.readerCursor = control.key;
        if (control.input) this.pathInput?.focus?.();
        else { this.inputFocused = false; this.handle.focus(); }
        this.reveal(control);
      }
      cx.notify();
    }
    // A bounded shared inline surface. It is a sibling below its trigger, never absolute.
    disclosure(id, theme, { v, muted }, height = 112) {
      return v().id(id).h(height).flex_none().min_w(0).min_h(0).overflow_y_scrollbar().track_scroll(this.panelScroll)
        .p(6).gap(3).rounded(6).bg(theme.raised ?? theme.surface).border(1).border_color(theme.border ?? muted)
        .on_click((_e, cx) => cx.stop_propagation());
    }
    // Herdr's Spaces, in the stock list's order and look. A click selects the Space natively.
    renderSpaces(body, theme, { click, change, labelText, h, fg, muted, groupHeader }) {
      const c = this.controller, snapshot = c.feed.snapshot ?? {};
      const colors = typeof app.shared === 'function' ? app.shared('space.colors') ?? {} : {};
      const identityOf = space => this.git?.lookup(space.machine ?? null, spacePlace(space, snapshot.panes)) ?? null;
      const rows = spaceRows({ spaces: snapshot.spaces, machines: snapshot.machines }, { colors, folds: c.state.folds, identityOf });
      // The list scrolls by its direct children; count them to find the active row's place.
      let drawn = 0, activeAt = -1, activeId = null;
      const add = element => { body.child(element); drawn++; };
      if (this.activeNewSpace() && !rows.some(row => row.kind === 'machine' && row.machine === this.newSpace.machine)) {
        const before = this.controls.length;
        add(this.renderNewSpace(theme, { labelText, h, v: () => v_flex(), fg, muted }));
        for (const control of this.controls.slice(before)) control.rowIndex = drawn - 1;
      }
      for (const row of rows) {
        if (row.kind === 'machine') {
          // As in the stock list: icon, name, state when not connected, then +, the
          // connection dot and the fold chevron last.
          const before = this.controls.length;
          const trigger = 'machine-add:' + row.key;
          const dim = theme.dim ?? muted, newSpace = cx => this.openNewSpace(row.machine, cx, trigger);
          // The OS icon when known (PRETTY_NAME in the tooltip), else the generic machine icon.
          const os = this.os?.lookup(row.machine) ?? null;
          const extras = [];
          if (!row.ready) extras.push(div().id('machine-note:' + row.key).flex_none().child(row.loading ? 'loading' : 'not connected'));
          else extras.push(click(trigger, 'Open folder as Space on ' + row.label, newSpace).flex_none().px(4).rounded(4).cursor_pointer()
            .hover(el => el.bg(theme.hover ?? theme.raised).text_color(fg)).tooltip('New space on ' + (row.machine ?? 'this computer'))
            .accessibility_label('New space on ' + row.label)
            .child('+'));
          extras.push(div().id('machine-state:' + row.key).size(6).rounded(3).flex_none().bg(row.ready ? theme.ansi2 ?? theme.working ?? fg : dim));
          const header = groupHeader(row.key, row.label + (row.collapsed ? ', folded' : ''), row.label,
            change({ type: 'fold', key: row.key, collapsed: !row.collapsed }),
            { icon: os?.icon ?? (row.machine ? 'server' : 'monitor'), collapsed: row.collapsed, extras, first: row === rows[0],
              tooltip: [row.label, os?.tooltip, row.machine ? (row.ready ? 'connected' : row.loading ? 'loading' : 'not connected') : null].filter(Boolean).join(' · ') });
          const headerControl = this.controls.pop();
          this.controls.splice(row.ready ? this.controls.length - 1 : this.controls.length, 0, headerControl);
          const block = v_flex().id('machine-block:' + row.key).flex_none().min_w(0).child(header);
          if (this.activeNewSpace() && this.newSpace.machine === row.machine) block.child(this.renderNewSpace(theme, { labelText, h, v: () => v_flex(), fg, muted }));
          for (const control of this.controls.slice(before)) control.rowIndex = drawn;
          add(block);
          if (!row.collapsed && row.count === 0 && row.ready) { add(click('spaces:new:' + machineKey(row.machine), 'New space on ' + row.label, cx => this.openNewSpace(row.machine, cx, 'spaces:new:' + machineKey(row.machine)))
            .h(28).flex_none().px(8).gap(7).rounded(7).text_size(12).text_color(dim).cursor_pointer()
            .hover(el => el.bg(theme.hover ?? theme.raised).text_color(fg)).child(icon('plus', 12)).child('New space there')); this.controls.at(-1).rowIndex = drawn - 1; }
          continue;
        }
        const element = click(row.key, 'Space ' + row.name + (row.machine ? ' on ' + row.machine : '') + (row.tree ? ', worktree' : '') + (row.active ? ', shown' : ''),
          () => c.host.run('space.select', { id: row.id })).h(row.tree ? 28 : 30).flex_none().gap(9).cursor_pointer().tooltip(row.name);
        if (row.active) element.bg(theme.selected ?? theme.raised);
        else element.hover(el => el.bg(theme.hover ?? theme.raised));
        // A linked worktree sits indented under its main checkout with a branch mark, as in stock.
        if (row.tree) element.pl(30).child(icon('branch', 13).id('space-tree:' + row.id).text_color(theme.dim ?? muted));
        else element.child(h().id('space-avatar:' + row.id).w(18).h(18).flex_none().justify_center().rounded(5).bg(spaceFill(row.color, theme))
            .child(div().text_size(10.5).font_bold().text_color('#ffffff').child(row.initial)));
        element.child(labelText(row.name, 12, fg).id('space-name:' + row.id).flex_1());
        // The tail: repository · branch, then separate marks for what needs a commit (pencil),
        // a push (↑n) or an update from upstream (↓n); zeros and unknowns are not drawn.
        const tail = row.tail ?? { text: row.branch };
        if (tail.text) element.child(labelText(tail.text, 11, muted).id('space-branch:' + row.id).flex_none().max_w(130));
        if (tail.dirty || tail.ahead || tail.behind) {
          const marks = h().id('space-git:' + row.id).flex_none().gap(5).text_size(11.5).tooltip(tail.tooltip).accessibility_label(tail.tooltip);
          // Uncommitted changes: a small pencil; dots belong to machine headers (Core connection).
          if (tail.dirty) marks.child(icon('pencil', 11).id('space-dirty:' + row.id).text_color(theme.ansi3 ?? theme.accent ?? fg));
          if (tail.ahead) marks.child(div().id('space-ahead:' + row.id).text_color(theme.ansi2 ?? theme.working ?? fg).child('↑' + tail.ahead));
          if (tail.behind) marks.child(div().id('space-behind:' + row.id).text_color(theme.ansi1 ?? theme.blocked ?? fg).child('↓' + tail.behind));
          element.child(marks);
        }
        this.controls.at(-1).rowIndex = drawn;
        if (row.active) { activeAt = drawn; activeId = row.id; }
        add(element);
      }
      if (!rows.length) body.child(labelText('No Spaces', 12, muted).p(6));
      // Render output consumed by the next event, like controls. Opening a panel never
      // sends a scroll request. An actual active-Space change can reveal itself on the timer.
      this.spaceReveal = { id: activeId, at: activeAt };
    }
    revealSpace() {
      const next = this.spaceReveal;
      if (!next || this.panel || (next.id === this.revealed?.id && next.at === this.revealed?.at)) return;
      this.revealed = next;
      if (next.at >= 0) this.rowScroll.scroll_to_item(next.at);
    }
    renderNewSpace(theme, { labelText, h, v, fg, muted }) {
      const c = this.controller, ns = this.newSpace, snapshot = c.feed.snapshot ?? {};
      this.readerControls = [];
      let panelIndex = 0;
      labelText = (value, size, color = fg) => div().min_w(0).flex_none().whitespace_normal().text_size(size).text_color(color).child(panelText(value));
      const control = (key, label, text, activate, color = fg) => {
        const owner = this.panel;
        const guarded = cx => { this.reconcilePanel(cx); if (this.panel === owner) activate(cx); };
        const item = { key, label, activate: guarded, panelIndex };
        this.readerControls.push(item); this.controls.push(item);
        return h().id(key).min_h(22).flex_none().px(6).rounded(4).accessibility_label(label).tooltip(label).cursor_pointer()
          .bg(this.newSpaceCursor === key && !this.inputFocused ? theme.selected ?? theme.hover ?? theme.surface : theme.raised ?? theme.surface)
          .hover(el => el.bg(theme.hover ?? theme.selected ?? theme.surface))
          .on_click((_e, cx) => { cx.stop_propagation(); this.newSpaceCursor = key; this.place(key); this.focus(cx); guarded(cx); }).min_w(0).child(div().min_w(0).flex_1().whitespace_normal().text_size(12).text_color(color).child(panelText(text)));
      };
      const drawnFolder = ns.folder, drawnCheck = ns.check;
      const machineLabel = ns.machine ?? 'This computer';
      const shown = folder => ns.machine ? folder : homeRelative(folder, typeof app.home === 'function' ? app.home() : null, true);
      const box = this.disclosure('roster-new-space', theme, { v, muted }).accessibility_label('Open folder as Space');
      const append = el => { box.child(el); panelIndex++; return box; };
      append(h().h(22).flex_none().gap(6).child(labelText('Open folder as Space', 12, fg).font_semibold().flex_1())
        .child(control('new-space:cancel', 'Cancel (Esc): nothing is created', 'Cancel', cx => this.closeNewSpace(cx))));
      append(div().min_w(0).flex_none().whitespace_normal().text_size(12).child(panelText('Machine: ' + machineLabel)).id('new-space:machine'));
      if (!ns.machine) append(control('new-space:pick', 'Choose a folder on this computer', 'Choose folder…', cx => { this.chooseLocalFolder(cx); }));
      else {
        // A typed path on that machine, or one of the folders Herdr already reports there.
        if (this.pathInput) { const input = { key: 'new-space:path', label: 'Folder on ' + machineLabel, input: true, panelIndex, activate: () => this.pathInput.focus?.() }; this.readerControls.push(input); this.controls.push(input); }
        if (this.pathInput) append(h().flex_none().gap(4).child(Input.new(this.pathInput).id('new-space:path').h(24).min_w(0).flex_1().text_size(12))
          .child(control('new-space:check', 'Check this folder on ' + machineLabel, 'Check', cx => this.checkFolder(this.pathInput.value(), cx))));
        const tops = [...(this.git?.cache ?? new Map()).entries()].filter(([key, e]) => JSON.parse(key)[0] === ns.machine && e.status === 'repo').map(([, e]) => e.top);
        const suggestions = folderSuggestions(ns.machine, snapshot.panes, tops);
        if (suggestions.length) append(labelText('Folders on ' + machineLabel, 10, muted));
        suggestions.forEach((folder, n) => append(control('new-space:suggest:' + n, 'Use ' + folder, folder, cx => { this.pathInput?.set_value?.(folder); this.checkFolder(folder, cx); }, muted)));
      }
      if (ns.folder) {
        append(div().min_w(0).flex_none().text_size(12).child(panelText('Folder: ' + shown(ns.folder))).id('new-space:folder').whitespace_normal());
        const check = ns.check ?? { status: 'checking' };
        if (check.status === 'checking') append(labelText('Checking…', 11, muted).id('new-space:status'));
        else if (check.status === 'repo') {
          append(div().min_w(0).flex_none().text_size(11).text_color(muted).child(panelText('Verified checkout: ' + shown(check.top))).id('new-space:status').whitespace_normal());
          const existing = matchingSpace(ns.machine, check.top, snapshot.spaces, snapshot.panes, (m, f) => this.git?.lookup(m, f) ?? null);
          if (existing) {
            append(control('new-space:open-existing', 'Open the existing Space ' + existing.name, 'Open existing Space “' + existing.name + '”', cx => {
              if (ns.check === drawnCheck) this.openExistingSpace(ns, drawnFolder, existing, spaceAnchor(existing, snapshot.panes), cx); }));
            append(control('new-space:duplicate', 'Create another Space for the same checkout', 'Create another Space here', cx => { if (ns.check === drawnCheck) this.createSpace(cx, ns, drawnFolder); }, muted));
          } else append(control('new-space:create', 'Create a Space on ' + machineLabel + ' in this folder', 'Create Space', cx => { if (ns.check === drawnCheck) this.createSpace(cx, ns, drawnFolder); }));
        } else {
          // Git said no or could not answer: that does not mean the folder is missing.
          append(labelText('Not verified: Git did not confirm a checkout here; the folder may still exist.', 11, muted).id('new-space:status').whitespace_normal());
          if (!ns.confirmUnverified) append(control('new-space:unverified', 'Create a Space in a folder that is not verified', 'Create in unverified folder…',
            cx => { ns.confirmUnverified = true; cx.notify(); }, muted));
          else { append(labelText('Create a Space on ' + machineLabel + ' in ' + shown(ns.folder) + ' anyway?', 11, fg).id('new-space:confirm-text').whitespace_normal());
            append(control('new-space:confirm', 'Create the Space in the unverified folder', 'Create anyway', cx => { if (ns.check === drawnCheck) this.createSpace(cx, ns, drawnFolder, true); })); }
        }
      }
      this.panelItems = panelIndex;
      return box;
    }
    renderDetails(reader, projection, theme, { labelText, h, v, fg, muted }) {
      const c = this.controller;
      this.readerControls = [];
      let panelIndex = 0;
      labelText = (value, size, color = fg) => div().min_w(0).flex_none().whitespace_normal().text_size(size).text_color(color).child(panelText(value));
      const control = (key, label, text, activate, color = fg) => {
        const owner = this.panel;
        const guarded = cx => { this.reconcilePanel(cx); if (this.panel === owner) activate(cx); };
        const item = { key, label, activate: guarded, panelIndex };
        this.readerControls.push(item); this.controls.push(item);
        return h().id(key).min_h(22).flex_none().px(6).rounded(4).accessibility_label(label).tooltip(label)
          .bg(this.readerCursor === key ? theme.selected ?? theme.raised : theme.raised ?? theme.surface)
          .hover(el => el.bg(theme.hover ?? theme.selected ?? theme.surface))
          // Panel actions stop propagation; row activation is a separate sibling.
          .on_click((_e, cx) => { cx.stop_propagation(); this.readerCursor = key; this.place(key); this.focus(cx); guarded(cx); })
          .min_w(0).child(div().min_w(0).flex_1().whitespace_normal().text_size(12).text_color(color).child(panelText(text)));
      };
      const box = this.disclosure('roster-details', theme, { v, muted }, projection.instances.some(i => i.key === reader.sourceKey && i.pinned) ? 96 : 112).accessibility_label('Agent details');
      const append = el => { box.child(el); panelIndex++; return box; };
      append(h().h(22).flex_none().gap(6)
        .child(labelText('Agent details', 12, fg).font_semibold().flex_1())
        .child(control('details:close', 'Close agent details (Esc)', '×', cx => this.closeDetails(cx))));
      const instance = projection.instances.find(i => i.kind === 'terminal' && i.key === reader.sourceKey);
      if (!instance) return append(labelText('This agent is no longer listed.', 12, muted));
      const facts = agentFacts(instance, { snapshot: c.feed.snapshot ?? {}, rows: c.feed.reduced.rows,
        home: typeof app.home === 'function' ? app.home() : null });
      // Label and full value; values wrap and are never cut.
      const line = (field, size = 12, color = fg) => {
        const value = field.href
          ? control('details:link', 'Open ' + field.label + ' ' + field.value, field.value, cx => cx.open_url(field.href), theme.accent ?? fg).w_full()
          : div().min_w(0).flex_none().whitespace_normal().text_size(size).text_color(color).accessibility_label(field.value).child(panelText(field.value));
        return v().id('detail:' + field.id).min_h(18).min_w(0).flex_none().gap(1)
          .child(div().flex_none().text_size(11).text_color(muted).child(field.label)).child(value);
      };
      for (const field of facts.fields) append(line(field));
      // The terminal action passes the same click-time check as the row.
      if (instance.navigation.enabled) append(control('details:go', 'Go to terminal: ' + instance.row.displayLabel, 'Go to terminal', cx => {
        const plan = c.activate(projection, instance.key);
        if (plan.enabled) this.closeDetails(cx, false);
        else { this.message = reasonText(plan.reason); this.openMessage = true; cx.notify(); }
      }));
      else append(labelText(actionReason(instance), 11, muted).id('details:unavailable').whitespace_normal());
      append(control('details:technical', (reader.technical ? 'Hide' : 'Show') + ' technical details',
        (reader.technical ? '▾ ' : '▸ ') + 'Technical details', cx => { reader.technical = !reader.technical; cx.notify(); }, muted));
      if (reader.technical) for (const field of facts.technical) append(line(field, 11, muted));
      this.panelItems = panelIndex;
      return box;
    }
    render(cx) {
      const projection = this.controller.render(), theme = app.theme(), props = app.props();
      const c = this.controller;
      // this.controls is this render's output: the callbacks key events use. Nothing else is written.
      this.controls = [];
      const parents = new Set(c.feed.reduced.rows.map(r => r.parent?.associationKey).filter(Boolean));
      const fg = theme.foreground ?? theme.text;
      const muted = theme.muted ?? fg;
      const v = () => v_flex();
      const h = () => h_flex().items_center();
      const labelText = (value, size, color = fg) => div().min_w(0).truncate().text_size(size).text_color(color).child(value);
      const click = (key, label, activate, column = false) => {

        this.controls.push({ key, label, activate });
        const element = (column ? v() : h()).id(key).min_w(0).px(6).rounded(4).accessibility_label(label)
          .bg(c.cursor === key ? theme.selected ?? theme.raised : theme.surface)
          .on_click((_e, cx) => { cx.stop_propagation(); this.place(key); this.focus(cx); activate(cx); });
        if (this.triggerHandles.has(key)) element.track_focus(this.triggerHandles.get(key));
        return element;
      };
      const button = (key, label, activate, { active = false, text = label } = {}) => {
        const element = click(key, label, activate).h(24).flex_none().tooltip(label);
        if (active && c.cursor !== key) element.bg(theme.raised);
        const content = labelText(text, 12, active ? theme.accent ?? fg : fg);
        if (active) content.font_semibold();
        return element.child(content);
      };
      // A state change discards the old callbacks until the next render draws new ones.
      const dim = theme.dim ?? muted;
      // The stock group header: 26px, 11px dim text, optional leading icon, extras, chevron last.
      // Machine headers in Spaces pass a larger, semibold title and an 18px icon; the +, dot and
      // chevron keep the header's own 11px size and stay aligned.
      // The one group header for Spaces, Projects and Status. The Spaces machine header is the
      // reference: 30px, an 18px leading icon (a shipped icon name, or an element such as a
      // Space's initial or the Working ring), a 13px bold title in full contrast whether
      // folded or not, then a right-aligned tail: view-specific extras, a count, and the
      // chevron (or an empty slot of its size where a group never folds). The header's own
      // 11px size and dim color reach only the tail.
      const HEADER = { height: 30, iconSize: 18, titleSize: 13, chevron: 11, gapAbove: 8 };
      const groupHeader = (key, label, title, activate, { icon: lead = null, collapsed = false, foldable = true, extras = [], tooltip = label, depth = 0,
        count = null, first = false } = {}) => {
        const head = click(key, label, activate).h(HEADER.height).mt(first ? 0 : HEADER.gapAbove).flex_none().px(8).pl(8 + Math.min(depth, 3) * 8).gap(7)
          .text_size(11).text_color(dim).cursor_pointer().hover(el => el.bg(theme.hover ?? theme.raised)).tooltip(tooltip);
        const leadEl = typeof lead === 'string' ? icon(lead, HEADER.iconSize) : lead;
        if (leadEl) head.child(leadEl.id('group-icon:' + key));
        head.child(labelText(title, HEADER.titleSize, fg).id('group-label:' + key).font_bold().flex_1());
        for (const extra of extras) head.child(extra);
        if (count != null) head.child(div().id('group-count:' + key).flex_none().text_size(11).text_color(dim).child(String(count)));
        head.child(foldable ? icon(collapsed ? 'chevron-right' : 'chevron-down', HEADER.chevron).id('group-chevron:' + key)
          : div().id('group-chevron:' + key).w(HEADER.chevron).h(HEADER.chevron).flex_none());
        return head;
      };
      // An element in the 18px icon box: a Space's colored initial, or the live Working spinner.
      const leadBox = () => h().w(HEADER.iconSize).h(HEADER.iconSize).flex_none().justify_center();
      const spaceInitial = space => {
        const colors = typeof app.shared === 'function' ? app.shared('space.colors') ?? {} : {};
        const name = typeof space.name === 'string' && space.name.trim() ? space.name.trim() : space.id;
        return leadBox().rounded(5).bg(spaceFill(typeof colors[space.id] === 'string' ? colors[space.id] : 'ansi6', theme))
          .child(div().text_size(10.5).font_bold().text_color('#ffffff').child((Array.from(name)[0] ?? '?').toUpperCase()));
      };
      // Color helps but is never the only signal: every header also names its status.
      const STATUS_COLORS = { 'Needs you': theme.blocked, 'Child needs you': theme.blocked, Working: theme.working, Done: theme.done,
        Idle: theme.idle, Unknown: theme.unknown };
      const still = this.reduceMotion();
      const statusIcon = label => {
        const el = icon(STATUS_ICONS[label] ?? 'help-circle', HEADER.iconSize).text_color(STATUS_COLORS[label] ?? dim);
        return label === 'Working' && !still ? el.spin(1200) : el;
      };
      const change = event => cx => { if (!this.toolsOpen) this.dismissPanel(cx, false); this.controls = []; c.change(event); cx.notify(); };
      const viewMode = c.state.view;
      const root = v().id('roster').size_full().p(5).gap(3).bg(theme.surface).text_color(fg).text_size(12)
        .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx));
      const toolbar = h().id('roster-toolbar').h(26).flex_none().gap(3);
      toolbar.child(button('mode:spaces', 'Spaces', change({ type: 'view', view: 'spaces' }), { active: viewMode === 'spaces' }))
        .child(button('mode:projects', 'Projects', change({ type: 'view', view: 'projects' }), { active: viewMode === 'projects' }))
        .child(button('mode:status', 'Status', change({ type: 'view', view: 'status' }), { active: viewMode === 'status' }))
        .child(div().flex_1().min_w(0));
      // The stock Spaces title's +: a new Space, Herdr choosing where, as space.new does.
      // The toolbar + preselects the machine of the Space that is shown.
      if (viewMode === 'spaces') toolbar.child(button('spaces:new', 'Open folder as Space', cx => this.openNewSpace(
        (c.feed.snapshot?.spaces ?? []).find(sp => sp?.active)?.machine ?? null, cx), { text: '+' })
        .w(24).px(0).justify_center().cursor_pointer());
      const settingsOpen = this.toolsOpen;
      let tools = null;
      const filtered = c.state.coreIds !== null || c.state.contextIds !== null;
      toolbar.child(button('tools:toggle', (settingsOpen ? 'Hide' : 'Show') + ' filters and Agents slot controls' + (filtered ? ' (filters active)' : ''),
        cx => { const open = this.beginPanel('options', 'options', 'tools:toggle', cx); this.controls = []; this.toolsOpen = open; cx.notify(); }, { active: settingsOpen || filtered, text: filtered ? 'Options •' : 'Options' }));
      if (!this.reading && this.controller.feed.evidence.admissions?.length) {
        cx.spawn(async cx => { if (this.reading) return; this.reading = true;
          try { if (await this.controller.refresh(p => timerDeadline(cx, p))) cx.notify(); } finally { this.reading = false; } });
      }
      const reader = this.activeReader(projection);
      if ((this.reader && !reader) || (this.newSpace && !this.activeNewSpace())) {
        const stale = this.panel;
        cx.spawn(async cx => { if (this.panel === stale) this.invalidatePanel(cx); });
      }
      if (settingsOpen) {
        tools = this.disclosure('roster-options', theme, { v, muted }, 52).p(0).gap(2).track_scroll(this.optionsScroll);
        let optionIndex = 0;
        const option = (key, label, activate, { active = false, text = label } = {}) => {
          const element = click(key, label, activate).min_h(24).flex_none().tooltip(label)
            .child(div().min_w(0).flex_1().whitespace_normal().text_size(12)
              .text_color(active ? theme.accent ?? fg : fg).child(panelText(text)));
          if (active && c.cursor !== key) element.bg(theme.raised);
          tools.child(element);
          this.controls.at(-1).optionIndex = optionIndex++;
        };
        for (const [field, title, getId] of [['coreIds', 'Machine', r => r.core.verified ? r.core.id : null], ['contextIds', 'Context', r => r.executionContext.id]]) {
          const ids = new Set(c.feed.reduced.rows.map(getId));
          const selected = c.state[field];
          // A singleton (including unknown) is equivalent to All unless a filter is already set.
          if (ids.size <= 1 && selected === null) continue;
          option('all:' + field, title + ': all', change({ type: 'filters', [field]: null }), { active: selected === null });
          for (const id of ids) option('filter:' + field + ':' + (id === null ? 'null' : 'value:' + id), title + ': ' + (id ?? 'unknown'),
            change({ type: 'filters', [field]: [id] }), { active: selected?.includes(id) });
        }
        option('motion:toggle', still ? 'Motion: reduced (status icons stay still)' : 'Motion: on (Working turns, a new Needs you pulses once)', cx => {
          writeStored(storage, still ? 'full' : 'reduce'); this.pulseUntil = 0; cx.notify();
        }, { active: still, text: still ? 'Motion: reduced' : 'Motion: on' });
        option('layout:select', 'Choose an existing Agents slot…', cx => {
          if (app.checking()) return;
          try { this.selection = this.optIn.inspect(); this.message = this.selection.slots.length ? 'Select the Agents slot to replace in a new layout copy' : 'No existing Agents slot'; }
          catch (e) { this.message = e.message; } cx.notify();
        });
        for (const slot of this.selection?.slots ?? []) option('layout:enable:' + slot.id, 'Use Roster in ' + slot.id, cx => {
          const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          cx.spawn(async cx => this.layoutAction(() => this.optIn.enable(this.selection, slot.id, token, p => timerDeadline(cx, p)), cx));
        });
        if (props?.rosterToken) option('layout:undo', 'Restore Agents in this slot', cx => {
          cx.spawn(async cx => this.layoutAction(() => this.optIn.undo(props.rosterToken, p => timerDeadline(cx, p)), cx));
        });
        this.panelItems = optionIndex;
        tools.h(Math.min(52, optionIndex * 24 + Math.max(0, optionIndex - 1) * 2));
      }
      const body = v().id('roster-rows').flex_1().min_h(0).gap(3).overflow_y_scrollbar().track_scroll(this.rowScroll);
      // Needs you, pinned above the tabs and outside their list: the same section in every
      // view, drawn only while something is pending. Its rows scroll on their own past three.
      const PINNED = { row: 44, gap: 3, shown: 3 };
      const pinnedCount = projection.instances.filter(i => i.pinned && i.kind === 'terminal').length;
      // Capture the initial drawn attention list; its task establishes the baseline after render.
      if (this.arrivals.seen === null) {
        const pending = projection.instances.filter(i => i.pinned && i.kind === 'terminal').map(i => i.identity);
        cx.spawn(async () => { if (this.arrivals.seen === null) this.arrivals.take(pending); });
      }
      const shown = Math.min(pinnedCount, PINNED.shown);
      const pinnedRows = v().id('roster-needs-rows').flex_none().gap(PINNED.gap).overflow_y_scrollbar().track_scroll(this.pinnedScroll)
        .h(Math.min(144, shown * PINNED.row + Math.max(0, shown - 1) * PINNED.gap + (reader && projection.instances.some(i => i.pinned && i.key === reader.sourceKey) ? 115 : 0)));
      const pinned = v().id('roster-needs-you').flex_none().gap(2).pb(4).border_b(1).border_color(theme.border ?? theme.raised ?? muted);
      // Each instance is one direct child of its list; these count them for scrolling.
      let bodyAt = 0, pinnedAt = 0;
      const place = (i, element) => {
        if (i.kind === 'terminal') {
          element = v().id('inline:' + i.key).flex_none().min_w(0).child(element);
          if (reader?.sourceKey === i.key) {
            const before = this.controls.length;
            element.child(this.renderDetails(reader, projection, theme, { labelText, h, v, fg, muted }));
            for (const control of this.controls.slice(before)) Object.assign(control, slot(i));
          }
        }
        if (i.pinned) { pinnedRows.child(element); pinnedAt++; } else { body.child(element); bodyAt++; }
      };
      const slot = i => i.pinned ? { pinnedIndex: pinnedAt, pinned: true } : { rowIndex: bodyAt };
      let section = null, firstHeader = true;
      for (const i of projection.instances) {
        if (i.kind === 'section' && i.pinned) {
          section = i;
          const bell = leadBox().child(statusIcon('Needs you'));
          if (!still && this.pulseUntil > c.host.now()) bell.loop('opacity', { from: PULSE.from, to: PULSE.to, period: PULSE.period });
          pinned.child(groupHeader(i.key, 'Needs you, ' + i.counts.needsYou, 'Needs you', () => {},
            { icon: bell, foldable: false, count: i.counts.needsYou, tooltip: 'Needs you: pending in any Space, on any machine' }).cursor_default());
          this.controls.at(-1).pinned = true;
          continue;
        }
        if (i.kind === 'section') {
          section = i;
          const count = i.label === 'Working' ? i.counts?.working : i.label === 'Needs you' ? i.counts?.needsYou : i.counts?.identities ?? i.count;
          const title = i.label;
          const foldable = true;
          // The leading icon says what kind of group it is. Working's is the one live
          // indicator: a native spinner, decoration rather than a control.
          const lead = viewMode === 'status' ? statusIcon(i.label)
            : i.space ? spaceInitial(i.space) : i.label === 'Done' ? 'check-circle' : i.label === 'Unidentified' ? 'terminal'
            : i.label === 'Infrastructure' ? 'server' : i.repository ? 'branch' : 'folder';
          // A Space group is named as a Space on its machine: where these terminals are shown,
          // not a claim that they belong to a project or repository.
          const where = i.space ? 'Space · ' + (i.space.machine ?? 'This computer') : null;
          const extras = where ? [div().id('group-space:' + i.key).flex_none().text_size(10).text_color(muted).child(where)] : [];
          const header = groupHeader(i.key, title + (count != null ? ', ' + count : '') + (where ? ', ' + where : '') + (foldable ? (i.collapsed ? ', folded' : ', open') : ''), title,
            change({ type: 'fold', key: i.key, collapsed: !i.collapsed }), { icon: lead, collapsed: i.collapsed, foldable, extras, depth: i.depth, count, first: firstHeader || i.depth > 0,
              tooltip: where ? i.label + ': the Herdr Space on ' + (i.space.machine ?? 'this computer') + ' that shows these terminals (project not verified)' : undefined });
          Object.assign(this.controls.at(-1), slot(i));
          place(i, header);
          firstHeader = false;
          continue;
        }
        const row = i.row, waiting = row.roster.state === 'waiting';
        const status = waiting ? i.display.compact ? '◈ Waiting' : i.display.label : i.display.error ?? i.status;
        const provider = row.providerBadge?.accessibleName;
        const context = rowContext(i), label = detailLabel(i), explanation = actionReason(i);
        // Hover is short and pre-wrapped; the full label stays for screen readers and Info.
        const hover = hoverText(i, waiting ? i.display.detail ?? 'Waiting' : status);
        // One compact line per agent: name, machine, known context, badges. Everything
        // unknown or secondary (project, parent, route, reasons) lives in Info/Details.
        // Click re-reads the snapshot and focuses only the exact pane drawn; otherwise it
        // says why. Info and the child fold are sibling controls, never this click.
        const element = click(i.key, label, cx => {
          const plan = this.controller.activate(projection, i.key);
          if (plan.enabled) { if (this.openMessage) this.message = ''; this.openMessage = false; }
          else { this.message = reasonText(plan.reason); this.openMessage = true; }
          cx?.notify?.();
        }).flex_1().min_w(0).h(24).gap(4).tooltip(hover);
        // Visibly navigable or not: a pointer and full-color name only for a pane Roster can open.
        if (i.navigation.enabled) element.cursor_pointer(); else element.cursor_default();
        // Like the stock list: a hover tint, and the row of the terminal that has focus is marked.
        element.hover(el => el.bg(theme.hover ?? theme.raised));
        if (c.cursor !== i.key && c.feed.snapshot?.focused?.terminal === row.address) element.bg(theme.raised);
        const selected = this.controls.at(-1), at = slot(i);
        Object.assign(selected, { ...at, instance: i, anchor: rowAnchor(i, c.feed.snapshot), detail: label, hover,
          disabledReason: i.navigation.enabled ? null : explanation });
        // One leading icon: what runs there, from Herdr's program table only (runtime.js),
        // never a tab title or role. A neutral terminal when nothing is known.
        const kind = terminalKind(row.program);
        const kindIcon = kind.source === 'herdr'
          ? (kind.color ? herdrPicture(kind.name, 14) : herdrGlyph(kind.name, 14).text_color(fg))
          : (kind.color ? picture(kind.name, 14) : icon(kind.name, 14).text_color(dim));
        element.child(h().id('row-kind:' + i.key).w(16).h(16).flex_none().justify_center().accessibility_label(kind.label).child(kindIcon));
        // An echo is the alert's own terminal listed again in its group: muted, never a second alert.
        const echo = i.echo === true;
        // The task is the easiest part to spot: the name is plain, the task follows in full
        // contrast ("Developer · herdr-agents #141"). A task is only a verified association:
        // the terminal's own herdr.issue / herdr.pr label (titles are in no label, so none is
        // shown). A Done session says nothing about the issue being closed.
        const live = i.navigation.enabled && !echo;
        const item = row.workItem ? (row.workItem.kind === 'pr' ? 'PR #' : '#') + row.workItem.numberOrId : null;
        const repo = row.workItem ? String(row.workItem.repositoryIdentity ?? '').split('/').filter(Boolean).pop() ?? null : null;
        const task = item && !i.pinned ? [repo, item].filter(Boolean).join(' ') : null;
        // A role name carries its issue ("Planner #21"); with the task beside it, never twice.
        const name = task && row.displayLabel.endsWith(' ' + item) ? row.displayLabel.slice(0, -(item.length + 1)) : row.displayLabel;
        element.child(labelText(name, 12, live ? fg : muted).id('row-name:' + i.key).flex_none().max_w(task ? 110 : 150));
        // Working and Done in Status say so when nothing is reported (direct work without a label).
        const wantsTask = !i.pinned && viewMode === 'status' && ['Working', 'Done'].includes(section?.label);
        const sep = () => labelText('·', 12, dim).flex_none();
        if (task) {
          const kind = row.workItem.kind === 'pr' ? 'pull request' : 'issue';
          element.child(sep()).child(labelText(task, 12, live ? fg : muted).id('row-task:' + i.key).font_semibold().flex_none().max_w(150)
            .accessibility_label([provider ?? 'Work item', kind, item, 'in', row.workItem.repositoryIdentity].join(' ')
              + (section?.label === 'Done' ? '; the session is done, the ' + kind + ' state is not checked' : '')));
        } else if (wantsTask) element.child(sep()).child(labelText('Task not reported', 11, dim).id('row-task:' + i.key).flex_none()
          .accessibility_label('Task not reported: no herdr.issue or herdr.pr label on this terminal'));
        // Then the verified project, unless the group already is that project.
        const facts = i.pinned || !context.knownProject || context.knownProject === section?.label ? [] : [context.knownProject];
        element.child(labelText(facts.join(' · '), 11, muted).id('row-facts:' + i.key).flex_1());
        // The quiet tail: the Space when the group is not that Space, and the machine only
        // when remote (a pinned row always names where it is, This computer included).
        const where = [i.space && !section?.space ? i.space.name : null,
          row.core.alias || i.pinned ? context.machineShort : null].filter(Boolean).join(' · ');
        if (where) element.child(labelText(where, 10, muted).id('row-machine:' + i.key).flex_none().max_w(i.space && !section?.space ? 150 : 84));
        if (context.knownContext) element.child(labelText(context.knownContext, 10, muted).id('row-execution-context:' + i.key).flex_none().max_w(72));
        const stateColor = ({ Working: theme.working, 'Needs you': theme.blocked, 'Child needs you': theme.blocked,
          Done: theme.done, Idle: theme.idle })[status] ?? (waiting ? theme.accent : muted) ?? fg;
        const badge = (value, outline) => {
          const chip = h().h(18).max_w(104).min_w(0).flex_none().px(4).rounded(4).bg(theme.raised).child(labelText(value, 10));
          return outline ? chip.border(1).border_color(outline) : chip;
        };
        // Status groups by state, so a chip that repeats its header is dropped there; Projects
        // mixes states and keeps every chip. Waiting stays in Working with a compact marker.
        const statusView = viewMode === 'status';
        if (statusView && waiting) element.child(badge('◈ Waiting', theme.accent ?? muted).id('row-waiting:' + i.key)
          .accessibility_label('Waiting for delegate').tooltip('Waiting for delegate'));
        else if (echo) element.child(labelText('in Needs you', 10, muted).id('row-echo:' + i.key).flex_none());
        // The pinned header already says Needs you: its rows carry no repeated chip.
        else if (i.pinned) { /* no chip */ }
        else if (!(statusView && !i.display.error && section?.label === i.status)) element.child(badge(status, stateColor));
        // A discreet chevron on hover or keyboard focus, only on a row that can open its
        // exact session; its place is always reserved so nothing shifts.
        const infoShown = this.hoverKey === i.key || [i.key, 'info:' + i.key].includes(c.cursor) || reader?.sourceKey === i.key;
        const opens = h().id('row-open:' + i.key).w(10).h(16).flex_none().justify_center();
        if (infoShown && i.navigation.enabled) opens.child(icon('chevron-right', 10).text_color(muted));
        element.child(opens);
        const line = h().id('line:' + i.key).h(24).flex_none().min_w(0).gap(2).pl(Math.min(i.depth, 3) * 8).child(element)
          .on_hover((on, cx) => { if (on) this.hoverKey = i.key; else if (this.hoverKey === i.key) this.hoverKey = null; cx.notify(); });
        // A discreet ⓘ, drawn on hover or keyboard focus; its place is always reserved.
        const info = click('info:' + i.key, 'Agent details for ' + row.displayLabel, cx => this.openDetails({ key: 'info:' + i.key, instance: i, anchor: selected.anchor }, cx))
          .w(18).h(24).flex_none().px(0).justify_center().tooltip('Agent details')
          .child(labelText(infoShown ? 'ⓘ' : '', 12, muted).id('info-glyph:' + i.key));
        Object.assign(this.controls.at(-1), { ...at, instance: i, anchor: rowAnchor(i, c.feed.snapshot), detail: label, hover, disabledReason: selected.disabledReason });
        line.child(info);
        if (parents.has(row.associationKey)) {
          const collapsed = c.state.folds[i.key] ?? false;
          line.child(button('fold:' + i.key, collapsed ? 'Show children' : 'Hide children',
            change({ type: 'fold', key: i.key, collapsed: !collapsed }), { text: collapsed ? '▸' : '▾' }).px(0).w(18));
          Object.assign(this.controls.at(-1), { ...at, instance: i, anchor: rowAnchor(i, c.feed.snapshot), detail: label, hover, disabledReason: selected.disabledReason });
        }
        if (!i.alert) { place(i, line); continue; }
        // The first line is the verified agent, Space and machine. The second carries only
        // what the session reported (project, work item, reason) and names what it did not.
        const a = i.alert;
        const summary = [a.project, a.issue, a.reason].filter(Boolean).join(' · ');
        const details = [summary || null, a.recipient ? 'Reply goes to ' + a.recipient.label + ' (' + a.recipient.address + ')' : null,
          ...a.missing.map(m => 'Missing ' + m.field + ': ' + m.detail)].filter(Boolean).join('\n');
        const alertLine = h().id('alert:' + i.key).h(20).flex_none().min_w(0).gap(6).pl(Math.min(i.depth, 3) * 8 + 6)
          .tooltip(details).accessibility_label(details);
        if (summary) alertLine.child(labelText(summary, 11, fg).id('alert-summary:' + i.key).flex_1());
        if (a.recipient) {
          // Only a verified recipient gets an action, and it is checked again at click time.
          alertLine.child(button('recipient:' + i.key, 'Open ' + a.recipient.title + ': ' + a.recipient.label, cx => {
            const plan = this.controller.openRecipient(projection, i.key);
            if (plan.enabled) { if (this.openMessage) this.message = ''; this.openMessage = false; }
            else { this.message = reasonText(plan.reason); this.openMessage = true; }
            cx?.notify?.();
          }, { text: 'Open ' + a.recipient.title }).h(20));
          Object.assign(this.controls.at(-1), { ...at, instance: i, anchor: rowAnchor(i, c.feed.snapshot), detail: label, hover: details });
        }
        // What was not reported, when no recipient button takes the place.
        if (a.missing.length && !a.recipient) {
          const missing = labelText('Not reported: ' + a.missing.map(m => m.field).join(', '), 10, muted).id('alert-missing:' + i.key);
          alertLine.child(summary ? missing.flex_none().max_w(170) : missing.flex_1());
        }
        place(i, v().id('alert-block:' + i.key).h(PINNED.row).flex_none().child(line).child(alertLine));
      }
      if (viewMode === 'spaces') this.renderSpaces(body, theme, { click, change, labelText, h, fg, muted, groupHeader });
      else if (!projection.instances.some(i => !i.pinned)) body.child(labelText(pinnedCount ? 'Nothing else to list' : 'No observed terminals', 12, muted).p(6));
      // The list keeps its retained scroll handle and stable direct children.
      const stack = v().id('roster-stack').relative().flex_1().min_h(0).child(body);
      // Top to bottom: Needs you (only while pending), the tabs, Options, then the list.
      if (pinnedCount) root.child(pinned.child(pinnedRows));
      root.child(toolbar);
      if (tools) root.child(tools);
      // Keyboard order follows that: the pinned controls come before the tabs.
      const pinnedControls = this.controls.filter(control => control.pinned);
      if (pinnedControls.length) this.controls = [...pinnedControls, ...this.controls.filter(control => !control.pinned)];

      root.child(stack);
      if (this.message) root.child(labelText(this.message, 11, muted).id('roster-message').h(16).flex_none()
        .tooltip(this.message).accessibility_label(this.message));
      const footerOwner = (reader?.returnKey === 'details:open' ? this.controls.find(control => control.key === reader.sourceKey) : null) ?? this.controls.find(control => control.key === c.cursor)
        ?? (c.cursor === 'details:open' ? this.controls.find(control => control.key === this.footerSourceKey) : null);
      if (footerOwner?.instance) {
        this.controls.push({ ...footerOwner, key: 'details:open',
          activate: cx => this.openDetails({ key: 'details:open', instance: footerOwner.instance, anchor: footerOwner.anchor }, cx) });
      }
      // A cursor whose row vanished selects nothing until the next key or click moves it.
      // Keep the disabled reason independent of long waiting/context text for keyboard selection.
      const selected = this.controls.find(control => control.key === c.cursor);
      root.accessibility_label(selected?.label ?? 'Roster sidebar: Up and Down select, Enter activates');
      const foot = reader?.returnKey === 'details:open' ? this.controls.find(control => control.key === reader.sourceKey) ?? selected : selected;
      if (foot) {
        const footer = v().id('roster-focus-tooltip').h(foot.disabledReason ? 32 : 16).flex_none().min_w(0)
          .tooltip(foot.hover ?? foot.label).accessibility_label(foot.label);
        if (foot.disabledReason) footer.child(labelText(foot.disabledReason, 11, muted)
          .id('roster-disabled-reason').h(16).flex_none());
        const summary = h().h(16).flex_none().min_w(0)
          .child(labelText(foot.detail ?? foot.label, 11, muted).flex_1());
        if (foot.instance) { const trigger = h().id('details:open').h(16).flex_none().px(3)
          .bg(c.cursor === 'details:open' ? theme.selected ?? theme.raised : theme.surface)
          .accessibility_label('Details (D)').on_click((_e, cx) => {
            cx.stop_propagation(); this.footerSourceKey = foot.instance.key; this.place('details:open'); this.focus(cx);
            this.controls.find(control => control.key === 'details:open')?.activate(cx);
          })
          .child(labelText('Details (D)', 11));
          if (this.triggerHandles.has('details:open')) trigger.track_focus(this.triggerHandles.get('details:open'));
          summary.child(trigger);
        }
        footer.child(summary);
        root.child(footer);
      }
      return root;
    }
  };
}
