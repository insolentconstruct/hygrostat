// Copyright 2026 Insolent Construct.
// MIT licence: see encoder.js.
// Links follow the selected release, including its source revision during development.
const docs = 'https://github.com/insolentconstruct/eurorack/blob/{TAG}/beads/build/docs/FEATURES.md';
const descriptions = {
  1: ['Snap final pitch, including PITCH, CV and randomness, to a scale.', 'drizzlet-options'],
  2: ['Choose Stock or Clouds-style reverb character; REVERB still sets its amount during play.', 'decisions'],
  3: ['Choose automatic delay, disable it, or widen the delay filter neutral zone.', 'exact-option-values'],
  4: ['Granular or Clouds spectral playback.', 'drizzlet-options'],
  5: ['Stock, fast or no limiter.', 'drizzlet-options'],
  6: ['While frozen, FEEDBACK controls an evolving wet feedback loop; the recording stays unchanged.', 'drizzlet-options'],
  7: ['Beads or Plaits synth.', 'drizzlet-options'],
  8: ['Align grains to recorded hits.', 'drizzlet-options'],
  9: ['Auto or manual synth start.', 'buttons-and-startup'],
  10: ['Step CCW PITCH randomness relative to the current pitch; CW stays continuous before Pitch scale.', 'drizzlet-options'],
  11: ['Spread grains in stereo.', 'stereo-width'],
  12: ['Soften grains before reverb.', 'decisions'],
  13: ['One grain at a time; try square or decay envelopes.', 'buttons-and-startup'],
  14: ['Keep only a fresh recording when freezing.', 'buttons-and-startup'],
  15: ['Brief blue startup cue.', 'small-beta-2-profile-options'],
  16: ['Lower manual gain to silence; automatic gain unchanged.', 'small-beta-2-profile-options'],
  17: ['Light cue when switching delay mode.', 'small-beta-2-profile-options'],
  18: ['Set LED brightness, including warnings.', 'small-beta-2-profile-options'],
  19: ['Show CV strength on assignment LEDs.', 'small-beta-2-profile-options'],
  20: ['Keep FREEZE lit while saving.', 'small-beta-2-profile-options'],
  21: ['Choose latched SEED trigger behaviour.', 'small-beta-2-profile-options'],
  22: ['Show PITCH unison/octaves, ignoring CV and random pitch.', 'small-beta-2-profile-options'],
  23: ['Scan the granular buffer when TIME CV is unplugged.', 'small-beta-2-profile-options'],
  24: ['Keep the synth reverb tail as stock does, or clear it when synth playback stops.', 'synth-reverb-tail']
};

export function featureHelp(feature, release) {
  const [description, section] = descriptions[feature.id];
  const details = feature.id === 10 ? 'Around C, the steps are C and G across octaves, including G below C (a fourth down). Pitch scale applies afterwards and can change these intervals. Works on granular and Beads wavetable grains, not the continuous oscillator, Plaits or Spectral.' : '';
  return { description, details, url: docs.replace('{TAG}', encodeURIComponent(release.development ? release.source_commit : release.tag)) + '#' + section };
}

export function actionHelp(feature) {
  if (feature.id === 13) return 'Change on the module: an [A] gesture switches it; there is no page knob. Always: on or off, no gesture.';
  if (feature.id === 14) return 'Always On or Change on the module turns on the trim gesture.';
  if (feature.id === 9) return 'Manual needs an [A] gesture to start the synth, also when always Manual.';
  return '';
}
