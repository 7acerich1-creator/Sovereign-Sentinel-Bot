// Optional dependencies — dynamically imported at runtime
declare module "puppeteer" {
  export function launch(options?: any): Promise<any>;
}
