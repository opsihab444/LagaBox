// --- STATE & ROUTING ---
const state = {
    currentView: 'home',
    cache: {}
};

function route(viewName, params = {}) {
    // UI Switch optimized
    requestAnimationFrame(() => {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewName}`).classList.add('active');
        window.scrollTo(0, 0);

        state.currentView = viewName;
        state.params = params;

        // Logic deferred slightly to allow UI to paint
        setTimeout(() => {
            if (viewName === 'home') initHome();
            if (viewName === 'details') loadDetails(params.id);
            if (viewName === 'search') doSearch(params.query);
            if (viewName === 'player') openPlayer(params.id, params.title);
        }, 10);
    });
}

// Allow linking via ?v=details&id=...
window.onload = function () {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (id && window.location.pathname.includes('details')) {
        route('details', { id: id });
    } else if (urlParams.get('q')) {
        document.querySelector('.search-input').value = urlParams.get('q');
        route('search', { query: urlParams.get('q') });
    } else {
        route('home');
    }
};

// --- API HELPERS ---
async function apiFetch(endpoint) {
    if (state.cache[endpoint]) return state.cache[endpoint];
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.success && endpoint.includes('details')) state.cache[endpoint] = data; // Cache details
    return data;
}

// --- HOME VIEW ---
async function initHome() {
    if (document.getElementById('home-grid').children.length > 12) return; // Already loaded?

    try {
        // Fetch REAL Trending Data
        const data = await apiFetch('/api/home');

        if (data.success && data.data) {
            const content = data.data;
            let trendingItems = [];

            // Parse Operating List
            const opList = content.operatingList || (Array.isArray(content) ? content : []);

            // 1. Try to find "Trending" section
            const trendingSection = opList.find(s => s.title && s.title.includes('Trending'));
            if (trendingSection && trendingSection.subjects) {
                trendingItems = trendingSection.subjects;
            }
            // 2. Fallback to any section with subjects/list matching "Movie" or generic
            else {
                const anySection = opList.find(s => s.subjects && s.subjects.length > 0);
                if (anySection) trendingItems = anySection.subjects;
            }

            if (trendingItems.length > 0) {
                renderGrid(trendingItems, 'home-grid');
            } else {
                // Absolute fallback if everything fails
                console.warn("No trending data found, falling back to search");
                const fallback = await apiFetch('/api/search?q=Action&page=1');
                if (fallback.success) renderGrid(fallback.data.items, 'home-grid');
            }
        }
    } catch (e) {
        console.error("Home load failed", e);
    }
}

// --- SEARCH ---
function handleSearch(e) {
    if (e.key === 'Enter') {
        route('search', { query: e.target.value });
    }
}

async function doSearch(query) {
    if (!query) return;
    document.getElementById('search-grid').innerHTML = '<div class="skeleton" style="height:200px; grid-column:1/-1"></div>';
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(query)}&page=1`);
    if (data.success && data.data.items) {
        renderGrid(data.data.items, 'search-grid');
    } else {
        document.getElementById('search-grid').innerHTML = '<p>No results found.</p>';
    }
}

// --- LAZY LOADING ---
function setupLazyLoading() {
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.getAttribute('data-src');
                    if (src) {
                        img.src = src;
                        img.onload = () => img.classList.add('loaded');
                        img.onerror = () => img.classList.add('loaded'); // Show placeholder if fail
                        img.removeAttribute('data-src');
                        obs.unobserve(img);
                    }
                }
            });
        }, { rootMargin: "200px" });

        document.querySelectorAll('.lazy-img[data-src]').forEach(img => observer.observe(img));
    } else {
        document.querySelectorAll('.lazy-img[data-src]').forEach(img => {
            img.src = img.getAttribute('data-src');
            img.onload = () => img.classList.add('loaded');
        });
    }
}



// --- RENDER GRID ---
function renderGrid(items, containerId) {
    const container = document.getElementById(containerId);

    container.innerHTML = items.map(item => {
        // 🚀 OPTIMIZATION: Use API dominant colors for instant "BlurHash-like" placeholder
        const cover = item.cover || item.image || {};
        const color1 = cover.avgHueDark || '#1a1a1a';
        const color2 = cover.avgHueLight || '#333';
        const bgStyle = `background: linear-gradient(135deg, ${color1}, ${color2})`;

        // Logic for badges (Corner or Quality)
        const badgeText = item.corner || (item.quality ? item.quality : '');
        const badgeHtml = badgeText ? `<div class="card-badge">${badgeText}</div>` : '';

        return `
        <div class="media-card" style="${bgStyle}" onclick="route('details', {id: '${item.subjectId || item.id}'})">
            ${badgeHtml}
            <img class="media-img lazy-img" 
                 decoding="async" 
                 loading="lazy"
                 data-src="${cover.url || ''}" 
                 src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
            <div class="media-info">
                <h4 class="media-title">${item.title}</h4>
                <div class="media-meta" style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.8rem; opacity:0.8">${item.releaseDate ? item.releaseDate.substring(0, 4) : (item.year || '')}</span>
                    <span class="rating-pill">
                        <i class="fa-solid fa-star"></i> ${item.imdbRatingValue || item.score || 'N/A'}
                    </span>
                </div>
            </div>
        </div>
    `}).join('');
    setupLazyLoading();
}

