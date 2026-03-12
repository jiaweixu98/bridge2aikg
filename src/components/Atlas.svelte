<script lang="ts">
  import { browser } from '$app/environment';

  import { onMount } from 'svelte';

  import type { EmbeddingName } from 'src/types';
  import type { Embedding } from '../routes/embedding';
  import AnimeDetails from './AnimeDetails.svelte';
  import { AtlasViz, ColorBy, getDefaultColorBy } from './AtlasViz';
  import { DEFAULT_PROFILE_SOURCE, ProfileSource } from './recommendation/conf';
  import Search from './Search.svelte';
  import VizControls from './VizControls.svelte';
  import Header from './recommendation/Header.svelte';


  export let embeddingName: EmbeddingName;
  export let embedding: Embedding;
  export let embeddingNeighbors;
  // what if directly read neighbors here
  export let collaboratorsdict;
  export let username: string | undefined = undefined;
  export let maxWidth: number | undefined = undefined;
  export let disableEmbeddingSelection: boolean = true;
  export let disableUsernameSearch: boolean = false;
  export let profileSource: ProfileSource = DEFAULT_PROFILE_SOURCE;

  // console.log('embeddingNeighbors:', embeddingNeighbors);
  let viz: AtlasViz | null = null;
  let selectedNodeID: number | null = null; // Support Bioentity
  let selectedAnimeID: number | null = null;
  $: selectedDatum = selectedAnimeID === null || !viz ? null : viz.embeddedPointByID.get(selectedAnimeID)!;
  $: defaultAuthorForMatrix = (() => {
    const fallback = embedding.find((d) => d.metadata?.id === DEFAULT_OPEN_AUTHOR_ID && d.metadata?.IsAuthor);
    return fallback ? { id: fallback.metadata.id, name: fallback.metadata.FullName } : null;
  })();
  $: selectedAuthorForMatrix =
    selectedDatum && selectedDatum.metadata?.IsAuthor
      ? { id: selectedDatum.metadata.id, name: selectedDatum.metadata.FullName }
      : (!introPlaying ? defaultAuthorForMatrix : null);

  $: if (viz) {
    viz.setMaxWidth(maxWidth);
  }

  let colorBy = browser ? getDefaultColorBy() : ColorBy.Number_NIHindexed;
  // console.log("Current colorBy setting:", colorBy);

  const setColorBy = (newColorBy: ColorBy) => {
    colorBy = newColorBy;
    viz?.setColorBy(colorBy);
  };

  const DEFAULT_OPEN_AUTHOR_ID = 6052561;
  const INTRO_START_CAMERA_HEIGHT = 1244;
  const INTRO_HOLD_MS = 1500;
  const INTRO_FLY_MS = 3000;
  let introPlaying = true;
  let introReplayToken = 0;

  const getMatrixAppBaseUrl = () => {
    const configured = (import.meta.env.PUBLIC_MATRIX_APP_URL || '').trim();
    if (configured) {
      return configured.replace(/\/$/, '');
    }
    if (browser) {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://127.0.0.1:3000';
      }
    }
    return '/matrix';
  };

  let matrixModalOpen = false;
  let matrixModalUrl = '';
  let matrixModalTitle = 'MATRIX Teaming Assistant';

  const openMatrixModal = (url: string, title = 'MATRIX Teaming Assistant') => {
    matrixModalUrl = url;
    matrixModalTitle = title;
    matrixModalOpen = true;
  };

  const closeMatrixModal = () => {
    matrixModalOpen = false;
    matrixModalUrl = '';
  };

  const requestCloseMatrixModal = () => {
    if (!matrixModalOpen) return;
    if (!browser) {
      closeMatrixModal();
      return;
    }
    const confirmed = window.confirm('Close Teaming Assistant? Current progress in the modal may be lost.');
    if (confirmed) {
      closeMatrixModal();
    }
  };

  const handleGlobalKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && matrixModalOpen) {
      requestCloseMatrixModal();
    }
  };

  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const playIntroSequence = async (token: number, resetState: boolean) => {
    if (!viz) return;
    const isTokenActive = () => token === introReplayToken;

    introPlaying = true;
    viz.setLabelsVisible(false);

    if (resetState) {
      closeMatrixModal();
      generalFeedbackOpen = false;
      generalFeedbackMessage = '';
      generalFeedbackText = '';
      viz.resetSelectionAndHighlights();
    }

    viz.setCameraCenterAndHeight(0, 0, INTRO_START_CAMERA_HEIGHT);

    if (embedding.some((d) => d.metadata?.id === DEFAULT_OPEN_AUTHOR_ID)) {
      await sleep(INTRO_HOLD_MS);
      if (!viz || !isTokenActive()) return;
      await viz.flyToCameraOnly(DEFAULT_OPEN_AUTHOR_ID, { targetScale: 8, timeMs: INTRO_FLY_MS });
    }

    if (!viz || !isTokenActive()) return;
    viz.setLabelsVisible(true);
    introPlaying = false;
  };

  const normalizeCollaboratorIds = (ids: unknown): number[] => {
    if (!Array.isArray(ids)) return [];
    return ids
      .map((rawId) => Number(rawId))
      .filter((num) => Number.isFinite(num));
  };

  const loadMALProfile = async (id: number) => {
    if (!viz) {
      console.error('Tried to load MAL profile before Atlas viz was loaded.');
      return;
    }
    
    // Check if we already have collaborators for this author
    if (Object.prototype.hasOwnProperty.call(collaboratorsdict, id)) {
      const collaboratorIds = normalizeCollaboratorIds(collaboratorsdict[id]);
      const collaboratorObjects = collaboratorIds.map((id) => ({ node: { id } }));
      viz?.displayMALUser(collaboratorObjects);
      return;
    }
    
    // Load collaborators on-demand from API
    console.time(`[timing] Load collaborators for author ${id}`);
    try {
      const response = await fetch(`/api/collaborators/${id}`);
      if (!response.ok) {
        console.error(`Failed to load collaborators for ${id}`);
        return;
      }
      
      const data = await response.json();
      const collaboratorIds = normalizeCollaboratorIds(data.collaborators);
      
      // Cache for future use
      collaboratorsdict[id] = collaboratorIds;
      
      console.log(`[timing] Loaded ${collaboratorIds.length} collaborators for author ${id}`);
      console.timeEnd(`[timing] Load collaborators for author ${id}`);
      
      const collaboratorObjects = collaboratorIds.map((id: number) => ({ node: { id } }));
      viz?.displayMALUser(collaboratorObjects);
    } catch (e) {
      console.error(`Error loading collaborators for ${id}:`, e);
    }
  };

  onMount(() => {
    let disposed = false;
    import('../pixi').then(async (mod) => {
      if (disposed) return;
      const setSelectedAnimeID = (newSelectedAnimeID: number | null) => {
        selectedAnimeID = newSelectedAnimeID;
      };
      viz = new AtlasViz(mod, 'viz', embedding, setSelectedAnimeID, maxWidth);
      viz.setColorBy(colorBy);
      viz?.setCollaboratorsDict(collaboratorsdict);
      const token = ++introReplayToken;
      await playIntroSequence(token, false);
      const embeddingNeighborsPromise = Promise.resolve(embeddingNeighbors);
      embeddingNeighborsPromise.then((neighbors) => {
        viz?.setNeighbors(neighbors);
      });
    });

    return () => {
      disposed = true;
      introReplayToken += 1;
      introPlaying = false;
      viz?.dispose();
      viz = null;
    };
  });

  const openMatrixFromAtlas = () => {
    const params = new URLSearchParams();
    if (selectedAuthorForMatrix) {
      params.set('aid', String(selectedAuthorForMatrix.id));
    }
    if (browser) {
      params.set('return_to', window.location.href);
    }
    const query = params.toString();
    const matrixAppBaseUrl = getMatrixAppBaseUrl();
    openMatrixModal(
      `${matrixAppBaseUrl}/${query ? `?${query}` : ''}`,
      selectedAuthorForMatrix
        ? `MATRIX for ${selectedAuthorForMatrix.name}`
        : 'MATRIX Recommender'
    );
  };

  const resetAtlasView = () => {
    if (!viz) return;
    const token = ++introReplayToken;
    void playIntroSequence(token, true);
  };

  let generalFeedbackOpen = false;
  let generalFeedbackText = '';
  let generalFeedbackSubmitting = false;
  let generalFeedbackMessage = '';

  const openGeneralFeedback = () => {
    generalFeedbackOpen = true;
    generalFeedbackText = '';
    generalFeedbackMessage = '';
  };

  const closeGeneralFeedback = () => {
    if (generalFeedbackSubmitting) return;
    generalFeedbackOpen = false;
  };

  const submitGeneralFeedback = async () => {
    const feedbackText = generalFeedbackText.trim();
    if (!feedbackText || generalFeedbackSubmitting) return;

    generalFeedbackSubmitting = true;
    generalFeedbackMessage = '';
    try {
      const response = await fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: 'bridge2aikg',
          page: 'atlas-general-feedback',
          reportFolder: 'general_feedback',
          feedback: feedbackText,
          currentUrl: browser ? window.location.href : null,
          userAgent: browser ? window.navigator.userAgent : null,
          context: {
            selected_author_id: selectedAuthorForMatrix?.id ?? null,
            selected_author_name: selectedAuthorForMatrix?.name ?? null,
            matrix_modal_open: matrixModalOpen,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      generalFeedbackMessage = 'Thanks, feedback saved.';
      generalFeedbackText = '';
      window.setTimeout(() => {
        generalFeedbackOpen = false;
        generalFeedbackMessage = '';
      }, 900);
    } catch (error) {
      console.error('Failed to submit general feedback:', error);
      generalFeedbackMessage = 'Failed to submit feedback. Please try again.';
    } finally {
      generalFeedbackSubmitting = false;
    }
  };
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<svelte:head>
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="root">
  <canvas id="viz" />
  {#if introPlaying}
    <div class="intro-lock" aria-hidden="true"></div>
  {/if}
</div>
{#if viz && !introPlaying}
  <Search {embedding} onSubmit={(id) => viz?.flyTo(id, { targetScale: 7 })} suggestionsStyle="top: 50px;" />
  <VizControls
    {colorBy}
    {setColorBy}
    {disableEmbeddingSelection}
    {disableUsernameSearch}
    {embedding}
    onSubmit={(id) => {
      loadMALProfile(id);
      viz?.setCollabID(id);
    }}
    suggestionsStyle="top: 30px;"
  />
{/if}

<div class="matrix-entry">
  <div class="matrix-entry-title">
    Teaming Assistant
    <span class="matrix-entry-hot">Try Me</span>
    <span class="matrix-entry-ping" aria-hidden="true"></span>
  </div>
  <button class="matrix-entry-button" on:click={openMatrixFromAtlas}>
    {selectedAuthorForMatrix
      ? `Open MATRIX for ${selectedAuthorForMatrix.name}`
      : 'Open MATRIX Recommender'}
  </button>
  <div class="matrix-entry-hint">
    {selectedAuthorForMatrix
      ? `Using author ID ${selectedAuthorForMatrix.id}`
      : 'Select an author node to pass a specific ID.'}
  </div>
</div>

<div id="atlas-viz-legend" />
<div class="debug-controls" class:intro-hidden={introPlaying}>
  <div id="atlas-viz-debug" />
  <div class="atlas-action-buttons">
    <button class="atlas-feedback-button" on:click={openGeneralFeedback}>Feedback</button>
    <button class="atlas-reset-button" on:click={resetAtlasView}>Reset View</button>
  </div>
</div>

<div
  id="toast-container"
  style="
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: rgba(0,0,0,0.8);
  color: white;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  display: none;
  z-index: 9999;
  transition: opacity 0.3s ease;
"
></div>
{#if selectedDatum !== null && viz}
  <AnimeDetails
    id={selectedDatum.metadata.id}
    datum={selectedDatum}
    {embedding}
    {embeddingNeighbors}
    {viz}
    {collaboratorsdict}
    onOpenMatrixModal={openMatrixModal}
    onClose={() => (selectedAnimeID = null)}
  />
{/if}

{#if generalFeedbackOpen}
  <div class="feedback-modal-backdrop" on:click={closeGeneralFeedback} role="button" tabindex="0" aria-label="Close feedback dialog">
    <div class="feedback-modal" on:click|stopPropagation>
      <h3>Feedback</h3>
      <p class="feedback-modal-desc">Share any issue or suggestion about this visualization page.</p>
      <textarea
        class="feedback-textarea"
        rows="5"
        placeholder="Please enter your feedback..."
        bind:value={generalFeedbackText}
      />
      {#if generalFeedbackMessage}
        <p class="feedback-message">{generalFeedbackMessage}</p>
      {/if}
      <div class="feedback-actions">
        <button class="feedback-cancel-btn" on:click={closeGeneralFeedback} disabled={generalFeedbackSubmitting}>Cancel</button>
        <button
          class="feedback-submit-btn"
          on:click={submitGeneralFeedback}
          disabled={generalFeedbackSubmitting || !generalFeedbackText.trim()}
        >
          {generalFeedbackSubmitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if matrixModalOpen}
  <div
    class="matrix-modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close MATRIX modal"
    on:click={requestCloseMatrixModal}
    on:keydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        requestCloseMatrixModal();
      }
    }}
  >
    <div
      class="matrix-modal"
      role="dialog"
      aria-modal="true"
      aria-label={matrixModalTitle}
      on:click|stopPropagation
    >
      <div class="matrix-modal-header">
        <div class="matrix-modal-title">{matrixModalTitle}</div>
        <button class="matrix-modal-close" on:click={requestCloseMatrixModal} aria-label="Close MATRIX modal">×</button>
      </div>
      <iframe
        class="matrix-modal-iframe"
        src={matrixModalUrl}
        title={matrixModalTitle}
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
      />
    </div>
  </div>
{/if}

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    position: relative;
    font-family: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  }

  .intro-lock {
    position: absolute;
    inset: 0;
    z-index: 70;
    background: transparent;
    pointer-events: all;
  }

  .matrix-entry {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: min(420px, calc(100vw - 24px));
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.12);
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(8px);
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.14);
    animation: matrixEntryGlow 2s ease-in-out infinite;
    overflow: hidden;
    isolation: isolate;
  }

  .matrix-entry::before {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 14px;
    background: conic-gradient(
      from 0deg,
      rgba(14, 165, 233, 0.0),
      rgba(14, 165, 233, 0.55),
      rgba(16, 185, 129, 0.55),
      rgba(14, 165, 233, 0.0)
    );
    animation: matrixBorderSpin 2.8s linear infinite;
    z-index: -2;
  }

  .matrix-entry::after {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: 11px;
    background: rgba(255, 255, 255, 0.92);
    z-index: -1;
  }

  .matrix-entry-title {
    color: #0369a1;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .matrix-entry-hot {
    font-size: 10px;
    font-weight: 800;
    text-transform: none;
    letter-spacing: 0.02em;
    color: #fff;
    background: linear-gradient(135deg, #f97316, #ef4444);
    border-radius: 999px;
    padding: 2px 7px;
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
    animation: matrixHotBounce 1.4s ease-in-out infinite;
  }

  .matrix-entry-ping {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: #22c55e;
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5);
    animation: matrixEntryPing 1.4s ease-out infinite;
  }

  .matrix-entry-button {
    position: relative;
    font-size: 14px;
    font-weight: 700;
    padding: 10px 14px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, #10b981, #0ea5e9);
    color: #fff;
    cursor: pointer;
    box-shadow: 0 8px 22px rgba(2, 132, 199, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: transform 0.2s ease, filter 0.2s ease, box-shadow 0.2s ease;
    animation: matrixButtonPulse 1.8s ease-in-out infinite;
  }

  .matrix-entry-button::after {
    content: '';
    position: absolute;
    top: 0;
    left: -35%;
    width: 30%;
    height: 100%;
    background: linear-gradient(
      100deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.28) 45%,
      rgba(255, 255, 255, 0) 100%
    );
    transform: skewX(-18deg);
    animation: matrixButtonSweep 2.3s ease-in-out infinite;
    pointer-events: none;
  }

  .matrix-entry-button:hover {
    filter: brightness(1.1);
    transform: translateY(-2px) scale(1.01);
    box-shadow: 0 10px 26px rgba(14, 116, 144, 0.45);
  }

  .matrix-entry-hint {
    color: #0f172a;
    font-size: 12px;
    font-weight: 600;
    text-shadow: none;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes matrixEntryGlow {
    0%,
    100% {
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.14), 0 0 0 0 rgba(14, 165, 233, 0.18);
    }
    50% {
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18), 0 0 0 7px rgba(14, 165, 233, 0.12);
    }
  }

  @keyframes matrixBorderSpin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes matrixHotBounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-1px);
    }
  }

  @keyframes matrixEntryPing {
    0% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45);
    }
    70% {
      box-shadow: 0 0 0 7px rgba(34, 197, 94, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
    }
  }

  @keyframes matrixButtonSweep {
    0%,
    82%,
    100% {
      left: -35%;
    }
    90% {
      left: 120%;
    }
  }

  @keyframes matrixButtonPulse {
    0%,
    100% {
      box-shadow: 0 8px 22px rgba(2, 132, 199, 0.45);
    }
    50% {
      box-shadow: 0 12px 28px rgba(2, 132, 199, 0.55);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .matrix-entry,
    .matrix-entry-ping,
    .matrix-entry-button::after {
      animation: none !important;
    }
    .matrix-entry-button {
      transition: none;
    }
  }

  .matrix-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(2, 6, 23, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .matrix-modal {
    width: min(1200px, 96vw);
    height: min(820px, 92vh);
    background: #ffffff;
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.12);
    box-shadow: 0 22px 50px rgba(2, 6, 23, 0.35);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .matrix-modal-header {
    height: 48px;
    min-height: 48px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.1);
    background: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .matrix-modal-title {
    font-size: 14px;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .matrix-modal-close {
    width: 34px;
    height: 34px;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  .matrix-modal-close:hover {
    background: #f1f5f9;
    color: #0f172a;
  }

  .matrix-modal-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #ffffff;
  }

  #atlas-viz-legend {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 9;
    background: rgba(255, 255, 255, 0.9);
    padding: 10px;
    border-radius: 8px;
    border: 1px solid rgba(15, 23, 42, 0.12);
    backdrop-filter: blur(8px);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
  }

  #atlas-viz-debug {
    min-width: 220px;
    max-width: min(360px, calc(100vw - 24px));
    background: rgba(15, 23, 42, 0.8);
    color: #e2e8f0;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    line-height: 1.5;
    white-space: pre;
    pointer-events: none;
    backdrop-filter: blur(4px);
    box-shadow: 0 8px 18px rgba(2, 6, 23, 0.35);
  }

  .debug-controls {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 12;
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .atlas-action-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .atlas-feedback-button {
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid rgba(16, 185, 129, 0.6);
    background: rgba(16, 185, 129, 0.16);
    color: #d1fae5;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 8px 18px rgba(2, 6, 23, 0.35);
  }

  .atlas-feedback-button:hover {
    background: rgba(16, 185, 129, 0.26);
  }

  .intro-hidden {
    display: none;
  }

  .atlas-reset-button {
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.85);
    color: #e2e8f0;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 8px 18px rgba(2, 6, 23, 0.35);
  }

  .atlas-reset-button:hover {
    background: rgba(30, 41, 59, 0.92);
  }

  .feedback-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 85;
    background: rgba(15, 23, 42, 0.52);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }

  .feedback-modal {
    width: min(520px, calc(100vw - 24px));
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #cbd5e1;
    box-shadow: 0 18px 38px rgba(2, 6, 23, 0.3);
    padding: 14px;
    color: #0f172a;
  }

  .feedback-modal-desc {
    margin: 4px 0 10px;
    color: #475569;
    font-size: 14px;
    font-weight: 500;
  }

  .feedback-textarea {
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

  .feedback-textarea::placeholder {
    color: #64748b;
    opacity: 1;
  }

  .feedback-textarea:focus {
    outline: none;
    border-color: #0369a1;
    box-shadow: 0 0 0 3px rgba(3, 105, 161, 0.12);
  }

  .feedback-message {
    margin: 8px 0 0;
    color: #0f766e;
    font-size: 13px;
    font-weight: 600;
  }

  .feedback-actions {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .feedback-cancel-btn,
  .feedback-submit-btn {
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    background: #ffffff;
    color: #0f172a;
  }

  .feedback-submit-btn {
    border-color: #0369a1;
    background: #0369a1;
    color: #ffffff;
  }

  .feedback-cancel-btn:disabled,
  .feedback-submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Keep legend text readable on the light card */
  :global(#atlas-viz-legend),
  :global(#atlas-viz-legend label),
  :global(#atlas-viz-legend span),
  :global(#atlas-viz-legend div) {
    color: #0f172a !important;
  }

  :global(#atlas-viz-legend svg text) {
    fill: #0f172a !important;
  }

  @media (max-width: 768px) {
    .matrix-entry {
      top: auto;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      max-width: calc(100vw - 24px);
    }

    #atlas-viz-legend {
      top: 58px;
      right: 8px;
    }

    .debug-controls {
      left: 8px;
      bottom: 8px;
    }

    #atlas-viz-debug {
      max-width: calc(100vw - 16px);
      font-size: 11px;
    }
  }

  @media (max-width: 800px) {
    #atlas-viz-legend {
      transform: scale(0.83);
      transform-origin: right top;
      right: 8px;
    }
  }

  @media (max-width: 600px) {
    #atlas-viz-legend {
      top: 56px;
      right: 6px;
      background: rgba(255, 255, 255, 0.94);
      padding: 4px;
    }
  }
</style>
