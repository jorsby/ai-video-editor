declare module 'gl-transitions' {
  interface GlTransition {
    name: string;
    paramsTypes: Record<string, string>;
    defaultParams: Record<string, unknown>;
    glsl: string;
  }
  const transitions: GlTransition[];
  export default transitions;
}
