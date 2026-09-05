import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMarker, SentryLayer } from '@/types/domain';
import { MARKER_RADIUS, MARKER_SCALE_STEP, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from './constants';
import {
  EQUATOR_PATH,
  GRATICULE_PATH,
  LAND_PATH,
  MAP_HEIGHT,
  MAP_WIDTH,
  project,
} from './worldPath';
import styles from './WorldMap.module.css';

/**
 * The map.
 *
 * An `<svg>` with a `viewBox`, which is what makes pan and zoom a matter of changing four
 * numbers rather than of loading a mapping library. See `worldPath.ts` for why there is no
 * library and what the projection costs.
 *
 * # Accessibility
 *
 * The `<svg>` is `role="img"` with a label that says what it contains, and the markers inside
 * it are plain shapes rather than controls. That is deliberate: a few hundred focusable nodes
 * inside a graphic is a worse experience than it sounds, and screen reader support for
 * interactive SVG children is uneven in WKWebView, which is this app's macOS target.
 *
 * The keyboard and screen reader path is the **visible** list beside the map, not a hidden
 * duplicate of it. Every marker on the map appears in `MarkerList` as a real button that
 * selects the same thing. Nothing is reachable by pointer that is not reachable by keyboard.
 */

interface WorldMapProps {
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (markerId: string | null) => void;
  /** Layers currently drawn. Markers outside it are not rendered at all. */
  visible: Set<SentryLayer>;
}

interface View {
  zoom: number;
  /** Centre of the view, in projected units. */
  cx: number;
  cy: number;
}

const INITIAL_VIEW: View = { zoom: 1, cx: MAP_WIDTH / 2, cy: MAP_HEIGHT / 2 };

/**
 * Draw order. Reference geography sits underneath, hazards on top.
 *
 * Without this the paint order is whatever the server happened to return, and a magnitude 7
 * earthquake can end up behind a container port.
 */
const LAYER_ORDER: SentryLayer[] = ['chokepoints', 'economy', 'flights', 'weather', 'seismic'];

export function WorldMap({ markers, selectedId, onSelect, visible }: WorldMapProps) {
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * The pane's shape, so the viewBox can match it.
   *
   * Without this the map is 2:1 in a pane that is rarely 2:1, and one of the two bad outcomes
   * follows: `slice` crops the world (the eastern Pacific, and every marker in it, went missing
   * this way) or `meet` letterboxes and wastes half the pane. Matching the viewBox to the
   * container gives the whole world *and* the whole pane — the vertical overshoot is simply
   * space above the pole, where there is nothing to draw anyway.
   */
  const [aspect, setAspect] = useState(2);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    // ResizeObserver fires once on observe, so the initial size arrives through the same path
    // as every later one — no separate measure-on-mount that could disagree with it.
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width === 0 || box.height === 0) return;
      setAspect(box.width / box.height);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shown = useMemo(
    () =>
      markers
        .filter((marker) => visible.has(marker.layer))
        .slice()
        .sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer)),
    [markers, visible],
  );

  const width = MAP_WIDTH / view.zoom;
  const height = width / aspect;

  /**
   * Keeps the view inside the world.
   *
   * Without the clamp, panning walks off the edge and leaves an empty pane with no clue how to
   * get back — the classic way a hand-rolled map traps someone.
   */
  const clamp = useCallback(
    (next: View): View => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.zoom));
      const halfW = MAP_WIDTH / zoom / 2;
      const halfH = MAP_WIDTH / zoom / aspect / 2;

      /*
       * When the view is taller (or wider) than the world it is showing, there is nothing to
       * pan to and the axis is pinned to the middle. Running the ordinary clamp in that case
       * inverts it — the lower bound ends up above the upper one — and the map drifts to a
       * corner and stays there.
       */
      const centre = (half: number, extent: number, value: number): number =>
        half * 2 >= extent ? extent / 2 : Math.min(extent - half, Math.max(half, value));

      return {
        zoom,
        cx: centre(halfW, MAP_WIDTH, next.cx),
        cy: centre(halfH, MAP_HEIGHT, next.cy),
      };
    },
    [aspect],
  );

  const zoomBy = useCallback(
    (factor: number) => setView((current) => clamp({ ...current, zoom: current.zoom * factor })),
    [clamp],
  );

  /** Projected units per screen pixel, so a drag moves the map exactly under the pointer. */
  const unitsPerPixel = useCallback(() => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 1;
    return width / box.width;
  }, [width]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // Primary button only: a right-click drag is a context menu, not a pan.
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start) return;
    const scale = unitsPerPixel();
    setView(
      clamp({
        zoom: view.zoom,
        cx: start.cx - (event.clientX - start.x) * scale,
        cy: start.cy - (event.clientY - start.y) * scale,
      }),
    );
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /*
   * Marker size is divided by the zoom so a marker keeps its size on screen while the map
   * grows underneath it. Stroke widths do the same, via `vector-effect: non-scaling-stroke`
   * in the stylesheet, which the browser does more cheaply than arithmetic here.
   */
  const markerScale = 1 / view.zoom;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <svg
        ref={svgRef}
        className={dragging ? styles.svgDragging : styles.svg}
        viewBox={`${view.cx - width / 2} ${view.cy - height / 2} ${width} ${height}`}
        /*
          `meet`, not `slice`. The viewBox is always 2:1 and the pane rarely is, so `slice`
          scales to cover and crops the difference — at the pane width this ships at, that hid
          the eastern Pacific and with it every marker in the Aleutians. Fitting instead of
          filling letterboxes, and the letterbox is invisible because the ocean rect and the
          wrapper behind it are the same colour.
        */
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`World map showing ${shown.length} ${
          shown.length === 1 ? 'marker' : 'markers'
        }. Every marker is also listed beside the map.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect
          x={0}
          y={0}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          className={styles.ocean}
          // The ocean is the click target for "nothing" — pressing it clears the selection,
          // which is the gesture people try before they find the close button.
          onClick={() => onSelect(null)}
        />

        <path d={GRATICULE_PATH} className={styles.graticule} />
        <path d={EQUATOR_PATH} className={styles.equator} />
        <path d={LAND_PATH} className={styles.land} />

        <g>
          {shown.map((marker) => (
            <Marker
              key={marker.id}
              marker={marker}
              scale={markerScale}
              selected={marker.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </g>
      </svg>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={view.zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={view.zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={() => setView(INITIAL_VIEW)}
          disabled={view.zoom === 1 && view.cx === INITIAL_VIEW.cx && view.cy === INITIAL_VIEW.cy}
          aria-label="Reset the view to the whole world"
        >
          ⌂
        </button>
      </div>

      {/*
        The zoom level, announced politely. Someone using magnification needs to know the view
        changed; an alert would be far too loud for a button they just pressed themselves.
      */}
      <div className={styles.scale} role="status" aria-live="polite">
        {view.zoom.toFixed(1)}×
      </div>
    </div>
  );
}

function Marker({
  marker,
  scale,
  selected,
  onSelect,
}: {
  marker: MapMarker;
  scale: number;
  selected: boolean;
  onSelect: (markerId: string) => void;
}) {
  const { x, y } = project(marker.lat, marker.lon);

  // `scale` is the earthquake magnitude where there is one. Radius grows with it so a
  // magnitude 7 reads as larger than a 4.6 without needing a legend.
  const radius = (MARKER_RADIUS + (marker.scale ?? 0) * MARKER_SCALE_STEP) * scale;

  return (
    <g
      className={styles.marker}
      data-layer={marker.layer}
      data-severity={marker.severity}
      data-selected={selected ? 'true' : undefined}
      transform={`translate(${x} ${y})`}
      onClick={(event) => {
        // The svg's own pointer handlers are for panning; a marker click must not also be
        // read as a click on the ocean underneath it.
        event.stopPropagation();
        onSelect(marker.id);
      }}
    >
      {selected ? <circle r={radius * 2} className={styles.halo} /> : null}
      <Symbol layer={marker.layer} radius={radius} />
    </g>
  );
}

/**
 * A distinct shape per layer.
 *
 * Shape rather than colour alone, and this is not a preference. The palette rules in UI_MAP.md
 * §6 require that nothing is signalled by hue on its own; on a map that matters more than
 * anywhere else in the app, because the markers are small, they overlap, and there is no text
 * beside them to fall back on.
 */
function Symbol({ layer, radius }: { layer: SentryLayer; radius: number }) {
  switch (layer) {
    case 'seismic':
      // Concentric rings — a shock spreading from a point.
      return (
        <>
          <circle r={radius} className={styles.symbolFill} />
          <circle r={radius * 1.7} className={styles.symbolRing} />
        </>
      );
    case 'weather':
      // A triangle: the warning shape, and the one that reads at the smallest size.
      return (
        <path
          d={`M0,${-radius * 1.2} L${radius * 1.1},${radius * 0.8} L${-radius * 1.1},${radius * 0.8} Z`}
          className={styles.symbolFill}
        />
      );
    case 'flights':
      // A chevron pointing up. Heading is in the inspector rather than the glyph — OpenSky's
      // track is often stale by more than the marker is wide.
      return (
        <path
          d={`M0,${-radius} L${radius * 0.9},${radius} L0,${radius * 0.4} L${-radius * 0.9},${radius} Z`}
          className={styles.symbolFill}
        />
      );
    case 'chokepoints':
      // A diamond — a fixed place rather than an event.
      return (
        <path
          d={`M0,${-radius} L${radius},0 L0,${radius} L${-radius},0 Z`}
          className={styles.symbolOutline}
        />
      );
    case 'economy':
      // A square, the most obviously non-event shape left.
      return (
        <rect
          x={-radius * 0.8}
          y={-radius * 0.8}
          width={radius * 1.6}
          height={radius * 1.6}
          className={styles.symbolOutline}
        />
      );
    default:
      return <circle r={radius} className={styles.symbolFill} />;
  }
}
