import type { Viewport } from 'pixi-viewport';

import type { EmbeddedPoint, Embedding } from '../routes/embedding';
import ColorLegend from './ColorLegend';
import * as d3 from '../d3';
import type * as PIXI from '../pixi';
import { captureMessage } from 'src/sentry';
import type { CompatAnimeListEntry } from 'src/anilistAPI';
// import { GlowFilter } from 'pixi-filters';
import { lines } from '@carbon/charts';

const WORLD_SIZE = 1;
const BASE_LABEL_FONT_SIZE = 48;
const BASE_RADIUS = 50;
// this is the blue
const MAL_NODE_COLOR = 0x2bcaff;
const SELECTED_NODE_COLOR = 0xdb18ce;
const NEIGHBOR_LINE_COLOR = 0xefefef;
const NEIGHBOR_LINE_OPACITY = 0.4;
const LABEL_BG_COLOR = 0x080808;
const LABEL_BG_OPACITY = 0.82;
const LABEL_HEIGHT = 50;
const MAX_LABELS_PER_GRID_SQUARE = 3;
const MIN_GRID_SQUARE_SIZE = 2;
const MAX_GRID_SQUARE_SIZE = 64;
const ESTIMATED_LABEL_MAX_WIDTH = 460;

const DENSITY_CONFIG = {
  nodeSizeMin: 0.2,
  nodeSizeMax: 0.8,
  sizeScaleMode: 'log' as 'log' | 'linear',
  initialZoom: 12,
  zoomMin: 0.5,
  zoomMax: 160,
};
const LOCAL_AVOIDANCE_ZOOM_THRESHOLD = 6.5;
const LOCAL_AVOIDANCE_MAX_NODES = 1400;
const LOCAL_AVOIDANCE_ITERATIONS = 5;
const LOCAL_AVOIDANCE_MAX_OFFSET = 14;
const STRICT_AVOIDANCE_ZOOM_THRESHOLD = 8;
const STRICT_AVOIDANCE_CAMERA_HEIGHT_THRESHOLD = 72;
const STRICT_AVOIDANCE_ZOOM_HEIGHT_THRESHOLD = 0.12;
const STRICT_AVOIDANCE_MAX_NODES = 2600;
const STRICT_AVOIDANCE_ITERATIONS = 12;
const STRICT_AVOIDANCE_MIN_DISTANCE_MULTIPLIER = 1.03;
const STRICT_AVOIDANCE_PUSH_FACTOR = 0.62;
const STRICT_AVOIDANCE_MAX_OFFSET = 56;
const LOCAL_AVOIDANCE_DEBOUNCE_MS = 280;
const LABEL_UPDATE_INTERVAL_MS = 120;
const LABEL_BUDGET_MULTIPLIER_WHILE_AVOIDANCE = 0.5;
const BASE_GLOW_BOOST = 5;
const MAX_RENDER_DEVICE_PIXEL_RATIO = 1.25;

export enum ColorBy {
  CareerStartYear = 'BeginYear',
  Number_NIHindexed = 'PaperNum',
  CustomMapping = 'color_category', // New option for bioentity
}
const CUSTOM_GROUP_LABELS: { [key: string]: string } = {
  '0': 'Author Nodes',
  '1': 'Dataset Nodes',
  '2': 'Bridge2AI PIs'
};

export interface EmbeddedPointWithIndex extends EmbeddedPoint {
  index: number;
}
type EmbeddingWithIndices = EmbeddedPointWithIndex[];


// export interface EmbeddedPoint {
//   vector: { x: number; y: number };
//   metadata: Metadatum;
// }


export const getDefaultColorBy = () =>
  (new URLSearchParams(window.location.search).get('colorBy') as ColorBy | undefined) ?? ColorBy.CustomMapping;

const buildNodeLabelClass = (PixiModule: typeof PIXI) => {
  class NodeLabel extends PixiModule.Graphics {
    constructor(text: string, style: Partial<PIXI.ITextStyle>, textWidth: number) {
      super();
      this.beginFill(LABEL_BG_COLOR, LABEL_BG_OPACITY);
      const paddingHorizontal = 4;
      const paddingVertical = 2;
      this.drawRoundedRect(
        -textWidth / 2 - paddingHorizontal / 2,
        -LABEL_HEIGHT / 2 - paddingVertical / 2,
        textWidth + paddingHorizontal,
        LABEL_HEIGHT + paddingVertical,
        5
      );
      this.textNode = new PixiModule.Text(text, style);
      this.textNode.position.set(-textWidth / 2, -LABEL_HEIGHT / 2 - paddingVertical * 4);
      this.addChild(this.textNode);
    }

    private textNode: PIXI.Text;
    public renderTimeMs: number;
    public nodeIx: number;
    public datum: EmbeddedPointWithIndex;
    public textWidth: number;
  }

  return NodeLabel;
};

type InstanceTypeOf<T> = T extends new (...args: any[]) => infer R ? R : never;

type NodeLabelClass = ReturnType<typeof buildNodeLabelClass>;
// Instance type
type NodeLabel = InstanceTypeOf<NodeLabelClass>;

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function fastQuadtreeVisit<T>(
  tree: d3.Quadtree<T>,
  callback: (
    d: d3.QuadtreeInternalNode<T> | d3.QuadtreeLeaf<T>,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) => boolean | void
) {
  let q,
    node = (tree as any)._root,
    child,
    x0,
    y0,
    x1,
    y1;
  const quads: any[] = [];

  if (node) {
    quads.push({ node, x0: (tree as any)._x0, y0: (tree as any)._y0, x1: (tree as any)._x1, y1: (tree as any)._y1 });
  }

  while ((q = quads.pop())) {
    const stopTraversing = callback((node = q.node), (x0 = q.x0), (y0 = q.y0), (x1 = q.x1), (y1 = q.y1));

    if (!stopTraversing && Array.isArray(node)) {
      const xm = (x0 + x1) / 2,
        ym = (y0 + y1) / 2;
      if ((child = node[3])) quads.push({ node: child, x0: xm, y0: ym, x1: x1, y1: y1 });
      if ((child = node[2])) quads.push({ node: child, x0: x0, y0: ym, x1: xm, y1: y1 });
      if ((child = node[1])) quads.push({ node: child, x0: xm, y0: y0, x1: x1, y1: ym });
      if ((child = node[0])) quads.push({ node: child, x0: x0, y0: y0, x1: xm, y1: ym });
    }
  }
}

export class AtlasViz {
  private embedding: EmbeddingWithIndices;
  private dataExtents: { mins: { x: number; y: number }; maxs: { x: number; y: number } };
  public embeddedPointByID: Map<number, EmbeddedPointWithIndex>;
  /**
   * Node positions from embedding kept here for faster lookup
   */
  private embeddingPositions: Float32Array;
  /** Holds indices of nodes.  Positions can be looked up via `embeddingPositions` */
  private embeddingQuadTree: d3.Quadtree<number>;
  private cachedNodeRadii: Float32Array;
  private colorBy: ColorBy;
  private colorScaler: d3.ScaleSequential<string, never>;
  private renderedHoverObjects: { label: PIXI.Graphics; neighborLines: PIXI.Graphics | null } | null = null;
  private neighbors: number[][] | null = null;
  private CollaboratorsDict: Map<number, number[]> | null = null;
  public collabID: number | null = null;
  private setSelectedAnimeID: (id: number | null) => void;
  //avoid pre-rendering
  private filtersInitialized = false;


  private visibleCategories: Set<string> = new Set(Object.keys(CUSTOM_GROUP_LABELS)); //adding checkbox

