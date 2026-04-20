module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  globals: {
    'ts-jest': {
      tsconfig: {
        module: 'commonjs',
        target: 'es2019',
        esModuleInterop: true,
        resolveJsonModule: true,
        strict: true,
        jsx: 'react',
        skipLibCheck: true,
      },
    },
  },
};
