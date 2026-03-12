<script context="module" lang="ts">
  const buildMALLink = (animeID: number) => `https://myanimelist.net/anime/${animeID}`;
</script>

<script lang="ts">
  import type { AnimeDetails } from '../malAPI';
  import type { EmbeddedPointWithIndex } from './AtlasViz';
  import type { Embedding } from '../routes/embedding';

  export let id: number;
  export let datum: EmbeddedPointWithIndex;
  export let embedding: Embedding;
  export let embeddingNeighbors;
  export let viz: { flyTo: (id: number, opts?: { maxZoom?: boolean }) => void };
  export let collaboratorsdict;
  export let onClose: () => void = () => {};
  export let onOpenMatrixModal: ((url: string, title?: string) => void) | null = null;
  const SHOW_PRECOMPUTED_COLLABS = false;
  const normalizeAffText = (v: unknown) => String(v ?? '').trim();
  const isMissingAff = (v: string) => {
    const s = v.toLowerCase();
    return !s || s === 'unknown' || s === 'none' || s === 'null' || s === 'nan' || s === 'n/a';
  };
  const resolveAffiliation = (meta: any) => {
    const direct = normalizeAffText(meta?.Affiliation);
    if (!isMissingAff(direct)) return direct;

    // Canonical metadata should already be complete. Keep one lookup fallback for stale selected object.
    const byId = embeddedPointByID.get(Number(meta?.id))?.metadata;
    const fromLookup = normalizeAffText(byId?.Affiliation);
    if (!isMissingAff(fromLookup)) return fromLookup;

    return 'Unknown';
  };
  const parsePmidsCount = (pmids: unknown) => {
    const raw = String(pmids ?? '').trim();
    if (!raw) return 0;
    return raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean).length;
  };
  const getRecentYear = () => {
    const n = Number((datum?.metadata as any)?.RecentYear);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  let selectedPaperTitles: Array<{ title: string; year?: number; citationCount?: number }> = [];
  let loadingPaperTitles = false;
  let paperTitlesLoadedForAid: number | null = null;

  const pickDisplayPapers = (papers: Array<{ title?: string; year?: number; citation_count?: number }>) => {
    const cleaned = papers
      .filter((p) => p && p.title && String(p.title).trim().length > 0)
      .map((p) => ({
        title: String(p.title).trim(),
        year: Number(p.year) || 0,
        citationCount: Number(p.citation_count) || 0,
      }));

    // Prefer papers that are not too old and not low-citation.
    const tier1 = cleaned
      .filter((p) => p.year >= 2012 && p.citationCount >= 10)
      .sort((a, b) => (b.citationCount - a.citationCount) || (b.year - a.year));
    if (tier1.length >= 2) return tier1.slice(0, 3);

    const tier2 = cleaned
      .filter((p) => p.year >= 2008 && p.citationCount >= 3)
      .sort((a, b) => (b.citationCount - a.citationCount) || (b.year - a.year));
    if (tier2.length >= 2) return tier2.slice(0, 3);

    return cleaned.sort((a, b) => (b.citationCount - a.citationCount) || (b.year - a.year)).slice(0, 3);
  };

  const loadPaperTitlesForAuthor = async (authorId: number) => {
    if (paperTitlesLoadedForAid === authorId) return;
    paperTitlesLoadedForAid = authorId;
    selectedPaperTitles = [];
    loadingPaperTitles = true;
    try {
      const author = embeddedPointByID.get(authorId)?.metadata;
      const pmids = String(author?.Representative_papers ?? '').trim();
      if (!pmids) {
        selectedPaperTitles = [];
        return;
      }
      const pubData = await fetchPubData(pmids);
      selectedPaperTitles = pickDisplayPapers(pubData?.data || []);
    } catch (e) {
      console.error('Failed to load display papers:', e);
      selectedPaperTitles = [];
    } finally {
      loadingPaperTitles = false;
    }
  };

  $: if (datum?.metadata?.IsAuthor && Number.isFinite(Number(datum.metadata.id))) {
    void loadPaperTitlesForAuthor(Number(datum.metadata.id));
  }
  const resolveLocalDevBase = (localUrl: string, productionPath: string) => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return localUrl;
      }
    }
    return productionPath;
  };

  const matrixAppBaseUrl = (
    import.meta.env.PUBLIC_MATRIX_APP_URL || resolveLocalDevBase('http://127.0.0.1:3000', '/matrix')
  ).replace(/\/$/, '');
  const matrixApiBaseUrl = (
    import.meta.env.PUBLIC_MATRIX_API_URL || resolveLocalDevBase('http://127.0.0.1:8001/api', '/matrix/api')
  ).replace(/\/$/, '');

  const openMatrixRecommendation = async (authorId: number) => {
    const aid = String(authorId);
    try {
      const probeRes = await fetch(`${matrixApiBaseUrl}/author/${encodeURIComponent(aid)}`, {
        method: 'GET',
      });
      if (!probeRes.ok) {
        window.alert(
          `MATRIX does not currently have profile data for author ${aid} (API returned ${probeRes.status}).\nThis is a data alignment issue between the two systems, not a broken link.`
        );
        return;
      }
      const params = new URLSearchParams({
        aid,
        return_to: window.location.href,
      });
      const targetUrl = `${matrixAppBaseUrl}/?${params.toString()}`;
      if (onOpenMatrixModal) {
        const authorName = String(datum?.metadata?.FullName || `Author ${aid}`);
        onOpenMatrixModal(targetUrl, `MATRIX for ${authorName}`);
      } else {
        window.location.assign(targetUrl);
      }
    } catch (err) {
      console.error('Failed to validate MATRIX aid:', err);
      window.alert('Unable to reach the MATRIX service right now. Please try again later.');
    }
  };

  let explanations = {};
  let fetchingExplanations = {};
  let reportDialogOpen = false;
  let reportFeedback = '';
  let reportSubmitting = false;
  let reportMessage = '';

  const openReportDialog = () => {
    reportDialogOpen = true;
    reportFeedback = '';
    reportMessage = '';
  };

  const closeReportDialog = () => {
    if (reportSubmitting) return;
    reportDialogOpen = false;
  };

  const submitReportFeedback = async () => {
    const feedbackText = reportFeedback.trim();
    if (!feedbackText || reportSubmitting) return;

    reportSubmitting = true;
    reportMessage = '';
    try {
      const response = await fetch('/api/report-error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project: 'bridge2aikg',
          page: 'author-info',
          reportFolder: 'kg_error',
          feedback: feedbackText,
          currentUrl: typeof window !== 'undefined' ? window.location.href : null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          context: {
            selected_id: Number(datum?.metadata?.id) || null,
            selected_name: String(datum?.metadata?.FullName || ''),
            selected_is_author: Boolean(datum?.metadata?.IsAuthor),
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      reportMessage = 'Thank you. Your feedback has been recorded.';
      reportFeedback = '';
      window.setTimeout(() => {
        reportDialogOpen = false;
        reportMessage = '';
      }, 900);
    } catch (error) {
      console.error('Failed to submit report feedback:', error);
      reportMessage = 'Failed to submit feedback. Please try again.';
    } finally {
      reportSubmitting = false;
    }
  };

  async function handleWhyRecommendClick(focalId, neighborId) {
    const key = `${focalId}_${neighborId}`;
    // Check if we are already fetching an explanation for this neighbor
    if (fetchingExplanations[key]) return;

    fetchingExplanations = { ...fetchingExplanations, [key]: true };
    explanations = { ...explanations, [key]: '' };

    try {
      const focalInfo = await getAuthorInfo(focalId);
      const neighborInfo = await getAuthorInfo(neighborId);
      const neighbors = collaboratorsdict[focalId] || [];
      const collaborators = collaboratorsdict[embeddedPointByID.get(neighborId).metadata.id] || [];
      const intersection = neighbors.filter((neighbor) => collaborators.includes(neighbor));
      const payload = {
        info_a: focalInfo,
        info_b: neighborInfo,
        shared_coauthors: intersection,
      };

      // Call the backend API route
      const response = await fetch('/api/why-recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();
      const explanation = data.explanation;

      explanations = { ...explanations, [key]: explanation };
    } catch (error) {
      console.error('Error fetching explanation:', error);
      explanations = { ...explanations, [key]: 'Sorry, there was an error generating the explanation.' };
    } finally {
      fetchingExplanations = { ...fetchingExplanations, [key]: false };
    }
  }

  async function handleWhyRecommendClickDataset(focalId, neighborId) {
    const key = `${focalId}_${neighborId}`;
    // Check if we are already fetching an explanation for this neighbor
    if (fetchingExplanations[key]) return;

    fetchingExplanations = { ...fetchingExplanations, [key]: true };
    explanations = { ...explanations, [key]: '' };

    try {
      const dataset = embeddedPointByID.get(focalId)?.metadata;
      const focalInfo = `
Dataset Name: ${dataset.FullName}
Dataset URL ${dataset.Data_url}
Dataset Description ${dataset.Data_Description}`;
      const neighborInfo = await getAuthorInfo(neighborId);
      const payload = {
        info_a: focalInfo,
        info_b: neighborInfo,
      };

      // Call the backend API route
      const response = await fetch('/api/why-recommend-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();
      const explanation = data.explanation;

      explanations = { ...explanations, [key]: explanation };
    } catch (error) {
      console.error('Error fetching explanation:', error);
      explanations = { ...explanations, [key]: 'Sorry, there was an error generating the explanation.' };
    } finally {
      fetchingExplanations = { ...fetchingExplanations, [key]: false };
    }
  }

  async function getAuthorInfo(authorId) {
    const author = embeddedPointByID.get(authorId)?.metadata;
    if (!author) return 'Information not available.';

    const pub_string = author.Representative_papers;
    const pubData = await fetchPubData(pub_string);

    // Format each paper's information clearly
    const papersList = pubData.data
      .map(
        (paper, index) => `
    Paper ${index + 1}:
      Title: ${paper.title}
      Year: ${paper.year}
      Journal: ${paper.journal}
      Authors: ${paper.authors}
      Citation Count: ${paper.citation_count}
  `
      )
      .join('\n');

    const info = `
Author Name: ${author.FullName}
Author Affiliation: ${author.Affiliation}
Author Career Begin Year: ${author.BeginYear}
Number of Papers Published (Indexed by PubMed): ${author.PaperNum}
Recent Papers and Publications by ${author.FullName}:
${papersList}
`;

    return info.trim();
  }

  async function fetchPubData(pub_string) {
    try {
      const response = await fetch(
        `https://icite.od.nih.gov/api/pubs?pmids=${pub_string}&fl=pmid,year,title,journal,authors,citation_count`
      );
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Fetch error:', error);
      return { data: [] };
    }
  }

  let embeddedPointByID: Map<number, EmbeddedPointWithIndex> = new Map(embedding.map((p) => [+p.metadata.id, p]));

  let details: { id: number; details: Promise<AnimeDetails> } = {
    id: -1,
    details: new Promise((_resolve) => {}),
  };

  $: {
    if (details.id !== id) {
      details = { id, details: fetch(`/anime?id=${id}`).then((res) => res.json()) };
    }
  }
  // console.log('print fetch details: ',details);

  let navigationStack = []; // Stack to track history

  function navigateTo(id) {
    if (datum.metadata && datum.metadata.id) {
      navigationStack.push(datum.metadata.id); // Push current ID to the stack before navigating
    }
    viz?.flyTo(id); // Fly to the new node
  }

  function goBack() {
    if (navigationStack.length > 0) {
      const previousId = navigationStack.pop(); // Get the last visited node ID from the stack
      viz?.flyTo(previousId); // Fly back to the previous node
    }
  }

  // let focalData = null;  // This will store the data returned from the API

  // // Define the function to fetch data
  // async function fetchPubData(pub_string) {
  //   try {
  //     const response = await fetch(`https://icite.od.nih.gov/api/pubs?pmids=${pub_string}&fl=pmid,year,title,journal,authors,citation_count`);
  //     if (!response.ok) throw new Error('Network response was not ok');
  //     const data = await response.json();
  //     focalData = data; // Update the component's state with the fetched data
  //   } catch (error) {
  //     console.error('Fetch error:', error);
  //   }
  // }
  // fetchPubData(datum.metadata.Representative_papers);
</script>

<div class="root">
  <button class="close-details-btn" on:click={onClose} aria-label="Close details">×</button>
  <div class="details">
    <div class="info">
      {#if datum.metadata.IsAuthor}
        <h2 class="author-title">
          <a href="#" on:click|preventDefault={() => openMatrixRecommendation(datum.metadata.id)}>
            {datum.metadata.FullName}
          </a>
        </h2>
        <div class="section-label">Institution</div>
        <p class="section-value">{resolveAffiliation(datum.metadata)}</p>
        <div class="papers-block">
          <div class="section-label">Publications</div>
          {#if loadingPaperTitles}
            <p class="meta-line">Loading...</p>
          {:else if selectedPaperTitles.length > 0}
            <ul class="paper-list">
              {#each selectedPaperTitles as p}
                <li>
                  {p.title}
                  {#if p.year}
                    <span class="paper-inline-meta"> ({p.year})</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="meta-line">No suitable publication titles available.</p>
          {/if}
        </div>
        <button
          class="rec_button"
          on:click={() => openMatrixRecommendation(datum.metadata.id)}
        >
          Find Teaming Opportunities
        </button>
        <button class="report-error-btn" on:click={openReportDialog}>
          Report Error
        </button>
      {/if}
      {#if !datum.metadata.IsAuthor}
        <h2>
          <a href={datum.metadata.Data_url} target="_blank">
            {datum.metadata.FullName}
            <br />
          </a>
        </h2>
        <!-- <p>Source: {datum.metadata.Data_Source}<p> -->
        <p class="meta-line">
          <strong>Dataset Source:</strong>
          {datum.metadata.Data_Source}
        </p>
        <p class="meta-line"><strong>Description:</strong> {datum.metadata.Data_Description}</p>
        <p class="meta-line">
          <strong>Dataset URL:</strong>
          <a href={datum.metadata.Data_url} target="_blank">{datum.metadata.Data_url}</a>
        </p>

        <p>
          About the dataset (by {datum.metadata.Data_Source}):
        </p>
        <p>{datum.metadata.Data_Description}.</p>
        <a href={datum.metadata.Data_url} target="_blank">{datum.metadata.Data_url}</a>
        <br /><br />
        <button
          class="rec_button"
          onclick="window.open('https://www.google.com/search?q=' + encodeURIComponent('{datum.metadata.FullName} {datum
            .metadata.Data_Description}'));"
        >
          Google
        </button>
        <br />
      {/if}

      <!-- List of potential users or collaborators -->

      <!-- <p>Click a name below to show details</p> -->
      <!-- <button class="go-back" on:click={goBack}>Back</button> -->
      <button class="go-back" on:click={() => viz?.flyTo(id, { maxZoom: true })}>Re-center</button>
      {#if SHOW_PRECOMPUTED_COLLABS}
      <ul>
          {#each embeddingNeighbors[datum.index]
            // Sort by BeginYear in descending order (later years first)
            .sort((a, b) => embeddedPointByID.get(b)?.metadata?.BeginYear - embeddedPointByID.get(a)?.metadata?.BeginYear) as neighborId, i (neighborId)}
            {#if embeddedPointByID.get(neighborId)}
              <li>
                <a
                  href="#"
                  on:click|preventDefault={() => navigateTo(embeddedPointByID.get(neighborId).metadata.id)}
                >
                  <p style="font-size: 15px;">
                    {i + 1}.
                    {embeddedPointByID.get(neighborId).metadata.FullName}
                  </p>
                  <span style="font-size: 12px;">
                    {resolveAffiliation(embeddedPointByID.get(neighborId).metadata)}<br />
                    {embeddedPointByID.get(neighborId).metadata.BeginYear}<br />
                    {(() => {
                      const neighbors = collaboratorsdict[datum.metadata.id] || [];
                      const collaborators = collaboratorsdict[embeddedPointByID.get(neighborId).metadata.id] || [];
                      const intersection = neighbors.filter((neighbor) => collaborators.includes(neighbor));

                      if (intersection.length === 0) {
                        return '';
                      } else if (datum.metadata.IsAuthor == false) {
                        return '';
                      } else if (intersection.length === 1) {
                        return `Shared coauthor: ${embeddedPointByID.get(intersection[0]).metadata.FullName}`;
                      } else {
                        return `Shared coauthors: ${intersection.length} (${embeddedPointByID.get(intersection[0]).metadata.FullName}, etc.)`;
                      }
                    })()}
                  </span>
                </a>
                <br />

                {#if datum.metadata.IsAuthor}
                  <button
                    class="small_button"
                    on:click={() => handleWhyRecommendClick(datum.metadata.id, neighborId)}
                    disabled={fetchingExplanations[`${datum.metadata.id}_${neighborId}`]}
                  >
                    Why Recommend? (ChatGPT)
                  </button>
                {/if}

                {#if datum.metadata.IsAuthor == false}
                  <button
                    class="small_button"
                    on:click={() => handleWhyRecommendClickDataset(datum.metadata.id, neighborId)}
                    disabled={fetchingExplanations[`${datum.metadata.id}_${neighborId}`]}
                  >
                    Why Recommend? (ChatGPT)
                  </button>
                {/if}
                <button
                  class="small_button"
                  onclick="window.open('https://www.google.com/search?q=' + encodeURIComponent('{embeddedPointByID.get(
                    neighborId
                  ).metadata.FullName} {embeddedPointByID.get(neighborId).metadata.Affiliation}'));"
                >
                  Google
                </button>

                {#if fetchingExplanations[`${datum.metadata.id}_${neighborId}`]}
                  <p>Searching in the Knowledge Graph and Reasoning ...</p>
                {:else if explanations[`${datum.metadata.id}_${neighborId}`]}
                  <p>{explanations[`${datum.metadata.id}_${neighborId}`]}</p>
                {/if}
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
      <!-- Go Back Button -->
    </div>
  </div>
</div>

{#if reportDialogOpen}
  <div class="report-modal-backdrop" on:click={closeReportDialog} role="button" tabindex="0" aria-label="Close report dialog">
    <div class="report-modal" on:click|stopPropagation>
      <h3>Report Error</h3>
      <p class="report-modal-desc">Describe the issue in this author info panel.</p>
      <textarea
        class="report-textarea"
        placeholder="Please enter your feedback..."
        bind:value={reportFeedback}
        rows="5"
      />
      {#if reportMessage}
        <p class="report-message">{reportMessage}</p>
      {/if}
      <div class="report-actions">
        <button class="report-cancel-btn" on:click={closeReportDialog} disabled={reportSubmitting}>Cancel</button>
        <button
          class="report-submit-btn"
          on:click={submitReportFeedback}
          disabled={reportSubmitting || !reportFeedback.trim()}
        >
          {reportSubmitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style lang="css">
  .root {
    padding: 14px 22px 16px 14px;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
    backdrop-filter: blur(8px);
    position: absolute;
    top: auto;
    left: auto;
    right: 12px;
    bottom: 12px;
    width: clamp(320px, 34vw, 460px);
    max-width: calc(100vw - 24px);
    max-height: none;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    z-index: 25;
    color: #0f172a !important;
  }

  .close-details-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    border: 1px solid #cbd5e1;
    border-radius: 999px;
    background: #ffffff;
    color: #334155;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  .close-details-btn:hover {
    background-color: #f1f5f9;
    color: #0f172a;
  }

  .details {
    width: 100%;
    display: flex;
    flex-direction: column;
    margin-bottom: 8px;
    gap: 8px;
  }

  h2 {
    margin-top: 4px;
    margin-bottom: 8px;
    font-size: 20px;
    text-align: left;
    line-height: 24px;
    color: #0b1220 !important;
  }

  .author-title {
    margin-bottom: 10px;
  }

  .meta-line {
    margin: 4px 0;
  }

  .papers-block {
    margin-top: 6px;
    margin-bottom: 10px;
  }

  .paper-list {
    margin-top: 8px;
    margin-left: 0;
    padding-left: 16px;
    padding-right: 6px;
  }

  .paper-list li {
    margin: 6px 0;
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .paper-inline-meta {
    color: #334155 !important;
    font-size: 12px;
  }

  h2 a {
    color: #0b1220 !important;
    text-decoration: none;
    transition: color 0.3s;
  }

  h2 a:hover {
    color: #0b57d0 !important;
  }

  p {
    font-size: 14px;
    font-weight: 500;
    margin: 2px 0;
    color: #0f172a !important;
    padding: 2px 0;
    line-height: 1.45;
  }

  h3 {
    margin-top: 8px;
    margin-bottom: 8px;
    font-size: 18px;
    color: #0f172a;
  }

  ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
    width: 100%;
  }

  ul li {
    background-color: rgba(248, 250, 252, 0.98);
    padding: 8px 10px;
    margin-bottom: 8px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.32);
    transition: background-color 0.25s, border-color 0.25s;
  }

  ul li:hover {
    background-color: #f1f5f9;
    border-color: rgba(14, 116, 144, 0.34);
  }

  ul li a {
    color: #0f172a;
    text-decoration: none;
    font-size: 14px;
    transition: color 0.3s;
  }

  ul li a:hover {
    color: #0369a1;
  }

  .rec_button {
    font-size: 13px;
    margin-top: 10px;
    margin-bottom: 4px;
    padding: 9px 12px;
    background: #0f172a;
    color: #fff;
    border: 1px solid #0f172a;
    border-radius: 7px;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
    text-align: center;
    font-weight: 700;
    width: 100%;
  }

  .rec_button:hover {
    background: #1e293b;
    border-color: #1e293b;
  }

  .report-error-btn {
    width: 100%;
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 7px;
    border: 1px solid #ef4444;
    background: #fff1f2;
    color: #b91c1c;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .report-error-btn:hover {
    background: #ffe4e6;
  }

  .section-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #334155 !important;
    margin: 2px 0 4px;
  }

  .section-value {
    margin: 0 0 6px;
    color: #0f172a !important;
  }

  .small_button {
    font-size: 10px;
    margin-top: 8px;
    margin-bottom: 8px;
    padding: 8px 12px;
    background-color: #f8fafc;
    color: #0f172a;
    border: 1px solid rgba(148, 163, 184, 0.45);
    border-radius: 7px;
    cursor: pointer;
    transition: background-color 0.3s;
    text-align: left;
  }

  .go-back {
    font-size: 12px;
    margin-top: 8px;
    margin-bottom: 4px;
    padding: 8px 12px;
    background-color: #ffffff;
    color: #0f172a;
    border: 1px solid #94a3b8;
    border-radius: 7px;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .go-back:hover {
    background-color: #e2e8f0;
  }

  .report-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.52);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 80;
    padding: 12px;
  }

  .report-modal {
    width: min(520px, calc(100vw - 24px));
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #cbd5e1;
    padding: 14px;
    box-shadow: 0 18px 38px rgba(2, 6, 23, 0.3);
  }

  .report-modal-desc {
    margin-top: 4px;
    margin-bottom: 10px;
    color: #475569 !important;
  }

  .report-textarea {
    width: 100%;
    box-sizing: border-box;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    padding: 10px;
    font-size: 14px;
    color: #0f172a;
    resize: vertical;
    min-height: 110px;
    color-scheme: light;
    -webkit-text-fill-color: #0f172a;
  }

  .report-textarea::placeholder {
    color: #64748b;
    opacity: 1;
  }

  .report-textarea:focus {
    outline: none;
    border-color: #0369a1;
    box-shadow: 0 0 0 3px rgba(3, 105, 161, 0.12);
  }

  .report-message {
    margin-top: 8px;
    margin-bottom: 0;
    color: #0f766e !important;
    font-size: 13px;
    font-weight: 600;
  }

  .report-actions {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .report-cancel-btn,
  .report-submit-btn {
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    background: #ffffff;
    color: #0f172a;
  }

  .report-submit-btn {
    border-color: #0369a1;
    background: #0369a1;
    color: #ffffff;
  }

  .report-cancel-btn:disabled,
  .report-submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .papers-block strong,
  .papers-block li,
  .papers-block span,
  .info strong,
  .info a,
  .info li {
    color: #0f172a !important;
  }

  @media (max-width: 1200px) {
    .root {
      width: min(40vw, 460px);
    }
  }

  @media (max-width: 900px) {
    .root {
      left: auto;
      right: 12px;
      bottom: 12px;
      width: min(460px, calc(100vw - 24px));
      max-height: none;
      overflow: hidden;
    }
  }
</style>
