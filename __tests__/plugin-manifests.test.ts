import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('Plugin manifests', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };

  const codexManifest = JSON.parse(
    readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'),
  ) as {
    version: string;
    mcpServers?: string;
    interface?: {
      composerIcon?: string;
      logo?: string;
      screenshots?: string[];
      websiteURL?: string;
      privacyPolicyURL?: string;
      termsOfServiceURL?: string;
    };
  };

  const cursorManifest = JSON.parse(
    readFileSync(new URL('../.cursor-plugin/plugin.json', import.meta.url), 'utf8'),
  ) as {
    version: string;
    mcpServers?: string;
  };

  it('PLUG-001: .codex-plugin/plugin.json version tracks package.json', () => {
    assert.equal(codexManifest.version, pkg.version);
  });

  it('PLUG-002: .cursor-plugin/plugin.json version tracks package.json', () => {
    assert.equal(cursorManifest.version, pkg.version);
  });

  it('PLUG-003: manifests point to valid mcp.json', () => {
    assert.equal(codexManifest.mcpServers, './mcp.json');
    assert.equal(cursorManifest.mcpServers, './mcp.json');
    assert.ok(existsSync(new URL('../mcp.json', import.meta.url)));
  });

  it('PLUG-004: .codex-plugin/plugin.json referenced assets exist', () => {
    assert.ok(codexManifest.interface);
    if (codexManifest.interface?.composerIcon) {
      assert.ok(existsSync(new URL(`../${codexManifest.interface.composerIcon}`, import.meta.url)));
    }
    if (codexManifest.interface?.logo) {
      assert.ok(existsSync(new URL(`../${codexManifest.interface.logo}`, import.meta.url)));
    }
    for (const screenshot of codexManifest.interface?.screenshots ?? []) {
      assert.ok(existsSync(new URL(`../${screenshot}`, import.meta.url)));
    }
    assert.ok(existsSync(new URL('../PRIVACY.md', import.meta.url)));
  });
});
