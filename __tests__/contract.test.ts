import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { cleanupTestRoot, createTestClientPair, createTestRoot } from './helpers.ts';

let tmpDir: string;

/**
 * The advertised MCP contract — what every client reads before its first
 * call. A change here is a wire change: review the snapshot diff, then
 * regenerate with `node --test --test-update-snapshots __tests__/contract.test.ts`.
 * Run with no FS_* variables set: the get-help text embeds the max file size.
 */
async function surface(readOnly: boolean): Promise<Record<string, unknown>> {
  const pair = await createTestClientPair([tmpDir], { readOnly });
  try {
    const { tools } = await pair.client.listTools();
    const { prompts } = await pair.client.listPrompts();
    const { resourceTemplates } = await pair.client.listResourceTemplates();
    const help = await pair.client.getPrompt({ name: 'get-help' });
    return {
      capabilities: pair.client.getServerCapabilities(),
      instructions: pair.client.getInstructions(),
      tools,
      prompts,
      resourceTemplates,
      help,
    };
  } finally {
    await pair.close();
  }
}

describe('Advertised MCP contract', () => {
  before(async () => {
    tmpDir = await createTestRoot();
  });

  after(async () => {
    await cleanupTestRoot(tmpDir);
  });

  it('CONTRACT-001: full server surface matches the snapshot', async (t) => {
    const value = await surface(false);
    assert.ok(
      !JSON.stringify(value).includes('fsmcp-test-'),
      'surface must not embed the test root',
    );
    t.assert.snapshot(value);
  });

  it('CONTRACT-002: --read-only surface matches the snapshot', async (t) => {
    const value = await surface(true);
    assert.ok(
      !JSON.stringify(value).includes('fsmcp-test-'),
      'surface must not embed the test root',
    );
    t.assert.snapshot(value);
  });
});
