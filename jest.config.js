/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  modulePathIgnorePatterns: ['<rootDir>/EchoesOfTheOuterRim/'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@xwingz/core$': '<rootDir>/packages/core/src/index.ts',
    '^@xwingz/physics$': '<rootDir>/packages/physics/src/index.ts',
    '^@xwingz/gameplay$': '<rootDir>/packages/gameplay/src/index.ts',
    '^@dimforge/rapier3d$': '<rootDir>/node_modules/@dimforge/rapier3d/rapier.js'
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'ESNext',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true
        }
      }
    ]
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/tests/**/*.test.ts'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/*/src/**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  transformIgnorePatterns: [
    'node_modules/(?!(@dimforge/rapier3d)/)'
  ]
};