// --- DETAILS VIEW ---
async function loadDetails(id) {
    // Reset UI to skeletons
    document.getElementById('det-title').textContent = '';
    document.getElementById('det-title').classList.add('skeleton', 'sk-title');

    // Meta Tags Reset
    document.getElementById('det-meta').innerHTML = '<div class="skeleton sk-tag"></div><div class="skeleton sk-tag"></div><div class="skeleton sk-tag"></div>';

    // Description Reset
    document.getElementById('det-sk-desc').style.display = 'block';
    document.getElementById('det-desc').style.display = 'none';

    // Buttons & Info Row Reset
    document.getElementById('btn-play').classList.add('skeleton');
    document.getElementById('btn-add').classList.add('skeleton');
    document.getElementById('det-info-row').innerHTML = '<div class="skeleton meta-skeleton-row"></div>';

    // Cast Skeleton Reset
    document.getElementById('det-cast-info').style.display = 'none';
    document.getElementById('det-cast-skeleton').style.display = 'block';

    // Poster Reset
    document.getElementById('det-poster').style.opacity = '0';
    document.getElementById('det-poster-container').classList.add('skeleton');

    // Rec Grid Reset
    document.getElementById('rec-grid').innerHTML = '<div class="media-card skeleton"></div>'.repeat(6);

    const data = await apiFetch(`/api/details/${id}`);

    if (data.success) {
        const s = data.data.subject;

        document.getElementById('det-title').textContent = s.title;
        document.getElementById('det-title').classList.remove('skeleton', 'sk-title');

        const desc = s.description || "No description available for this content.";
        document.getElementById('det-desc').textContent = desc;
        document.getElementById('det-sk-desc').style.display = 'none';
        document.getElementById('det-desc').style.display = 'block';

        // Buttons & Info Row Reveal
        document.getElementById('btn-play').classList.remove('skeleton');
        document.getElementById('btn-add').classList.remove('skeleton');

        document.getElementById('det-info-row').innerHTML = `
             <div class="rating-pill" style="font-size:1rem; padding: 4px 12px;">
                <i class="fa-brands fa-imdb" style="font-size:1.2em"></i> 
                <span style="font-weight:bold; margin-left:5px">${s.imdbRatingValue || s.score || 'N/A'}</span>
             </div>
             <div style="opacity:0.75; font-size:0.95rem; display:flex; gap:6px; align-items:center; margin-left:15px">
                <i class="fa-regular fa-calendar"></i> <span>${s.releaseDate || s.year || 'N/A'}</span>
             </div>
             <div style="opacity:0.75; font-size:0.95rem; display:flex; gap:6px; align-items:center; margin-left:15px">
                <i class="fa-regular fa-clock"></i> <span>${s.duration ? Math.round(s.duration / 60) + ' min' : 'N/A'}</span>
             </div>
        `;

        // Cast & Crew Populate
        // Note: API returns 'stars' in the root data object, not inside 'subject'
        const stars = data.data.stars || [];
        const actors = stars.filter(s => s.staffType === 1).map(a => a.name).slice(0, 8).join(', ');
        const directors = stars.filter(s => s.staffType === 2).map(d => d.name).join(', ') || 'Unknown';
        // Fallback: if no staffType distinction found in this sample, just assume all stars are cast for now.
        const displayCast = actors || stars.map(s => s.name).slice(0, 8).join(', ') || 'Unknown';

        document.getElementById('det-director').textContent = directors; // Director might be empty if not in stars
        document.getElementById('det-cast').textContent = displayCast;

        document.getElementById('det-cast-skeleton').style.display = 'none';
        document.getElementById('det-cast-info').style.display = 'block';

        if (s.cover && s.cover.url) {
            document.getElementById('det-poster').src = s.cover.url;
            document.getElementById('det-poster-container').classList.remove('skeleton');
        }

        // Tags
        let tagsHtml = '';
        // Genre string is "Action,Adventure,Sci-Fi" in the response, not array of objects
        if (s.genre) {
            tagsHtml = s.genre.split(',').map(g => `<span class="tag">${g.trim()}</span>`).join('');
        } else if (s.movieCategory) {
            tagsHtml = s.movieCategory.map(c => `<span class="tag">${c.name}</span>`).join('');
        }

        if (s.title.includes('CAM')) tagsHtml += `<span class="tag" style="background:red; color:white">CAM</span>`;
        document.getElementById('det-meta').innerHTML = tagsHtml;

        // Play Button
        document.getElementById('btn-play').onclick = () => route('player', { id: id, title: s.title });

        // Trigger Recommendations (Native ID-based)
        loadRecommendations(id);
    }
}

async function loadRecommendations(id) {
    // Use dedicated recommendation API
    const data = await apiFetch(`/api/recommendations?id=${id}&page=1`);
    if (data.success && data.data.items) {
        renderGrid(data.data.items.slice(0, 12), 'rec-grid');
    }
}

// --- PLAYER ---
function openPlayer(id, title) {
    document.getElementById('player-title').textContent = title;
    document.getElementById('player-frame').src = `/player?id=${id}&title=${encodeURIComponent(title)}`;
}

function closePlayer() {
    document.getElementById('player-frame').src = "";
    route('details', { id: state.lastDetailsId || state.params.id });
    document.getElementById('view-player').classList.remove('active');
}

// Track last details for back nav
const originalRoute = route;
route = function (name, params) {
    if (name === 'details') state.lastDetailsId = params.id;
    originalRoute(name, params);
}