  private PIXI: typeof import('../pixi');
  private app: PIXI.Application;
  private container: Viewport;
  private maxCanvasWidth: number | undefined;
  private pointsContainer: PIXI.Container;
  private selectedNodeContainer: PIXI.Container;
  private decorationsContainer: PIXI.Container;
  private persistentGlowContainer: PIXI.Container;
  private labelsContainer: PIXI.Container;
  private hoverLabelsContainer: PIXI.Container;
  private selectedLabelContainer: PIXI.Container;
  private pointerCbs: {
    pointerMove: (evt: PointerEvent) => void;
    pointerLeave: () => void;
    pointerDown: (evt: PIXI.InteractionEvent) => void;
    pointerUp: (evt: PIXI.InteractionEvent) => void;
  };
  private debugInfoEl: HTMLElement | null = null;
  private lastPointerInfo:
    | { screenX: number; screenY: number; worldX: number; worldY: number }
    | null = null;
  private textMeasurerCtx = (() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${BASE_LABEL_FONT_SIZE}px IBM Plex Sans`;
    return ctx;
  })();
  // private malProfileEntities: { pointGlowBackgrounds: PIXI.ParticleContainer; connections: PIXI.Graphics } | null =
  //   null;
  private malProfileEntities: { pointGlowBackgrounds: PIXI.ParticleContainer } | null = null;
  private cachedMALBackgroundTexture: PIXI.Texture | null = null;
  private renderedMALNodeIDs: Set<number> = new Set();
  private selectedNode: {
    id: number;
    node: PIXI.Sprite;
    background: PIXI.Sprite;
    connections: PIXI.Graphics | null;
  } | null = null;
  private selectedNameLabel: PIXI.Graphics | null = null;
  private cachedNodeTexture: PIXI.Texture | null = null;
  private cachedRecTexture: PIXI.Texture | null = null;
  private cachedLabels: Map<string, NodeLabel> = new Map();
  private visibleNodesIndicesScratch: Uint32Array;
  private NodeLabel: NodeLabelClass;
  private cachedGlobalLabelsByGridSize: Map<number, { datum: EmbeddedPointWithIndex; transformedBounds: Rectangle }[]> =
    new Map();
  private textWidthCache: Map<string, number> = new Map();
  private densityNodeScaleMultiplier = 1.0;
  private localAvoidanceOffsets: Float32Array;
  private localAvoidanceActive = false;
  private localAvoidanceLastKey = '';
  private localAvoidanceTouchedIndices: number[] = [];
  private localAvoidanceTimeout: number | null = null;
  private labelUpdateTimeout: number | null = null;
  private labelUpdateLastAtMs = 0;

  private formatDebugNum = (value: number, precision = 2) => {
    if (!Number.isFinite(value)) return 'N/A';
    return value.toFixed(precision);
  };

  private updateDebugInfo = () => {
    if (!this.debugInfoEl) return;
    const scale = this.container?.scale?.x ?? 0;
    const center = this.container?.center;
    const visibleBounds = this.container?.getVisibleBounds();
    const cameraHeight = visibleBounds?.height ?? NaN;
    const pointerWorldText = this.lastPointerInfo
      ? `${this.formatDebugNum(this.lastPointerInfo.worldX, 2)}, ${this.formatDebugNum(this.lastPointerInfo.worldY, 2)}`
      : '-';

    this.debugInfoEl.textContent =
      `camera center: ${this.formatDebugNum(center?.x ?? NaN, 2)}, ${this.formatDebugNum(center?.y ?? NaN, 2)}\n` +
      `camera height: ${this.formatDebugNum(cameraHeight, 3)}\n` +
      `mouse(world): ${pointerWorldText}`;
  };

  private measureText = (text: string): number => {
    const cached = this.textWidthCache.get(text);
    if (cached) {
      return cached;
    }
    const width = this.textMeasurerCtx.measureText(text).width;
    this.textWidthCache.set(text, width);
    return width;
  };

  //add range filter
  private publicationRange: [number, number] = [0, Infinity];
  public setPublicationRange(min: number, max: number) {
    this.publicationRange = [min, max];
    this.renderNodes();
  }
  //add begin year filter
  private beginYearRange: [number, number] = [1900, 2024];
  public setRangeFilter(type: 'PaperNum' | 'BeginYear', min: number, max: number) {
    if (type === 'PaperNum') {
      this.setPublicationRange(min, max); // 呼叫原本的論文數量篩選
    } else if (type === 'BeginYear') {
      this.beginYearRange = [min, max];   // 設定新變數
      this.renderNodes();                 // 重新渲染節點
    }
    if (this.filtersInitialized) { // avoid pre-rendering
      this.renderNodes();
    }
  }

  private buildNeighborLines(datum: EmbeddedPointWithIndex): PIXI.Graphics | null {
    return null;
    if (!this.neighbors) {
      console.error("this.neighbors is not defined", this.neighbors);
      return null;
    }

    const neighbors: number[] = this.neighbors[datum.index] ?? [];
    if (neighbors.length === 0) {
      console.warn(`No neighbors found for node index=${datum.index} id=${datum.metadata.id}`);
      return null;
    }

    const g = new this.PIXI.Graphics();
    // # important, set the neighbors line style,
    g.lineStyle(2, NEIGHBOR_LINE_COLOR, NEIGHBOR_LINE_OPACITY, 0.5, true);

    neighbors.forEach((neighborID) => {
      const neighbor = this.embeddedPointByID.get(neighborID);
      if (!neighbor) {
        console.warn(`Could not find neighbor id=${neighborID} for node index=${datum.index}`);
        return;
      }
      g.moveTo(datum.vector.x, datum.vector.y);
      g.lineTo(neighbor.vector.x, neighbor.vector.y);
    });
    return g;
  }




  // private buildNeighborLines(datum: EmbeddedPointWithIndex): PIXI.Graphics | null {
  //   // console.log('test author_id',datum)
  //   if (!this.neighbors) {
  //     console.error("this.neighbors is not defined", this.neighbors);
  //     return null;
  //   }
  //   // console.log('test CollaboratorsDict',this.CollaboratorsDict[datum.metadata.id])

  //   const neighbors: number[] = this.neighbors[datum.index] ?? [];
  //   if (neighbors.length === 0) {
  //     console.warn(`No neighbors found for node index=${datum.index} id=${datum.metadata.id}`);
  //     return null;
  //   }
  //   const collaborators = this.CollaboratorsDict[datum.metadata.id];
  //   const g = new this.PIXI.Graphics();
  //   g.lineStyle(2, NEIGHBOR_LINE_COLOR, NEIGHBOR_LINE_OPACITY, 0.5, true);


  //   const getCollaborators = (neighbors: number[], collaborators: number[] | undefined) => {
  //     if (!Array.isArray(neighbors) || !Array.isArray(collaborators)) {
  //       console.warn("Invalid input to getCollaborators:", { neighbors, collaborators });
  //       return []; // Aviod error msg
  //     }

  //     let neibor_collab = new Set<number>();

  //     neighbors.forEach(neigh => {
  //       if (this.CollaboratorsDict && this.CollaboratorsDict[neigh]) {
  //         this.CollaboratorsDict[neigh].forEach(collab => neibor_collab.add(collab));
  //       }
  //     });

  //     return Array.from(neibor_collab).filter(collab => collaborators.includes(collab));
  //   }

  //   const result = getCollaborators(neighbors, collaborators);
  //   // console.log('coauthor:',result);
  //   if (!Array.isArray(result)) {
  //     console.error("getCollaborators() did not return an array:", result);
  //     return null;  // 🔥 Don't conduct result.forEach()
  //   }
  //   result.forEach((collaboratorID) => {
  //     // console.log('test CollaboratorsDict',collaboratorID)
  //     const collaborator = this.embeddedPointByID.get(collaboratorID)
  //     if (!collaborator) {
  //       console.warn(`Could not find neighbor id=${collaboratorID} for node index=${datum.index}`);
  //       return;
  //     }
  //     // console.log('test ', datum.metadata, collaborator)
  //     g.moveTo(datum.vector.x, datum.vector.y);
  //     g.lineTo(collaborator.vector.x, collaborator.vector.y);
  //   });

  //   // neighbors.forEach((neighborID) => {
  //   //   const neighbor = this.embeddedPointByID.get(neighborID);
  //   //   if (!neighbor) {
  //   //     console.warn(`Could not find neighbor id=${neighborID} for node index=${datum.index}`);
  //   //     return;
  //   //   }
  //   //   g.moveTo(datum.vector.x, datum.vector.y);
  //   //   g.lineTo(neighbor.vector.x, neighbor.vector.y);
  //   // });
  //   return g;
  // }

  private getNodeBackgroundTexture = () => {
    if (this.cachedMALBackgroundTexture) {
      return this.cachedMALBackgroundTexture;
    }

    const gradientRenderTexture = this.PIXI.gradients.GradientFactory.createRadialGradient(
      this.app.renderer as PIXI.Renderer,
      this.PIXI.RenderTexture.create({ width: BASE_RADIUS * 2, height: BASE_RADIUS * 2 }),
      {
        x0: BASE_RADIUS,
        y0: BASE_RADIUS,
        r0: 0,
        x1: BASE_RADIUS,
        y1: BASE_RADIUS,
        r1: BASE_RADIUS,
        colorStops: [
          { color: 0xffffffcc, offset: 0 },
          { color: 0xffffff99, offset: 0.14 },
          { color: 0xffffff66, offset: 0.34 },
          { color: 0xffffff1a, offset: 0.66 },
          { color: 0xffffff00, offset: 1 },
        ],
      }
    );

    this.cachedMALBackgroundTexture = gradientRenderTexture;
    return gradientRenderTexture;
  };

  private buildNodeBackgroundSprite = (
    texture: PIXI.Texture,
    datum: EmbeddedPointWithIndex,
    color: number,
    radiusMultiplier = 1.6,
    opacity = 0.7
  ): PIXI.Sprite => {
    const nodeRadius = this.getRenderedNodeWorldRadius(datum.index);
    // Keep glow proportional to node size, but with a minimum screen-visible radius.
    const minVisibleRadiusWorld = 4.5 / Math.max(this.container.scale.x, 0.001);
    const radius = Math.max(nodeRadius * radiusMultiplier, minVisibleRadiusWorld);
    const sprite = new this.PIXI.Sprite(texture);
    sprite.blendMode = this.PIXI.BLEND_MODES.ADD;
    sprite.interactive = false;
    sprite.alpha = opacity;
    sprite.tint = color;
    const [rx, ry] = this.getRenderedPositionByIndex(datum.index);
    sprite.position.set(rx, ry);
    sprite.anchor.set(0.5, 0.5);
    sprite.scale.set(radius / BASE_RADIUS);
    // console.log("nodeRadius",radius / BASE_RADIUS);
    return sprite;
  };

  private renderMALHighlightsByIDs = (ids: number[]) => {
    if (this.malProfileEntities) {
      if (this.malProfileEntities.pointGlowBackgrounds.parent) {
        this.malProfileEntities.pointGlowBackgrounds.parent.removeChild(this.malProfileEntities.pointGlowBackgrounds);
      }
      this.malProfileEntities.pointGlowBackgrounds.destroy({ children: true });
      this.malProfileEntities = null;
    }

    if (ids.length === 0) {
      return;
    }

    const pointGlowBackgrounds = new this.PIXI.ParticleContainer(ids.length, {
      vertices: false,
      position: false,
      rotation: false,
      uvs: false,
      tint: false,
      alpha: false,
      scale: false,
    });

    const texture = this.getNodeBackgroundTexture();
    ids.forEach((id) => {
      // TODO: Dynamic color based on rating?
      const color = MAL_NODE_COLOR;
      const datum = this.embeddedPointByID.get(id);
      if (!datum) {
        console.warn(`Could not find embedded point for MAL data point ${id}`);
        return;
      }

      const sprite = this.buildNodeBackgroundSprite(texture, datum, color);
      pointGlowBackgrounds.addChild(sprite);
    });
    this.persistentGlowContainer.addChild(pointGlowBackgrounds);

    // const allMALNodeIDs = new Set(ids);
    // const connections = new this.PIXI.Graphics();
    // connections.lineStyle(1, NEIGHBOR_LINE_COLOR, NEIGHBOR_LINE_OPACITY * 0.2, undefined, true);
    // allMALNodeIDs.forEach((id) => {
    //   const datum = this.embeddedPointByID.get(+id);
    //   if (!datum) {
    //     console.warn(`User has anime id=${id} in their profile which isn't in the embedding; ignoring it`);
    //     return;
    //   }

    //   const neighbors = this.neighbors?.[datum.index] ?? [];
    //   neighbors.forEach((neighborID) => {
    //     if (!allMALNodeIDs.has(neighborID)) {
    //       return;
    //     }
    //     const neighbor = this.embeddedPointByID.get(neighborID);
    //     if (!neighbor) {
    //       console.warn(`Could not find neighbor id=${neighborID} for node index=${datum.index}`);
    //       return;
    //     }
    //     const lineLength = Math.sqrt(
    //       Math.pow(neighbor.vector.x - datum.vector.x, 2) + Math.pow(neighbor.vector.y - datum.vector.y, 2)
    //     );
    //     if (lineLength > 100 && Math.random() < 0.9) {
    //       return;
    //     }

    //     connections.moveTo(datum.vector.x, datum.vector.y);
    //     connections.lineTo(neighbor.vector.x, neighbor.vector.y);
    //   });
    // });
    // this is used to keep the connections
    // this.decorationsContainer.addChild(connections);
    // why this?
    this.malProfileEntities = {
      pointGlowBackgrounds,
      // connections,
    };
  };

  public displayMALUser(allMALData: CompatAnimeListEntry[]) {
    const normalizedIds = allMALData
      .map((d) => Number(d.node.id))
      .filter((id) => Number.isFinite(id));
    this.renderedMALNodeIDs = new Set(normalizedIds);
    this.renderNodes();
  }

