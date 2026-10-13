import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Next.js-Regeln (React, Hooks, Barrierefreiheit) plus TypeScript. */
const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Absichtlich ungenutzte Parameter (z. B. `_prev` bei Server Actions).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Gerätefotos kommen verkleinert und nur mit Anmeldung aus /api –
      // der Bildoptimierer von next/image hätte dort weder Zugriff noch Nutzen.
      "@next/next/no-img-element": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", "data/**", "next-env.d.ts"],
  },
];

export default config;
