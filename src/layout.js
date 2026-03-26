// Layout class - Ring position calculator
// Manages pet positioning in a circular carousel arrangement

const { RING_CONFIG } = require("./constants");

class Layout {
  constructor(sessionManager) {
    this.manager = sessionManager;
    this.config = RING_CONFIG;
  }

  /**
   * Calculate position for a pet at a given angle on the carousel.
   *
   * The carousel is viewed from above:
   * - Angle 0 = front (closest to viewer, foreground)
   * - Positive angles = right side
   * - Negative angles = left side
   * - Angle π = back (farthest from viewer)
   *
   * Position is calculated using 3D perspective projection:
   * - x: horizontal position on screen
   * - scale: perspective scaling based on depth
   * - opacity: fades with depth
   * - zIndex: layers based on depth
   */
  calculatePositionForAngle(angle, radius) {
    // Normalize angle to [-π, π]
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;

    // Depth factor: 0 at front (angle=0), 1 at back (angle=±π)
    // Using cosine: cos(0)=1 (front), cos(π)=-1 (back)
    // So depth = (1 - cos(angle)) / 2 gives 0 at front, 1 at back
    const depth = (1 - Math.cos(angle)) / 2;

    // Horizontal position: x = radius * sin(angle)
    // sin(0)=0 (center), sin(π/2)=1 (right), sin(-π/2)=-1 (left)
    const x = radius * Math.sin(angle);

    // Vertical offset: pets in back appear slightly lower
    const y = depth * 15;

    // Scale: 1.0 at front, shrinking toward back
    // Min scale 0.4 at deepest point
    const scale = 1.0 - depth * 0.6;

    // Opacity: 1.0 at front, fading toward back
    // Min opacity 0.25 at deepest point for strong depth perception
    const opacity = 1.0 - depth * 0.75;

    // Z-index: 100 at front, decreasing toward back
    // Higher z-index = in front
    const zIndex = Math.round(100 - depth * 60);

    // Foreground detection: within 30° of front
    const isForeground = Math.abs(angle) < Math.PI / 6;

    return {
      x,
      y,
      scale,
      opacity,
      zIndex,
      isForeground,
      angle, // Include angle for debugging
    };
  }

  /**
   * Calculate angles for all pets in the ring.
   * Returns an array of angles, one per pet.
   *
   * The foreground pet is always at angle 0.
   * Background pets are distributed based on count:
   * - Few pets (2-3): spread in front half (angles ±π/3 to ±π/2)
   * - More pets: expand to full circle as needed
   */
  calculateAngles(N) {
    if (N === 0) return [];

    const angles = [];

    // First pet (foreground) is always at angle 0
    angles.push(0);

    if (N === 1) return angles;

    const bgCount = N - 1;

    // Determine angle span based on pet count
    // 2 pets: front half only (±60°)
    // 3 pets: front half spread (±60° to ±90°)
    // 4+ pets: expand toward back
    let angleSpan;
    if (bgCount === 1) {
      // Single background pet: right side, front half
      angleSpan = Math.PI / 3; // 60° right
      angles.push(angleSpan);
    } else if (bgCount === 2) {
      // Two background pets: symmetric left/right in front half
      angles.push(Math.PI / 3);  // 60° right
      angles.push(-Math.PI / 3); // 60° left
    } else {
      // 3+ background pets: distribute across wider arc
      // Start from front-right, expand toward back as count increases
      // Max span: 180° (full back half) when bgCount >= 5
      const maxSpan = Math.PI; // 180° back half
      const minSpan = Math.PI * 0.6; // 108° minimum for 3 bg pets
      const spanGrowth = (bgCount - 2) / 3; // 0 at 3 pets, 1 at 5+ pets
      angleSpan = minSpan + spanGrowth * (maxSpan - minSpan);
      angleSpan = Math.min(angleSpan, maxSpan);

      // Distribute evenly from -angleSpan/2 to +angleSpan/2 (centered at back)
      for (let i = 0; i < bgCount; i++) {
        const t = bgCount > 1 ? i / (bgCount - 1) : 0.5;
        // Center at π (back), spread ±angleSpan/2
        let angle = Math.PI - angleSpan / 2 + t * angleSpan;
        // Normalize to [-π, π]
        if (angle > Math.PI) angle -= 2 * Math.PI;
        angles.push(angle);
      }
    }

    return angles;
  }

  /**
   * Calculate positions for all pets in the ring.
   * Returns an array of position objects.
   */
  calculatePositions(N) {
    if (N === 0) return [];

    const radius = this.config.radius;
    const angles = this.calculateAngles(N);

    return angles.map((angle) => this.calculatePositionForAngle(angle, radius));
  }

  /**
   * Update pet positions and send to renderer.
   */
  updatePositions(ringOrder) {
    const N = ringOrder.length;
    if (N === 0) return;

    const positions = this.calculatePositions(N);

    // Send layout update to renderer
    this.manager.sendToRenderer("layout-update", ringOrder, positions);
  }

  // Check if session is foreground
  isForeground(ringOrder, sessionId) {
    return ringOrder[0] === sessionId;
  }

  // Get foreground session ID
  getForegroundId(ringOrder) {
    return ringOrder[0] || null;
  }
}

module.exports = { Layout };
