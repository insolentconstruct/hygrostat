// Copyright 2026 Insolent Construct.
// Author: Insolent Construct
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasFeatureHelp } from '../static/js/help.js';

const root = fileURLToPath(new URL('../static/', import.meta.url));

function check(features, source) {
  for (const { id, name } of features) {
    if (hasFeatureHelp(id)) continue;
    console.error(`${source}: missing editor help for feature ID ${id} (${name})`);
    process.exitCode = 1;
  }
}

for (const file of readdirSync(root, { recursive: true }).sort()) {
  if (!file.endsWith('.json')) continue;
  const data = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  if (Array.isArray(data.features)) check(data.features, file);
  if (Array.isArray(data.profile?.features)) check(data.profile.features, file);
  for (const release of data.releases ?? []) {
    check(release.profile.features, `${file} (${release.tag})`);
  }
}
