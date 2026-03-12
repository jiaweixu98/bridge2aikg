<script context="module" lang="ts">
  import { EmbeddingName } from '../types';

  const getCurrentEmbeddingName = (): EmbeddingName => {
    switch (window.location.pathname) {
      case '/pymde_4d_40n':
        return EmbeddingName.TKG;
      // case '/pymde_4d_40n':
      //   return EmbeddingName.TEST11;
      // case '/pymde_3d_40n':
      //   return EmbeddingName.PyMDE_3D_40N;
      // case '/ggvec':
      //   return EmbeddingName.GGVec_10D_40N_Order2;
      // case '/pymde_4d_40n':
      //   return EmbeddingName.PyMDE_4D_40N;
      // case '/pymde_4d_100n':
      //   return EmbeddingName.PyMDE_4D_100N;
      default:
        // console.error('Unknown embedding name:', window.location.pathname);
        return EmbeddingName.TKG;
    }
  };

  const AllColorBys = [
    // { label: '1st PubMed Paper Publish Year', value: ColorBy.CaeerStartYear },
    { label: 'Number of Papers', value: ColorBy.Number_NIHindexed },
  ];

  const AllEmbeddingNames = [
    { label: 'Semantic Embedding -> t-SNE', value: EmbeddingName.TKG },
    // { label: 'PyMDE 3D 40 Neighbors -> t-SNE', value: EmbeddingName.TEST11 },
    // { label: 'PyMDE 3D 40 Neighbors -> t-SNE', value: EmbeddingName.PyMDE_3D_40N },
    // { label: 'PyMDE 4D 40 Neighbors -> t-SNE', value: EmbeddingName.PyMDE_4D_40N },
    // { label: 'PyMDE 4D 100 Neighbors -> t-SNE', value: EmbeddingName.PyMDE_4D_100N },
    // { label: 'GGVec 10D -> t-SNE', value: EmbeddingName.GGVec_10D_40N_Order2 },
  ];
</script>

<script lang="ts">
  import { goto, pushState } from '$app/navigation';

  import { ColorBy } from './AtlasViz';
  import { captureMessage } from 'src/sentry';

  export let colorBy: ColorBy;
  export let setColorBy: (newColorBy: ColorBy) => void;
  // export let loadMALProfile: (username: string) => void;
  export let disableEmbeddingSelection: boolean | undefined;
  export let disableUsernameSearch: boolean | undefined;
  export let embedding: { metadata: { id: number; FullName: string} }[];
  export let onSubmit: (id: number, FullName: string) => void;
  export let suggestionsStyle: string | undefined = undefined;


  const handleColorByChange = (newColorBy: ColorBy) => {
    captureMessage('Atlas color by changed', { newColorBy });
    setColorBy(newColorBy);

    // Set query param
    const queryParams = new URLSearchParams(window.location.search);
    queryParams.set('colorBy', newColorBy);
    pushState(`?${queryParams.toString()}`, {});
  };

  let embeddingName = getCurrentEmbeddingName();
  const handleEmbeddingNameChange = (newEmbeddingName: EmbeddingName) => {
    embeddingName = newEmbeddingName;

    const embeddingPathname = (
      {
        [EmbeddingName.TKG]: '/',
        // [EmbeddingName.TEST11]: '/pymde_4d_40n',
        // [EmbeddingName.PyMDE_3D_40N]: '/pymde_3d_40n',
        // [EmbeddingName.GGVec_10D_40N_Order2]: '/ggvec',
        // [EmbeddingName.PyMDE_4D_40N]: '/pymde_4d_40n',
        // [EmbeddingName.PyMDE_4D_100N]: '/pymde_4d_100n',
      } as const
    )[embeddingName];
    goto(`${embeddingPathname}${window.location.search}`);
  };

  // const handleLoadMALProfileButtonClick = () => {
  //   // console.log('Loading MAL profile for', malUsername);
  //   loadMALProfile(malUsername);

  //   // Set search params
  //   // const queryParams = new URLSearchParams(window.location.search);
  //   // queryParams.set('username', malUsername);
  //   // // console.log('queryParams:', `?${queryParams.toString()}`);
  //   // pushState(`?${queryParams.toString()}`, {});
  // };

  // let malUsername = '';
  import Fuse from 'fuse.js';
  let value = '';
  const fuse = new Fuse(embedding, {
    // keys: ['metadata.title', 'metadata.title_english'],
    keys: ['metadata.FullName'],
  });
  let isFocused = false;
  $: suggestions = value && isFocused ? fuse.search(value, { limit: 8 }) : [];
  const handleInputChange = (evt: any) => {
    value = evt.target.value;
  };
</script>

