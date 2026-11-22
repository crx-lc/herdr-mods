import * as kit from 'gpui-kit';
import * as app from 'herdr';
import { h_flex, v_flex, ScrollHandle } from 'gpui-base';
import { createRosterView } from './view.js';
export default createRosterView({ ...kit, h_flex, v_flex, ScrollHandle }, app);
