/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@engine/(.*)$': '<rootDir>/src/engine/$1',
    '^@infra/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^@telegram/(.*)$': '<rootDir>/src/telegram/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  verbose: true,
  // Some infrastructure integration tests (RedisStorageAdapter, BullMQ)
  // exercise real network round-trips and delayed-job delivery, which need
  // more headroom than pure unit tests. Individual slow tests still set
  // their own explicit per-test timeout on top of this default.
  testTimeout: 15000,
};
