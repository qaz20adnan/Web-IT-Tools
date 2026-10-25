const NODES = [
  { x: 40, y: 60, r: 2.6 },
  { x: 120, y: 34, r: 1.8 },
  { x: 196, y: 78, r: 3 },
  { x: 274, y: 44, r: 2 },
  { x: 348, y: 92, r: 2.4 },
  { x: 424, y: 52, r: 1.7 },
  { x: 500, y: 84, r: 2.8 },
  { x: 574, y: 46, r: 1.9 },
  { x: 646, y: 98, r: 2.4 },
  { x: 82, y: 138, r: 1.9 },
  { x: 162, y: 172, r: 2.4 },
  { x: 240, y: 128, r: 1.7 },
  { x: 314, y: 184, r: 2.8 },
  { x: 392, y: 142, r: 1.8 },
  { x: 468, y: 190, r: 2.2 },
  { x: 548, y: 148, r: 2.8 },
  { x: 624, y: 182, r: 1.8 },
  { x: 700, y: 132, r: 2.2 },
  { x: 60, y: 214, r: 2 },
  { x: 206, y: 230, r: 2.2 },
  { x: 356, y: 242, r: 1.7 },
  { x: 512, y: 232, r: 2.2 },
  { x: 660, y: 232, r: 1.8 },
  { x: 724, y: 78, r: 1.6 },
]

const LINKS: Array<[number, number, number]> = [
  [0, 1, 1],
  [1, 2, 1],
  [2, 3, 1],
  [3, 4, 1],
  [4, 5, 1],
  [5, 6, 1],
  [6, 7, 1],
  [7, 8, 1],
  [8, 23, 2],
  [0, 9, 1],
  [9, 10, 1],
  [10, 11, 1],
  [11, 12, 1],
  [12, 13, 1],
  [13, 14, 1],
  [14, 15, 1],
  [15, 16, 1],
  [16, 17, 2],
  [9, 18, 1],
  [10, 19, 1],
  [12, 19, 2],
  [13, 20, 1],
  [14, 21, 1],
  [15, 22, 1],
  [16, 22, 2],
  [2, 10, 2],
  [4, 12, 2],
  [6, 14, 2],
  [7, 16, 2],
  [11, 20, 2],
  [17, 23, 1],
]

export function HeroNetwork() {
  return (
    <svg className="nx-hero-network" viewBox="0 0 760 280" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <linearGradient id="nx-link-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#35d6f2" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#30d6b5" stopOpacity="0.12" />
        </linearGradient>
        <radialGradient id="nx-node-glow">
          <stop offset="0%" stopColor="#35d6f2" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#35d6f2" stopOpacity="0" />
        </radialGradient>
        <filter id="nx-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {LINKS.map(([from, to, weight], index) => {
        const a = NODES[from]
        const b = NODES[to]
        return (
          <line
            key={`${from}-${to}-${index}`}
            className="nx-link"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="url(#nx-link-gradient)"
            strokeWidth={weight === 2 ? 1.15 : 0.7}
            style={{ animationDelay: `${(index % 7) * -2.4}s` }}
          />
        )
      })}

      {NODES.map((node, index) => (
        <g key={`${node.x}-${node.y}`} className="nx-node" style={{ animationDelay: `${(index % 9) * -0.55}s` }}>
          <circle cx={node.x} cy={node.y} r={node.r * 4.5} fill="url(#nx-node-glow)" opacity="0.22" />
          <circle
            cx={node.x}
            cy={node.y}
            r={node.r}
            fill={index % 5 === 0 ? '#e6b85c' : index % 3 === 0 ? '#30d6b5' : '#35d6f2'}
            filter={node.r > 2.2 ? 'url(#nx-soft-glow)' : undefined}
          />
        </g>
      ))}

      {[
        [1, 2],
        [10, 12],
        [14, 16],
        [0, 9],
      ].map(([a, b], index) => (
        <circle key={`packet-${index}`} r="1.6" fill="#eaf4fa" opacity="0.9">
          <animateMotion
            dur={`${5 + index * 1.4}s`}
            repeatCount="indefinite"
            path={`M${NODES[a].x},${NODES[a].y} L${NODES[b].x},${NODES[b].y}`}
            begin={`${index * 1.1}s`}
          />
        </circle>
      ))}
    </svg>
  )
}
