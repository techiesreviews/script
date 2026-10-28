#!/usr/bin/env node
// Project commands for script-editor: doctor and specs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { kitRoot, kitResult } from './kit-lib.mjs';
const [command, ...args] = process.argv.slice(2);
const root = kitRoot();
const help = {
  doctor: 'Usage: kit doctor\nCheck Node 24+, git, the Claude CLI, npx, kit wiring and JavaScript syntax. No installs, network or deploys.',
  specs: 'Usage: kit specs [FILE...]\nRun the unit tests (node --test tests/*.test.mjs, or the given files) and save docs/agents/evidence/specs.txt. No network, no paid services.',
};
if (args.includes('--help') || args.includes('-h')) { console.log(help[command]); process.exit(0); }
let ok = true;
const walk = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : [];
if (command === 'doctor') {
  for (const [name, argv] of [['node', ['--version']], ['git', ['--version']], ['claude', ['--version']], ['npx', ['--version']], ['timeout', ['--version']]]) {
    const r = spawnSync(name, argv, { encoding: 'utf8', timeout: 20000 });
    const pass = r.status === 0 && (name !== 'node' || Number(r.stdout.match(/^v(\d+)/)?.[1]) >= 24);
    console.log(`${pass ? 'ok' : 'fail'} ${name}`); ok &&= pass;
  }
  for (const file of readdirSync(join(root, 'scripts/agents/kit.d'))) {
    const r = spawnSync(join(root, 'scripts/agents/kit'), [file, '--help'], { encoding: 'utf8', timeout: 10000 });
    console.log(`${r.status === 0 ? 'ok' : 'fail'} kit ${file} --help`); ok &&= r.status === 0;
  }
  const code = [...walk(join(root, 'public')), ...walk(join(root, 'worker')), ...walk(join(root, 'src')), ...walk(join(root, 'scripts/agents'))]
    .filter((f) => /\.(m?js)$/.test(f));
  for (const file of code) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10000 });
    if (r.status !== 0) { console.log(`fail syntax ${file.slice(root.length + 1)}\n${r.stderr}`); ok = false; }
  }
  console.log(`ok syntax ${code.length} files checked`);
} else if (command === 'specs') {
  const files = args.length ? args.map((f) => resolve(root, f)) : readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => join(root, 'tests', f));
  if (!files.length) { console.error('No tests found in tests/'); ok = false; }
  else {
    const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, encoding: 'utf8', timeout: 180000 });
    const evidence = join(root, 'docs/agents/evidence/specs.txt');
    mkdirSync(resolve(evidence, '..'), { recursive: true });
    writeFileSync(evidence, `${result.stdout || ''}${result.stderr || ''}RESULT: ${result.status === 0 ? 'ok' : 'fail'} specs\n`);
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    console.log('evidence: docs/agents/evidence/specs.txt'); ok = result.status === 0;
  }
} else { console.error(help[command] || 'Unknown command'); ok = false; }
kitResult(ok ? 'ok' : 'fail', `${command}${args.length ? ' ' + args.join(' ') : ''}`);
process.exitCode = ok ? 0 : 1;
