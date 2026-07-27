// Root ESLint config for the GEM ERP monorepo.
// ESLint 9 walks up from each package's cwd and finds this file, so the shared
// preset applies everywhere unless a package ships its own eslint.config.mjs.
import base from '@gemerp/config/eslint';

export default base;
