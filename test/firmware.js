// Copyright 2026 Insolent Construct.
// MIT licence: see ../LICENSE.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const firmwareRepo = resolve(process.env.FIRMWARE_REPO || './firmware');
if (!existsSync(firmwareRepo)) {
  throw new Error('FIRMWARE_REPO is missing: clone insolentconstruct/eurorack with full history and tags into ./firmware, or set FIRMWARE_REPO to its checkout.');
}
try {
  execFileSync('git', ['-C', firmwareRepo, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' });
} catch (cause) {
  throw new Error('FIRMWARE_REPO must point to a checkout of insolentconstruct/eurorack with full history and tags.', { cause });
}
// The final Beta 3 firmware that the prepared Beta 3 tests check (override with BETA3_FIRMWARE_REF).
export const beta3Ref = process.env.BETA3_FIRMWARE_REF || '12180c690c40909bb0229e71def75111d3ec8b86';
export const firmwareRef = (release) => release.development ? release.source_commit : 'refs/tags/' + release.tag;
export const firmwareShow = (ref, file, options = {}) => execFileSync('git',
  ['-C', firmwareRepo, 'show', `${ref}:${file}`], options);
