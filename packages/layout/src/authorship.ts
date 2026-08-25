/**
 * Which stage objects this package wrote, and why anything needs to ask.
 *
 * M3.9's fast paths are the first thing here that decides NOT to run the
 * pipeline, and every one of them rests on a claim about what a stage reads.
 * "A patch that only moves a port changes no geometry" is true of every stage
 * in this package and is not a rule the pipeline imposes: a stage is handed the
 * whole {@link PreparedState}, so a caller's own router may read ports, a
 * caller's own ranker may read an edge attribute, and M7's compound layout will
 * read a parent. A skip taken against such a stage is not a slower answer or a
 * wider bound, it is a WRONG DRAWING returned silently, which is a worse
 * failure than any this package has shipped, so the claim has to be checked
 * rather than assumed.
 *
 * The check cannot be identity against a list of exported names, because half
 * the stages here come out of a factory: `networkSimplexRank({ maxIterations })`
 * and `barycenterOrder({ sweeps })` mint a fresh object per call, and a caller
 * who tuned one is exactly the caller who should keep the fast path. So each
 * construction site registers what it made, here, and the engine asks this
 * question of the four stages it was given.
 *
 * A `WeakSet` rather than a flag on the stage object, for two reasons. The
 * stages are frozen at their construction sites, so there is nothing to write
 * on afterwards. And a flag is a thing a caller can copy: spreading one of
 * these stages into an object with a different `run` would carry the mark onto
 * a stage this package did not write, which is precisely the case the mark
 * exists to catch.
 *
 * IT IS A CONSERVATIVE ANSWER AND NOT AN EXACT ONE. A caller's stage that
 * happens to read nothing but ranks is refused the fast path along with one
 * that reads everything, because "what does this stage read" is not a question
 * a stage can be asked today. Letting a stage DECLARE it is the obvious lift
 * and it is M3.9b's to take: it is a widening of four public interfaces, and
 * nothing needs it until a consumer with their own stage wants the fast path
 * back.
 */

/**
 * Stages built in this package, by identity.
 *
 * Weak so that a factory called once per engine in a long-lived process does
 * not accumulate an entry per engine that outlives the engine.
 */
const authoredStages = new WeakSet<object>();

/**
 * Marks a stage as one this package wrote, and hands it straight back so a
 * construction site stays a single expression.
 */
export function authored<T extends object>(stage: T): T {
  authoredStages.add(stage);
  return stage;
}

/** Whether this stage is one {@link authored} marked. */
export function isAuthored(stage: object): boolean {
  return authoredStages.has(stage);
}
