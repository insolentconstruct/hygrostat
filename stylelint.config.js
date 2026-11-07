// Copyright 2026 Insolent Construct. MIT licence: see LICENSE.
export default {
  extends: ['stylelint-config-recommended'],
  // Independent components are grouped together; their selectors need not be globally sorted.
  rules: { 'no-descending-specificity': null },
  overrides: [{ files: ['**/*.html'], customSyntax: 'postcss-html' }]
};
