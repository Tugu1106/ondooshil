/**
 * Stub for the `server-only` package under vitest.
 *
 * The real package throws on import unless the bundler sets React's `react-server`
 * condition, which Next.js does and vitest does not. The guard it provides is a *build
 * time* protection against importing server code into a client bundle; it has no runtime
 * behaviour worth preserving in a unit test, so an empty module is the honest stand-in.
 *
 * Aliased in vitest.config.mts.
 */
export {};
