// --- Multi-pet renderer ---
const container = document.getElementById("pet-container");

// Pets map: sessionId → { element, state, svg }
const pets = new Map();

// Current ring order and foreground session
let ringOrder = [];
let foregroundSessionId = null;

// --- Pointer-based drag + click detection ---
let isDragging = false;
let didDrag = false;
let lastScreenX, lastScreenY;
let mouseDownX, mouseDownY;
let pendingDx = 0, pendingDy = 0;
let dragRAF = null;
const DRAG_THRESHOLD = 3;

// --- Do Not Disturb ---
let dndEnabled = false;
window.electronAPI.onDndChange((enabled) => { dndEnabled = enabled; });

// --- Mini Mode ---
let miniMode = false;
window.electronAPI.onMiniModeChange((enabled) => {
  miniMode = enabled;
  container.style.cursor = enabled ? "default" : "";
  updatePetVisibility();
});

// --- Click tracking for reactions ---
const CLICK_WINDOW_MS = 400;
const REACT_LEFT_SVG = "clawd-react-left.svg";
const REACT_RIGHT_SVG = "clawd-react-right.svg";
const REACT_DOUBLE_SVG = "clawd-react-double.svg";
const REACT_DRAG_SVG = "clawd-react-drag.svg";
const REACT_SINGLE_DURATION = 2500;
const REACT_DOUBLE_DURATION = 3500;

let clickCount = 0;
let clickTimer = null;
let firstClickDir = null;
let isReacting = false;
let isDragReacting = false;
let reactTimer = null;

const SVG_IDLE_FOLLOW = "clawd-idle-follow.svg";

function shouldTrackEyes(state, svg) {
  return (state === "idle" && svg === SVG_IDLE_FOLLOW) || state === "mini-idle";
}

// --- Drag handling ---
container.addEventListener("pointerdown", (e) => {
  if (e.button === 0) {
    if (miniMode) { didDrag = false; return; }
    container.setPointerCapture(e.pointerId);
    isDragging = true;
    didDrag = false;
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    pendingDx = 0;
    pendingDy = 0;
    window.electronAPI.dragLock(true);
    container.classList.add("dragging");
  }
});

document.addEventListener("pointermove", (e) => {
  if (isDragging) {
    pendingDx += e.screenX - lastScreenX;
    pendingDy += e.screenY - lastScreenY;
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;

    if (!didDrag) {
      const totalDx = e.clientX - mouseDownX;
      const totalDy = e.clientY - mouseDownY;
      if (Math.abs(totalDx) > DRAG_THRESHOLD || Math.abs(totalDy) > DRAG_THRESHOLD) {
        didDrag = true;
        startDragReaction();
      }
    }

    if (!dragRAF) {
      dragRAF = setTimeout(() => {
        window.electronAPI.moveWindowBy(pendingDx, pendingDy);
        pendingDx = 0;
        pendingDy = 0;
        dragRAF = null;
      }, 0);
    }
  }
});

function stopDrag() {
  if (!isDragging) return;
  isDragging = false;
  window.electronAPI.dragLock(false);
  container.classList.remove("dragging");
  if (pendingDx !== 0 || pendingDy !== 0) {
    if (dragRAF) { clearTimeout(dragRAF); dragRAF = null; }
    window.electronAPI.moveWindowBy(pendingDx, pendingDy);
    pendingDx = 0; pendingDy = 0;
  }
  if (didDrag) {
    window.electronAPI.dragEnd();
  }
  endDragReaction();
}

document.addEventListener("pointerup", (e) => {
  if (e.button === 0) {
    const wasDrag = didDrag;
    stopDrag();
    if (!wasDrag) {
      if (e.ctrlKey || e.metaKey) {
        window.electronAPI.showSessionMenu();
      } else {
        handleClick(e.clientX, e.clientY, e.target);
      }
    }
  }
});

container.addEventListener("pointercancel", stopDrag);
container.addEventListener("lostpointercapture", () => {
  if (isDragging) stopDrag();
});
window.addEventListener("blur", stopDrag);

