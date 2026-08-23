const assert = require('node:assert/strict');
const test = require('node:test');

const coreupdate = require('../commands/coreupdate');

const { dependencyContractChanged } = coreupdate.testHelpers;

test('treats structurally equal nested overrides as unchanged', () => {
  const currentPackage = {
    overrides: {
      micromatch: { picomatch: '2.3.2' },
    },
  };
  const incomingPackage = {
    overrides: {
      micromatch: { picomatch: '2.3.2' },
    },
  };

  assert.equal(dependencyContractChanged(currentPackage, incomingPackage), false);
});

test('detects a changed value inside a nested override', () => {
  const currentPackage = {
    overrides: {
      micromatch: { picomatch: '2.3.1' },
    },
  };
  const incomingPackage = {
    overrides: {
      micromatch: { picomatch: '2.3.2' },
    },
  };

  assert.equal(dependencyContractChanged(currentPackage, incomingPackage), true);
});
