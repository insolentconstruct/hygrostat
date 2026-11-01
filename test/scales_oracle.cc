// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
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
//
// See http://creativecommons.org/licenses/MIT/ for more information.
//
// A stream of V2 profile candidates, decoded by the firmware's actual parser.
#include <cstdio>
#include <cstring>
#include "beads/profile.h"

int main() {
  uint8_t block[beads::kProfileSize];
  while (fread(block, 1, sizeof(block), stdin) == sizeof(block)) {
    beads::Profile profile;
    const bool accepted = profile.Init(block);
    putchar(accepted ? 1 : 0);
    putchar(accepted && profile.custom_bank() ? 1 : 0);
    putchar(accepted ? profile.scale_count() : 0);
    for (int i = 0; i < 14; ++i) {
      uint8_t record[144] = { 0 };
      if (accepted && i < profile.scale_count()) {
        const beads::PitchScaleDefinition& s = profile.scale(i);
        record[0] = s.id;
        record[1] = s.size;
        memcpy(record + 2, s.color, 3);
        record[5] = s.pulses;
        memcpy(record + 8, &s.period, 4);
        memcpy(record + 12, s.name, 32);
        memcpy(record + 44, s.notes, 4 * s.size);
      }
      fwrite(record, 1, sizeof(record), stdout);
    }
  }
  return ferror(stdin) ? 1 : 0;
}
