// Layout strategies - Pluggable positioning algorithms
// Each strategy implements calculatePositions(N, config) returning position objects

/**
 * Base class for layout strategies.
 * Subclasses must implement calculatePositions().
 */
class LayoutStrategy {
  constructor(name) {
    this.name = name;
  }

  /**
   * Calculate positions for N pets.
   * @param {number} N - Number of pets
   * @param {object} config - Layout configuration
   * @returns {Array<{x, y, scale, opacity, zIndex, isForeground}>}
   */
  calculatePositions(N, config) {
    throw new Error("LayoutStrategy.calculatePositions() must be implemented by subclass");
  }
}

/**
 * Circular carousel layout with perspective projection.
 * Pets arranged in a ring, with depth-based scaling and opacity.
 */
class CircularLayoutStrategy extends LayoutStrategy {
  constructor() {
    super("circular");
  }

  /**
   * Calculate position for a pet at a given angle on the carousel.
   */
  calculatePositionForAngle(angle, radius) {
    // Normalize angle to [-π, π]
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;

    // Depth factor: 0 at front (angle=0), 1 at back (angle=±π)
    const depth = (1 - Math.cos(angle)) / 2;

    // Horizontal position
    const x = radius * Math.sin(angle);

    // Vertical offset: pets in back appear slightly lower
    const y = depth * 15;

    // Scale: 1.0 at front, shrinking toward back (min 0.4)
    const scale = 1.0 - depth * 0.6;

    // Opacity: 1.0 at front, fading toward back (min 0.25)
    const opacity = 1.0 - depth * 0.75;

    // Z-index: 100 at front, decreasing toward back
    const zIndex = Math.round(100 - depth * 60);

    // Foreground detection: within 30° of front
    const isForeground = Math.abs(angle) < Math.PI / 6;

    return { x, y, scale, opacity, zIndex, isForeground, angle };
  }

  /**
   * Calculate angles for all pets in the ring.
   */
  calculateAngles(N) {
    if (N === 0) return [];

    const angles = [];

    // First pet (foreground) is always at angle 0
    angles.push(0);

    if (N === 1) return angles;

    const bgCount = N - 1;

    if (bgCount === 1) {
      // Single background pet: right side, front half
      angles.push(Math.PI / 3);
    } else if (bgCount === 2) {
      // Two background pets: symmetric left/right in front half
      angles.push(Math.PI / 3);
      angles.push(-Math.PI / 3);
    } else {
      // 3+ background pets: distribute across wider arc
      const maxSpan = Math.PI;
      const minSpan = Math.PI * 0.6;
      const spanGrowth = (bgCount - 2) / 3;
      const angleSpan = Math.min(minSpan + spanGrowth * (maxSpan - minSpan), maxSpan);

      for (let i = 0; i < bgCount; i++) {
        const t = bgCount > 1 ? i / (bgCount - 1) : 0.5;
        let angle = Math.PI - angleSpan / 2 + t * angleSpan;
        if (angle > Math.PI) angle -= 2 * Math.PI;
        angles.push(angle);
      }
    }

    return angles;
  }

  calculatePositions(N, config) {
    if (N === 0) return [];

    const radius = config.radius || 80;
    const angles = this.calculateAngles(N);

    return angles.map((angle) => this.calculatePositionForAngle(angle, radius));
  }
}

/**
 * Linear layout - pets arranged in a horizontal line.
 * Foreground pet is largest, others scale down toward edges.
 */
class LinearLayoutStrategy extends LayoutStrategy {
  constructor() {
    super("linear");
  }

  calculatePositions(N, config) {
    if (N === 0) return [];

    const spacing = config.linearSpacing || 100;
    const minScale = config.linearMinScale || 0.7;
    const minOpacity = config.linearMinOpacity || 0.6;

    const positions = [];

    for (let i = 0; i < N; i++) {
      const isForeground = i === 0;

      // Distance from center (foreground is at index 0)
      // Background pets spread to the right
      const distance = i;

      // x position: foreground at center, others to the right
      const x = i * spacing - (N > 1 ? spacing / 2 : 0);

      // No vertical offset
      const y = 0;

      // Scale and opacity decrease with distance
      const scale = isForeground ? 1.0 : Math.max(minScale, 1.0 - distance * 0.1);
      const opacity = isForeground ? 1.0 : Math.max(minOpacity, 1.0 - distance * 0.1);

      // Z-index: foreground highest, decreasing for background
      const zIndex = 100 - i * 10;

      positions.push({ x, y, scale, opacity, zIndex, isForeground });
    }

    return positions;
  }
}

/**
 * Grid layout - pets arranged in a grid pattern.
 * Useful for displaying many sessions at once.
 */
class GridLayoutStrategy extends LayoutStrategy {
  constructor() {
    super("grid");
  }

  calculatePositions(N, config) {
    if (N === 0) return [];

    const cellSize = config.gridCellSize || 80;
    const minScale = config.gridMinScale || 0.5;
    const minOpacity = config.gridMinOpacity || 0.7;

    // Calculate grid dimensions
    const cols = Math.ceil(Math.sqrt(N));
    const rows = Math.ceil(N / cols);

    const positions = [];
    let index = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (index >= N) break;

        const isForeground = index === 0;

        // Center the grid
        const x = (col - (cols - 1) / 2) * cellSize;
        const y = (row - (rows - 1) / 2) * cellSize * 0.5;

        // Scale based on distance from center
        const distFromCenter = Math.sqrt(
          Math.pow(col - (cols - 1) / 2, 2) + Math.pow(row - (rows - 1) / 2, 2)
        );
        const maxDist = Math.sqrt(Math.pow((cols - 1) / 2, 2) + Math.pow((rows - 1) / 2, 2));
        const normalizedDist = maxDist > 0 ? distFromCenter / maxDist : 0;

        const scale = isForeground ? 1.0 : Math.max(minScale, 1.0 - normalizedDist * 0.3);
        const opacity = isForeground ? 1.0 : Math.max(minOpacity, 1.0 - normalizedDist * 0.2);

        // Z-index: foreground highest, then by row (top rows in front)
        const zIndex = isForeground ? 100 : 90 - row * 10 + col;

        positions.push({ x, y, scale, opacity, zIndex, isForeground });
        index++;
      }
    }

    return positions;
  }
}

// Strategy registry
const STRATEGIES = {
  circular: CircularLayoutStrategy,
  linear: LinearLayoutStrategy,
  grid: GridLayoutStrategy,
};

/**
 * Create a strategy instance by name.
 * @param {string} name - Strategy name ("circular", "linear", "grid")
 * @returns {LayoutStrategy}
 */
function createStrategy(name) {
  const StrategyClass = STRATEGIES[name];
  if (!StrategyClass) {
    console.warn(`[LayoutStrategy] Unknown strategy "${name}", falling back to circular`);
    return new CircularLayoutStrategy();
  }
  return new StrategyClass();
}

module.exports = {
  LayoutStrategy,
  CircularLayoutStrategy,
  LinearLayoutStrategy,
  GridLayoutStrategy,
  STRATEGIES,
  createStrategy,
};
