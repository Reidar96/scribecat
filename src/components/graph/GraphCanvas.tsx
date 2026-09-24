import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { VaultGraphEdge, VaultGraphNode } from "@/lib/graphIndex";
import { cn } from "@/lib/utils";

type GraphCanvasProps = {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
  activeFilePath: string | null;
  onActivateNode: (node: VaultGraphNode) => void;
};

type Point = { x: number; y: number; vx: number; vy: number };
type ViewTransform = { x: number; y: number; scale: number };
type NodeDrag = {
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
};
type PanDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const NODE_RADIUS = 7;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initialPoint(id: string, centerX: number, centerY: number): Point {
  const hash = hashString(id);
  const angle = ((hash % 3600) / 3600) * Math.PI * 2;
  const radius = 22 + ((hash >>> 8) % 58);
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
    vx: 0,
    vy: 0
  };
}

function connectionKey(left: string, right: string): string {
  return left < right ? left + "\u0000" + right : right + "\u0000" + left;
}

function buildComponentAnchors(
  nodes: VaultGraphNode[],
  edges: VaultGraphEdge[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  components.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));

  const anchors = new Map<string, { x: number; y: number }>();
  const centerX = width / 2;
  const centerY = height / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  components.forEach((component, index) => {
    // A loose sunflower spiral keeps disconnected islands organic instead of
    // arranging them in a visible rectangular grid.
    const radius = index === 0 ? 0 : 105 + Math.sqrt(index) * 115;
    const angle = index * goldenAngle;
    const anchor = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };

    for (const id of component) anchors.set(id, anchor);
  });

  return anchors;
}

function edgeLength(kind: VaultGraphEdge["kind"]): number {
  if (kind === "tag") return 66;
  if (kind === "folder") return 74;
  return 82;
}

function nodeTitle(node: VaultGraphNode): string {
  if (node.kind === "note") return node.relativePath ?? node.label;
  if (node.kind === "folder") return node.relativePath || node.label;
  return node.label;
}

