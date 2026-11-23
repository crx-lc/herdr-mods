import { Controller } from './controller.js';
import { LayoutOptIn } from './layout.js';
import { desktopHost, desktopLayoutHost } from './desktop.js';
import { spaceRows, spaceFill, spacePlace, GitIdentities } from './spaces.js';
import { actionReason, rowContext, detailLabel, hoverText, reasonText, agentFacts } from './detail.js';

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
  const { View, div, h_flex, v_flex, ScrollHandle, svg } = kit;
  // Roster's own icons, shipped in the mod folder; icon paths resolve against Herdr's root.
  const icon = (name, size) => svg('mods/roster/icons/' + name + '.svg').size(size).flex_none();
  return class Roster extends View {
    init(_props, cx) {
      this.handle = cx.focus_handle();
      this.rowScroll = ScrollHandle.new();
      this.optionsScroll = ScrollHandle.new();
      this.controller = new Controller(options.host ?? desktopHost(app), { collapseUnassigned: options.collapseUnassigned ?? true,
        // Spaces is the first tab and where the panel starts: daily navigation.
        initialView: options.initialView ?? 'spaces' });
      this.optIn = new LayoutOptIn(options.layoutHost ?? desktopLayoutHost(app));
      this.reader = null; this.readerControls = [];
      this.controls = []; this.message = ''; this.selection = null; this.reading = false; this.toolsOpen = false;
      // Where the cursor was when an event last placed it; Up/Down resume there if its row vanishes.
      this.cursorAt = null;
      if (!app.checking()) cx.spawn(async cx => {
        for (;;) { if (await app.nextCommand() === 'focus') this.focus(cx); }
      });
      // Git identity for worktree nesting: the stock panel's two read-only rev-parse
      // queries, probed in the background (never in render, never under check).
      const exec = options.exec ?? app.exec;
      if (!app.checking() && typeof exec === 'function' && typeof cx.timer?.every === 'function') {
        this.git = new GitIdentities({ exec, now: () => this.controller.host.now() });
        this.machineReady = new Map();
        cx.timer.every(1000, cx => this.pollGit(cx));
      }
    }
    // Ask about Spaces' folders on ready machines; ask again on reconnect; redraw on answers.
    pollGit(cx) {
      if (!this.git || this.controller.state.view !== 'spaces') return;
      const host = this.controller.host, machines = host.machines(), panes = host.panes();
      const ready = new Set();
      for (const m of machines) {
        const name = m?.name ?? null, now = m?.layout === 'ready';
        if (now) ready.add(name);
        if (now && this.machineReady.get(name) === false) this.git.retry(name);
        this.machineReady.set(name, now);
      }
      const places = host.spaces().filter(sp => ready.has(sp?.machine ?? null))
        .map(sp => ({ machine: sp.machine ?? null, folder: spacePlace(sp, panes) }));
      this.git.request(places, (ms, fn) => cx.timer.after(ms, fn));
      if (this.git.takeChanged()) cx.notify();
    }
    focus(cx) { this.handle.focus(); cx.notify(); }
    async layoutAction(operation, cx) {
      if (app.checking()) return;
      try { await operation(); this.message = 'Agents slot updated'; } catch (e) { this.message = `Layout unchanged or incomplete: ${e.message}`; }
      cx.notify();
    }
    reveal(control) {
      if (control?.rowIndex != null) this.rowScroll.scroll_to_item(control.rowIndex);
      if (control?.optionIndex != null) this.optionsScroll.scroll_to_item(control.optionIndex);
    }
    // Render never changes state or asks for a redraw (GPUI throws on cx.notify() there).
    // Everything below that moves the cursor, scrolls or closes Details runs in an event.
    place(key) {
      this.controller.cursor = key;
      const index = this.controls.findIndex(control => control.key === key);
      this.cursorAt = index < 0 ? null : { key, index };
    }
    // Details stay open only while the view they were opened over is unchanged.
    activeReader() {
      const reader = this.reader;
      return reader && reader.state === JSON.stringify(this.controller.state) && reader.toolsOpen === this.toolsOpen ? reader : null;
    }
    // Agent details open as a compact modal over the list. The list stays mounted under
    // it, so its scroll position and expanded groups never change.
    openDetails(control, cx) {
      if (!control?.instance) return;
      this.reader = { sourceKey: control.instance.key, returnKey: control.key,
        state: JSON.stringify(this.controller.state), toolsOpen: this.toolsOpen, technical: false };
      this.readerCursor = null; this.readerControls = [];
      cx.notify();
    }
    closeDetails(cx, returnToOrigin = true) {
      const reader = this.reader;
      if (!reader) return;
      this.reader = null; this.readerControls = [];
      // Esc/× keep the list's controls; a view, filter or Options change makes them stale.
      if (returnToOrigin) this.returnTo(reader); else this.controls = [];
      cx.notify();
    }
    // Esc or ×: the cursor goes back to the exact control the modal was opened from, on the
    // same row, if that row is still listed; otherwise to Projects. No scrolling.
    returnTo(reader) {
      const c = this.controller, projection = c.render();
      const instance = projection.instances.find(i => i.kind === 'terminal' && i.key === reader.sourceKey);
      if (!instance) { this.place('mode:projects'); return; }
      const parent = c.feed.reduced.rows.some(r => r.parent?.associationKey && r.parent.associationKey === instance.row.associationKey);
      const key = reader.returnKey === 'fold:' + reader.sourceKey && !parent ? reader.sourceKey : reader.returnKey;
      if (key === 'details:open') this.footerSourceKey = reader.sourceKey;
      c.cursor = key; this.cursorAt = { key, index: null };
    }
    key(event, cx) {
      const chord = event.keystroke;
      // Details left over from a changed view are dropped here, in the event, not in render.
      if (this.reader && !this.activeReader()) { this.reader = null; this.readerControls = []; }
      if (this.reader) {
        const controls = this.readerControls, at = controls.findIndex(i => i.key === this.readerCursor);
        if (chord === 'escape') this.closeDetails(cx);
        else if (['up', 'down', 'left', 'right'].includes(chord) && controls.length) {
          const step = ['up', 'left'].includes(chord) ? -1 : 1;
          this.readerCursor = controls[at < 0 ? (step > 0 ? 0 : controls.length - 1) : (at + step + controls.length) % controls.length].key;
          cx.notify();
        } else if (chord === 'enter') (at < 0 ? controls[0] : controls[at])?.activate(cx);
        else return;
        cx.stop_propagation();
        return;
      }
      if (chord === 'd') {
        const selected = this.controls.find(i => i.key === this.controller.cursor);
        if (!selected?.instance) return;
        cx.stop_propagation(); this.openDetails(selected, cx); return;
      }
      if (!['up', 'down', 'enter'].includes(chord)) return;
      cx.stop_propagation();
      const c = this.controller, controls = this.controls, count = controls.length;
      // Enter acts only on the exact control under the cursor. If that row vanished, Enter
      // does nothing: a neighbour is never activated in its place.
      if (chord === 'enter') controls.find(i => i.key === c.cursor)?.activate(cx);
      else if (count) {
        const index = controls.findIndex(i => i.key === c.cursor), step = chord === 'up' ? -1 : 1;
        let next;
        if (index >= 0) next = (index + step + count) % count;
        else if (this.cursorAt?.key === c.cursor && this.cursorAt.index != null) {
          // The selected row vanished: resume beside where it was.
          const at = Math.min(this.cursorAt.index, count - 1);
          next = step > 0 ? at : Math.max(0, Math.min(this.cursorAt.index, count) - 1);
        } else next = step > 0 ? 0 : count - 1;
        this.place(controls[next].key);
        if (controls[next].key === 'details:open') this.footerSourceKey = controls[next].instance?.key ?? this.footerSourceKey;
        this.reveal(controls[next]);
      }
      cx.notify();
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
      for (const row of rows) {
        if (row.kind === 'machine') {
          // As in the stock list: icon, name, state when not connected, then +, the
          // connection dot and the fold chevron last.
          const dim = theme.dim ?? muted, newSpace = () => c.host.run('space.new', { machine: row.machine ?? '' });
          const extras = [];
          if (!row.ready) extras.push(div().id('machine-note:' + row.key).flex_none().child(row.loading ? 'loading' : 'not connected'));
          else extras.push(h().id('machine-add:' + row.key).flex_none().px(4).rounded(4).cursor_pointer()
            .hover(el => el.bg(theme.hover ?? theme.raised).text_color(fg)).tooltip('New space on ' + (row.machine ?? 'this computer'))
            .accessibility_label('New space on ' + row.label)
            .on_click((_e, cx) => { cx.stop_propagation(); if (!this.reader) newSpace(); }).child('+'));
          extras.push(div().id('machine-state:' + row.key).size(6).rounded(3).flex_none().bg(row.ready ? theme.ansi2 ?? theme.working ?? fg : dim));
          add(groupHeader(row.key, row.label + (row.collapsed ? ', folded' : ''), row.label,
            change({ type: 'fold', key: row.key, collapsed: !row.collapsed }),
            { icon: row.machine ? 'server' : 'monitor', collapsed: row.collapsed, extras,
              tooltip: row.machine ? row.label + ' · ' + (row.ready ? 'connected' : row.loading ? 'loading' : 'not connected') : row.label }));
          if (!row.collapsed && row.count === 0 && row.ready) add(click('spaces:new:' + (row.machine ?? 'local'), 'New space on ' + row.label, newSpace)
            .h(28).flex_none().px(8).gap(7).rounded(7).text_size(12).text_color(dim).cursor_pointer()
            .hover(el => el.bg(theme.hover ?? theme.raised).text_color(fg)).child(icon('plus', 12)).child('New space there'));
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
        if (row.active) { activeAt = drawn; activeId = row.id; }
        add(element);
      }
      if (!rows.length) body.child(labelText('No Spaces', 12, muted).p(6));
      // As the stock list does: when the active Space or its place changes, ask the list
      // to bring it into view. A visible row stays put. The one render-time request here:
      // a scroll request only, no state change and no redraw.
      if (activeId !== this.revealed?.id || activeAt !== this.revealed?.at) {
        this.revealed = { id: activeId, at: activeAt };
        if (activeAt >= 0) this.rowScroll.scroll_to_item(activeAt);
      }
    }
    renderModal(reader, projection, theme, { labelText, h, v, fg, muted }) {
      const c = this.controller;
      this.readerControls = [];
      const control = (key, label, text, activate, color = fg) => {
        this.readerControls.push({ key, label, activate });
        return h().id(key).h(22).flex_none().px(6).rounded(4).accessibility_label(label).tooltip(label)
          .bg(this.readerCursor === key ? theme.selected ?? theme.raised : theme.raised ?? theme.surface)
          .hover(el => el.bg(theme.hover ?? theme.selected ?? theme.surface))
          // A click on the modal stops here; GPUI would otherwise also deliver it to the row beneath.
          .on_click((_e, cx) => { cx.stop_propagation(); this.readerCursor = key; this.focus(cx); activate(cx); })
          .child(labelText(text, 12, color));
      };
      const box = v().id('roster-details').absolute().top(0).left(0).right(0).p(8).gap(3).rounded(8)
        .bg(theme.raised ?? theme.surface).border(1).border_color(theme.border ?? muted).accessibility_label('Agent details')
        .on_click((_e, cx) => cx.stop_propagation());
      box.child(h().h(22).flex_none().gap(6)
        .child(labelText('Agent details', 12, fg).font_semibold().flex_1())
        .child(control('details:close', 'Close agent details (Esc)', '×', cx => this.closeDetails(cx))));
      const instance = projection.instances.find(i => i.kind === 'terminal' && i.key === reader.sourceKey);
      if (!instance) return box.child(labelText('This agent is no longer listed.', 12, muted));
      const facts = agentFacts(instance, { snapshot: c.feed.snapshot ?? {}, rows: c.feed.reduced.rows,
        home: typeof app.home === 'function' ? app.home() : null });
      // Label and full value; values wrap and are never cut.
      const line = (field, size = 12, color = fg) => {
        const value = field.href
          ? control('details:link', 'Open ' + field.label + ' ' + field.value, field.value, cx => cx.open_url(field.href), theme.accent ?? fg)
          : div().min_w(0).flex_1().whitespace_normal().text_size(size).text_color(color).child(field.value);
        return h().id('detail:' + field.id).min_h(18).flex_none().gap(6).items_start()
          .child(div().w(92).flex_none().text_size(11).text_color(muted).child(field.label)).child(value);
      };
      for (const field of facts.fields) box.child(line(field));
      // The terminal action passes the same click-time check as the row.
      if (instance.navigation.enabled) box.child(control('details:go', 'Go to terminal: ' + instance.row.displayLabel, 'Go to terminal', cx => {
        const plan = c.activate(projection, instance.key);
        if (plan.enabled) this.closeDetails(cx, false);
        else { this.message = reasonText(plan.reason); this.openMessage = true; cx.notify(); }
      }));
      else box.child(labelText(actionReason(instance), 11, muted).id('details:unavailable').whitespace_normal());
      box.child(control('details:technical', (reader.technical ? 'Hide' : 'Show') + ' technical details',
        (reader.technical ? '▾ ' : '▸ ') + 'Technical details', cx => { reader.technical = !reader.technical; cx.notify(); }, muted));
      if (reader.technical) for (const field of facts.technical) box.child(line(field, 11, muted));
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
      // Controls drawn in the list ignore clicks while the details modal is open over it.
      let listPhase = false;
      const click = (key, label, activate, column = false) => {
        const inList = listPhase;
        this.controls.push({ key, label, activate });
        return (column ? v() : h()).id(key).min_w(0).px(6).rounded(4).accessibility_label(label)
          .bg(c.cursor === key ? theme.selected ?? theme.raised : theme.surface)
          .on_click((_e, cx) => { if (inList && this.reader) return; this.place(key); this.focus(cx); activate(cx); });
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
      const groupHeader = (key, label, title, activate, { icon: lead = null, collapsed = false, foldable = true, extras = [], tooltip = label, depth = 0 } = {}) => {
        const head = click(key, label, activate).h(26).flex_none().px(8).pl(8 + Math.min(depth, 3) * 8).gap(7)
          .text_size(11).text_color(dim).cursor_pointer().hover(el => el.bg(theme.hover ?? theme.raised)).tooltip(tooltip);
        if (lead) head.child(icon(lead, 13).id('group-icon:' + key));
        head.child(labelText(title, 11, dim).id('group-label:' + key).flex_1());
        for (const extra of extras) head.child(extra);
        if (foldable) head.child(icon(collapsed ? 'chevron-right' : 'chevron-down', 11).id('group-chevron:' + key));
        return head;
      };
      const change = event => cx => { this.closeDetails(cx, false); this.controls = []; c.change(event); cx.notify(); };
      const viewMode = c.state.view;
      const root = v().id('roster').size_full().p(5).gap(3).bg(theme.surface).text_color(fg).text_size(12)
        .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx));
      const toolbar = h().id('roster-toolbar').h(26).flex_none().gap(3);
      toolbar.child(button('mode:spaces', 'Spaces', change({ type: 'view', view: 'spaces' }), { active: viewMode === 'spaces' }))
        .child(button('mode:projects', 'Projects', change({ type: 'view', view: 'projects' }), { active: viewMode === 'projects' }))
        .child(button('mode:status', 'Status', change({ type: 'view', view: 'status' }), { active: viewMode === 'status' }))
        .child(div().flex_1().min_w(0));
      // The stock Spaces title's +: a new Space, Herdr choosing where, as space.new does.
      if (viewMode === 'spaces') toolbar.child(button('spaces:new', 'New space', () => c.host.run('space.new'), { text: '+' })
        .w(24).px(0).justify_center().cursor_pointer());
      const settingsOpen = this.toolsOpen;
      const filtered = c.state.coreIds !== null || c.state.contextIds !== null;
      toolbar.child(button('tools:toggle', (settingsOpen ? 'Hide' : 'Show') + ' filters and Agents slot controls' + (filtered ? ' (filters active)' : ''),
        cx => { this.closeDetails(cx, false); this.controls = []; this.toolsOpen = !this.toolsOpen; cx.notify(); }, { active: settingsOpen || filtered, text: filtered ? 'Options •' : 'Options' }));
      root.child(toolbar);
      if (!this.reading && this.controller.feed.evidence.admissions?.length) {
        this.reading = true;
        cx.spawn(async cx => { try { if (await this.controller.refresh(p => timerDeadline(cx, p))) cx.notify(); } finally { this.reading = false; } });
      }
      const reader = this.activeReader();
      if (settingsOpen) {
        const tools = v().id('roster-options').min_h(0).flex_none().gap(2).overflow_y_scrollbar().track_scroll(this.optionsScroll);
        let optionIndex = 0;
        const option = (...args) => {
          tools.child(button(...args));
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
        tools.h(Math.min(52, optionIndex * 24 + Math.max(0, optionIndex - 1) * 2));
        root.child(tools);
      }
      listPhase = true;
      const body = v().id('roster-rows').flex_1().min_h(0).gap(3).overflow_y_scrollbar().track_scroll(this.rowScroll);
      let section = null;
      for (const [index, i] of projection.instances.entries()) {
        if (i.kind === 'section') {
          section = i;
          const count = i.label === 'Working' ? i.counts?.working : i.label === 'Needs you' ? i.counts?.needsYou : i.counts?.identities ?? i.count;
          const title = i.label + (count != null ? ' · ' + count : '');
          // Needs you never folds, so it has no chevron.
          const foldable = i.key !== JSON.stringify([viewMode, 'attention']);
          // One subtle native spinner marks live work in Status; it is decoration, not a control.
          const extras = viewMode === 'status' && i.label === 'Working' ? [div().id('roster-working-indicator').flex_none()
            .text_size(10).text_color(theme.working ?? theme.accent ?? muted).frames(WORKING_FRAMES, 80)] : [];
          const header = groupHeader(i.key, title + (foldable ? (i.collapsed ? ', folded' : ', open') : ''), title,
            change({ type: 'fold', key: i.key, collapsed: !i.collapsed }), { collapsed: i.collapsed, foldable, extras, depth: i.depth });
          body.child(header);
          this.controls.at(-1).rowIndex = index;
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
          if (this.reader) return;
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
        const selected = this.controls.at(-1);
        Object.assign(selected, { rowIndex: index, instance: i, detail: label, hover,
          disabledReason: i.navigation.enabled ? null : explanation });
        // Neutral monogram only for a known project: an "Unassigned" initial says nothing.
        if (context.knownProject) element.child(h().w(16).h(16).flex_none().justify_center().rounded(4).bg(theme.raised)
          .accessibility_label(context.knownProject + ' project icon fallback').child(labelText(Array.from(context.knownProject)[0] ?? '?', 10)));
        element.child(labelText(row.displayLabel, 12, i.navigation.enabled ? fg : muted).id('row-name:' + i.key).font_semibold().flex_1());
        element.child(labelText(context.machineShort, 10, muted).id('row-machine:' + i.key).flex_none().max_w(84));
        if (context.knownContext) element.child(labelText(context.knownContext, 10, muted).id('row-execution-context:' + i.key).flex_none().max_w(72));
        const stateColor = ({ Working: theme.working, 'Needs you': theme.blocked, 'Child needs you': theme.blocked,
          Done: theme.done, Idle: theme.idle })[status] ?? (waiting ? theme.accent : muted) ?? fg;
        const badge = (value, outline) => {
          const chip = h().h(18).max_w(104).min_w(0).flex_none().px(4).rounded(4).bg(theme.raised).child(labelText(value, 10));
          return outline ? chip.border(1).border_color(outline) : chip;
        };
        if (provider === 'GitHub' || provider === 'Azure DevOps') {
          const providerChip = badge(provider === 'GitHub' ? 'GH' : 'ADO').accessibility_label(provider + ' provider badge').tooltip(provider);
          element.child(providerChip);
        }
        // Status groups by state, so a chip that repeats its header is dropped there; Projects
        // mixes states and keeps every chip. Waiting stays in Working with a compact marker.
        const statusView = viewMode === 'status';
        if (statusView && waiting) element.child(badge('◈ Waiting', theme.accent ?? muted).id('row-waiting:' + i.key)
          .accessibility_label('Waiting for delegate').tooltip('Waiting for delegate'));
        else if (!(statusView && !i.display.error && section?.label === i.status)) element.child(badge(status, stateColor));
        const line = h().id('line:' + i.key).h(24).flex_none().min_w(0).gap(2).pl(Math.min(i.depth, 3) * 8).child(element)
          .on_hover((on, cx) => { if (on) this.hoverKey = i.key; else if (this.hoverKey === i.key) this.hoverKey = null; cx.notify(); });
        // A discreet ⓘ, drawn on hover or keyboard focus; its place is always reserved.
        const infoShown = this.hoverKey === i.key || [i.key, 'info:' + i.key].includes(c.cursor) || reader?.sourceKey === i.key;
        const info = click('info:' + i.key, 'Agent details for ' + row.displayLabel, cx => this.openDetails({ key: 'info:' + i.key, instance: i }, cx))
          .w(18).h(24).flex_none().px(0).justify_center().tooltip('Agent details')
          .child(labelText(infoShown ? 'ⓘ' : '', 12, muted).id('info-glyph:' + i.key));
        Object.assign(this.controls.at(-1), { rowIndex: index, instance: i, detail: label, hover, disabledReason: selected.disabledReason });
        line.child(info);
        if (parents.has(row.associationKey)) {
          const collapsed = c.state.folds[i.key] ?? false;
          line.child(button('fold:' + i.key, collapsed ? 'Show children' : 'Hide children',
            change({ type: 'fold', key: i.key, collapsed: !collapsed }), { text: collapsed ? '▸' : '▾' }).px(0).w(18));
          Object.assign(this.controls.at(-1), { rowIndex: index, instance: i, detail: label, hover, disabledReason: selected.disabledReason });
        }
        body.child(line);
      }
      if (viewMode === 'spaces') this.renderSpaces(body, theme, { click, change, labelText, h, fg, muted, groupHeader });
      else if (!projection.instances.length) body.child(labelText('No observed terminals', 12, muted).p(6));
      // The modal lies over the list; the list underneath keeps its scroll and folds.
      const stack = v().id('roster-stack').relative().flex_1().min_h(0).child(body);
      if (reader) stack.child(this.renderModal(reader, projection, theme, { labelText, h, v, fg, muted }));
      root.child(stack);
      if (this.message) root.child(labelText(this.message, 11, muted).id('roster-message').h(16).flex_none()
        .tooltip(this.message).accessibility_label(this.message));
      const footerOwner = this.controls.find(control => control.key === c.cursor)
        ?? (c.cursor === 'details:open' ? this.controls.find(control => control.key === this.footerSourceKey) : null);
      if (footerOwner?.instance) {
        this.controls.push({ ...footerOwner, key: 'details:open',
          activate: cx => this.openDetails({ key: 'details:open', instance: footerOwner.instance }, cx) });
      }
      // A cursor whose row vanished selects nothing until the next key or click moves it.
      // Keep the disabled reason independent of long waiting/context text for keyboard selection.
      const selected = this.controls.find(control => control.key === c.cursor);
      root.accessibility_label(selected?.label ?? 'Roster sidebar: Up and Down select, Enter activates');
      if (selected) {
        const footer = v().id('roster-focus-tooltip').h(selected.disabledReason ? 32 : 16).flex_none().min_w(0)
          .tooltip(selected.hover ?? selected.label).accessibility_label(selected.label);
        if (selected.disabledReason) footer.child(labelText(selected.disabledReason, 11, muted)
          .id('roster-disabled-reason').h(16).flex_none());
        const summary = h().h(16).flex_none().min_w(0)
          .child(labelText(selected.detail ?? selected.label, 11, muted).flex_1());
        if (selected.instance) summary.child(h().id('details:open').h(16).flex_none().px(3)
          .bg(c.cursor === 'details:open' ? theme.selected ?? theme.raised : theme.surface)
          .accessibility_label('Details (D)').on_click((_e, cx) => {
            this.footerSourceKey = selected.instance.key; this.place('details:open'); this.focus(cx);
            this.controls.find(control => control.key === 'details:open')?.activate(cx);
          })
          .child(labelText('Details (D)', 11)));
        footer.child(summary);
        root.child(footer);
      }
      return root;
    }
  };
}