  private getColorByTitle() {
    switch (this.colorBy) {
      case ColorBy.CareerStartYear:
        return '1st PubMed Paper Publish Year';
      case ColorBy.Number_NIHindexed:
        return 'Number of Papers';
    }
  }

  // private static createColorScaler = (scaleBy: ColorBy) => {
  //   // console.log('test, if this case work:', scaleBy)
  //   switch (scaleBy) {
  //     case ColorBy.CareerStartYear:
  //       return d3.scaleSequential(d3.interpolatePlasma).domain([1980, 2024]);
  //     case ColorBy.Number_NIHindexed: {
  //       const scaler = d3.scaleSequentialPow(d3.interpolateRdYlGn).domain([0, 200]);
  //       return (scaler as any).exponent(2) as typeof scaler;
  //     }
  //   }
  // };
  // private static createColorScaler = (scaleBy: ColorBy) => {
  //   switch (scaleBy) {
  //     case ColorBy.CareerStartYear:
  //       return d3.scaleSequential(d3.interpolatePlasma).domain([1980, 2024]);
  //     case ColorBy.Number_NIHindexed: {
  //       const scaler = d3.scaleSequentialPow(d3.interpolateRdYlGn).domain([0, 200]);
  //       return (scaler as any).exponent(2) as typeof scaler;
  //     }
  //     case ColorBy.CustomMapping:
  //       // Define a discrete scale for custom mapping using hex codes
  //       return d3.scaleOrdinal<string>()
  //         .domain(['0', '1', '2']) // Keys as strings
  //         .range(['#868ea6', '#ffea08', '#FF0000']); // author, dataset, bridge2ai, cm4ai in hex
  //     default:
  //       throw new Error(`Unknown colorBy option: ${scaleBy}`);
  //   }
  // };
  private static createColorScaler = (scaleBy: ColorBy) => {
    switch (scaleBy) {
      case ColorBy.CareerStartYear:
        return d3.scaleSequential(d3.interpolatePlasma).domain([1980, 2024]);
      case ColorBy.Number_NIHindexed: {
        const scaler = d3.scaleSequentialPow(d3.interpolateRdYlGn).domain([0, 200]);
        return (scaler as any).exponent(2) as typeof scaler;
      }
      case ColorBy.CustomMapping:
        return d3.scaleOrdinal<string>()
          .domain(['0', '1', '2']) // Keys as strings: Author, Dataset, Bridge2AI
          .range(['#7F7F7F', '#4CAF50', '#FFD700']); // gray (author), green (dataset), gold (bridge2ai)
      default:
        throw new Error(`Unknown colorBy option: ${scaleBy}`);
    }
  };

  private static getNodeRadius = (paperNum: number) => {
    const minRadius = DENSITY_CONFIG.nodeSizeMin;
    const maxRadius = DENSITY_CONFIG.nodeSizeMax;
    const safePaperNum = Number.isFinite(paperNum) ? Math.max(1, paperNum) : 1;
    const maxPaperNumForScaling = 200;
    const growthExponent = 5.2;

    let normalized = 0;
    if (DENSITY_CONFIG.sizeScaleMode === 'linear') {
      normalized = Math.min(1, safePaperNum / maxPaperNumForScaling);
    } else {
      normalized = Math.min(1, Math.log1p(safePaperNum) / Math.log1p(maxPaperNumForScaling));
    }

    // Compress most nodes near min size; only high-paper authors grow sharply.
    const boostedTail = Math.pow(normalized, growthExponent);
    return minRadius + boostedTail * (maxRadius - minRadius);
  };



  private static parseColorString = (colorString: string) => {
    if (colorString.startsWith('#')) {
      return parseInt(colorString.slice(1), 16);
    }
    // Parse RGB string like `rgb(255, 0, 0)`
    const match = colorString.match(/rgb\((\d+), (\d+), (\d+)\)/);
    if (match) {
      const [, r, g, b] = match;
      return (+r << 16) + (+g << 8) + +b;
    }
    throw new Error(`Could not parse color string ${colorString}`);
  };

  // private getNodeColor = (datum: EmbeddedPoint) => {
  //   const animeID = datum.metadata.id;
  //   if (this.renderedMALNodeIDs.has(animeID)) {
  //     return MAL_NODE_COLOR;
  //   }
  //   const colorString = this.colorScaler(datum.metadata[this.colorBy]);
  //   const color = AtlasViz.parseColorString(colorString);
  //   return color;
  // };
  // private getNodeColor = (datum: EmbeddedPoint) => {
  //   const animeID = datum.metadata.id;
  //   if (this.renderedMALNodeIDs.has(animeID)) {
  //     return MAL_NODE_COLOR;
  //   }

  //   if (this.colorBy === ColorBy.CustomMapping) {
  //     const key = String(datum.metadata[this.colorBy]); // Ensure it's a string
  //     const colorString = this.colorScaler(key);
  //     const color = AtlasViz.parseColorString(colorString);
  //     return color;
  //   }

  //   const colorString = this.colorScaler(datum.metadata[this.colorBy]);
  //   const color = AtlasViz.parseColorString(colorString);
  //   return color;
  // };
  private getNodeColor = (datum: EmbeddedPoint) => {
    // console.log(`ID: ${datum.metadata.id}, Name: ${datum.metadata.FullName}, Category: ${datum.metadata.color_category}`);  // <- 這裡
    const animeID = datum.metadata.id;
    if (this.renderedMALNodeIDs.has(animeID)) {
      return MAL_NODE_COLOR;
    }

    let colorString;
    if (this.colorBy === ColorBy.CustomMapping) {
      const key = String(datum.metadata[this.colorBy]);
      colorString = this.colorScaler(key);
    } else {
      colorString = this.colorScaler(datum.metadata[this.colorBy]);
    }

    const color = AtlasViz.parseColorString(colorString);
    return color;
  };

  /**
   * This is an override of the `uploadVertices` function for the original PIXI.js implementation.  It is optimized to
   * do less work given that
   */
  private customUploadVertices = (
    children: PIXI.Sprite[],
    _startIndex: number,
    amount: number,
    array: Float32Array | number[],
    stride: number,
    offset: number
  ) => {
    const adjustment = this.getNodeRadiusAdjustment(this.container.scale.x);

    const texture = children[0].texture;
    const orig = texture.orig;

    const w0 = orig.width * (1 - 0.5); // * (1 - sprite.anchor.x);
    const w1 = orig.width * -0.5;
    const h0 = orig.height * (1 - 0.5); // * (1 - sprite.anchor.y);
    const h1 = orig.height * -0.5;

    for (let i = 0; i < amount; ++i) {
      const radius = this.cachedNodeRadii[i];
      const scale = (radius / BASE_RADIUS) * adjustment * this.densityNodeScaleMultiplier;

      array[offset] = w1 * scale;
      array[offset + 1] = h1 * scale;
      array[offset + stride] = w0 * scale;
      array[offset + stride + 1] = h1 * scale;
      array[offset + stride * 2] = w0 * scale;
      array[offset + stride * 2 + 1] = h0 * scale;
      array[offset + stride * 3] = w1 * scale;
      array[offset + stride * 3 + 1] = h0 * scale;
      offset += stride * 4;
    }
  };

  constructor(
    pixi: typeof import('../pixi'),
    containerID: string,
    embedding: Embedding,
    setSelectedAnimeID: (id: number | null) => void,
    maxCanvasWidth?: number
  ) {
    this.maxCanvasWidth = maxCanvasWidth;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    // define a new index here
    this.embedding = embedding.map((datum, i) => {
      minX = Math.min(minX, datum.vector.x);
      maxX = Math.max(maxX, datum.vector.x);
      minY = Math.min(minY, datum.vector.y);
      maxY = Math.max(maxY, datum.vector.y);
      return { ...datum, index: i };
    });
    this.dataExtents = { mins: { x: minX, y: minY }, maxs: { x: maxX, y: maxY } };
    this.embeddingPositions = new Float32Array(embedding.length * 2);
    for (let i = 0; i < embedding.length; i++) {
      this.embeddingPositions[i * 2] = embedding[i].vector.x;
      this.embeddingPositions[i * 2 + 1] = embedding[i].vector.y;
    }
    this.embeddingQuadTree = d3
      .quadtree<number>()
      .extent([
        [minX, minY],
        [maxX, maxY],
      ])
      .x((ix) => this.embeddingPositions[ix * 2])
      .y((ix) => this.embeddingPositions[ix * 2 + 1])
      .addAll(this.embedding.map((_datum, i) => i));

    this.colorBy = getDefaultColorBy();

    this.visibleNodesIndicesScratch = new Uint32Array(embedding.length);
    this.localAvoidanceOffsets = new Float32Array(embedding.length * 2);
    this.embeddedPointByID = new Map(this.embedding.map((p) => [+p.metadata.id, p]));
    this.setSelectedAnimeID = (newSelectedAnimeID: number | null) => {
      setSelectedAnimeID(newSelectedAnimeID);

      if (this.selectedNode?.id !== newSelectedAnimeID) {
        const sprites = this.renderSelectedNodeObjects(newSelectedAnimeID);
        this.selectedNode = sprites ? { id: newSelectedAnimeID, ...sprites } : null;
      }
    };
    this.PIXI = pixi;
    this.NodeLabel = buildNodeLabelClass(pixi);

    // Performance optimization to avoid having to set transforms on every point
    this.cachedNodeRadii = new Float32Array(embedding.length);
    for (let i = 0; i < embedding.length; i++) {
      const p = embedding[i];
      // Keep cached radii fully aligned with render-time sizing rules.
      const radius = p.metadata.IsAuthor ? AtlasViz.getNodeRadius(p.metadata.PaperNum) : AtlasViz.getNodeRadius(200);
      this.cachedNodeRadii[i] = radius;
    }

    const canvas = document.getElementById(containerID)! as HTMLCanvasElement;
    this.app = new this.PIXI.Application({
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_RENDER_DEVICE_PIXEL_RATIO),
      autoDensity: true,
      view: canvas,
      height: window.innerHeight,
      width: Math.min(window.innerWidth, maxCanvasWidth ?? Infinity),
      backgroundColor: 0,
    });

    this.container = new pixi.Viewport({
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      worldHeight: WORLD_SIZE,
      worldWidth: WORLD_SIZE,
      interaction: this.app.renderer.plugins.interaction,

    });
    this.container.drag({ mouseButtons: 'middle-left' }).pinch().wheel();
    this.container.clampZoom({
      minScale: DENSITY_CONFIG.zoomMin,
      maxScale: DENSITY_CONFIG.zoomMax,
    });
    // TODO: The initial transform probably needs to be relative to screen size
    this.container.setTransform(1000.5, 400.5, DENSITY_CONFIG.initialZoom, DENSITY_CONFIG.initialZoom);
    this.container.moveCenter(-130, 210);
    this.debugInfoEl = document.getElementById('atlas-viz-debug');
    this.updateDebugInfo();
    window.addEventListener('resize', this.handleResize);