<div class="root">
  <!-- <div class="row">
    <div class="label">Color By</div>
    <div class="tabs">
      {#each AllColorBys as { label, value } (value)}
        <div class="tab" role="button" data-selected={colorBy == value} on:click={() => handleColorByChange(value)}>
          {label}
        </div>
      {/each}
    </div>
  </div> -->
  {#if !disableEmbeddingSelection}
    <div class="row">
      <div class="label">Embedding</div>
      <div class="tabs">
        {#each AllEmbeddingNames as { label, value } (value)}
          <!-- svelte-ignore a11y-interactive-supports-focus -->
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="tab"
            role="button"
            data-selected={embeddingName == value}
            on:click={() => handleEmbeddingNameChange(value)}
          >
            {label}
          </div>
        {/each}
      </div>
    </div>
  {/if}
  {#if !disableUsernameSearch}
    <!-- <div class="row">
      <div class="label">Collaborator Search</div>
      <div class="input">
        <input
          type="text"
          bind:value={malUsername}
          on:keydown={(evt) => {
            if (evt.key === 'Enter') {
              handleLoadMALProfileButtonClick();
            }
          }}
          placeholder="Enter Researcher Username"
        />
        {#if malUsername.length > 0}
          <button class="load-mal-profile-button" on:click={handleLoadMALProfileButtonClick}>Go</button>
        {/if}
      </div>
    </div> -->
    <label for="existing-collaborators">Highlight a talent's coauthors (or a dataset's users):</label>
    <input
    id="existing-collaborators"
    type="text"
    value={isFocused ? value : value}
    placeholder={isFocused ? undefined : value || 'Input the name of a talent or a dataset'}

    on:input={handleInputChange}
    on:blur={() => {
      isFocused = false;
    }}
    on:focus={() => {
      isFocused = true;
    }}
  />

  {#if suggestions.length > 0}
    <div class="suggestions-container" style={suggestionsStyle}>
      {#each suggestions as suggestion (suggestion.item.metadata.id)}
        <div
          role="button"
          tabindex={0}
          class="suggestion"
          on:mousedown={() => {
            onSubmit(
              suggestion.item.metadata.id,
              suggestion.item.metadata.FullName,
            );
            value = suggestion.item.metadata.FullName;
          }}
        >
          {suggestion.item.metadata.FullName}

        </div>
      {/each}
    </div>
  {/if}
  {/if}
</div>

<style lang="css">
  .root {
    position: absolute;
    left: 12px;
    background: rgba(255, 255, 255, 0.9);
    box-sizing: border-box;
    font-size: 13px;
    width: min(420px, calc(100vw - 24px));
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 12px;
    top: 112px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    backdrop-filter: blur(8px);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
    z-index: 55;
    overflow: visible;
  }
  @media (max-width: 600px) {
    .root {
      width: calc(100vw - 24px);
    }
  }

  label {
    font-size: 15px;
    margin-bottom: 2px;
    color: #334155;
    font-weight: 700;
  }

  input {
    font-size: 17px;
    font-weight: 700;
    padding: 10px 12px;
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    border-radius: 8px;
    border: 1px solid rgba(15, 23, 42, 0.16);
    background: rgba(255, 255, 255, 0.98);
    color: #0f172a;
  }

  input::placeholder {
    font-size: 16px;
    font-weight: 700;
    color: #475569;
    opacity: 1;
  }

  .suggestions-container {
    position: absolute;
    left: 0;
    width: 100%;
    z-index: 85;
    border-radius: 10px;
    overflow: hidden;
    max-height: min(50vh, 360px);
    overflow-y: auto;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
  }

  .suggestion {
    z-index: 86;
    cursor: pointer;
    font-size: 14px;
    padding: 9px 10px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.3);
    background-color: rgba(255, 255, 255, 0.98);
    color: #0f172a;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .suggestion:hover {
    background-color: #eff6ff;
  }

  .row {
    display: flex;
    flex-direction: row;
  }

  .row .label {
    display: flex;
    flex: 0;
    flex-basis: 200px;
    align-items: center;
    padding: 0 2px;
  }

  .row .tabs {
    display: flex;
    gap: 1px;
    flex: 1;
  }

  .row .tabs .tab {
    box-sizing: border-box;
    padding: 3px 3px;
    cursor: pointer;
    border-radius: 1px;
    border: 1px solid transparent;
  }

  .row .tabs .tab:hover {
    border: 1px solid rgba(14, 116, 144, 0.35);
  }

  .row .tabs .tab[data-selected='true'] {
    border: 1px solid rgba(14, 116, 144, 0.45);
    color: #0f172a;
    cursor: default;
  }
</style>