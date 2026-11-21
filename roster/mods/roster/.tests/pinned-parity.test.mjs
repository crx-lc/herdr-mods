// Optional offline verification against exact upstream downloads. No fetching,
// fixture redistribution, or runtime dependency on the producer repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assessDelegations } from '../delegations.js';
const directory = process.env.ROSTER_DELEGATION_FIXTURES;
test('pinned herdr-agents v1 reader worlds and exact reference reader parity', { skip: !directory }, async t => {
  const worlds = JSON.parse(await readFile(`${directory}/reader-cases.json`, 'utf8'));
  const { assess } = await import(pathToFileURL(`${directory}/delegation-read.mjs`));
  for (const world of worlds) await t.test(world.name, async () => {
    const text = world.contract ? await readFile(`${directory}/${world.contract}`, 'utf8') : null;
    const input = { ...world, text }, result = assessDelegations(input);
    assert.deepEqual(result, assess(input));
    const compact = result.status === 'unknown' ? result : { status: result.status,
      assignments: Object.fromEntries(result.assignments.map(a => [a.id, a.why ? `${a.state}:${a.why}` : a.reason ? `${a.state}:${a.reason}` : a.state])) };
    assert.deepEqual(compact, world.expect);
  });
});
