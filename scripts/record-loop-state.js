#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const loopDir = path.join(process.cwd(), '.loop');
const runLogPath = path.join(loopDir, 'run-log.json');
const lastRunPath = path.join(loopDir, 'last-run.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

const status = process.argv[2] || 'update';
const runLog = readJson(runLogPath, {
  phase: 'verify',
  iteration: 0,
  masterIteration: 1,
  lastAgent: null,
  testsHealed: [],
  healAttempts: {},
  stoppedReason: null,
});

if (status === 'pass') {
  runLog.phase = 'verify';
  runLog.stoppedReason = 'tests_passed';
  writeJson(runLogPath, runLog);
  writeJson(lastRunPath, { exitCode: 0, failedTests: [], timestamp: new Date().toISOString() });
  console.log('Loop state: verify passed');
  process.exit(0);
}

writeJson(runLogPath, runLog);
console.log(JSON.stringify(runLog, null, 2));
