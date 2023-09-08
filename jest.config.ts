import type {Config} from '@jest/types';

// eslint-disable-next-line import/no-anonymous-default-export
export default async (): Promise<Config.InitialOptions> => {
  return {
    clearMocks: true,
    moduleFileExtensions: ['js', 'ts'],
    testMatch: ['**/*.test.ts'],
    transform: {
      '^.+\\.ts$': ['ts-jest', {tsconfig: './tsconfig.test.json'}],
    },
    verbose: true,

    collectCoverage: true,
    coverageDirectory: 'target',
    coverageReporters: ['lcovonly', ['text', {skipFull: true}]],
    coverageThreshold: {
      global: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: -10,
      },
    },
  };
};