    // Need to do some hacky subclassing to enable big performance improvement
    class NodesParticleRenderer extends this.PIXI.ParticleRenderer { }
    NodesParticleRenderer.prototype.uploadVertices = this.customUploadVertices;

    const nodesParticleRenderer = new NodesParticleRenderer(this.app.renderer as PIXI.Renderer);

    class NodesParticleContainer extends this.PIXI.ParticleContainer {
      public render(renderer: PIXI.Renderer): void {
        if (!this.visible || this.worldAlpha <= 0 || !this.children.length || !this.renderable) {
          return;
        }

        renderer.batch.setObjectRenderer(nodesParticleRenderer);
        nodesParticleRenderer.render(this);
      }
    }

    this.decorationsContainer = new this.PIXI.Container();
    this.decorationsContainer.interactive = false;
    this.decorationsContainer.interactiveChildren = false;
    this.container.addChild(this.decorationsContainer);

    this.persistentGlowContainer = new this.PIXI.Container();
    this.persistentGlowContainer.interactive = false;
    this.persistentGlowContainer.interactiveChildren = false;
    this.container.addChild(this.persistentGlowContainer);

    // this.pointsContainer = new NodesParticleContainer(embedding.length, {
    //   vertices: true,
    //   position: false,
    //   rotation: false,
    //   uvs: false,
    //   tint: false,
    // });
    this.pointsContainer = new this.PIXI.Container();
    this.pointsContainer.interactive = false;
    this.pointsContainer.interactiveChildren = false;
    this.container.addChild(this.pointsContainer);

    this.selectedNodeContainer = new this.PIXI.Container();
    this.selectedNodeContainer.interactive = false;
    this.selectedNodeContainer.interactiveChildren = false;
    this.container.addChild(this.selectedNodeContainer);

    this.labelsContainer = new this.PIXI.Container();
    this.labelsContainer.interactive = false;
    this.labelsContainer.interactiveChildren = false;
    this.container.addChild(this.labelsContainer);

    this.hoverLabelsContainer = new this.PIXI.Container();
    this.hoverLabelsContainer.interactive = false;
    this.hoverLabelsContainer.interactiveChildren = false;
    this.container.addChild(this.hoverLabelsContainer);

    this.selectedLabelContainer = new this.PIXI.Container();
    this.selectedLabelContainer.interactive = false;
    this.selectedLabelContainer.interactiveChildren = false;
    this.container.addChild(this.selectedLabelContainer);

    // When zooming in and out, scale the circles in the opposite direction a bit to open up some space when
    // zooming in to dense areas and keeping structure when zooming out far.
    let lastCenter = this.container.center;
    let lastScale = this.container.scale.x;
    let wasZooming = this.container.zooming;

    this.app.ticker.add(() => {
      const newScale = this.container.scale.x;
      const scaleChanged = newScale !== lastScale;
      const centerChanged =
        lastCenter.x !== this.container.center.x || lastCenter.y !== this.container.center.y;
      const isZooming = this.container.zooming;
      const zoomStateChanged = isZooming !== wasZooming;

      if (!centerChanged && !scaleChanged && !zoomStateChanged) {
        return;
      }

      lastCenter = this.container.center;
      lastScale = newScale;

      // During wheel zoom interaction, skip expensive refresh paths entirely.
      // Rebuild once when zooming stops.
      if (isZooming) {
        this.labelsContainer.visible = false;
        this.hoverLabelsContainer.visible = false;
        this.selectedLabelContainer.visible = false;
        wasZooming = true;
        return;
      }

      this.scheduleLocalAvoidance();
      if (zoomStateChanged) {
        this.labelsContainer.visible = true;
        this.hoverLabelsContainer.visible = true;
        this.selectedLabelContainer.visible = true;
        this.updateDensityScale();
        this.scheduleLabelUpdate(true);
      } else {
        this.scheduleLabelUpdate();
        if (scaleChanged) {
          this.updateDensityScale();
        }
      }

      // || This is now computed in our overridden `uploadVertices` function to avoid the overhead
      // \/ of setting it on each node directly like this
      //
      // this.pointsContainer.children.forEach((c, i) => {
      //   const radius = this.cachedNodeRadii[i];
      //   c.transform.scale.set((radius / BASE_RADIUS) * this.getNodeRadiusAdjustment(newScale));
      // });

      if (this.selectedNode) {
        const index = this.embeddedPointByID.get(this.selectedNode.id)!.index;
        const radius = this.getRenderedNodeWorldRadius(index);
        this.selectedNode.node.transform.scale.set(radius / BASE_RADIUS);
      }

      this.hoverLabelsContainer.children.forEach((g) => {
        const d = (g as any).datum;
        this.setLabelScale(g as PIXI.Graphics, d);
      });

      if (this.selectedNameLabel && this.selectedNode) {
        const selectedDatum = this.embeddedPointByID.get(this.selectedNode.id);
        if (selectedDatum) {
          this.setLabelScale(this.selectedNameLabel as PIXI.Graphics, selectedDatum);
        }
      }
      wasZooming = false;
      this.updateDebugInfo();
    });

    this.app.stage.addChild(this.container);

    // Somewhat annoyingly, we have to do manual hit testing in order to get decent rendering performance
    // for the circles.
    let hoveredDatum: EmbeddedPointWithIndex | null = null;
    let containerPointerDownPos: PIXI.IPointData | null = null;

    this.pointerCbs = {
      pointerMove: (evt: PointerEvent) => {
        if (this.container.zooming) {
          return;
        }

        const worldPoint = this.container.toWorld(evt.offsetX, evt.offsetY);
        this.lastPointerInfo = {
          screenX: evt.offsetX,
          screenY: evt.offsetY,
          worldX: worldPoint.x,
          worldY: worldPoint.y,
        };
        this.updateDebugInfo();

        let datum: EmbeddedPointWithIndex | undefined;
        for (let i = this.embedding.length - 1; i >= 0; i--) {
          const p = this.embedding[i];
          const radius = this.getRenderedNodeWorldRadius(i);
          const centerX = this.embeddingPositions[i * 2] + this.localAvoidanceOffsets[i * 2];
          const centerY = this.embeddingPositions[i * 2 + 1] + this.localAvoidanceOffsets[i * 2 + 1];
          const hitTest = Math.abs(worldPoint.x - centerX) < 2 * radius && Math.abs(worldPoint.y - centerY) < 2 * radius;

          if (hitTest) {
            datum = p;
            break;
          }
        }

        if (datum && hoveredDatum !== datum) {
          this.handlePointerOut();
          hoveredDatum = datum;
          this.handlePointerOver(hoveredDatum);
        } else if (!datum && hoveredDatum) {
          this.handlePointerOut();
          hoveredDatum = null;
        } else {
          hoveredDatum = datum ?? null;
        }

        this.container.cursor = hoveredDatum ? 'pointer' : containerPointerDownPos ? 'grabbing' : 'default';
      },
      pointerLeave: () => {
        this.lastPointerInfo = null;
        this.updateDebugInfo();
      },
      pointerDown: (evt: PIXI.InteractionEvent) => {
        // Ignore right clicks
        if ((evt.data.originalEvent as PointerEvent).button === 2) {
          return;
        }

        this.container.cursor = 'grabbing';
        containerPointerDownPos = evt.data.getLocalPosition(this.app.stage);

        if (hoveredDatum) {
          this.handlePointerDown(hoveredDatum);
        }
      },
      pointerUp: (evt: PIXI.InteractionEvent) => {
        this.container.cursor = 'default';
        const newPos = evt.data.getLocalPosition(this.app.stage);
        if (hoveredDatum || newPos.x !== containerPointerDownPos?.x || newPos.y !== containerPointerDownPos?.y) {
          containerPointerDownPos = null;
          return;
        }
        containerPointerDownPos = null;

        this.setSelectedAnimeID(null);
      },
    };

    canvas.addEventListener('pointermove', this.pointerCbs.pointerMove);
    canvas.addEventListener('pointerleave', this.pointerCbs.pointerLeave);
    this.container.on('pointerdown', this.pointerCbs.pointerDown).on('pointerup', this.pointerCbs.pointerUp);
    this.setColorBy(this.colorBy);

    this.renderNodes();

    this.updateLabels();