// --- Click handling ---
function handleClick(clientX, clientY, target) {
  if (miniMode) {
    window.electronAPI.exitMiniMode();
    return;
  }
  if (isReacting || isDragReacting) return;

  // Check if clicked on a background pet
  const clickedSessionId = getPetAtPosition(clientX, clientY);
  if (clickedSessionId && clickedSessionId !== foregroundSessionId) {
    window.electronAPI.bringToFront(clickedSessionId);
    return;
  }

  // Get foreground pet state
  const foregroundPet = pets.get(foregroundSessionId);
  if (!foregroundPet) return;

  const { state, svg } = foregroundPet;

  // Non-idle states: focus terminal directly
  if (svg !== SVG_IDLE_FOLLOW && svg !== "clawd-idle-living.svg") {
    window.electronAPI.focusTerminal();
    return;
  }

  // Idle states: track clicks for reactions
  clickCount++;
  if (clickCount === 1) {
    firstClickDir = clientX < container.offsetWidth / 2 ? "left" : "right";
    window.electronAPI.focusTerminal();
  }

  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }

  if (clickCount >= 4) {
    clickCount = 0;
    firstClickDir = null;
    playReaction(foregroundSessionId, REACT_DOUBLE_SVG, REACT_DOUBLE_DURATION);
  } else if (clickCount >= 2) {
    clickTimer = setTimeout(() => {
      clickTimer = null;
      const svg = firstClickDir === "left" ? REACT_LEFT_SVG : REACT_RIGHT_SVG;
      clickCount = 0;
      firstClickDir = null;
      playReaction(foregroundSessionId, svg, REACT_SINGLE_DURATION);
    }, CLICK_WINDOW_MS);
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = null;
      clickCount = 0;
      firstClickDir = null;
    }, CLICK_WINDOW_MS);
  }
}

function getPetAtPosition(clientX, clientY) {
  // Get container center
  const containerRect = container.getBoundingClientRect();
  const centerX = containerRect.left + containerRect.width / 2;
  const centerY = containerRect.top + containerRect.height / 2;

  // Calculate click offset from center
  const clickOffsetX = clientX - centerX;

  // Find the background pet whose position is closest to the click
  let closestSessionId = null;
  let closestDistance = Infinity;

  for (const [sessionId, pet] of pets) {
    if (sessionId === foregroundSessionId) continue;
    const el = pet.wrapper;
    if (!el) continue;

    // Get the pet's translateX from transform
    const transform = el.style.transform || "";
    const match = transform.match(/translateX\(([-\d.]+)px\)/);
    const petOffsetX = match ? parseFloat(match[1]) : 0;

    // Calculate distance from click to pet center
    const distance = Math.abs(clickOffsetX - petOffsetX);

    // Consider this pet if click is within its visible area (roughly 60px radius)
    if (distance < 60 && distance < closestDistance) {
      closestDistance = distance;
      closestSessionId = sessionId;
    }
  }

  if (closestSessionId) {
    console.log("[Renderer] Pet hit:", closestSessionId, "distance:", closestDistance, "clickOffset:", clickOffsetX);
  }

  return closestSessionId;
}

function playReaction(sessionId, svgFile, durationMs) {
  const pet = pets.get(sessionId);
  if (!pet) return;

  isReacting = true;
  detachEyeTracking(sessionId);
  window.electronAPI.pauseCursorPolling();

  swapPetSvg(pet, svgFile);

  reactTimer = setTimeout(() => {
    isReacting = false;
    reactTimer = null;
    window.electronAPI.resumeFromReaction();
  }, durationMs);
}

function cancelReaction() {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; clickCount = 0; firstClickDir = null; }
  if (isReacting) {
    if (reactTimer) { clearTimeout(reactTimer); reactTimer = null; }
    isReacting = false;
  }
  if (isDragReacting) {
    isDragReacting = false;
  }
}

// --- Drag reaction ---
function startDragReaction() {
  if (isDragReacting) return;
  if (dndEnabled) return;

  if (isReacting) {
    if (reactTimer) { clearTimeout(reactTimer); reactTimer = null; }
    isReacting = false;
  }

  isDragReacting = true;
  detachEyeTracking(foregroundSessionId);
  window.electronAPI.pauseCursorPolling();

  const pet = pets.get(foregroundSessionId);
  if (pet) swapPetSvg(pet, REACT_DRAG_SVG);
}

function endDragReaction() {
  if (!isDragReacting) return;
  isDragReacting = false;
  window.electronAPI.resumeFromReaction();
}

// --- Pet management ---

