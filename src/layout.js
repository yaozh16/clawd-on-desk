// Layout class - Ring position calculator
// Manages pet positioning in a circular arrangement

const { RING_CONFIG } = require("./constants");

class Layout {
  constructor(sessionManager) {
    this.manager = sessionManager;
    this.config = RING_CONFIG;
  }

  // Calculate position for a single pet at given index in the ring
  // Returns position relative to the window center
  calculatePositionForIndex(index, total) {
    if (total === 0) return null;

    const windowWidth = 200;

    if (total === 1) {
      return {
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
        zIndex: 100,
        isForeground: true,
      };
    }

    if (total === 2) {
      if (index === 0) {
        // Foreground: slightly left of center
        return {
          x: -windowWidth * 0.15,
          y: 0,
          scale: 0.85,
          opacity: 1,
          zIndex: 100,
          isForeground: true,
        };
      } else {
        // Background: right side
        return {
          x: windowWidth * 0.25,
          y: 10,
          scale: 0.6,
          opacity: 0.7,
          zIndex: 50,
          isForeground: false,
        };
      }
    }

    if (total === 3) {
      if (index === 0) {
        // Foreground: center
        return {
          x: 0,
          y: 0,
          scale: 0.85,
          opacity: 1,
          zIndex: 100,
          isForeground: true,
        };
      } else if (index === 1) {
        // Left background
        return {
          x: -windowWidth * 0.35,
          y: 15,
          scale: 0.5,
          opacity: 0.6,
          zIndex: 40,
          isForeground: false,
        };
      } else {
        // Right background
        return {
          x: windowWidth * 0.35,
          y: 15,
          scale: 0.5,
          opacity: 0.6,
          zIndex: 40,
          isForeground: false,
        };
      }
    }

    // Four or more: foreground center, others in arc
    if (index === 0) {
      return {
        x: 0,
        y: 0,
        scale: 0.8,
        opacity: 1,
        zIndex: 100,
        isForeground: true,
      };
    }

    // Background pets in arc
    const bgCount = total - 1;
    const bgIndex = index - 1;
    const arcRadius = windowWidth * 0.4;
    const angleSpan = Math.PI * 0.8; // 144 degree arc
    const angleStart = Math.PI + (Math.PI - angleSpan) / 2;

    const t = bgCount > 1 ? bgIndex / (bgCount - 1) : 0.5;
    const angle = angleStart + t * angleSpan;
    const x = Math.cos(angle) * arcRadius;
    const y = Math.sin(angle) * arcRadius * 0.3 + 20;

    return {
      x,
      y,
      scale: 0.45,
      opacity: 0.5,
      zIndex: 30 + Math.round(Math.sin(angle) * 20),
      isForeground: false,
    };
  }

  // Calculate positions for all pets in the ring
  calculatePositions(N) {
    const positions = [];
    for (let i = 0; i < N; i++) {
      positions.push(this.calculatePositionForIndex(i, N));
    }
    return positions;
  }

  // Update pet positions and send to renderer
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
