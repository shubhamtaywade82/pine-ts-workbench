const config = {
  plugins: {
    // Resolve `@import "tailwindcss"` from this project: without a base,
    // Tailwind fell back to the parent folder on the first compile and
    // logged "Can't resolve 'tailwindcss' in '…/tradingview-pine'".
    "@tailwindcss/postcss": { base: import.meta.dirname },
  },
};

export default config;