    this.renderLegend();
  }

  private handleResize = () => {
    const width = Math.min(window.innerWidth, this.maxCanvasWidth ?? Infinity);
    this.app.renderer.resize(width, window.innerHeight);
    this.container.resize(width, window.innerHeight);
    this.updateDebugInfo();
  };

  private getNodeRadiusAdjustment = (newZoomScale: number) => {
    let adjustment = (1 / (newZoomScale / 16)) * 1;
    adjustment = (adjustment + adjustment + adjustment + 1 + 1) / 5;
    adjustment = Math.min(adjustment, 1.5);
    return adjustment;
  };

  private shouldRenderNode = (point: EmbeddedPointWithIndex | undefined | null) => {
    if (!point?.metadata) return false;
    const category = String(point.metadata.color_category);
    if (!this.visibleCategories.has(category)) return false;
    if (point.metadata.IsAuthor) {
      const numPubs = point.metadata.PaperNum;
      const beginYear = point.metadata.BeginYear;
      if (
        numPubs < this.publicationRange[0] || numPubs > this.publicationRange[1] ||
        beginYear < this.beginYearRange[0] || beginYear > this.beginYearRange[1]
      ) {
        return false;
      }
    }
    return true;
  };

  private getRenderedPositionByIndex = (idx: number): [number, number] => {
    return [
      this.embeddingPositions[idx * 2] + this.localAvoidanceOffsets[idx * 2],
      this.embeddingPositions[idx * 2 + 1] + this.localAvoidanceOffsets[idx * 2 + 1],
    ];
  };

  /**
   * World-space radius actually used by rendered node sprites.
   * Keep collision and hit-testing in sync with this value.
   */
  private getRenderedNodeWorldRadius = (idx: number): number => {
    return this.cachedNodeRadii[idx] * this.densityNodeScaleMultiplier;
  };

  private clearLocalAvoidanceOffsets = () => {
    if (this.localAvoidanceTouchedIndices.length === 0) return false;
    for (const idx of this.localAvoidanceTouchedIndices) {
      this.localAvoidanceOffsets[idx * 2] = 0;
      this.localAvoidanceOffsets[idx * 2 + 1] = 0;
    }
    this.localAvoidanceTouchedIndices = [];
    this.localAvoidanceActive = false;
    this.localAvoidanceLastKey = '';
    return true;
  };

  private scheduleLocalAvoidance = () => {
    if (this.localAvoidanceTimeout !== null) {
      window.clearTimeout(this.localAvoidanceTimeout);
    }
    this.localAvoidanceTimeout = window.setTimeout(() => {
      this.localAvoidanceTimeout = null;
      // Recompute density scale once interaction settles.
      this.updateDensityScale();
      this.runLocalAvoidanceIfNeeded();
    }, LOCAL_AVOIDANCE_DEBOUNCE_MS);
  };

  private scheduleLabelUpdate = (force = false) => {
    const now = performance.now();
    if (force || now - this.labelUpdateLastAtMs >= LABEL_UPDATE_INTERVAL_MS) {
      this.labelUpdateLastAtMs = now;
      this.updateLabels();
      return;
    }
    if (this.labelUpdateTimeout !== null) {
      return;
    }
    const delay = Math.max(0, LABEL_UPDATE_INTERVAL_MS - (now - this.labelUpdateLastAtMs));
    this.labelUpdateTimeout = window.setTimeout(() => {
      this.labelUpdateTimeout = null;
      this.labelUpdateLastAtMs = performance.now();
      this.updateLabels();
    }, delay);
  };

  private runLocalAvoidanceIfNeeded = () => {
    const scale = this.container.scale.x;
    if (scale < LOCAL_AVOIDANCE_ZOOM_THRESHOLD) {
      if (this.clearLocalAvoidanceOffsets()) {
        this.renderNodes();
        if (this.selectedNode) {
          const selectedId = this.selectedNode.id;
          const sprites = this.renderSelectedNodeObjects(selectedId);
          this.selectedNode = sprites ? { id: selectedId, ...sprites } : null;
        }
      }
      return;
    }

    const center = this.container.center;
    const visibleBounds = this.container.getVisibleBounds();
    const cameraHeight = visibleBounds.height;
    const zoomInHeight = 1 / Math.max(scale, 1e-9);
    const strictAvoidanceMode =
      scale > STRICT_AVOIDANCE_ZOOM_THRESHOLD ||
      cameraHeight < STRICT_AVOIDANCE_CAMERA_HEIGHT_THRESHOLD ||
      zoomInHeight < STRICT_AVOIDANCE_ZOOM_HEIGHT_THRESHOLD;
    const stateKey = `${Math.round(scale * 10)}|${Math.round(center.x * 2)}|${Math.round(center.y * 2)}|${Math.round(
      cameraHeight * 10
    )}|${strictAvoidanceMode ? 1 : 0}`;
    if (stateKey === this.localAvoidanceLastKey) {
      return;
    }
    this.localAvoidanceLastKey = stateKey;

    this.clearLocalAvoidanceOffsets();

    const visible = Array.from(this.computeVisibleNodeIndices(visibleBounds, false))
      .map((i) => this.embedding[i])
      .filter((p): p is EmbeddedPointWithIndex => this.shouldRenderNode(p));

    if (visible.length < 2) {
      return;
    }

    const maxNodes = strictAvoidanceMode ? STRICT_AVOIDANCE_MAX_NODES : LOCAL_AVOIDANCE_MAX_NODES;
    const candidates = visible.length <= maxNodes
      ? visible
      : [...visible]
          .sort((a, b) => this.cachedNodeRadii[b.index] - this.cachedNodeRadii[a.index])
          .slice(0, maxNodes);

    const n = candidates.length;
    const posX = new Float32Array(n);
    const posY = new Float32Array(n);
    const rad = new Float32Array(n);
    const deltaX = new Float32Array(n);
    const deltaY = new Float32Array(n);
    const indexByNode = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const idx = candidates[i].index;
      indexByNode[i] = idx;
      posX[i] = this.embeddingPositions[idx * 2];
      posY[i] = this.embeddingPositions[idx * 2 + 1];
      rad[i] = this.getRenderedNodeWorldRadius(idx);
    }

    const grid = new Map<string, number[]>();
    const avgRadius = rad.reduce((acc, v) => acc + v, 0) / Math.max(1, n);
    const cellSize = Math.max(3.2, avgRadius * 3.2);
    const iterations = strictAvoidanceMode ? STRICT_AVOIDANCE_ITERATIONS : LOCAL_AVOIDANCE_ITERATIONS;
    const minDistanceMultiplier = strictAvoidanceMode ? STRICT_AVOIDANCE_MIN_DISTANCE_MULTIPLIER : 0.9;
    const pushFactor = strictAvoidanceMode ? STRICT_AVOIDANCE_PUSH_FACTOR : 0.48;
    for (let iter = 0; iter < iterations; iter++) {
      grid.clear();
      deltaX.fill(0);
      deltaY.fill(0);

      for (let i = 0; i < n; i++) {
        const cx = Math.floor(posX[i] / cellSize);
        const cy = Math.floor(posY[i] / cellSize);
        const key = `${cx},${cy}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }

      for (let i = 0; i < n; i++) {
        const cx = Math.floor(posX[i] / cellSize);
        const cy = Math.floor(posY[i] / cellSize);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const neighbors = grid.get(`${cx + ox},${cy + oy}`);
            if (!neighbors) continue;
            for (const j of neighbors) {
              if (j <= i) continue;
              let dx = posX[j] - posX[i];
              let dy = posY[j] - posY[i];
              const minDist = (rad[i] + rad[j]) * minDistanceMultiplier;
              const d2 = dx * dx + dy * dy;
              if (d2 >= minDist * minDist) continue;
              let dist = Math.sqrt(Math.max(d2, 1e-9));

              // If two nodes are at (nearly) identical positions, synthesize a deterministic
              // direction so they can be separated instead of staying locked together.
              if (dist < 1e-4) {
                const angle = ((i * 73856093) ^ (j * 19349663)) * 0.000001;
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                dist = 1;
              }

              const overlap = minDist - dist;
              const ux = dx / dist;
              const uy = dy / dist;
              const push = overlap * pushFactor;
              deltaX[i] -= ux * push;
              deltaY[i] -= uy * push;
              deltaX[j] += ux * push;
              deltaY[j] += uy * push;
            }
          }
        }
      }

      for (let i = 0; i < n; i++) {
        posX[i] += deltaX[i];
        posY[i] += deltaY[i];
      }
    }

    for (let i = 0; i < n; i++) {
      const idx = indexByNode[i];
      const baseX = this.embeddingPositions[idx * 2];
      const baseY = this.embeddingPositions[idx * 2 + 1];
      let ox = posX[i] - baseX;
      let oy = posY[i] - baseY;
      const mag = Math.sqrt(ox * ox + oy * oy);
      const maxOffset = strictAvoidanceMode
        ? Math.min(
            STRICT_AVOIDANCE_MAX_OFFSET,
            Math.max(LOCAL_AVOIDANCE_MAX_OFFSET, LOCAL_AVOIDANCE_MAX_OFFSET * (scale / STRICT_AVOIDANCE_ZOOM_THRESHOLD))
          )
        : LOCAL_AVOIDANCE_MAX_OFFSET;
      if (mag > maxOffset) {
        const s = maxOffset / mag;
        ox *= s;
        oy *= s;
      }
      if (Math.abs(ox) < 1e-3 && Math.abs(oy) < 1e-3) continue;
      this.localAvoidanceOffsets[idx * 2] = ox;
      this.localAvoidanceOffsets[idx * 2 + 1] = oy;
      this.localAvoidanceTouchedIndices.push(idx);
    }

    this.localAvoidanceActive = this.localAvoidanceTouchedIndices.length > 0;
    this.renderNodes();
    if (this.selectedNode) {
      const selectedId = this.selectedNode.id;
      const sprites = this.renderSelectedNodeObjects(selectedId);
      this.selectedNode = sprites ? { id: selectedId, ...sprites } : null;
    }
  };

  private updateDensityScale = () => {
    const visible = this.computeVisibleNodeIndices(this.container.getVisibleBounds(), false);
    const sampleCount = Math.min(visible.length, 120);
    if (sampleCount < 8) {
      this.densityNodeScaleMultiplier = 1.0;
      return;
    }
    let overlapLikePairs = 0;
    const maxPairs = sampleCount * (sampleCount - 1);
    for (let i = 0; i < sampleCount; i++) {
      const a = this.embedding[visible[i]];
      const ar = this.getRenderedNodeWorldRadius(a.index);
      for (let j = i + 1; j < sampleCount; j++) {
        const b = this.embedding[visible[j]];
        const br = this.getRenderedNodeWorldRadius(b.index);
        const dx = a.vector.x - b.vector.x;
        const dy = a.vector.y - b.vector.y;
        const d2 = dx * dx + dy * dy;
        const threshold = (ar + br) * 1.1;
        if (d2 < threshold * threshold) {
          overlapLikePairs += 2;
        }
      }
    }
    const ratio = overlapLikePairs / Math.max(1, maxPairs);
    this.densityNodeScaleMultiplier = ratio > 0.18 ? 0.8 : 1.0;
  };

  private handlePointerOver = (datum: EmbeddedPointWithIndex) => {
    this.maybeRemoveHoverObjects();
    const label = this.buildHoverLabel(datum);
    this.hoverLabelsContainer.addChild(label);
    // # important, build the neighbor lines when hovering
    const neighborLines = this.buildNeighborLines(datum);
    if (neighborLines) {
      this.decorationsContainer.addChild(neighborLines);
    }

    this.renderedHoverObjects = { label, neighborLines };
  };
  private handlePointerOut = () => this.maybeRemoveHoverObjects();
  private handlePointerDown = (datum: EmbeddedPoint) => {
    captureMessage('Atlas set selected anime', {
      animeID: datum.metadata.id,
      title: datum.metadata.FullName,
    });
    this.setSelectedAnimeID(datum.metadata.id);
  };

  private updateSelectedNameLabel = (selectedAnimeID: number | null) => {
    if (this.selectedNameLabel) {
      this.selectedNameLabel.parent?.removeChild(this.selectedNameLabel);
      this.selectedNameLabel.destroy({ children: true });
      this.selectedNameLabel = null;
    }

    if (selectedAnimeID == null) {
      return;
    }

    const datum = this.embeddedPointByID.get(selectedAnimeID);
    if (!datum) {
      return;
    }

    const label = this.buildHoverLabel(datum);
    this.selectedLabelContainer.addChild(label);
    this.selectedNameLabel = label;
  };

  private getNodeTexture = (): PIXI.Texture => {
    if (this.cachedNodeTexture) {
      return this.cachedNodeTexture;
    }

    const nodeGraphics = new this.PIXI.Graphics();
    nodeGraphics.lineStyle(10, 0xffffff, 1);
    nodeGraphics.beginFill(0xffffff);
    nodeGraphics.drawCircle(0, 0, BASE_RADIUS);
    nodeGraphics.endFill();
    const texture = this.app.renderer.generateTexture(nodeGraphics, {
      resolution: 5,
      scaleMode: this.PIXI.SCALE_MODES.LINEAR,
      multisample: this.PIXI.MSAA_QUALITY.MEDIUM,
    });
    this.cachedNodeTexture = texture;
    return texture;
  };

  private getRecTexture = (): PIXI.Texture => {
    if (this.cachedRecTexture) {
      return this.cachedRecTexture;
    }

    const nodeGraphics = new this.PIXI.Graphics();
    nodeGraphics.lineStyle(10, 0xffffff, 1);
    nodeGraphics.beginFill(0xffffff);
    nodeGraphics.drawRect(0, 0, BASE_RADIUS, BASE_RADIUS);
    nodeGraphics.endFill();
    const texture = this.app.renderer.generateTexture(nodeGraphics, {
      resolution: 5,
      scaleMode: this.PIXI.SCALE_MODES.LINEAR,
      multisample: this.PIXI.MSAA_QUALITY.MEDIUM,
    });
    this.cachedRecTexture = texture;
    return texture;
  };

  private buildNodeSprite = (texture: PIXI.Texture, point: EmbeddedPoint) => {
    const nodeSprite = new this.PIXI.Sprite(texture);
    nodeSprite.anchor.set(0.5, 0.5);
    nodeSprite.interactive = false;
    const idx = (point as EmbeddedPointWithIndex).index;
    const radius = this.cachedNodeRadii[idx];
    const [rx, ry] = this.getRenderedPositionByIndex(idx);
    nodeSprite.position.set(rx, ry);
    // nodeSprite.scale.set((radius / BASE_RADIUS) * this.getNodeRadiusAdjustment(this.container.scale.x));
    nodeSprite.scale.set((radius / BASE_RADIUS) * this.densityNodeScaleMultiplier);
    const color = this.getNodeColor(point);
    nodeSprite.tint = color;
    return nodeSprite;
  };



  private renderNodes() {
    // Delete transient overlays
    this.decorationsContainer.removeChildren().forEach(c => c.destroy({ texture: false, children: true }));
    // Persistent glow layer is rebuilt every render so zoom/avoidance paths can't desync it.
    this.persistentGlowContainer.removeChildren().forEach(c => c.destroy({ texture: false, children: true }));
    this.malProfileEntities = null;
    // Delete nodes
    this.pointsContainer.removeChildren().forEach((c) => c.destroy({ texture: false, children: true }));
    // Clear label cache, update Labels 
    this.cachedGlobalLabelsByGridSize.clear();
    this.labelsContainer.removeChildren();
    this.hoverLabelsContainer.removeChildren();
    this.updateLabels();

    const nodeBackgroundTexture = this.getNodeBackgroundTexture();

    this.embedding.forEach((point) => {
      const category = String(point.metadata.color_category);
      if (!this.visibleCategories.has(category)) return;
      if (point.metadata.IsAuthor) {
        const numPubs = point.metadata.PaperNum;
        const beginYear = point.metadata.BeginYear;
        if (
          numPubs < this.publicationRange[0] || numPubs > this.publicationRange[1] ||
          beginYear < this.beginYearRange[0] || beginYear > this.beginYearRange[1]
        ) {
          return;
        }
      }

      let texture;
      if (point.metadata.IsAuthor === true) {
        texture = this.getNodeTexture();
      } else {
        texture = this.getRecTexture();
      }

      const nodeSprite = this.buildNodeSprite(texture, point);
      this.pointsContainer.addChild(nodeSprite);

      // Keep baseline glow only for Bridge2AI PI seeds.
      // Dataset nodes (category 1) should render without halo.
      const colorCategoryNum = Number(point.metadata.color_category);
      if (colorCategoryNum === 2) {
        const baseGlowRadiusMultiplier = colorCategoryNum === 2 ? 3 : 2;
        const glowRadiusMultiplier = baseGlowRadiusMultiplier * BASE_GLOW_BOOST;
        const glowColor = this.getNodeColor(point);
        const backgroundSprite = this.buildNodeBackgroundSprite(
          nodeBackgroundTexture,
          point,
          glowColor,
          glowRadiusMultiplier,
          colorCategoryNum === 2 ? 1 : 0.95
        );
        this.persistentGlowContainer.addChild(backgroundSprite);
      }
    });
    this.updateDensityScale();
    this.renderMALHighlightsByIDs(Array.from(this.renderedMALNodeIDs));
    // Clear label cache, update Labels 
    this.labelsContainer.removeChildren();
    this.hoverLabelsContainer.removeChildren();
    this.updateLabels();
  }




  private renderSelectedNodeObjects(selectedAnimeID: number | null) {
    if (this.selectedNode) {
      this.selectedNode.node.destroy({ texture: null });
      this.selectedNodeContainer.removeChild(this.selectedNode.node);
      this.decorationsContainer.removeChild(this.selectedNode.background);
      // important, see how to deal with the connections
      if (this.selectedNode.connections) {
        this.decorationsContainer.removeChild(this.selectedNode.connections);
      }
    }

    if (selectedAnimeID == null) {
      this.updateSelectedNameLabel(null);
      return;
    }

    const point = this.embeddedPointByID.get(selectedAnimeID)!;
    // console.log('test point:',point.metadata.IsAuthor)
    let texture;
    if (point.metadata.IsAuthor === true) {
      texture = this.getNodeTexture();
    } else {
      texture = this.getRecTexture();
    }

    // what is node sprite here? important
    // some errors in the color tint. 
    const nodeSprite = this.buildNodeSprite(texture, point);
    nodeSprite.tint = SELECTED_NODE_COLOR;
    this.selectedNodeContainer.addChild(nodeSprite);

    const nodeBackgroundTexture = this.getNodeBackgroundTexture();
    const backgroundSprite = this.buildNodeBackgroundSprite(nodeBackgroundTexture, point, SELECTED_NODE_COLOR);
    this.decorationsContainer.addChild(backgroundSprite);
    // console.log(point)
    // console.log(texture);
    // important, build lines.
    const connections = this.buildNeighborLines(point);
    if (connections) {
      this.decorationsContainer.addChild(connections);
    }

    this.updateSelectedNameLabel(selectedAnimeID);
    return { node: nodeSprite, background: backgroundSprite, connections };
  }

  // public setColorBy(colorBy: ColorBy) {
  //   this.colorBy = colorBy;
  //   this.colorScaler = AtlasViz.createColorScaler(colorBy);
  //   this.renderNodes();
  //   this.renderLegend();
  // }
  public setColorBy(colorBy: ColorBy) {
    this.colorBy = colorBy;
    this.colorScaler = AtlasViz.createColorScaler(colorBy);
    this.renderNodes();
    this.renderLegend();
  }

  public setLabelsVisible = (visible: boolean) => {
    this.labelsContainer.visible = visible;
    this.hoverLabelsContainer.visible = visible;
    this.selectedLabelContainer.visible = visible;

    const legendContainer = document.getElementById('atlas-viz-legend');
    if (legendContainer) {
      legendContainer.style.display = visible ? '' : 'none';
    }

    if (!visible) {
      this.labelsContainer.removeChildren() as NodeLabel[];
      this.hoverLabelsContainer.removeChildren();
      this.selectedLabelContainer.removeChildren();
      return;
    }

    this.scheduleLabelUpdate(true);
  };


  public flyTo = (id: number, opts?: { maxZoom?: boolean; targetScale?: number }) => {
    captureMessage('Fly to node in atlas', { id, FullName: this.embeddedPointByID.get(id)?.metadata.FullName });
    this.setSelectedAnimeID(id);
    const { x, y } = this.embedding.find((p) => p.metadata.id === id)!.vector;
    const targetScale = opts?.targetScale ?? (opts?.maxZoom ? DENSITY_CONFIG.zoomMax : 8);
    this.container.animate({
      time: 500,
      position: { x, y },
      scale: targetScale,
      ease: (curTime: number, minVal: number, maxVal: number, maxTime: number): number => {
        // cubic ease in out
        const t = curTime / maxTime;
        const p = t * t * t;
        return minVal + (maxVal - minVal) * p;
      },
      callbackOnComplete: () => this.scheduleLabelUpdate(true),
    });
  };

  public setCameraCenterAndHeight = (centerX: number, centerY: number, cameraHeight: number) => {
    const safeHeight = Math.max(cameraHeight, 1e-3);
    const targetScale = Math.min(
      DENSITY_CONFIG.zoomMax,
      Math.max(DENSITY_CONFIG.zoomMin, this.app.renderer.height / safeHeight)
    );
    this.container.setZoom(targetScale, true);
    this.container.moveCenter(centerX, centerY);
    this.updateDensityScale();
    this.scheduleLabelUpdate(true);
  };

  public flyToCameraOnly = async (
    id: number,
    opts?: { maxZoom?: boolean; targetScale?: number; timeMs?: number }
  ): Promise<boolean> => {
    const target = this.embedding.find((p) => p.metadata.id === id);
    if (!target) return false;

    const targetScale = opts?.targetScale ?? (opts?.maxZoom ? DENSITY_CONFIG.zoomMax : 8);
    const timeMs = opts?.timeMs ?? 500;
    await new Promise<void>((resolve) => {
      this.container.animate({
        time: timeMs,
        position: { x: target.vector.x, y: target.vector.y },
        scale: targetScale,
        ease: (curTime: number, minVal: number, maxVal: number, maxTime: number): number => {
          const t = curTime / maxTime;
          const p = t * t * t;
          return minVal + (maxVal - minVal) * p;
        },
        callbackOnComplete: () => {
          this.scheduleLabelUpdate(true);
          resolve();
        },
      });
    });
    return true;
  };

  private getTextScale = () => {
    const currentScale = this.container.scale.x;
    const textSize = (1 / currentScale) * 12.5 + 0.163;
    return textSize / BASE_LABEL_FONT_SIZE;
  };

  private setLabelScale = (
    g: PIXI.DisplayObject,
    datum: EmbeddedPointWithIndex,
    scaleOverride?: number
  ) => {
    g.transform.scale.set(scaleOverride ?? this.getTextScale());
    const baseRadius = this.cachedNodeRadii[datum.index];
    const radius = this.getRenderedNodeWorldRadius(datum.index);
    const [rx, ry] = this.getRenderedPositionByIndex(datum.index);
    g.position.set(rx, ry - radius);
    g.position.y -= 12 * (1 / this.container.scale.x) + baseRadius * 0.0023 * this.container.scale.x;
  };

  private buildHoverLabel = (datum: EmbeddedPointWithIndex): PIXI.Graphics => {
    const text = datum.metadata.FullName || datum.metadata.FullName;
    const textWidth = this.measureText(text);

    const g = new this.PIXI.Graphics();
    g.beginFill(0x111111, 0.9);
    g.drawRoundedRect(0, 0, textWidth + 10, 50, 5);
    g.endFill();
    g.interactive = false;
    g.interactiveChildren = false;

    (g as any).datum = datum;
    this.setLabelScale(g, datum);
    // set origin to center of text
    g.pivot.set(textWidth / 2, 25);

    const textSprite = new this.PIXI.Text(text, {
      fontFamily: 'IBM Plex Sans',
      fontSize: BASE_LABEL_FONT_SIZE,
      fill: 0xcccccc,
      align: 'center',
    });
    textSprite.anchor.set(0.5, 0.5);
    textSprite.position.set(5 + textWidth / 2, 25);
    textSprite.interactive = false;

    g.addChild(textSprite);
    return g;
  };

  private maybeRemoveHoverObjects = () => {
    if (!this.renderedHoverObjects) {
      return;
    }

    const { label, neighborLines } = this.renderedHoverObjects;

    label.parent?.removeChild(label);
    label.destroy({ children: true });

    if (neighborLines) {
      neighborLines.parent?.removeChild(neighborLines);
      neighborLines.destroy({ children: true });
    }

    this.renderedHoverObjects = null;
  };

  // private renderLegend() {
  //   const legendContainer = document.getElementById('atlas-viz-legend')!;
  //   legendContainer.innerHTML = '';

  //   if (this.colorBy === ColorBy.CustomMapping) {
  //     Object.keys(CUSTOM_GROUP_LABELS).forEach(key => {
  //       const label = CUSTOM_GROUP_LABELS[key];
  //       const colorString = this.colorScaler(key);
  //       const color = AtlasViz.parseColorString(colorString);

  //       const legendItem = document.createElement('div');
  //       legendItem.style.display = 'flex';
  //       legendItem.style.alignItems = 'center';
  //       legendItem.style.marginBottom = '4px';

  //       const colorBox = document.createElement('div');
  //       colorBox.style.width = '16px';
  //       colorBox.style.height = '16px';
  //       colorBox.style.backgroundColor = `#${color.toString(16).padStart(6, '0')}`;
  //       colorBox.style.marginRight = '8px';
  //       colorBox.style.border = '1px solid #000';

  //       const labelText = document.createElement('span');
  //       labelText.textContent = label;

  //       legendItem.appendChild(colorBox);
  //       legendItem.appendChild(labelText);
  //       legendContainer.appendChild(legendItem);
  //     });
  //   } else {
  //     const legend = ColorLegend(this.colorScaler, {
  //       title: this.getColorByTitle(),
  //     });
  //     legendContainer.appendChild(legend);
  //   }
  // }
  private renderLegend() {
    const legendContainer = document.getElementById('atlas-viz-legend')!;
    legendContainer.innerHTML = '';

    if (this.colorBy === ColorBy.CustomMapping) {
      Object.keys(CUSTOM_GROUP_LABELS).forEach(key => {
        const label = CUSTOM_GROUP_LABELS[key];
        const colorString = this.colorScaler(key);
        const color = AtlasViz.parseColorString(colorString);

        const legendItem = document.createElement('label');
        legendItem.style.display = 'flex';
        legendItem.style.alignItems = 'center';
        legendItem.style.marginBottom = '4px';
        legendItem.style.cursor = 'pointer';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.visibleCategories.has(key);
        checkbox.style.marginRight = '6px';

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            this.visibleCategories.add(key);
          } else {
            this.visibleCategories.delete(key);

            // if the selected belongs to the canceled category, then clean the selected status
            if (
              this.selectedNode &&
              this.embeddedPointByID.get(this.selectedNode.id)?.metadata.color_category === parseInt(key)
            ) {
              this.setSelectedAnimeID(null); // ⬅ clean the selected nodes
              this.showToast(`⚠️ ${label}hidden – deselected the currently selected node.`); // display toast
            }
          }
          this.renderNodes(); // rerender new nodes
        });

        const colorBox = document.createElement('div');
        colorBox.style.width = '16px';
        colorBox.style.height = '16px';
        colorBox.style.backgroundColor = `#${color.toString(16).padStart(6, '0')}`;
        colorBox.style.marginRight = '8px';
        colorBox.style.border = '1px solid #000';

        const labelText = document.createElement('span');
        labelText.textContent = label;

        legendItem.appendChild(checkbox);
        legendItem.appendChild(colorBox);
        legendItem.appendChild(labelText);
        legendContainer.appendChild(legendItem);
      });
    } else {
      const legend = ColorLegend(this.colorScaler, {
        title: this.getColorByTitle(),
      });
      legendContainer.appendChild(legend);
    }
  }
  private showToast(message: string) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    container.textContent = message;
    container.style.display = 'block';
    container.style.opacity = '1';

    setTimeout(() => {
      container!.style.opacity = '0';
    }, 2000); // fade out time

    setTimeout(() => {
      container!.style.display = 'none';
    }, 2500); // hidden time
  }

  public setNeighbors(neighbors: number[][]) {
    this.neighbors = neighbors;
  }
  public setCollabID(collabID: number | null) {
    this.collabID = collabID;
  }

  public resetSelectionAndHighlights = () => {
    this.setSelectedAnimeID(null);
    this.setCollabID(null);
    this.displayMALUser([]);
  };
  public setCollaboratorsDict(CollaboratorsDict) {
    this.CollaboratorsDict = CollaboratorsDict;
  }
  private computeVisibleNodeIndices = (bounds: Rectangle, sort = true) => {
    let count = 0;

    const xmin = bounds.x;
    const xmax = bounds.x + bounds.width;
    const ymin = bounds.y;
    const ymax = bounds.y + bounds.height;

    // Adapted from https://github.com/d3/d3-quadtree#quadtree_visit
    fastQuadtreeVisit(this.embeddingQuadTree, (node, x1, y1, x2, y2) => {
      if (Array.isArray(node)) {
        return x1 >= xmax || y1 >= ymax || x2 < xmin || y2 < ymin;
      }

      do {
        const nodeIx = node.data;
        const x = this.embeddingPositions[nodeIx * 2];
        const y = this.embeddingPositions[nodeIx * 2 + 1];
        if (x >= xmin && x < xmax && y >= ymin && y < ymax) {
          this.visibleNodesIndicesScratch[count] = nodeIx;
          count += 1;
        }
      } while ((node = node.next));
    });

    // Put `visibleNodeIndicesScratch` in order of increasing index.  The underlying embedding is sorted with
    // more popular nodes first, so this matches that with the visible node indices.
    if (sort) {
      const sorted = this.visibleNodesIndicesScratch.slice(0, count).sort((a, b) => a - b);
      return sorted;
    }
    return this.visibleNodesIndicesScratch.slice(0, count);
  };

  private getBaseLabelScale = (gridSquareSize: number) => {
    // Keep global labels at a readable, near-constant screen size similar to selected labels.
    const zoomAware = this.getTextScale();
    const tierMultiplier =
      gridSquareSize >= 64 ? 1.05 :
        gridSquareSize >= 32 ? 1.0 :
          gridSquareSize >= 16 ? 0.95 :
            gridSquareSize >= 8 ? 0.9 : 0.86;
    const scaled = zoomAware * tierMultiplier;
    return Math.max(0.008, Math.min(scaled, 0.06));
  };

  private getLabelVisibilityProgress = () => {
    const z = this.container.scale.x;
    const hideZoom = 0.9;
    const fullZoom = 6;
    if (z <= hideZoom) {
      return 0;
    }
    if (z >= fullZoom) {
      return 1;
    }
    const t = (z - hideZoom) / (fullZoom - hideZoom);
    // smoothstep for gradual label increase while zooming in
    return t * t * (3 - 2 * t);
  };

  private getAdaptiveMaxLabelsPerGridSquare = (gridSquareSize: number) => {
    const visibilityProgress = this.getLabelVisibilityProgress();
    if (visibilityProgress <= 0) {
      return 0;
    }
    const baseMax =
      gridSquareSize >= 64 ? 2 :
        gridSquareSize >= 32 ? 4 :
          gridSquareSize >= 16 ? 7 :
            gridSquareSize >= 8 ? 10 : 14;
    return Math.max(1, Math.round(baseMax * (0.25 + 0.75 * visibilityProgress)));
  };

  private getAdaptiveLabelBudget = (gridSquareSize: number) => {
    const visibilityProgress = this.getLabelVisibilityProgress();
    if (visibilityProgress <= 0) {
      return 0;
    }
    const screenArea = this.app.renderer.width * this.app.renderer.height;
    const megapixels = Math.max(0.6, screenArea / 1_000_000);
    // Fewer labels when zoomed out; more labels when zoomed in.
    const densityPerMp =
      gridSquareSize >= 64 ? 24 :
        gridSquareSize >= 32 ? 44 :
          gridSquareSize >= 16 ? 72 :
            gridSquareSize >= 8 ? 110 : 150;
    const rawBudget = Math.round(densityPerMp * megapixels);
    const rampedBudget = Math.round(rawBudget * (0.12 + 0.88 * visibilityProgress));
    return Math.max(24, Math.min(620, rampedBudget));
  };

  private compareDatumPriority = (a: EmbeddedPointWithIndex, b: EmbeddedPointWithIndex) => {
    const aIsSeed = a.metadata.IsAuthor && a.metadata.color_category === 2 ? 1 : 0;
    const bIsSeed = b.metadata.IsAuthor && b.metadata.color_category === 2 ? 1 : 0;
    if (bIsSeed !== aIsSeed) {
      return bIsSeed - aIsSeed;
    }
    const aPaperNum = a.metadata.IsAuthor ? a.metadata.PaperNum : -1;
    const bPaperNum = b.metadata.IsAuthor ? b.metadata.PaperNum : -1;
    if (bPaperNum !== aPaperNum) {
      return bPaperNum - aPaperNum;
    }
    return a.index - b.index;
  };

  private computeGlobalLabelsPositions = (
    gridSquareSize: number
  ): { datum: EmbeddedPointWithIndex; transformedBounds: Rectangle }[] => {
    // Base case for recursion
    if (gridSquareSize > MAX_GRID_SQUARE_SIZE) {
      return [];
    }

    const cached = this.cachedGlobalLabelsByGridSize.get(gridSquareSize);
    if (cached) {
      return cached;
    }

    const labelScale = this.getBaseLabelScale(gridSquareSize);

    const computeLabelTransformedBounds = (textWidth: number, x: number, y: number): Rectangle => {
      // Avoid rendering labels on top of each other
      const transformedWidth = textWidth * labelScale;
      const transformedHeight = LABEL_HEIGHT * labelScale;
      const spacingFactor =
        gridSquareSize >= 64 ? 1.2 :
          gridSquareSize >= 32 ? 1.12 :
            gridSquareSize >= 16 ? 1.08 : 1.04;
      const spacingMargin = (spacingFactor - 1) / 2;

      // The origin of the label as at its center, so adjust x and y to put it in the top left corner
      const bounds = {
        x: x - transformedWidth / 2,
        y: y - transformedHeight / 2,
        width: transformedWidth,
        height: transformedHeight,
      };
      // Grow bounds slightly to enforce a bit of space between the labels
      bounds.x -= bounds.width * spacingMargin;
      bounds.width *= spacingFactor;
      bounds.y -= bounds.height * spacingMargin;
      bounds.height *= spacingFactor;

      return bounds;
    };

    // Zooming in retains all labels from the previous zoom level and then adds more.  So, we use all labels
    // from the previous zoom level as a base.
    const retainedLabels = this.computeGlobalLabelsPositions(gridSquareSize * 2);
    // Need to re-compute transformed bounds for the current zoom level
    const labelsToRender = retainedLabels.map(({ datum }) => ({
      datum,
      transformedBounds: computeLabelTransformedBounds(
        this.measureText(datum.metadata.FullName),
        datum.vector.x,
        datum.vector.y
      ),
    }));

    const getRectangleVertices = (rect: Rectangle): [number, number][] => [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height],
      [rect.x + rect.width, rect.y + rect.height],
    ];

    // Add all vertices of each label so intersections can be computed faster
    const labelsToRenderQuadtree = d3
      .quadtree<readonly [number, number, number]>()
      .x(([x]) => x)
      .y(([_x, y]) => y)
      .addAll(
        labelsToRender.flatMap(({ transformedBounds }, i) =>
          getRectangleVertices(transformedBounds).map(([x, y]) => [x, y, i] as const)
        )
      );

    let maxDistanceFromMidpointToEdge = 0;
    labelsToRender.forEach(({ transformedBounds }) => {
      maxDistanceFromMidpointToEdge = Math.max(
        maxDistanceFromMidpointToEdge,
        transformedBounds.width / 2,
        transformedBounds.height / 2
      );
    });

    // Fast-pathed `PIXI.Rectangle.intersects` function
    const fastRectIntersects = (r0: Rectangle, r1: Rectangle) => {
      const r0Right = r0.x + r0.width;
      const r1Right = r1.x + r1.width;

      const x0 = r0.x < r1.x ? r1.x : r0.x;
      const x1 = r0Right > r1Right ? r1Right : r0Right;

      if (x1 <= x0) {
        return false;
      }

      const r0Bottom = r0.y + r0.height;
      const r1Bottom = r1.y + r1.height;

      const y0 = r0.y < r1.y ? r1.y : r0.y;
      const y1 = r0Bottom > r1Bottom ? r1Bottom : r0Bottom;

      return y1 > y0;
    };

    const checkIntersectsExistingLabel = (newLabelBounds: Rectangle): boolean => {
      const midpointX = newLabelBounds.x + newLabelBounds.width / 2;
      const midpointY = newLabelBounds.y + newLabelBounds.height / 2;
      maxDistanceFromMidpointToEdge = Math.max(
        maxDistanceFromMidpointToEdge,
        newLabelBounds.width / 2,
        newLabelBounds.height / 2
      );

      const searchArea_xmin = midpointX - maxDistanceFromMidpointToEdge;
      const searchArea_xmax = midpointX + maxDistanceFromMidpointToEdge;
      const searchArea_ymin = midpointY - maxDistanceFromMidpointToEdge;
      const searchArea_ymax = midpointY + maxDistanceFromMidpointToEdge;

      // Adapted from https://github.com/d3/d3-quadtree#quadtree_visit
      let blocked = false;
      fastQuadtreeVisit(labelsToRenderQuadtree, (node, x1, y1, x2, y2) => {
        if (blocked) {
          return true;
        }

        if (Array.isArray(node)) {
          return x1 > searchArea_xmax || y1 > searchArea_ymax || x2 < searchArea_xmin || y2 < searchArea_ymin;
        }

        do {
          const labelIx = node.data[2];
          const labelBounds = labelsToRender[labelIx].transformedBounds;

          if (fastRectIntersects(newLabelBounds, labelBounds)) {
            blocked = true;
            return true;
          }
        } while ((node = node.next));
      });
      return blocked;
    };

    const dataWidth = this.dataExtents.maxs.x - this.dataExtents.mins.x;
    const dataHeight = this.dataExtents.maxs.y - this.dataExtents.mins.y;
    const gridSquareCountX = Math.ceil(dataWidth / gridSquareSize);
    const gridSquareCountY = Math.ceil(dataHeight / gridSquareSize);

    const gridSquareArea = new this.PIXI.Rectangle();
    gridSquareArea.width = gridSquareSize;
    gridSquareArea.height = gridSquareSize;

    const maxLabelsPerGridSquare = this.getAdaptiveMaxLabelsPerGridSquare(gridSquareSize);

    for (let y = 0; y < gridSquareCountY; y++) {
      for (let x = 0; x < gridSquareCountX; x++) {
        gridSquareArea.x = this.dataExtents.mins.x + x * gridSquareSize;
        gridSquareArea.y = this.dataExtents.mins.y + y * gridSquareSize;
        const visibleNodeIndices = this.computeVisibleNodeIndices(gridSquareArea);
        const prioritizedNodeIndices = Array.from(visibleNodeIndices).sort((a, b) =>
          this.compareDatumPriority(this.embedding[a], this.embedding[b])
        );

        let score = 0;
        for (const nodeIx of prioritizedNodeIndices) {
          const datum = this.embedding[nodeIx];
          // if (String(datum.metadata.color_category) === '3') {
          //   console.log('[✅ CM4AI index]', datum.metadata.FullName);
          // }

          // adding the conditions, skip all the unselected categories
          if (!this.visibleCategories.has(String(datum.metadata.color_category))) continue;

          const textWidth = this.measureText(datum.metadata.FullName);
          const bounds = computeLabelTransformedBounds(textWidth, datum.vector.x, datum.vector.y);
          if (checkIntersectsExistingLabel(bounds)) {
            continue;
          }

          labelsToRender.push({ datum, transformedBounds: bounds });
          labelsToRenderQuadtree.addAll(
            getRectangleVertices(bounds).map(([x, y]) => [x, y, labelsToRender.length - 1] as const)
          );

          score += 1;
          if (score >= maxLabelsPerGridSquare) {
            break;
          }
        }
      }
    }

    // No special label handling needed for current categories


    this.cachedGlobalLabelsByGridSize.set(gridSquareSize, labelsToRender);
    return labelsToRender;
  };

  private buildLabel = (datum: EmbeddedPointWithIndex, labelScale: number) => {
    const text = datum.metadata.FullName ?? datum.metadata.FullName;
    const cachedTextSprite = this.cachedLabels.get(text);
    if (cachedTextSprite) {
      this.setLabelScale(cachedTextSprite, datum, labelScale);
      return cachedTextSprite;
    }

    const textWidth = this.measureText(text);

    const label = new this.NodeLabel(
      text,
      {
        fontFamily: 'IBM Plex Sans',
        fontSize: BASE_LABEL_FONT_SIZE,
        fill: 0xffffff,
        align: 'center',
      },
      textWidth
    );
    label.position.set(5 + textWidth / 2, 25);
    label.interactive = false;

    label.datum = datum;
    label.textWidth = textWidth;
    this.setLabelScale(label, datum, labelScale);
    this.cachedLabels.set(text, label);
    label.beginFill(0xff0000, 0.2);
    label.drawRect(-textWidth / 2, -LABEL_HEIGHT / 2, textWidth, LABEL_HEIGHT);
    label.endFill();

    return label;
  };

  private getGridSquareSize = () => {
    const curZoomScale = this.container.scale.x;
    const rawGridSquareSize = (1 / curZoomScale) * 400;
    // Round to nearest power of 2
    const gridSquareSize = Math.pow(2, Math.round(Math.log2(rawGridSquareSize)));
    if (gridSquareSize > MAX_GRID_SQUARE_SIZE) {
      return MAX_GRID_SQUARE_SIZE;
    }
    if (gridSquareSize < MIN_GRID_SQUARE_SIZE) {
      return MIN_GRID_SQUARE_SIZE;
    }
    return gridSquareSize;
  };

  private updateLabels = () => {
    const gridSquareSize = this.getGridSquareSize();

    // Remove but do not destroy the removed labels since we cache them
    this.labelsContainer.removeChildren() as NodeLabel[];

    const labelBudgetMultiplier = this.localAvoidanceActive ? LABEL_BUDGET_MULTIPLIER_WHILE_AVOIDANCE : 1;
    const labelBudget = Math.round(this.getAdaptiveLabelBudget(gridSquareSize) * labelBudgetMultiplier);
    if (labelBudget <= 0) {
      return;
    }

    const globalLabelPositionsForZoomLevel = this.computeGlobalLabelsPositions(gridSquareSize);

    const visibleNodeIndices = new Set(this.computeVisibleNodeIndices(this.container.getVisibleBounds(), false));
    const labelScale = this.getBaseLabelScale(gridSquareSize);
    const labelsToRender = globalLabelPositionsForZoomLevel
      .filter(({ datum }) => {
        //console.log('label candidate', datum.metadata.FullName, datum.metadata.color_category);

        const category = String(datum.metadata.color_category);

        const isVisible = visibleNodeIndices.has(datum.index);
        const isCategorySelected = this.visibleCategories.has(category);
        const isAuthorValid =
          !datum.metadata.IsAuthor ||
          (datum.metadata.PaperNum >= this.publicationRange[0] && datum.metadata.PaperNum <= this.publicationRange[1]);

        // Display condition: visible, category selected, and valid author filters
        return isVisible && isAuthorValid && isCategorySelected;
      }
      ) // filter legend & range
      .sort((a, b) => this.compareDatumPriority(a.datum, b.datum))
      .slice(0, labelBudget)
      .map(({ datum }) => this.buildLabel(datum, labelScale));

    for (const label of labelsToRender) {
      this.labelsContainer.addChild(label);
    }

  };

  public setMaxWidth = (maxWidth: number | undefined) => {
    this.maxCanvasWidth = maxWidth;
    this.handleResize();
  };

  public dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.container.off('pointerdown', this.pointerCbs.pointerUp);
    this.container.off('pointerup', this.pointerCbs.pointerUp);
    this.app.renderer.view.removeEventListener('pointermove', this.pointerCbs.pointerMove);
    this.app.renderer.view.removeEventListener('pointerleave', this.pointerCbs.pointerLeave);
    if (this.localAvoidanceTimeout !== null) {
      window.clearTimeout(this.localAvoidanceTimeout);
      this.localAvoidanceTimeout = null;
    }
    if (this.labelUpdateTimeout !== null) {
      window.clearTimeout(this.labelUpdateTimeout);
      this.labelUpdateTimeout = null;
    }
    this.app.ticker.stop();
    this.app.destroy(false, { children: true, texture: true, baseTexture: true });
  }
}
