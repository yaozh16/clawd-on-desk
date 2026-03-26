// Layout class - Manages pet positioning using pluggable strategies
// Delegates actual position calculation to LayoutStrategy instances

const { RING_CONFIG } = require("./constants");
const { createStrategy } = require("./layout-strategies");

class Layout {
  constructor(sessionManager, strategyName = "circular") {
    this.manager = sessionManager;
    this.config = RING_CONFIG;
    this.strategy = createStrategy(strategyName);
  }

  /**
   * Switch to a different layout strategy.
   * @param {string} strategyName - Name of the strategy ("circular", "linear", "grid")
   */
  setStrategy(strategyName) {
    this.strategy = createStrategy(strategyName);
    console.log("[Layout] Strategy changed to:", strategyName);
  }

  /**
   * Get the current strategy name.
   * @returns {string}
   */
  getStrategyName() {
    return this.strategy.name;
  }

  /**
   * Calculate positions for all pets.
   * Delegates to the current strategy.
   */
  calculatePositions(N) {
    return this.strategy.calculatePositions(N, this.config);
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
