<script lang="ts">
  import Fuse from 'fuse.js';

  // export let embedding: { metadata: { id: number; title: string; title_english: string } }[];
  export let embedding: {
    metadata: { id: number; FullName: string; Data_Description: string; Category: string; Institution: string };
  }[];
  export let onSubmit: (id: number, FullName: string, Category?: string, Institution?: string) => void;
  export let style: string | undefined = undefined;
  export let inputStyle: string | undefined = undefined;
  export let suggestionsStyle: string | undefined = undefined;
  export let blurredValue: string | undefined = undefined;

  let value = '';
  const fuse = new Fuse(embedding, {
    // keys: ['metadata.title', 'metadata.title_english'],
    keys: ['metadata.FullName', 'metadata.Data_Description'],
    includeScore: true, // Display matching score, enhance searching accuracy
    threshold: 0.3, // Decrease similarity value
  });

  let isFocused = false;
  $: suggestions = value && isFocused ? fuse.search(value, { limit: 8 }) : [];

  const handleInputChange = (evt: any) => {
    value = evt.target.value;
  };

  // Add safeText utility
  const safeText = (text: string | undefined | null) => (text ?? '').replace(/[^\x20-\x7E\u4e00-\u9fa5]/g, '').trim();
</script>

<div class="root">
  <label for="potential-collaborators">Navigate to a talent or dataset: (input the name)</label>
  <input
    id="potential-collaborators"
    type="text"
    value={isFocused ? value : blurredValue || value}
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
              suggestion.item.metadata.Category, // passing category
              suggestion.item.metadata.Institution // passing institution
            );
            value = suggestion.item.metadata.FullName;
          }}
        >
          <strong>{suggestion.item.metadata.FullName}</strong>
          {#if suggestion.item.metadata.Category || suggestion.item.metadata.Institution}
            <small
              >(
              {safeText(suggestion.item.metadata.Category)}
              {#if suggestion.item.metadata.Category && suggestion.item.metadata.Institution}
                -
              {/if}
              {safeText(suggestion.item.metadata.Institution)}
              )</small
            >
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style lang="css">
  .root {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    font-size: 13px;
    width: min(420px, calc(100vw - 24px));
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(8px);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
    padding: 10px 12px;
    flex-direction: column;
    gap: 6px;
    z-index: 60;
  }

  @media (max-width: 600px) {
    .root {
      width: calc(100vw - 24px);
    }
  }

  label {
    font-size: 12px;
    color: #334155;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  input {
    font-size: 14px;
    padding: 8px 10px;
    box-sizing: border-box;
    width: 100%;
    min-height: 38px;
    border-radius: 8px;
    border: 1px solid rgba(15, 23, 42, 0.16);
    background: rgba(255, 255, 255, 0.98);
    color: #0f172a;
  }

  .suggestions-container {
    position: absolute;
    top: 84px;
    width: 100%;
    z-index: 80;
    left: 0;
    border-radius: 10px;
    overflow: hidden;
    max-height: min(50vh, 360px);
    overflow-y: auto;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
  }

  .suggestion {
    z-index: 81;
    cursor: pointer;
    font-size: 14px;
    padding: 9px 10px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.3);
    background-color: rgba(255, 255, 255, 0.98);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #0f172a;
  }

  .suggestion:hover {
    background-color: #eff6ff;
  }
</style>
