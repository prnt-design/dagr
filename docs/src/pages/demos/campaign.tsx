import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './campaign.module.css';

/** Keep historical URLs useful without promoting or mounting the old scene. */
export default function CampaignArchive() {
  return (
    <Layout title="Archived experiment">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <main className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>An experiment, preserved.</h1>
          <p className={styles.lede}>
            The campaign demo has been retired from the showcase. Its generated
            dataset, renderer stage, and historical captures remain in the
            repository as development artifacts.
          </p>
          <p>
            <Link to="/">Explore Inside the graph →</Link>
          </p>
          <p>
            <a href="https://github.com/prnt-design/dagr/tree/main/packages/campaign">
              Browse the archived fixture ↗
            </a>
          </p>
        </header>
      </main>
    </Layout>
  );
}
