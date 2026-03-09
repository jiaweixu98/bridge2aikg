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

  let publicationRange: [number, number] = [0, 0]; // publication amount range
  let selectedPublicationRange: [number, number] = [0, 0]; // initial range
  let beginYearRange: [number, number] = [1980, 2024]; // 🔶 add BeginYear range
  let selectedRange: [number, number] = [0, 0]; // 🔶 initial range
  let rangeType: 'PaperNum' | 'BeginYear' = 'PaperNum'; // 🔶 Dropdown options
  let filtersInitialized = false; // renderNodes controller

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
  $: selectedAuthorForMatrix =
    selectedDatum && selectedDatum.metadata?.IsAuthor
      ? { id: selectedDatum.metadata.id, name: selectedDatum.metadata.FullName }
      : null;

  $: if (viz) {
    viz.setMaxWidth(maxWidth);
  }

  let colorBy = browser ? getDefaultColorBy() : ColorBy.Number_NIHindexed;
  // console.log("Current colorBy setting:", colorBy);

  const setColorBy = (newColorBy: ColorBy) => {
    colorBy = newColorBy;
    viz?.setColorBy(colorBy);
  };

  // responsive web design
  let isMobile = false;
  let isLegendOpen = true;

  // add range filter
  let minPub = 0;
  let showTooltip = false;

  const loadMALProfile = async (id: number) => {
    if (!viz) {
      console.error('Tried to load MAL profile before Atlas viz was loaded.');
      return;
    }
    
    // Check if we already have collaborators for this author
    if (collaboratorsdict[id]) {
      const collaboratorIds = collaboratorsdict[id];
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
      const collaboratorIds = data.collaborators || [];
      
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
    import('../pixi').then((mod) => {
      const setSelectedAnimeID = (newSelectedAnimeID: number | null) => {
        selectedAnimeID = newSelectedAnimeID;
      };
      viz = new AtlasViz(mod, 'viz', embedding, setSelectedAnimeID, maxWidth);
      viz.setColorBy(colorBy);
      viz?.setCollaboratorsDict(collaboratorsdict);
      const embeddingNeighborsPromise = Promise.resolve(embeddingNeighbors);
      embeddingNeighborsPromise.then((neighbors) => {
        viz?.setNeighbors(neighbors);
      });
      // 💡 Add：Based on all authors to calculate and initialize paperNum
      const paperNums = embedding.filter((d) => d.metadata.IsAuthor).map((d) => d.metadata.PaperNum);
      const beginYears = embedding.filter((d) => d.metadata.IsAuthor).map((d) => d.metadata.BeginYear);

      const minPub = Math.min(...paperNums);
      const maxPub = Math.max(...paperNums);
      const minYear = Math.min(...beginYears);
      const maxYear = Math.max(...beginYears);

      publicationRange = [minPub, maxPub];
      beginYearRange = [1970, maxYear];
      selectedRange = rangeType === 'PaperNum' ? [minPub, maxPub] : [1970, maxYear];

      // 💡 Add：pass initialize data to AtlasViz
      //viz?.setRangeFilter(rangeType, selectedRange[0], selectedRange[1]);
    });
    // console.log('we have get the neighbors done.')
    const handleResize = () => {
      isMobile = window.innerWidth < 768;
      isLegendOpen = !isMobile;
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      viz?.dispose();
      viz = null;
    };
  });

  function updateRange() {
    if (viz) {
      if (!filtersInitialized) {
        filtersInitialized = true;
        viz.filtersInitialized = true;
      }
      viz.setRangeFilter(rangeType, selectedRange[0], selectedRange[1]);
    }
  }

  const openMatrixFromAtlas = () => {
    const params = new URLSearchParams();
    if (selectedAuthorForMatrix) {
      params.set('aid', String(selectedAuthorForMatrix.id));
    }
    if (browser) {
      params.set('return_to', window.location.href);
    }
    const query = params.toString();
    window.location.assign(`/matrix/${query ? `?${query}` : ''}`);
  };
</script>

<svelte:head>
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="root">
  <canvas id="viz" />
