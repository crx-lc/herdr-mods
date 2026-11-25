import * as kit from 'gpui-kit';
import * as app from 'herdr';
import * as fs from 'fs/promises';
import { h_flex, v_flex, ScrollHandle, InputState, Input } from 'gpui-base';
import { createRosterView } from './view.js';
// mkdir: only for the mod's own hidden .cache/ (catalog icons, the GitHub totals cache).
export default createRosterView({ ...kit, h_flex, v_flex, ScrollHandle, InputState, Input }, app, { mkdir: dir => fs.mkdir(dir, { recursive: true }) });
