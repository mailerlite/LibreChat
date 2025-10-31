#!/usr/bin/env node

/**
 * Sentry Integration Test Script
 * Run this to verify your Sentry configuration is working
 * 
 * Usage: node api/config/test-sentry.js
 */

require('dotenv').config();
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..') });

console.log('=================================');
console.log('Sentry Integration Test');
console.log('=================================\n');

// Check environment variables
console.log('1. Checking environment variables...');
console.log(`   SENTRY_ENABLED: ${process.env.SENTRY_ENABLED || '(not set)'}`);
console.log(`   SENTRY_DSN: ${process.env.SENTRY_DSN ? '✓ Set' : '✗ Not set'}`);
console.log(`   SENTRY_ENVIRONMENT: ${process.env.SENTRY_ENVIRONMENT || 'production (default)'}`);
console.log('');

// Initialize Sentry
console.log('2. Initializing Sentry...');
const { initializeSentry, Sentry, isSentryEnabled } = require('./sentry');
const initialized = initializeSentry();
console.log(`   Sentry Enabled: ${isSentryEnabled}`);
console.log(`   Sentry Initialized: ${initialized}`);
console.log('');

if (!initialized) {
  console.log('❌ Sentry is not initialized!');
  console.log('\nTo enable Sentry, add these to your .env file:');
  console.log('   SENTRY_ENABLED=true');
  console.log('   SENTRY_DSN=https://your-key@your-org.ingest.sentry.io/your-project-id');
  console.log('\nGet your DSN from: https://sentry.io/settings/projects/');
  process.exit(1);
}

// Test Winston integration
console.log('3. Testing Winston integration...');
const logger = require('~/config/winston');
console.log('   Winston logger loaded ✓');
console.log('');

// Test Sentry capture
console.log('4. Sending test events to Sentry...');

// Test 1: Direct Sentry capture
console.log('   Test 1: Direct Sentry.captureMessage...');
Sentry.captureMessage('Sentry Test: Direct message capture', 'info');
console.log('   ✓ Sent test message');

// Test 2: Direct Sentry error capture
console.log('   Test 2: Direct Sentry.captureException...');
const testError = new Error('Sentry Test: Direct exception capture');
Sentry.captureException(testError);
console.log('   ✓ Sent test exception');

// Test 3: Winston error (should go through Sentry transport)
console.log('   Test 3: Winston logger.error...');
logger.error('Sentry Test: Winston error transport', {
  test: true,
  timestamp: new Date().toISOString(),
  errorCode: 'TEST_ERROR',
});
console.log('   ✓ Logged error through Winston');

// Test 4: Winston error with error object
console.log('   Test 4: Winston logger.error with Error object...');
const testWinstonError = new Error('Sentry Test: Winston with error object');
testWinstonError.code = 'TEST_WINSTON_ERROR';
logger.error('Sentry Test: Winston error with stack trace', testWinstonError);
console.log('   ✓ Logged error with stack trace');

// Test 5: MCP Transport errors (should pass through abort filters)
console.log('   Test 5: MCP Transport error - "This operation was aborted"...');
logger.error('[MCP][User: test-user][intercom] Transport error: This operation was aborted', {
  stack: 'AbortError: This operation was aborted\n    at Object.fetch',
  timestamp: new Date().toISOString(),
});
console.log('   ✓ Logged MCP abort error (should be captured)');

// Test 6: MCP Reconnection error
console.log('   Test 6: MCP Transport error - "Failed to reconnect SSE stream"...');
logger.error('[MCP][User: test-user][intercom] Transport error: Failed to reconnect SSE stream: This operation was aborted', {
  stack: 'Error: Failed to reconnect SSE stream: This operation was aborted',
  timestamp: new Date().toISOString(),
});
console.log('   ✓ Logged MCP reconnection error (should be captured)');

// Test 7: MCP Maximum reconnection attempts
console.log('   Test 7: MCP Transport error - "Maximum reconnection attempts exceeded"...');
logger.error('[MCP][User: test-user][intercom] Transport error: Maximum reconnection attempts (2) exceeded.', {
  stack: 'Error: Maximum reconnection attempts (2) exceeded.',
  timestamp: new Date().toISOString(),
});
console.log('   ✓ Logged MCP max attempts error (should be captured)');

// Test 8: Regular abort error (should be filtered out - not MCP)
console.log('   Test 8: Regular abort error (should be filtered - no MCP prefix)...');
logger.error('This operation was aborted', {
  stack: 'AbortError: This operation was aborted',
  timestamp: new Date().toISOString(),
});
console.log('   ✓ Logged regular abort error (should be filtered out)');

console.log('');
console.log('5. Flushing events to Sentry...');

// Flush and wait for events to be sent
Sentry.flush(2000).then(() => {
  console.log('   ✓ Events flushed successfully');
  console.log('');
  console.log('=================================');
  console.log('✅ Test Complete!');
  console.log('=================================');
  console.log('');
  console.log('Check your Sentry dashboard in a few seconds:');
  console.log('https://sentry.io/');
  console.log('');
  console.log('You should see 7 test events (regular abort error should be filtered):');
  console.log('1. "Sentry Test: Direct message capture" (info)');
  console.log('2. "Sentry Test: Direct exception capture" (error)');
  console.log('3. "Sentry Test: Winston error transport" (error)');
  console.log('4. "Sentry Test: Winston with error object" (error)');
  console.log('5. "[MCP]...Transport error: This operation was aborted" (error) ✓ MCP should pass');
  console.log('6. "[MCP]...Failed to reconnect SSE stream" (error) ✓ MCP should pass');
  console.log('7. "[MCP]...Maximum reconnection attempts exceeded" (error) ✓ MCP should pass');
  console.log('');
  console.log('Note: Test 8 (regular abort error) should be filtered out (not appear in Sentry)');
  console.log('      This confirms the filter is working correctly.');
  console.log('');
  process.exit(0);
}).catch((err) => {
  console.error('   ✗ Error flushing events:', err);
  process.exit(1);
});




