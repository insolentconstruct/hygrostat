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
// Profiles (type 1) and regions read with a profile's directory (type 2)
// through the firmware's own parser and region reader; one line per record.
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "beads/blob/plaits_region.h"
#include "beads/profile.h"

using namespace beads;

static void ReadAll(void* p, size_t size) {
  if (size && fread(p, 1, size, stdin) != size) {
    exit(1);
  }
}

static uint32_t ReadWord() {
  uint8_t b[4];
  ReadAll(b, sizeof(b));
  return b[0] | b[1] << 8 | b[2] << 16 | uint32_t(b[3]) << 24;
}

int main() {
  static uint8_t block[kProfileSize];
  static Profile profile;
  static PlaitsRegion region;
  // No flash ECC flag on the host.
  region.set_flash_check(NULL);
  uint8_t type[4];
  while (fread(type, 1, sizeof(type), stdin) == sizeof(type)) {
    ReadAll(block, sizeof(block));
    printf("%d", profile.Init(block) ? 1 : 0);
    printf(" %d", profile.num_plaits_banks());
    for (int i = 0; i < profile.num_plaits_banks(); ++i) {
      for (int j = 0; j < kProfileBankSize; ++j) {
        printf(" %d", profile.plaits_bank(i)[j]);
      }
    }
    printf(" %d", profile.num_sections());
    for (int i = 0; i < profile.num_sections(); ++i) {
      const PlaitsDirectoryEntry& e = profile.directory()[i];
      printf(" %u %u %u %u", e.kind, e.offset, e.size, e.crc);
    }
    for (int id = 1; id < FEATURE_LAST; ++id) {
      const ProfileEntry& e = profile.entry(ProfileFeature(id));
      printf(" %d %d %d %d %d %d", e.feature, e.state, e.value, e.page_slot,
          e.amount_slot, e.action);
    }
    if (type[0] == 2) {
      const uint32_t release = ReadWord();
      const uint32_t num_digests = ReadWord();
      uint8_t (*digests)[kPlaitsBlobDigestSize] =
          static_cast<uint8_t (*)[kPlaitsBlobDigestSize]>(
              malloc(num_digests * kPlaitsBlobDigestSize + 1));
      ReadAll(digests, num_digests * kPlaitsBlobDigestSize);
      const uint32_t size = ReadWord();
      void* memory = NULL;
      if (posix_memalign(&memory, kPlaitsBlobAlignment, size + 1)) {
        return 1;
      }
      uint8_t* begin = static_cast<uint8_t*>(memory);
      ReadAll(begin, size);
      region.Read(begin, begin + size, release, profile.directory(),
          profile.num_sections(), NULL, 0, &plaits_blob_services, digests,
          num_digests);
      const PlaitsRegionIdentity& id = region.identity();
      printf(" | %u %u", id.services_status, id.directory_status);
      for (int i = 0; i < PLAITS_SECTION_LAST; ++i) {
        printf(" %u", id.sections[i].status);
      }
      printf(" %u", id.num_blobs);
      for (uint32_t i = 0; i < id.num_blobs; ++i) {
        printf(" %d", id.blob_status[i]);
      }
      free(memory);
      free(digests);
    }
    printf("\n");
  }
  return ferror(stdin) ? 1 : 0;
}
