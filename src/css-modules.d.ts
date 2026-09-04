/** Build-time CSS channels supplied by tsdown.config.ts (mirrors the official client preset). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
declare module '*.css?inline' {
  const text: string
  export default text
}
declare module '*.css' {}
