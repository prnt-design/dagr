/**
 * Types for `names.mjs`.
 *
 * `register.ts` imports those constants, and it is typechecked by the packages
 * that consume the bench kit as well as by this one. Those packages do not
 * enable `allowJs`, and enabling it in each of them to read one two-constant
 * module would be a wide change for a narrow reason. A declaration file keeps
 * the constants readable from TypeScript without it.
 */
export declare const CONTROL_GROUP: 'control';
export declare const CONTROL_NAME: 'mixed';
