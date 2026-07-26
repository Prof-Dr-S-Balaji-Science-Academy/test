(function () {
  "use strict";

  // ============================================================================
  // DATA STRUCTURE
  // ============================================================================
  const BOOKS = [
    { id: 'cbse10', label: 'CBSE 10\nScience', icon: 'science' },
    { id: 'cbse12-physics', label: 'CBSE 12\nPhysics', icon: 'physics' },
    { id: 'cbse12-chemistry', label: 'CBSE 12\nChemistry', icon: 'chemistry' },
    { id: 'sb12-physics', label: 'State Board\n12 Physics', icon: 'physics' },
    { id: 'sb12-chemistry', label: 'State Board\n12 Chemistry', icon: 'chemistry' }
  ];

  // Color scheme for nodes (primary, secondary, tertiary, quaternary, quinary)
  const COLOR_SCHEME = {
    primary: '#0052ff',      // Coinbase Blue
    secondary: '#578bfa',    // Lighter blue
    tertiary: '#a8c5fc',     // Even lighter
    quaternary: '#d4e0ff',   // Very light
    quinary: '#eef0f3'       // Almost white
  };

  // Sample mockup data structure (will be replaced with actual JSON)
  const MOCKUP_CHAPTERS = [
    {
      id: 'ch1',
      number: 1,
      title: 'Introduction to Concepts',
      mindmapData: {
        root: {
          id: 'root',
          text: 'Chapter One',
          level: 0,
          expanded: true,
          children: [
            {
              id: 's1',
              text: 'Fundamentals',
              level: 1,
              expanded: true,
              children: [
                { 
                  id: 't1', 
                  text: 'Core Principles', 
                  level: 2, 
                  expanded: false,
                  children: [
                    { id: 'q1', text: 'Definition', level: 3, children: [] },
                    { id: 'q2', text: 'Applications', level: 3, children: [] }
                  ]
                },
                { 
                  id: 't2', 
                  text: 'Key Terms', 
                  level: 2,
                  expanded: false,
                  children: [
                    { id: 'q3', text: 'Definitions', level: 3, children: [] },
                    { id: 'q4', text: 'Examples', level: 3, children: [] }
                  ]
                },
                { 
                  id: 't3', 
                  text: 'Basic Laws', 
                  level: 2,
                  children: []
                }
              ]
            },
            {
              id: 's2',
              text: 'Properties',
              level: 1,
              expanded: true,
              children: [
                { 
                  id: 't4', 
                  text: 'Physical Properties', 
                  level: 2,
                  expanded: false,
                  children: [
                    { id: 'q5', text: 'Measurement', level: 3, children: [] },
                    { id: 'q6', text: 'Units', level: 3, children: [] }
                  ]
                },
                { 
                  id: 't5', 
                  text: 'Chemical Properties', 
                  level: 2,
                  children: []
                }
              ]
            },
            {
              id: 's3',
              text: 'Applications',
              level: 1,
              expanded: false,
              children: [
                { id: 't6', text: 'Real World Examples', level: 2, children: [] },
                { id: 't7', text: 'Industrial Uses', level: 2, children: [] },
                { id: 't8', text: 'Modern Technology', level: 2, children: [] }
              ]
            },
            {
              id: 's4',
              text: 'Practice Problems',
              level: 1,
              expanded: false,
              children: [
                { id: 't9', text: 'Solved Examples', level: 2, children: [] },
                { id: 't10', text: 'Practice Questions', level: 2, children: [] }
              ]
            }
          ]
        }
      }
    },
    {
      id: 'ch2',
      number: 2,
      title: 'Advanced Topics',
      mindmapData: {
        root: {
          id: 'root',
          text: 'Chapter Two',
          level: 0,
          expanded: true,
          children: [
            {
              id: 's1',
              text: 'Complex Systems',
              level: 1,
              expanded: true,
              children: [
                { 
                  id: 't1', 
                  text: 'System Analysis', 
                  level: 2,
                  children: []
                },
                { 
                  id: 't2', 
                  text: 'Interactions', 
                  level: 2,
                  children: []
                }
              ]
            },
            {
              id: 's2',
              text: 'Problem Solving',
              level: 1,
              expanded: false,
              children: [
                { id: 't3', text: 'Methods', level: 2, children: [] },
                { id: 't4', text: 'Strategies', level: 2, children: [] }
              ]
            }
          ]
        }
      }
    },
    {
      id: 'ch3',
      number: 3,
      title: 'Case Studies',
      mindmapData: {
        root: {
          id: 'root',
          text: 'Chapter Three',
          level: 0,
          expanded: true,
          children: [
            {
              id: 's1',
              text: 'Case Study 1',
              level: 1,
              expanded: false,
              children: [
                { id: 't1', text: 'Background', level: 2, children: [] },
                { id: 't2', text: 'Analysis', level: 2, children: [] }
              ]
            },
            {
              id: 's2',
              text: 'Case Study 2',
              level: 1,
              expanded: false,
              children: [
                { id: 't3', text: 'Overview', level: 2, children: [] },
                { id: 't4', text: 'Findings', level: 2, children: [] }
              ]
            }
          ]
        }
      }
    }
  ];

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  let state = {
    selectedBook: null,
    selectedChapter: null,
    chapters: [],
    mindmapData: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    expandedNodes: new Set()
  };

  // ============================================================================
  // DOM ELEMENTS
  // ============================================================================
  const bookSelector = document.getElementById('bookSelector');
  const chaptersSidebar = document.getElementById('chaptersSidebar');
  const chaptersList = document.getElementById('chaptersList');
  const noChaptersPlaceholder = document.getElementById('noChaptersPlaceholder');
  const mindmapCanvas = document.getElementById('mindmapCanvas');
  const mindmapSvg = document.getElementById('mindmap-svg');
  const mindmapPlaceholder = document.getElementById('mindmapPlaceholder');
  const mindmapCanvasWrapper = document.getElementById('mindmapCanvasWrapper');
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const zoomReset = document.getElementById('zoomReset');
  const mobileChaptersToggle = document.getElementById('mobileChaptersToggle');
  const mindmapWorkspace = document.getElementById('mindmapWorkspace');

  // ============================================================================
  // SVG ICON GENERATORS
  // ============================================================================
  function createIcon(type) {
    const baseAttrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="book-icon"';
    
    const icons = {
      science: `<svg ${baseAttrs}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
      physics: `<svg ${baseAttrs}><circle cx="12" cy="12" r="1"></circle><path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24"></path></svg>`,
      chemistry: `<svg ${baseAttrs}><path d="M7 4v10a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4"></path><line x1="7" y1="4" x2="13" y2="4"></line><line x1="13" y1="4" x2="19" y2="4"></line></svg>`
    };
    
    return icons[type] || icons.science;
  }

  // ============================================================================
  // BOOK SELECTOR
  // ============================================================================
  function initializeBookSelector() {
    bookSelector.innerHTML = BOOKS.map(book => `
      <label class="book-card" data-book-id="${book.id}">
        <input type="radio" name="book" value="${book.id}" />
        ${createIcon(book.icon)}
        <span class="book-label">${book.label}</span>
      </label>
    `).join('');

    document.querySelectorAll('.book-card input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectBook(e.target.value);
        }
      });
    });
  }

  // ============================================================================
  // BOOK SELECTION LOGIC
  // ============================================================================
  function selectBook(bookId) {
    state.selectedBook = bookId;
    state.selectedChapter = null;
    state.expandedNodes.clear();
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };

    // Update UI
    document.querySelectorAll('.book-card').forEach(card => {
      card.classList.toggle('active', card.dataset.bookId === bookId);
    });

    // Load chapters (from mockup data for now)
    state.chapters = MOCKUP_CHAPTERS;
    renderChapters();

    // Show chapters sidebar
    chaptersList.style.display = 'block';
    noChaptersPlaceholder.style.display = 'none';

    // Reset mindmap
    clearMindmap();
  }

  // ============================================================================
  // CHAPTERS SIDEBAR
  // ============================================================================
  function renderChapters() {
    chaptersList.innerHTML = state.chapters.map(chapter => `
      <div class="chapter-item" data-chapter-id="${chapter.id}">
        <span class="chapter-number">Ch ${chapter.number}</span>
        <span class="chapter-title">${chapter.title}</span>
      </div>
    `).join('');

    document.querySelectorAll('.chapter-item').forEach(item => {
      item.addEventListener('click', () => {
        const chapterId = item.dataset.chapterId;
        selectChapter(chapterId);
      });
    });
  }

  function selectChapter(chapterId) {
    state.selectedChapter = chapterId;
    state.expandedNodes.clear();
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };

    const chapter = state.chapters.find(ch => ch.id === chapterId);
    if (!chapter) return;

    state.mindmapData = JSON.parse(JSON.stringify(chapter.mindmapData));

    // Update UI
    document.querySelectorAll('.chapter-item').forEach(item => {
      item.classList.toggle('active', item.dataset.chapterId === chapterId);
    });

    // Close mobile sidebar after selection
    if (window.innerWidth < 896) {
      chaptersSidebar.classList.remove('active');
      mindmapCanvasWrapper.classList.add('active');
    }

    // Render mindmap
    renderMindmap();
  }

  // ============================================================================
  // MINDMAP RENDERING
  // ============================================================================
  function renderMindmap() {
    if (!state.mindmapData) {
      clearMindmap();
      return;
    }

    mindmapPlaceholder.style.display = 'none';
    mindmapSvg.style.display = 'block';

    // Clear SVG
    while (mindmapSvg.firstChild) {
      mindmapSvg.removeChild(mindmapSvg.firstChild);
    }

    // Calculate layout
    const layout = calculateLayout(state.mindmapData.root);
    
    // Draw connections
    drawConnections(layout);

    // Draw nodes
    drawNodes(layout);

    // Set SVG viewBox based on layout
    updateSvgViewBox(layout);

    // Add event listeners
    attachNodeListeners();
  }

  function clearMindmap() {
    mindmapPlaceholder.style.display = 'grid';
    mindmapSvg.style.display = 'block';
    mindmapSvg.innerHTML = '';
    
    // Draw default mockup with empty nodes
    const svg = mindmapSvg;
    svg.setAttribute('viewBox', '-50 -150 600 300');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    
    // Primary node
    const primary = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    primary.setAttribute('cx', '0');
    primary.setAttribute('cy', '0');
    primary.setAttribute('r', '35');
    primary.setAttribute('fill', COLOR_SCHEME.primary);
    primary.setAttribute('opacity', '0.15');
    svg.appendChild(primary);
    
    const primaryText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    primaryText.setAttribute('x', '0');
    primaryText.setAttribute('y', '5');
    primaryText.setAttribute('text-anchor', 'middle');
    primaryText.setAttribute('dominant-baseline', 'middle');
    primaryText.setAttribute('font-size', '12');
    primaryText.setAttribute('font-weight', '600');
    primaryText.setAttribute('fill', COLOR_SCHEME.primary);
    primaryText.textContent = 'Select';
    svg.appendChild(primaryText);
    
    // Secondary nodes (left and right)
    const secondaryPositions = [
      { x: -150, y: -80 },
      { x: -150, y: 80 },
      { x: 150, y: -80 },
      { x: 150, y: 80 }
    ];
    
    secondaryPositions.forEach((pos, idx) => {
      // Connection line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cpX = pos.x / 2;
      line.setAttribute('d', `M 0 0 Q ${cpX} ${pos.y / 2} ${pos.x} ${pos.y}`);
      line.setAttribute('stroke', COLOR_SCHEME.secondary);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('fill', 'none');
      line.setAttribute('opacity', '0.3');
      svg.appendChild(line);
      
      // Secondary node
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '28');
      circle.setAttribute('fill', COLOR_SCHEME.secondary);
      circle.setAttribute('opacity', '0.15');
      svg.appendChild(circle);
    });
    
    // Tertiary nodes
    const tertiaryPositions = [
      { x: -280, y: -100 },
      { x: -280, y: 0 },
      { x: -280, y: 100 },
      { x: 280, y: -100 },
      { x: 280, y: 100 }
    ];
    
    tertiaryPositions.forEach((pos) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '20');
      circle.setAttribute('fill', COLOR_SCHEME.tertiary);
      circle.setAttribute('opacity', '0.15');
      svg.appendChild(circle);
    });
  }

  // ============================================================================
  // LAYOUT CALCULATION (Smart positioning)
  // ============================================================================
  function calculateLayout(root, x = 150, y = 0, verticalGap = 100, horizontalGap = 180) {
    const layout = {};
    const nodeSize = 60;

    function traverse(node, level, x, y, siblingIndex, totalSiblings) {
      const nodeId = node.id;
      
      // Calculate position based on level and sibling count
      let posX = x + level * horizontalGap;
      let posY = y + (siblingIndex - totalSiblings / 2) * verticalGap;

      // Adjust radius based on level for visual hierarchy
      const radii = [35, 28, 24, 20, 18];
      const radius = radii[Math.min(level, radii.length - 1)];

      layout[nodeId] = {
        node,
        x: posX,
        y: posY,
        radius: radius,
        level,
        children: []
      };

      if (node.expanded && node.children && node.children.length > 0) {
        const childRadius = (node.children.length - 1) * verticalGap / 2;
        const childBaseY = posY;

        node.children.forEach((child, idx) => {
          const childX = posX + horizontalGap;
          const childY = childBaseY + (idx - (node.children.length - 1) / 2) * verticalGap;
          
          traverse(child, level + 1, childX, childY, idx, node.children.length);
          layout[nodeId].children.push(child.id);
        });
      }
    }

    traverse(root, 0, x, y, 0, 1);
    return layout;
  }

  // ============================================================================
  // SVG DRAWING
  // ============================================================================
  function drawConnections(layout) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'connections');

    Object.values(layout).forEach(item => {
      item.children.forEach(childId => {
        const childItem = layout[childId];
        if (!childItem) return;

        // Draw curved line (quadratic Bezier curve)
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x1 = item.x;
        const y1 = item.y;
        const x2 = childItem.x;
        const y2 = childItem.y;
        const cpX = (x1 + x2) / 2;

        const d = `M ${x1} ${y1} Q ${cpX} ${y1} ${x2} ${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('class', 'connection-line');

        g.appendChild(path);
      });
    });

    mindmapSvg.appendChild(g);
  }

  function drawNodes(layout) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'nodes');

    Object.entries(layout).forEach(([nodeId, item]) => {
      const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      nodeGroup.setAttribute('class', 'node-group');
      nodeGroup.setAttribute('data-node-id', nodeId);
      nodeGroup.setAttribute('data-node-level', item.level);

      // Determine color based on level
      const colors = [
        COLOR_SCHEME.primary,
        COLOR_SCHEME.secondary,
        COLOR_SCHEME.tertiary,
        COLOR_SCHEME.quaternary,
        COLOR_SCHEME.quinary
      ];
      const color = colors[Math.min(item.level, colors.length - 1)];

      // Circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'node-circle');
      circle.setAttribute('cx', item.x);
      circle.setAttribute('cy', item.y);
      circle.setAttribute('r', item.radius);
      circle.setAttribute('fill', color);
      circle.setAttribute('opacity', '0.9');

      nodeGroup.appendChild(circle);

      // Text
      if (item.node.text) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'node-text');
        text.setAttribute('x', item.x);
        text.setAttribute('y', item.y);
        text.setAttribute('fill', item.level === 0 ? 'white' : (item.level <= 1 ? 'white' : '#0a0b0d'));
        text.setAttribute('font-size', Math.max(10, 14 - item.level * 1.5));

        // Split text into multiple lines if needed
        const words = item.node.text.split(' ');
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
          const testLine = currentLine ? currentLine + ' ' + word : word;
          if (testLine.length > 12) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) lines.push(currentLine);

        const lineHeight = 13;
        const startY = item.y - (lines.length - 1) * lineHeight / 2;

        lines.forEach((line, idx) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', item.x);
          tspan.setAttribute('dy', idx === 0 ? 0 : lineHeight);
          tspan.textContent = line;
          text.appendChild(tspan);
        });

        nodeGroup.appendChild(text);
      }

      // Expand indicator
      if (item.children.length > 0) {
        const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        indicator.setAttribute('class', 'node-expand-indicator');
        indicator.setAttribute('x', item.x + item.radius + 8);
        indicator.setAttribute('y', item.y);
        indicator.setAttribute('fill', COLOR_SCHEME.primary);
        indicator.textContent = '>';

        nodeGroup.appendChild(indicator);
      }

      g.appendChild(nodeGroup);
    });

    mindmapSvg.appendChild(g);
  }

  function updateSvgViewBox(layout) {
    const positions = Object.values(layout);
    const xs = positions.map(p => p.x);
    const ys = positions.map(p => p.y);

    const minX = Math.min(...xs) - 50;
    const maxX = Math.max(...xs) + 50;
    const minY = Math.min(...ys) - 50;
    const maxY = Math.max(...ys) + 50;

    const width = maxX - minX;
    const height = maxY - minY;

    mindmapSvg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    mindmapSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  // ============================================================================
  // NODE INTERACTION
  // ============================================================================
  function attachNodeListeners() {
    document.querySelectorAll('.node-group').forEach(nodeGroup => {
      nodeGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeId = nodeGroup.dataset.nodeId;
        toggleNodeExpansion(nodeId);
      });

      nodeGroup.addEventListener('mouseenter', () => {
        nodeGroup.style.opacity = '0.8';
      });

      nodeGroup.addEventListener('mouseleave', () => {
        nodeGroup.style.opacity = '1';
      });
    });
  }

  function toggleNodeExpansion(nodeId) {
    const node = findNodeById(state.mindmapData.root, nodeId);
    if (!node || !node.children || node.children.length === 0) return;

    node.expanded = !node.expanded;

    if (node.expanded) {
      state.expandedNodes.add(nodeId);
    } else {
      state.expandedNodes.delete(nodeId);
    }

    renderMindmap();
  }

  function findNodeById(root, id) {
    if (root.id === id) return root;
    if (!root.children) return null;

    for (let child of root.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
    return null;
  }

  // ============================================================================
  // ZOOM & PAN CONTROLS
  // ============================================================================
  zoomIn.addEventListener('click', () => {
    state.zoom = Math.min(state.zoom + 0.2, 3);
    updateZoom();
  });

  zoomOut.addEventListener('click', () => {
    state.zoom = Math.max(state.zoom - 0.2, 0.5);
    updateZoom();
  });

  zoomReset.addEventListener('click', () => {
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };
    updateZoom();
  });

  function updateZoom() {
    mindmapSvg.style.transform = `scale(${state.zoom})`;
    mindmapCanvas.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px)`;
  }

  // Mouse wheel zoom
  mindmapCanvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      state.zoom = Math.max(0.5, Math.min(3, state.zoom + delta));
      updateZoom();
    }
  });

  // Pan with mouse drag
  let isPanning = false;
  let startX = 0;
  let startY = 0;

  mindmapCanvas.addEventListener('mousedown', (e) => {
    if (e.button !== 2) { // Not right click
      isPanning = true;
      startX = e.clientX - state.pan.x;
      startY = e.clientY - state.pan.y;
      mindmapCanvas.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (isPanning) {
      state.pan.x = e.clientX - startX;
      state.pan.y = e.clientY - startY;
      updateZoom();
    }
  });

  document.addEventListener('mouseup', () => {
    isPanning = false;
    mindmapCanvas.style.cursor = 'default';
  });

  // Touch support for mobile pan and zoom
  let touchStartDistance = 0;
  let touchStartX = 0;
  let touchStartY = 0;

  mindmapCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isPanning = true;
      touchStartX = e.touches[0].clientX - state.pan.x;
      touchStartY = e.touches[0].clientY - state.pan.y;
    } else if (e.touches.length === 2) {
      isPanning = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDistance = Math.sqrt(dx * dx + dy * dy);
    }
  });

  mindmapCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning) {
      state.pan.x = e.touches[0].clientX - touchStartX;
      state.pan.y = e.touches[0].clientY - touchStartY;
      updateZoom();
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const delta = (distance - touchStartDistance) * 0.01;
      state.zoom = Math.max(0.5, Math.min(3, state.zoom + delta));
      touchStartDistance = distance;
      updateZoom();
    }
  });

  mindmapCanvas.addEventListener('touchend', () => {
    isPanning = false;
  });

  // ============================================================================
  // MOBILE CHAPTERS TOGGLE
  // ============================================================================
  mobileChaptersToggle.addEventListener('click', () => {
    chaptersSidebar.classList.toggle('active');
    mindmapCanvasWrapper.classList.toggle('active');
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (window.innerWidth < 896) {
      if (!e.target.closest('.chapters-sidebar') && !e.target.closest('#mobileChaptersToggle')) {
        chaptersSidebar.classList.remove('active');
        mindmapCanvasWrapper.classList.add('active');
      }
    }
  });

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  function init() {
    initializeBookSelector();
    clearMindmap(); // Show default mockup on load
    document.getElementById('y').textContent = new Date().getFullYear();
  }

  // Call init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
