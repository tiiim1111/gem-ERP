/**
 * Jest configuration for @gemerp/api.
 *
 * Unit tests run WITHOUT a database: PrismaService is always replaced with
 * plain jest mocks. @gemerp/shared is mapped to its TypeScript source so the
 * suite does not require `pnpm build` to have run first.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.spec.json' },
    ],
  },
  moduleNameMapper: {
    '^@gemerp/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  clearMocks: true,
  verbose: false,
};
