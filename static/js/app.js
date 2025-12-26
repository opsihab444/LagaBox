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

// --- API CONFIG ---
const API_BASE = "https://h5.aoneroom.com/wefeed-h5-bff/web";
const TRENDING_API = "https://h5-api.aoneroom.com/wefeed-h5api-bff/ranking-list/content?id=5837669637445565960&page=1&perPage=20";

// --- API HELPERS ---
async function apiFetch(endpoint, options = {}) {
    // If endpoint starts with http, it's a direct external link
    const url = endpoint.startsWith('http') ? endpoint : `/api${endpoint}`;

    // Direct API calls (Bypassing Server Proxy)
    if (url.includes(API_BASE) || url.includes(TRENDING_API)) {
        try {
            const res = await fetch(url, options);
            const json = await res.json();
            // Normalize "Direct API" structure to match our app's expectation
            // API usually returns { code: 0, data: { ... } }
            // Our App expects { success: true, data: ... }
            if (json.code === 0 || json.success) {
                return { success: true, data: json.data || json };
            }
            return { success: false, error: json.message };
        } catch (e) {
            console.error("Direct API Error:", e);
            return { success: false, error: e.message };
        }
    }

    // Local Calls (Fallbacks)
    if (state.cache[endpoint]) return state.cache[endpoint];
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.success && endpoint.includes('details')) state.cache[endpoint] = data;
    return data;
}

// --- HOME VIEW ---
async function initHome() {
    if (document.getElementById('home-grid').children.length > 12) return; // Already loaded?

    try {
        // Fetch REAL Trending Data (DIRECT FROM API)
        const data = await apiFetch(TRENDING_API);

        if (data.success) {
            // API returns { data: { subjectList: [...] } }
            // Or our helper normalized it to { success:true, data: { subjectList... } }
            // Let's handle the specific BD Trending API structure

            const rawData = data.data;
            const subjectList = rawData.subjectList || (rawData.data ? rawData.data.subjectList : []);

            if (subjectList && subjectList.length > 0) {
                renderGrid(subjectList, 'home-grid');
                return;
            }
            // Fallback Logic below...
            const content = data.data;
            let trendingItems = [];
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

    // Direct POST Search
    const data = await apiFetch(`${API_BASE}/subject/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            keyword: query,
            page: 1,
            perPage: 24,
            subjectType: 0
        })
    });

    if (data.success && data.data && data.data.list) {
        renderGrid(data.data.list, 'search-grid');
    } else {
        document.getElementById('search-grid').innerHTML = '<p>No results found.</p>';
    }
}

// --- RECOMMENDATIONS ---
async function loadRecommendations(id) {
    // Direct POST Recommendations
    const data = await apiFetch(`${API_BASE}/subject/detail-rec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId: id, page: 1, perPage: 12 })
    });

    if (data.success && (data.data.items || data.data.list)) {
        renderGrid(data.data.items || data.data.list, 'rec-grid');
    }
}


// --- PLAYER (CLIENT SIDE ARTPLAYER) ---
var art = null;

async function openPlayer(id, title) {
    document.getElementById('player-title').textContent = title;
    const container = document.getElementById('artplayer-container');
    container.innerHTML = '<div class="custom-loader" style="height:100%; display:flex; align-items:center; justify-content:center; color:white;">Fetching Stream Links...</div>';

    // 1. Fetch Download Links
    const data = await apiFetch(`${API_BASE}/subject/download?subjectId=${id}&se=0&ep=0`);

    if (data.success && data.data.downloads && data.data.downloads.length > 0) {
        const downloads = data.data.downloads;
        // Sort by resolution desc
        downloads.sort((a, b) => b.resolution - a.resolution);

        const bestSource = downloads[0];

        // 2. Init ArtPlayer
        if (art) art.destroy();

        art = new Artplayer({
            container: '#artplayer-container',
            url: bestSource.url,
            title: title,
            volume: 0.8,
            isLive: false,
            autoplay: true,
            theme: '#00f2ea', // Neon Cyan

            // Quality Selector
            settings: [
                {
                    html: 'Quality',
                    tooltip: bestSource.resolution + 'p',
                    selector: downloads.map(d => ({
                        html: `${d.resolution}p (${Math.round(d.size / 1024 / 1024)}MB)`,
                        url: d.url,
                        default: d === bestSource
                    })),
                    onSelect: function (item) {
                        art.switchUrl(item.url);
                        return item.html;
                    },
                }
            ],

            icons: {
                loading: '<div style="color:#00f2ea">buffering...</div>',
            }
        });

    } else {
        container.innerHTML = '<div style="color:red; text-align:center; padding-top:40%">No Stream Links Found.<br>Try another movie.</div>';
    }
}

function closePlayer() {
    if (art) {
        art.destroy();
        art = null;
    }
    document.getElementById('artplayer-container').innerHTML = '';
    route('details', { id: state.lastDetailsId || state.params.id });
    document.getElementById('view-player').classList.remove('active');
}

// Track last details for back nav
const originalRoute = route;
route = function (name, params) {
    if (name === 'details') state.lastDetailsId = params.id;
    originalRoute(name, params);
}