</div>
{#if viz}
  <Search {embedding} onSubmit={(id) => viz?.flyTo(id)} suggestionsStyle="top: 50px;" />
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
  <div class="matrix-entry-title">Teaming Assistant</div>
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

{#if isMobile && !isLegendOpen}
  <button class="legend-toggle mobile-toggle" on:click={() => (isLegendOpen = true)}> Show Filters ▼ </button>
{/if}

<div id="atlas-viz-legend" class:hidden={!isLegendOpen} />

<!-- new：Publication range filter -->
{#if viz}
  {#if isMobile}
    {#if isLegendOpen}
      <div class="legend-wrapper">
        <button class="legend-toggle" on:click={() => (isLegendOpen = !isLegendOpen)}>
          {isLegendOpen ? 'Hide Filters ▲' : 'Show Filters ▼'}
        </button>
        <div class="pub-range-filter">
          <label>
            Filter by:
            <select bind:value={rangeType} on:change={updateRange}>
              <option value="PaperNum">Publication Number</option>
              <option value="BeginYear">Begin Year</option>
            </select>
          </label>
          <input
            type="range"
            min={rangeType === 'PaperNum' ? publicationRange[0] : beginYearRange[0]}
            max={rangeType === 'PaperNum' ? publicationRange[1] : beginYearRange[1]}
            bind:value={selectedRange[0]}
            on:input={updateRange}
            on:mouseenter={() => (showTooltip = true)}
            on:mouseleave={() => (showTooltip = false)}
          />
          {#if showTooltip}
            <div
              class="slider-tooltip"
              style="left: {((selectedRange[0] - (rangeType === 'PaperNum' ? publicationRange[0] : beginYearRange[0])) /
                ((rangeType === 'PaperNum' ? publicationRange[1] : beginYearRange[1]) -
                  (rangeType === 'PaperNum' ? publicationRange[0] : beginYearRange[0]))) *
                100}%"
            >
              {selectedRange[0]}
            </div>
          {/if}
          <div class="range-caption">
            Showing authors with ≥ <strong>{selectedRange[0]}</strong>
            {rangeType === 'PaperNum' ? 'papers' : 'career start year'}
          </div>
        </div>
      </div>
    {/if}
  {:else}
    <div class="legend-wrapper">
      <!-- 桌面直接顯示 Filter -->
      <div class="pub-range-filter">
        <label>
          Filter by:
          <select bind:value={rangeType} on:change={updateRange}>
            <option value="PaperNum">Publication Number</option>
            <option value="BeginYear">Begin Year</option>
          </select>
        </label>
        <input
          type="range"
          min={rangeType === 'PaperNum' ? publicationRange[0] : beginYearRange[0]}
          max={rangeType === 'PaperNum' ? publicationRange[1] : beginYearRange[1]}
          bind:value={selectedRange[0]}
          on:input={updateRange}
          on:mouseenter={() => (showTooltip = true)}
          on:mouseleave={() => (showTooltip = false)}
        />
        {#if showTooltip}
          <div
            class="slider-tooltip"
            style="left: {((selectedRange[0] - (rangeType === 'PaperNum' ? publicationRange[0] : beginYearRange[0])) /
              ((rangeType === 'PaperNum' ? publicationRange[1] : beginYearRange[1]) -
                (rangeType === 'PaperNum' ? publicationRange[0] : beginYearRange[0]))) *
              100}%"
          >
            {selectedRange[0]}
          </div>
        {/if}
        <div class="range-caption">
          Showing authors with ≥ <strong>{selectedRange[0]}</strong>
          {rangeType === 'PaperNum' ? 'papers' : 'career start year'}
        </div>
      </div>
    </div>
  {/if}
{/if}

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
  />
{/if}

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    font-family: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
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
  }

  .matrix-entry-title {
    color: #0369a1;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .matrix-entry-button {
    font-size: 14px;
    font-weight: 700;
    padding: 10px 14px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, #10b981, #0ea5e9);
    color: #fff;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .matrix-entry-button:hover {
    filter: brightness(1.06);
  }

  .matrix-entry-hint {
    color: #334155;
    font-size: 12px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pub-range-filter {
    position: relative;
    width: 100%;
    padding: 10px;
    background-color: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 6px;
    color: #0f172a;
    font-size: 14px;
    z-index: 10;
  }

  .pub-range-filter input[type='range'] {
    width: 100%;
    margin-top: 6px;
  }

  .range-caption {
    text-align: right;
    font-size: 13px;
    margin-top: 4px;
    color: #334155;
  }

  .slider-tooltip {
    position: absolute;
    top: 30px;
    transform: translateX(-50%);
    background: #f8fafc;
    color: #0f172a;
    border: 1px solid rgba(15, 23, 42, 0.14);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    white-space: nowrap;
    pointer-events: none;
    transition: opacity 0.2s ease;
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

  .legend-wrapper {
    position: absolute;
    top: 126px;
    right: 12px;
    z-index: 10;
    width: min(320px, 90vw);
    max-width: 320px;
  }

  .legend-toggle {
    display: block;
    width: 100%;
    background: rgba(248, 250, 252, 0.96);
    color: #0f172a;
    font-size: 14px;
    padding: 6px 8px;
    margin-bottom: 10px;
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 6px;
    cursor: pointer;
    text-align: center;
  }
  .legend-toggle.mobile-toggle {
    position: absolute;
    top: 10px;
    right: 10px;
    width: auto;
    margin-bottom: 0;
    text-align: right;
    background: transparent;
    border-radius: 0;
  }

  .hidden {
    display: none;
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
    .legend-wrapper {
      top: 150px;
      right: 8px;
      width: min(300px, calc(100vw - 16px));
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
    .legend-wrapper {
      top: 146px;
      right: 6px;
      width: calc(100vw - 12px);
      max-width: 320px;
    }
  }
</style>
