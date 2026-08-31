export async function runReview(opts: { port?: string }) {
  console.log(`[review] would start the local approval UI on port ${opts.port ?? "4173"}`);
  // TODO: serve drafted tools and write approved tools to .webmcpify/approved-tools.json
}