function createPet(sessionId, svg) {
  if (pets.has(sessionId)) return pets.get(sessionId);

  // Create wrapper for positioning
  const wrapper = document.createElement("div");
  wrapper.className = "pet-wrapper";
  wrapper.dataset.sessionId = sessionId;

  // Create SVG object
  const element = document.createElement("object");
  element.type = "image/svg+xml";
  element.className = "pet-svg";
  element.data = `../assets/svg/${svg}`;

  wrapper.appendChild(element);
  container.appendChild(wrapper);

  const pet = {
    wrapper,
    element,
    state: "idle",
    svg,
    pendingNext: null,
  };

  pets.set(sessionId, pet);
  return pet;
}

function removePet(sessionId) {
  const pet = pets.get(sessionId);
  if (!pet) return;

  if (pet.pendingNext) pet.pendingNext.remove();
  pet.wrapper.remove();
  pets.delete(sessionId);

  detachEyeTracking(sessionId);
}

function swapPetSvg(pet, svgFile) {
  if (pet.pendingNext) {
    pet.pendingNext.remove();
    pet.pendingNext = null;
  }

  // Preserve current scale and opacity from the existing element
  const currentScale = pet.element.style.transform || "";
  const currentOpacity = pet.element.style.opacity || "1";

  const next = document.createElement("object");
  next.type = "image/svg+xml";
  next.className = "pet-svg";
  next.style.opacity = "0";
  // Apply current scale to the new element immediately
  next.style.transform = currentScale;

  const swap = () => {
    if (pet.pendingNext !== next) return;
    next.style.transition = "none";
    // Restore the layout-computed opacity after swap
    next.style.opacity = currentOpacity;
    pet.element.remove();
    pet.wrapper.appendChild(next);
    pet.element = next;
    pet.svg = svgFile;
    pet.pendingNext = null;
  };

  next.addEventListener("load", swap, { once: true });
  next.data = `../assets/svg/${svgFile}`;
  pet.wrapper.appendChild(next);
  pet.pendingNext = next;

  setTimeout(() => {
    if (pet.pendingNext !== next) return;
    try { if (!next.contentDocument) { next.remove(); pet.pendingNext = null; return; } } catch {}
    swap();
  }, 3000);
}

function updatePetSvg(sessionId, svg) {
  const pet = pets.get(sessionId);
  if (!pet) return;
  if (pet.svg === svg) return;

  swapPetSvg(pet, svg);
}

function updatePetPositions(newRingOrder, positions) {
  console.log("[Renderer] updatePetPositions:", { ringOrder: newRingOrder, positionsCount: positions?.length });
  ringOrder = newRingOrder;
  foregroundSessionId = ringOrder[0] || null;

  // Remove pets no longer in ring (including "default" when real sessions exist)
  for (const [sessionId] of pets) {
    if (!ringOrder.includes(sessionId)) {
      console.log("[Renderer] Removing pet:", sessionId);
      removePet(sessionId);
    }
  }

  // If we have real sessions but still have "default" pet, remove it
  if (ringOrder.length > 0 && !ringOrder.includes("default") && pets.has("default")) {
    removePet("default");
  }

  ringOrder.forEach((sessionId, i) => {
    const pos = positions[i];
    if (!pos) {
      console.warn("[Renderer] No position for index", i, "sessionId", sessionId);
      return;
    }

    // Create pet if it doesn't exist yet
    let pet = pets.get(sessionId);
    if (!pet) {
      console.log("[Renderer] Creating pet for session:", sessionId);
      pet = createPet(sessionId, SVG_IDLE_FOLLOW);
    }

    console.log("[Renderer] Positioning pet:", sessionId, "index:", i, "pos:", pos);

    // Apply transforms directly for smooth animation
    pet.wrapper.style.transform = `translateX(${pos.x}px)`;
    pet.wrapper.style.zIndex = pos.zIndex;
    pet.wrapper.classList.toggle("is-foreground", pos.isForeground);

    // Apply scale and opacity to the SVG element
    pet.element.style.transform = `scale(${pos.scale})`;
    pet.element.style.opacity = pos.opacity;

    // Eye tracking for foreground idle pet
    if (pos.isForeground && pet.svg === SVG_IDLE_FOLLOW) {
      attachEyeTracking(sessionId, pet.element);
    } else {
      detachEyeTracking(sessionId);
    }
  });

  updatePetVisibility();
}

function updatePetVisibility() {
  // In mini mode, hide all but foreground
  for (const [sessionId, pet] of pets) {
    if (miniMode) {
      pet.wrapper.style.display = sessionId === foregroundSessionId ? "" : "none";
    } else {
      pet.wrapper.style.display = "";
    }
  }
}

