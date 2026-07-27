(function () {
  "use strict";

  console.log('Mindmap script loading...');

  // ============================================================================
  // CONFIGURATION
  // ============================================================================
  const BOOKS = [
    { id: 'cbse10', label: 'CBSE 10\nScience', icon: 'science' },
    { id: 'cbse12-physics', label: 'CBSE 12\nPhysics', icon: 'physics' },
    { id: 'cbse12-chemistry', label: 'CBSE 12\nChemistry', icon: 'chemistry' },
    { id: 'sb12-physics', label: 'State Board\n12 Physics', icon: 'physics' },
    { id: 'sb12-chemistry', label: 'State Board\n12 Chemistry', icon: 'chemistry' }
  ];

  const COLORS = {
    primary: '#0052ff',
    secondary: '#578bfa',
    tertiary: '#a8c5fc',
    quaternary: '#d4e0ff',
    quinary: '#eef0f3'
  };

  // ============================================================================
  // SAMPLE DATA
  // ============================================================================
  const SAMPLE_CHAPTERS = [
    {
      id: 'ch1',
      number: 1,
      title: 'Introduction',
      mindmapData: {
        root: {
          id: 'root',
          text: 'Chapter 1',
          level: 0,
          expanded: true,
          children: [
            {
              id: 's1',
              text: 'Fundamentals',
              level: 1,
              expanded: true,
              children: [
                { id: 't1', text: 'Basics', level: 2, expanded: false, children: [
                  { id: 'q1', text: 'Term 1', level: 3, children: [] },
                  { id: 'q2', text: 'Term 2', level: 3, children: [] }
                ]},
                { id: 't2', text: 'Concepts', level: 2, children: [] },
                { id: 't3', text: 'Laws', level: 2, children: [] }
              ]
            },
            {
              id: 's2',
              text: 'Properties',
              level: 1,
              expanded: true,
              children: [
                { id: 't4', text: 'Physical', level: 2, children: [] },
                { id: 't5', text: 'Chemical', level: 2, children: [] }
              ]
            },
            {
              id: 's3',
              text: 'Applications',
              level: 1,
              expanded: false,
              children: [
                { id: 't6', text: 'Example 1', level: 2, children: [] },
                { id: 't7', text: 'Example 2', level: 2, children: [] }
              ]
            }
          ]
        }
      }
    },
    {
      id: 'ch2',
      number: 2,
      title: 'Advanced',
      mindmapData: {
        root: {
          id: 'root',
          text: 'Chapter 2',
          level: 0,
          expanded: true,
          children: [
            {
              id: 's1',
              text: 'Complex',
              level: 1,
              expanded: true,
              children: [
                { id: 't1', text: 'Analysis', level: 2, children: [] }
              ]
            }
          ]
        }
      }
    }
  ];

  // ============================================================================
  // STATE
  // ============================================================================
  const state = {
    selectedBook: null,
    selectedChapter: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    chapters: SAMPLE_CHAPTERS
  };

  // ============================================================================
  // DOM ELEMENTS
  // ============================================================================
  const bookSelector = document.getElementById('bookSelector');
  const chaptersSidebar = document.getElementById('chaptersSidebar');
  const chaptersList = document.getElementById('chaptersList');
  const mindmapSvg = document.getElementById('mindmap-svg');
  const mindmapCanvas = document.getElementById('mindmapCanvas');
  const mindmapPlaceholder = document.getElementById('mindmapPlaceholder');
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const zoomReset = document.getElementById('zoomReset');

  // ============================================================================
  // SVG ICON HELPERS
  // ============================================================================
  function getIcon(type) {
    const icons = {
      science: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="book-icon"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
      physics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="book-icon"><circle cx="12" cy="12" r="1"></circle><path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24"></path></svg>',
      chemistry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="book-icon"><path d="M7 4v10a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4"></path><line x1="7" y1="4" x2="13" y2="4"></line><line x1="13" y1="4" x2="19" y2="4"></line></svg>'
    };
    return icons[type] || icons.science;
  }

  // ============================================================================
  // RENDER BOOK CARDS
  // ============================================================================
  function renderBookCards() {
    console.log('Rendering book cards...');
    
    const html = BOOKS.map(book => `
      <label class="book-card" data-book-id="${book.id}">
        <input type="radio" name="book" value="${book.id}" />
        ${getIcon(book.icon)}
        <span class="book-label">${book.label}</span>
      </label>
    `).join('');
    
    bookSelector.innerHTML = html;
    console.log('Book cards rendered');

    // Add event listeners
    document.querySelectorAll('.book-card input[type="radio"]').forEach(input => {
      input.addEventListener('change', (e) => {
        selectBook(e.target.value);
      });
    });
  }

  // ============================================================================
  // SELECT BOOK
  // ============================================================================
  function selectBook(bookId) {
    console.log('Book selected:', bookId);
    
    state.selectedBook = bookId;
    state.selectedChapter = null;

    // Update UI
    document.querySelectorAll('.book-card').forEach(card => {
      if (card.dataset.bookId === bookId) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // Show chapters
    renderChapters();
  }

  // ============================================================================
  // RENDER CHAPTERS
  // ============================================================================
  function renderChapters() {
    console.log('Rendering chapters...');
    
    const html = state.chapters.map(ch => `
      <div class="chapter-item" data-chapter-id="${ch.id}">
        <strong>Ch ${ch.number}</strong>
        <span>${ch.title}</span>
      </div>
    `).join('');

    chaptersList.innerHTML = html;
    chaptersList.style.display = 'block';

    document.querySelectorAll('.chapter-item').forEach(item => {
      item.addEventListener('click', () => {
        selectChapter(item.dataset.chapterId);
      });
    });
  }

  // ============================================================================
  // SELECT CHAPTER
  // ============================================================================
  function selectChapter(chapterId) {
    console.log('Chapter selected:', chapterId);
    
    state.selectedChapter = chapterId;

    // Update UI
    document.querySelectorAll('.chapter-item').forEach(item => {
      if (item.dataset.chapterId === chapterId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Find and render chapter mindmap
    const chapter = state.chapters.find(ch => ch.id === chapterId);
    if (chapter) {
      renderMindmap(chapter.mindmapData);
    }
  }

  // ============================================================================
  // CALCULATE LAYOUT
  // ============================================================================
  function calculateLayout(root, x = 150, y = 0, vGap = 100, hGap = 180) {
    const layout = {};

    function traverse(node, level, x, y, sibIdx, totalSibs) {
      const id = node.id;
      let posX = x + level * hGap;
      let posY = y + (sibIdx - totalSibs / 2) * vGap;

      const radii = [35, 28, 24, 20, 18];
      const radius = radii[Math.min(level, radii.length - 1)];

      layout[id] = {
        node,
        x: posX,
        y: posY,
        radius,
        level,
        children: []
      };

      if (node.expanded && node.children && node.children.length > 0) {
        node.children.forEach((child, idx) => {
          const childX = posX + hGap;
          const childY = posY + (idx - (node.children.length - 1) / 2) * vGap;
          traverse(child, level + 1, childX, childY, idx, node.children.length);
          layout[id].children.push(child.id);
        });
      }
    }

    traverse(root, 0, x, y, 0, 1);
    return layout;
  }

  // ============================================================================
  // DRAW SVG
  // ============================================================================
  function drawSvg(layout) {
    mindmapSvg.innerHTML = '';

    // Draw connections
    const conns = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    conns.setAttribute('id', 'connections');

    Object.values(layout).forEach(item => {
      item.children.forEach(childId => {
        const child = layout[childId];
        if (!child) return;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const cpX = (item.x + child.x) / 2;
        path.setAttribute('d', `M ${item.x} ${item.y} Q ${cpX} ${item.y} ${child.x} ${child.y}`);
        path.setAttribute('stroke', COLORS.secondary);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('fill', 'none');
        path.setAttribute('opacity', '0.4');
        conns.appendChild(path);
      });
    });

    mindmapSvg.appendChild(conns);

    // Draw nodes
    const nodes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodes.setAttribute('id', 'nodes');

    Object.entries(layout).forEach(([id, item]) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'node-group');
      g.setAttribute('data-node-id', id);

      const colorMap = [
        COLORS.primary,
        COLORS.secondary,
        COLORS.tertiary,
        COLORS.quaternary,
        COLORS.quinary
      ];
      const color = colorMap[Math.min(item.level, colorMap.length - 1)];

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', item.x);
      circle.setAttribute('cy', item.y);
      circle.setAttribute('r', item.radius);
      circle.setAttribute('fill', color);
      circle.setAttribute('opacity', '0.9');
      g.appendChild(circle);

      if (item.node.text) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', item.x);
        text.setAttribute('y', item.y);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-size', Math.max(10, 14 - item.level * 1.5));
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', item.level <= 1 ? 'white' : '#0a0b0d');

        const words = item.node.text.split(' ');
        const lines = [];
        let line = '';

        words.forEach(word => {
          if ((line + word).length > 12) {
            if (line) lines.push(line);
            line = word;
          } else {
            line += (line ? ' ' : '') + word;
          }
        });
        if (line) lines.push(line);

        lines.forEach((l, idx) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', item.x);
          tspan.setAttribute('dy', idx === 0 ? 0 : 13);
          tspan.textContent = l;
          text.appendChild(tspan);
        });

        g.appendChild(text);
      }

      g.addEventListener('click', () => {
        toggleNode(id);
      });

      nodes.appendChild(g);
    });

    mindmapSvg.appendChild(nodes);

    // Update viewBox
    const positions = Object.values(layout);
    const xs = positions.map(p => p.x);
    const ys = positions.map(p => p.y);
    const minX = Math.min(...xs) - 60;
    const maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 60;

    mindmapSvg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    mindmapSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  // ============================================================================
  // TOGGLE NODE
  // ============================================================================
  function toggleNode(nodeId) {
    const findNode = (node, id) => {
      if (node.id === id) return node;
      if (node.children) {
        for (let child of node.children) {
          const found = findNode(child, id);
          if (found) return found;
        }
      }
      return null;
    };

    const chapter = state.chapters.find(ch => ch.id === state.selectedChapter);
    if (!chapter) return;

    const node = findNode(chapter.mindmapData.root, nodeId);
    if (node && node.children && node.children.length > 0) {
      node.expanded = !node.expanded;
      renderMindmap(chapter.mindmapData);
    }
  }

  // ============================================================================
  // RENDER MINDMAP
  // ============================================================================
  function renderMindmap(mindmapData) {
    console.log('Rendering mindmap...');
    
    mindmapPlaceholder.style.display = 'none';
    mindmapSvg.style.display = 'block';

    const layout = calculateLayout(mindmapData.root);
    drawSvg(layout);
  }

  // ============================================================================
  // DRAW DEFAULT MOCKUP
  // ============================================================================
  function drawDefaultMockup() {
    console.log('Drawing default mockup...');
    
    mindmapPlaceholder.style.display = 'none';
    mindmapSvg.style.display = 'block';
    mindmapSvg.innerHTML = '';

    mindmapSvg.setAttribute('viewBox', '-100 -150 700 400');
    mindmapSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const svg = mindmapSvg;

    // Center node
    const center = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    center.setAttribute('cx', '0');
    center.setAttribute('cy', '0');
    center.setAttribute('r', '40');
    center.setAttribute('fill', COLORS.primary);
    center.setAttribute('opacity', '0.85');
    svg.appendChild(center);

    const centerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    centerText.setAttribute('x', '0');
    centerText.setAttribute('y', '5');
    centerText.setAttribute('text-anchor', 'middle');
    centerText.setAttribute('dominant-baseline', 'middle');
    centerText.setAttribute('font-size', '13');
    centerText.setAttribute('font-weight', '600');
    centerText.setAttribute('fill', 'white');
    centerText.textContent = 'Select';
    svg.appendChild(centerText);

    // Secondary nodes
    const secondaryPositions = [
      { x: -180, y: -100, label: 'Concept' },
      { x: -180, y: 100, label: 'Topic' },
      { x: 180, y: -100, label: 'Theme' },
      { x: 180, y: 100, label: 'Area' }
    ];

    secondaryPositions.forEach(pos => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cpX = pos.x / 2;
      line.setAttribute('d', `M 0 0 Q ${cpX} ${pos.y / 2} ${pos.x} ${pos.y}`);
      line.setAttribute('stroke', COLORS.secondary);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('fill', 'none');
      line.setAttribute('opacity', '0.4');
      svg.appendChild(line);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '30');
      circle.setAttribute('fill', COLORS.secondary);
      circle.setAttribute('opacity', '0.7');
      svg.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pos.x);
      text.setAttribute('y', pos.y);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '600');
      text.setAttribute('fill', 'white');
      text.textContent = pos.label;
      svg.appendChild(text);
    });

    // Tertiary nodes
    const tertiaryPositions = [
      -320, -60, -140,
      320, -60, 60, 140
    ];

    [
      { x: -320, y: -140 },
      { x: -320, y: -60 },
      { x: -320, y: 60 },
      { x: -320, y: 140 },
      { x: 320, y: -140 },
      { x: 320, y: 0 },
      { x: 320, y: 140 }
    ].forEach(pos => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', '22');
      circle.setAttribute('fill', COLORS.tertiary);
      circle.setAttribute('opacity', '0.55');
      svg.appendChild(circle);
    });
  }

  // ============================================================================
  // ZOOM & PAN
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

  // ============================================================================
  // INITIALIZE
  // ============================================================================
  function init() {
    console.log('Initializing mindmap page...');
    
    try {
      renderBookCards();
      drawDefaultMockup();
      console.log('Mindmap initialized successfully');
    } catch (error) {
      console.error('Error initializing mindmap:', error);
    }

    // Set year
    const yearEl = document.getElementById('y');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