export function GraphCanvas({
  nodes,
  edges,
  activeFilePath,
  onActivateNode
}: GraphCanvasProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointsRef = useRef<Map<string, Point>>(new Map());
  const nodeDragRef = useRef<NodeDrag | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      const rect = host.getBoundingClientRect();
      setSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height)
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const degreeById = useMemo(() => {
    const result = new Map<string, number>();
    for (const edge of edges) {
      result.set(edge.source, (result.get(edge.source) ?? 0) + 1);
      result.set(edge.target, (result.get(edge.target) ?? 0) + 1);
    }
    return result;
  }, [edges]);

  const neighborIds = useMemo(() => {
    const sourceId = hoveredId ?? focusedId;
    if (!sourceId) return null;

    const result = new Set<string>([sourceId]);
    for (const edge of edges) {
      if (edge.source === sourceId) result.add(edge.target);
      if (edge.target === sourceId) result.add(edge.source);
    }
    return result;
  }, [edges, focusedId, hoveredId]);

  useEffect(() => {
    if (size.width <= 1 || size.height <= 1 || nodes.length === 0) return;

    const points = pointsRef.current;
    const componentAnchors = buildComponentAnchors(
      nodes,
      edges,
      size.width,
      size.height
    );
    const connectedPairs = new Set(
      edges.map((edge) => connectionKey(edge.source, edge.target))
    );
    const focusNeighbors = new Set<string>();
    if (focusedId) {
      focusNeighbors.add(focusedId);
      for (const edge of edges) {
        if (edge.source === focusedId) focusNeighbors.add(edge.target);
        if (edge.target === focusedId) focusNeighbors.add(edge.source);
      }
    }

    for (const node of nodes) {
      if (!points.has(node.id)) {
        const anchor = componentAnchors.get(node.id) ?? {
          x: size.width / 2,
          y: size.height / 2
        };
        points.set(node.id, initialPoint(node.id, anchor.x, anchor.y));
      }
    }

    const visibleIds = new Set(nodes.map((node) => node.id));
    let animationFrame = 0;
    let iterations = 0;

    const step = () => {
      iterations += 1;
      const cellSize = 220;
      const buckets = new Map<string, string[]>();

      for (const node of nodes) {
        const point = points.get(node.id);
        if (!point) continue;
        const cellX = Math.floor(point.x / cellSize);
        const cellY = Math.floor(point.y / cellSize);
        const key = String(cellX) + ":" + String(cellY);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(node.id);
        else buckets.set(key, [node.id]);
      }

      for (const node of nodes) {
        const point = points.get(node.id);
        if (!point) continue;
        const cellX = Math.floor(point.x / cellSize);
        const cellY = Math.floor(point.y / cellSize);

        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            const key = String(cellX + offsetX) + ":" + String(cellY + offsetY);
            const bucket = buckets.get(key) ?? [];

            for (const otherId of bucket) {
              if (otherId <= node.id) continue;
              const other = points.get(otherId);
              if (!other) continue;

              let dx = other.x - point.x;
              let dy = other.y - point.y;
              let distanceSquared = dx * dx + dy * dy;
              if (distanceSquared < 0.01) {
                dx = 0.1;
                dy = 0.1;
                distanceSquared = 0.02;
              }

              const distance = Math.sqrt(distanceSquared);
              const directlyConnected = connectedPairs.has(
                connectionKey(node.id, otherId)
              );
              // Connected nodes are allowed to form a tight "string". Nodes
              // without a direct connection repel each other over a much
              // longer distance, which opens visible gaps between groups.
              const involvesFocus =
                focusedId !== null && (node.id === focusedId || otherId === focusedId);
              const separation = involvesFocus
                ? directlyConnected
                  ? 72
                  : 300
                : directlyConnected
                  ? 38
                  : 175;
              if (distance > separation) continue;

              const strength = involvesFocus
                ? directlyConnected
                  ? 0.055
                  : 0.16
                : directlyConnected
                  ? 0.04
                  : 0.07;
              const force = ((separation - distance) / separation) * strength;
              const fx = (dx / distance) * force;
              const fy = (dy / distance) * force;
              point.vx -= fx;
              point.vy -= fy;
              other.vx += fx;
              other.vy += fy;
            }
          }
        }
      }

      for (const edge of edges) {
        if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
        const source = points.get(edge.source);
        const target = points.get(edge.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const focusEdge =
          focusedId !== null &&
          (edge.source === focusedId || edge.target === focusedId);
        const desiredLength = focusEdge ? Math.max(64, edgeLength(edge.kind) - 8) : edgeLength(edge.kind);
        const force = (distance - desiredLength) * (focusEdge ? 0.0068 : 0.0046);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      let movement = 0;
      const centerX = size.width / 2;
      const centerY = size.height / 2;

      for (const node of nodes) {
        const point = points.get(node.id);
        if (!point) continue;

        const anchor = componentAnchors.get(node.id) ?? { x: centerX, y: centerY };

        if (focusedId) {
          if (node.id === focusedId) {
            // The selected node becomes the calm centre of the bubble.
            point.vx += (centerX - point.x) * 0.012;
            point.vy += (centerY - point.y) * 0.012;
          } else if (focusNeighbors.has(node.id)) {
            // Direct neighbours orbit close to the focus but keep their own
            // spring-determined angles, so the shape remains alive.
            const dx = point.x - centerX;
            const dy = point.y - centerY;
            const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const targetRadius = 115;
            const radialForce = (distance - targetRadius) * 0.0018;
            point.vx -= (dx / distance) * radialForce;
            point.vy -= (dy / distance) * radialForce;
          } else {
            // Everything unrelated yields space around the chosen node.
            const dx = point.x - centerX;
            const dy = point.y - centerY;
            const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const keepOutRadius = 245;
            if (distance < keepOutRadius) {
              const force = ((keepOutRadius - distance) / keepOutRadius) * 0.12;
              point.vx += (dx / distance) * force;
              point.vy += (dy / distance) * force;
            }

            point.vx += (anchor.x - point.x) * 0.00022;
            point.vy += (anchor.y - point.y) * 0.00022;
          }
        } else {
          // Without a focus the whole graph behaves as one soft, rounded cloud.
          point.vx += (anchor.x - point.x) * 0.00034;
          point.vy += (anchor.y - point.y) * 0.00034;
          point.vx += (centerX - point.x) * 0.00011;
          point.vy += (centerY - point.y) * 0.00011;
        }

        point.vx *= 0.86;
        point.vy *= 0.86;

        const speed = Math.sqrt(point.vx * point.vx + point.vy * point.vy);
        if (speed > 6) {
          point.vx = (point.vx / speed) * 6;
          point.vy = (point.vy / speed) * 6;
        }

        point.x += point.vx;
        point.y += point.vy;
        movement += Math.abs(point.vx) + Math.abs(point.vy);
      }

      setFrame((value) => value + 1);
      if (iterations < 300 && (iterations < 100 || movement > nodes.length * 0.008)) {
        animationFrame = window.requestAnimationFrame(step);
      }
    };

    animationFrame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [nodes, edges, focusedId, size.width, size.height]);

  void frame;

  const changeZoom = (factor: number) => {
    setView((current) => {
      const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * factor));
      const centerX = size.width / 2;
      const centerY = size.height / 2;
      const worldX = (centerX - current.x) / current.scale;
      const worldY = (centerY - current.y) / current.scale;
      return {
        scale: nextScale,
        x: centerX - worldX * nextScale,
        y: centerY - worldY * nextScale
      };
    });
  };

  const fitGraph = () => {
    const visiblePoints = nodes
      .map((node) => pointsRef.current.get(node.id))
      .filter((point): point is Point => Boolean(point));

    if (visiblePoints.length === 0) {
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }

    const minX = Math.min(...visiblePoints.map((point) => point.x));
    const maxX = Math.max(...visiblePoints.map((point) => point.x));
    const minY = Math.min(...visiblePoints.map((point) => point.y));
    const maxY = Math.max(...visiblePoints.map((point) => point.y));
    const graphWidth = Math.max(80, maxX - minX);
    const graphHeight = Math.max(80, maxY - minY);
    const horizontalRoom = Math.max(80, size.width - Math.min(90, size.width / 3));
    const verticalRoom = Math.max(80, size.height - Math.min(90, size.height / 3));
    const scale = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(horizontalRoom / graphWidth, verticalRoom / graphHeight))
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setView({
      scale,
      x: size.width / 2 - centerX * scale,
      y: size.height / 2 - centerY * scale
    });
  };

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    setView((current) => {
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * factor));
      const worldX = (localX - current.x) / current.scale;
      const worldY = (localY - current.y) / current.scale;
      return {
        scale: nextScale,
        x: localX - worldX * nextScale,
        y: localY - worldY * nextScale
      };
    });
  };

  const onPanPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".graph-view__node")) return;

    setFocusedId(null);
    panDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: view.x,
      startY: view.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPanPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: drag.startX + event.clientX - drag.startClientX,
      y: drag.startY + event.clientY - drag.startClientY
    }));
  };

  const finishPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panDragRef.current?.pointerId !== event.pointerId) return;
    panDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onNodePointerDown = (event: ReactPointerEvent<SVGGElement>, node: VaultGraphNode) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    const point = pointsRef.current.get(node.id);
    const svg = svgRef.current;
    if (!point || !svg) return;

    const rect = svg.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - view.x) / view.scale;
    const worldY = (event.clientY - rect.top - view.y) / view.scale;

    nodeDragRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: worldX - point.x,
      offsetY: worldY - point.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onNodePointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const svg = svgRef.current;
    const point = pointsRef.current.get(drag.nodeId);
    if (!svg || !point) return;

    if (
      Math.abs(event.clientX - drag.startClientX) > 3 ||
      Math.abs(event.clientY - drag.startClientY) > 3
    ) {
      drag.moved = true;
    }

    const rect = svg.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - view.x) / view.scale;
    const worldY = (event.clientY - rect.top - view.y) / view.scale;
    point.x = worldX - drag.offsetX;
    point.y = worldY - drag.offsetY;
    point.vx = 0;
    point.vy = 0;
    setFrame((value) => value + 1);
  };

  const onNodePointerUp = (event: ReactPointerEvent<SVGGElement>, node: VaultGraphNode) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.nodeId !== node.id) return;

    nodeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag.moved) {
      if (focusedId === node.id) {
        onActivateNode(node);
      } else {
        setFocusedId(node.id);
      }
    }
  };

  const onNodePointerCancel = (event: ReactPointerEvent<SVGGElement>) => {
    if (nodeDragRef.current?.pointerId === event.pointerId) {
      nodeDragRef.current = null;
    }
  };

  return (
    <div ref={hostRef} className="graph-view__canvas-shell">
      <svg
        ref={svgRef}
        className="graph-view__canvas"
        width={size.width}
        height={size.height}
        role="application"
        aria-label={t("graph.canvasLabel")}
        onWheel={onWheel}
        onPointerDown={onPanPointerDown}
        onPointerMove={onPanPointerMove}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
      >
        <g transform={"translate(" + view.x + " " + view.y + ") scale(" + view.scale + ")"}>
          <g className="graph-view__edges" aria-hidden="true">
            {edges.map((edge) => {
              const source = pointsRef.current.get(edge.source);
              const target = pointsRef.current.get(edge.target);
              if (!source || !target) return null;
              const dimmed =
                hoveredId !== null &&
                edge.source !== hoveredId &&
                edge.target !== hoveredId;

              return (
                <line
                  key={edge.id}
                  className={cn(
                    "graph-view__edge",
                    "graph-view__edge--" + edge.kind,
                    dimmed && "graph-view__edge--dimmed"
                  )}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                />
              );
            })}
          </g>

          <g className="graph-view__nodes">
            {nodes.map((node) => {
              const point = pointsRef.current.get(node.id);
              if (!point) return null;

              const degree = degreeById.get(node.id) ?? 0;
              const radius = NODE_RADIUS + Math.min(5, Math.sqrt(degree) * 1.25);
              const active = node.kind === "note" && node.filePath === activeFilePath;
              const focused = focusedId === node.id;
              const dimmed = neighborIds !== null && !neighborIds.has(node.id);
              const label =
                node.kind === "note"
                  ? t("graph.openNote", { name: node.label })
                  : node.kind === "tag"
                    ? t("graph.openTag", { name: node.label })
                    : t("graph.openFolder", { name: node.label });

              return (
                <g
                  key={node.id}
                  className={cn(
                    "graph-view__node",
                    "graph-view__node--" + node.kind,
                    active && "graph-view__node--active",
                    focused && "graph-view__node--focused",
                    dimmed && "graph-view__node--dimmed"
                  )}
                  transform={"translate(" + point.x + " " + point.y + ")"}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  onPointerEnter={() => setHoveredId(node.id)}
                  onPointerLeave={() =>
                    setHoveredId((current) => (current === node.id ? null : current))
                  }
                  onPointerDown={(event) => onNodePointerDown(event, node)}
                  onPointerMove={onNodePointerMove}
                  onPointerUp={(event) => onNodePointerUp(event, node)}
                  onPointerCancel={onNodePointerCancel}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (focusedId === node.id) {
                        onActivateNode(node);
                      } else {
                        setFocusedId(node.id);
                      }
                    }
                  }}
                >
                  <title>{nodeTitle(node)}</title>
                  {active || focused ? (
                    <circle
                      className={cn(
                        "graph-view__node-active-ring",
                        focused && "graph-view__node-focus-ring"
                      )}
                      r={radius + 5}
                    />
                  ) : null}
                  {node.kind === "note" ? (
                    <circle className="graph-view__node-shape" r={radius} />
                  ) : node.kind === "tag" ? (
                    <rect
                      className="graph-view__node-shape"
                      x={-radius * 0.72}
                      y={-radius * 0.72}
                      width={radius * 1.44}
                      height={radius * 1.44}
                      rx={2}
                      transform="rotate(45)"
                    />
                  ) : (
                    <rect
                      className="graph-view__node-shape"
                      x={-radius}
                      y={-radius * 0.72}
                      width={radius * 2}
                      height={radius * 1.44}
                      rx={3}
                    />
                  )}
                  <text className="graph-view__node-label" x={radius + 5} y={4}>
                    {node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <div className="graph-view__zoom-controls">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("zoomControl.zoomIn")}
          title={t("zoomControl.zoomIn")}
          onClick={() => changeZoom(1.2)}
        >
          <ZoomIn />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("zoomControl.zoomOut")}
          title={t("zoomControl.zoomOut")}
          onClick={() => changeZoom(1 / 1.2)}
        >
          <ZoomOut />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("graph.fit")}
          title={t("graph.fit")}
          onClick={fitGraph}
        >
          <Scan />
        </Button>
      </div>
    </div>
  );
}