// --- Eye tracking ---
const eyeTargets = new Map();
let lastEyeDx = 0;
let lastEyeDy = 0;

function attachEyeTracking(sessionId, objectEl) {
  detachEyeTracking(sessionId);

  const tryAttach = (attempt) => {
    if (!objectEl || !objectEl.isConnected) return;

    try {
      const svgDoc = objectEl.contentDocument;
      const eyes = svgDoc && svgDoc.getElementById("eyes-js");
      if (eyes) {
        eyeTargets.set(sessionId, {
          eye: eyes,
          body: svgDoc.getElementById("body-js"),
          shadow: svgDoc.getElementById("shadow-js"),
        });
        applyEyeMove(sessionId, lastEyeDx, lastEyeDy);
        return;
      }
    } catch (e) {
      return;
    }

    if (attempt < 60) {
      setTimeout(() => tryAttach(attempt + 1), 16);
    }
  };

  tryAttach(0);
}

function detachEyeTracking(sessionId) {
  if (sessionId) {
    eyeTargets.delete(sessionId);
  } else {
    eyeTargets.clear();
  }
}

function applyEyeMove(sessionId, dx, dy) {
  const targets = eyeTargets.get(sessionId);
  if (!targets) return;

  if (targets.eye) {
    targets.eye.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  if (targets.body || targets.shadow) {
    const bdx = Math.round(dx * 0.33 * 2) / 2;
    const bdy = Math.round(dy * 0.33 * 2) / 2;
    if (targets.body) targets.body.style.transform = `translate(${bdx}px, ${bdy}px)`;
    if (targets.shadow) {
      const absDx = Math.abs(bdx);
      const scaleX = 1 + absDx * 0.15;
      const shiftX = Math.round(bdx * 0.3 * 2) / 2;
      targets.shadow.style.transform = `translate(${shiftX}px, 0) scaleX(${scaleX})`;
    }
  }
}

// --- IPC Handlers ---

// Multi-pet state change
window.electronAPI.onPetStateChange((sessionId, state, svg) => {
  cancelReaction();

  // Ignore global state events - they're for single-pet mode when no sessions exist
  if (sessionId === "__global__") {
    // For global state, only create/update if there are no real sessions
    // If we already have real session pets, ignore global state
    const hasRealSessions = ringOrder.length > 0 && !ringOrder.includes("default");
    if (hasRealSessions) {
      return; // Ignore global state when we have real sessions
    }

    // Update foreground pet if exists, otherwise create default
    if (foregroundSessionId && pets.has(foregroundSessionId)) {
      updatePetSvg(foregroundSessionId, svg);
    } else if (pets.size === 0) {
      // No pets yet, create a default one for global state
      createPet("default", svg);
    }
    return;
  }

  // Real session: if we have a "default" pet from global state, remove it
  if (sessionId !== "default" && pets.has("default")) {
    removePet("default");
  }

  // Create pet if needed
  if (!pets.has(sessionId)) {
    createPet(sessionId, svg);
  }

  const pet = pets.get(sessionId);
  updatePetSvg(sessionId, svg);
  pet.state = state;
});

// Layout update
window.electronAPI.onLayoutUpdate((newRingOrder, positions) => {
  updatePetPositions(newRingOrder, positions);
});

// Pet remove
window.electronAPI.onPetRemove((sessionId) => {
  removePet(sessionId);
});

// Eye movement
window.electronAPI.onEyeMove((dx, dy) => {
  lastEyeDx = dx;
  lastEyeDy = dy;

  if (foregroundSessionId) {
    const targets = eyeTargets.get(foregroundSessionId);
    if (targets && targets.eye && !targets.eye.ownerDocument?.defaultView) {
      const pet = pets.get(foregroundSessionId);
      if (pet) attachEyeTracking(foregroundSessionId, pet.element);
    }
    applyEyeMove(foregroundSessionId, dx, dy);
  }
});

// Wake from doze
window.electronAPI.onWakeFromDoze(() => {
  const pet = pets.get(foregroundSessionId);
  if (pet && pet.element && pet.element.contentDocument) {
    try {
      const eyes = pet.element.contentDocument.getElementById("eyes-doze");
      if (eyes) eyes.style.transform = "scaleY(1)";
    } catch (e) {}
  }
});

// Right-click context menu
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.electronAPI.showContextMenu();
});
