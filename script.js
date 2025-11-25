// Configuration
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@ticker/ethusdt@ticker';
const BINANCE_API_URL = 'https://api.binance.com/api/v3';
const EXCHANGE_RATE_API = 'https://api.exchangerate-api.com/v4/latest/USD';

// State
let currentPrices = {
    bitcoin: { usd: 0, change24h: 0 },
    ethereum: { usd: 0, change24h: 0 }
};
// Store reference prices for real-time calculation
let referencePrices = {
    bitcoin: { price1hAgo: 0, price4hAgo: 0 },
    ethereum: { price1hAgo: 0, price4hAgo: 0 }
};

let usdToCnyRate = 7.2;
let activeChartCoin = 'bitcoin';
let mainChartInstance = null;
let miniChartInstances = {};

// DOM Elements
const elements = {
    btcPrice: document.getElementById('btc-price'),
    ethPrice: document.getElementById('eth-price'),

    // Stats Elements
    btc1h: document.getElementById('btc-1h'),
    btc4h: document.getElementById('btc-4h'),
    btc24h: document.getElementById('btc-24h'),
    eth1h: document.getElementById('eth-1h'),
    eth4h: document.getElementById('eth-4h'),
    eth24h: document.getElementById('eth-24h'),

    convertAmount: document.getElementById('convert-amount'),
    convertFrom: document.getElementById('convert-from'),
    convertResultUsd: document.getElementById('convert-result-usd'),
    convertResultCny: document.getElementById('convert-result-cny'),
    chartButtons: document.querySelectorAll('.chart-controls button')
};

// Initialize
async function init() {
    await fetchExchangeRate();
    setupWebSocket();
    setupEventListeners();
    await updateCharts();
    // Refresh historical data every minute (to update reference prices and chart)
    setInterval(updateCharts, 60000);
}

async function fetchExchangeRate() {
    try {
        const res = await fetch(EXCHANGE_RATE_API);
        const data = await res.json();
        usdToCnyRate = data.rates.CNY;
    } catch (e) {
        console.warn('Failed to fetch exchange rate, using default 7.2');
    }
}

function setupWebSocket() {
    const ws = new WebSocket(BINANCE_WS_URL);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const symbol = data.s;
        const price = parseFloat(data.c);
        const changePercent = parseFloat(data.P);
        const coin = symbol === 'BTCUSDT' ? 'bitcoin' : 'ethereum';

        // Update State
        currentPrices[coin].usd = price;
        currentPrices[coin].change24h = changePercent;

        // Update UI
        updatePriceDisplay(coin, price);
        updateStat(coin, '24h', changePercent);

        // Real-time recalculation of 1h and 4h changes
        if (referencePrices[coin].price1hAgo > 0) {
            const change1h = ((price - referencePrices[coin].price1hAgo) / referencePrices[coin].price1hAgo) * 100;
            updateStat(coin, '1h', change1h);
        }
        if (referencePrices[coin].price4hAgo > 0) {
            const change4h = ((price - referencePrices[coin].price4hAgo) / referencePrices[coin].price4hAgo) * 100;
            updateStat(coin, '4h', change4h);
        }

        updateConverter();

        // Update advice if it's the active coin
        if (coin === activeChartCoin) {
            updateAdvice();
        }
    };
}

function updatePriceDisplay(coin, price) {
    const el = coin === 'bitcoin' ? elements.btcPrice : elements.ethPrice;
    el.textContent = formatPrice(price);

    // Flash effect
    el.style.color = '#00ccff';
    setTimeout(() => {
        el.style.color = '#ffffff';
    }, 200);
}

function updateStat(coin, period, value) {
    const id = `${coin === 'bitcoin' ? 'btc' : 'eth'}-${period}`;
    const el = document.getElementById(id);
    if (!el) return;

    const formatted = value.toFixed(2);
    el.textContent = `${formatted > 0 ? '+' : ''}${formatted}%`;
    el.className = `stat-value ${value >= 0 ? 'up' : 'down'}`;
}

function formatPrice(price) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Charts & Stats Calculation
async function updateCharts() {
    const coins = [
        { id: 'bitcoin', symbol: 'BTCUSDT' },
        { id: 'ethereum', symbol: 'ETHUSDT' }
    ];

    for (const coin of coins) {
        try {
            // Fetch 15m candles for 24h (24 * 4 = 96 points)
            // limit=100 to be safe and cover full range
            const response = await fetch(`${BINANCE_API_URL}/klines?symbol=${coin.symbol}&interval=15m&limit=100`);
            const data = await response.json();

            // data[i] = [open_time, open, high, low, close, ...]
            // Store reference prices for real-time updates
            // 1h ago = 4 candles ago (15m * 4 = 60m)
            // 4h ago = 16 candles ago (15m * 16 = 240m)

            // We use the 'close' of the candle X periods ago as the baseline
            // Or 'open' of the candle X periods ago? Usually 'close' of previous is better, 
            // but for "1h ago" specifically, we want the price at T-1h.
            // Let's use the Close price of the candle that ended ~1h ago.

            const len = data.length;
            if (len > 4) {
                referencePrices[coin.id].price1hAgo = parseFloat(data[len - 5][4]); // 4 candles back
            }
            if (len > 16) {
                referencePrices[coin.id].price4hAgo = parseFloat(data[len - 17][4]); // 16 candles back
            }

            // Prepare Chart Data
            const prices = data.map(d => parseFloat(d[4]));
            const labels = data.map(d => d[0]); // Keep timestamp for formatting in callback

            renderMiniChart(coin.id, prices, labels);

            if (coin.id === activeChartCoin) {
                renderMainChart(coin.id, prices, labels);
            }
        } catch (e) {
            console.error(`Error fetching chart for ${coin.id}:`, e);
        }
    }
}

function renderMiniChart(coin, data, labels) {
    const ctx = document.getElementById(`${coin === 'bitcoin' ? 'btc' : 'eth'}-mini-chart`).getContext('2d');
    const isUp = data[data.length - 1] >= data[0];
    const color = isUp ? '#00ff88' : '#ff0055';

    if (miniChartInstances[coin]) {
        miniChartInstances[coin].destroy();
    }

    miniChartInstances[coin] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                borderColor: color,
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } },
            animation: false
        }
    });
}

function renderMainChart(coin, data, labels) {
    const ctx = document.getElementById('main-chart').getContext('2d');
    const color = '#00ccff';

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(0, 204, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 204, 255, 0)');

    if (mainChartInstance) {
        mainChartInstance.destroy();
    }

    mainChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Price (USD)',
                data: data,
                borderColor: color,
                backgroundColor: gradient,
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10, 11, 30, 0.9)',
                    titleColor: '#a0a0b0',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            return '$' + context.parsed.y.toLocaleString();
                        },
                        title: function (context) {
                            const date = new Date(parseInt(context[0].label));
                            // Format: MM-DD HH:mm
                            const month = (date.getMonth() + 1).toString().padStart(2, '0');
                            const day = date.getDate().toString().padStart(2, '0');
                            const hours = date.getHours().toString().padStart(2, '0');
                            const minutes = date.getMinutes().toString().padStart(2, '0');
                            return `${month}-${day} ${hours}:${minutes}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: {
                        color: '#a0a0b0',
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        callback: function (value, index, values) {
                            // Show fewer labels on x-axis to avoid clutter
                            const date = new Date(this.getLabelForValue(value));
                            const hours = date.getHours().toString().padStart(2, '0');
                            const minutes = date.getMinutes().toString().padStart(2, '0');
                            return `${hours}:${minutes}`;
                        }
                    }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#a0a0b0' }
                }
            }
        }
    });
}

// Custom Plugin for High/Low Markers
const highLowPlugin = {
    id: 'highLowMarkers',
    afterDatasetsDraw(chart, args, options) {
        const { ctx, data, chartArea: { top, bottom, left, right, width, height }, scales: { x, y } } = chart;

        // Only draw on main chart
        if (chart.canvas.id !== 'main-chart') return;

        const dataset = data.datasets[0];
        const values = dataset.data;
        if (!values || values.length === 0) return;

        let maxVal = -Infinity;
        let minVal = Infinity;
        let maxIdx = -1;
        let minIdx = -1;

        values.forEach((v, i) => {
            if (v > maxVal) { maxVal = v; maxIdx = i; }
            if (v < minVal) { minVal = v; minIdx = i; }
        });

        ctx.save();
        ctx.font = 'bold 12px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        // Draw Max
        const xMax = x.getPixelForValue(maxIdx);
        const yMax = y.getPixelForValue(maxVal);

        ctx.fillStyle = '#00ff88';
        ctx.fillText(`High: $${maxVal.toLocaleString()}`, xMax, yMax - 10);
        ctx.beginPath();
        ctx.arc(xMax, yMax, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Draw Min
        ctx.textBaseline = 'top';
        const xMin = x.getPixelForValue(minIdx);
        const yMin = y.getPixelForValue(minVal);

        ctx.fillStyle = '#ff0055';
        ctx.fillText(`Low: $${minVal.toLocaleString()}`, xMin, yMin + 10);
        ctx.beginPath();
        ctx.arc(xMin, yMin, 4, 0, 2 * Math.PI);
        ctx.fill();

        ctx.restore();
    }
};

Chart.register(highLowPlugin);

function updateAdvice() {
    const coin = activeChartCoin;
    const price = currentPrices[coin].usd;
    const change24h = currentPrices[coin].change24h;
    const adviceEl = document.getElementById('advice-content');

    if (price === 0) return;

    let advice = '';
    let sentiment = '';

    if (change24h > 5) {
        sentiment = '市场情绪极度贪婪 🔥';
        advice = `当前 ${coin === 'bitcoin' ? '比特币' : '以太坊'} 涨势强劲（+${change24h.toFixed(2)}%）。短期内可能面临回调风险，建议分批止盈，切勿盲目追高。`;
    } else if (change24h > 0) {
        sentiment = '市场情绪乐观 📈';
        advice = `当前呈现温和上涨趋势（+${change24h.toFixed(2)}%）。持有者可继续持有，观望者可等待回调时机入场。`;
    } else if (change24h > -5) {
        sentiment = '市场情绪谨慎 📉';
        advice = `当前处于震荡回调阶段（${change24h.toFixed(2)}%）。这可能是短期建仓的好机会，建议关注支撑位，定投买入。`;
    } else {
        sentiment = '市场情绪恐慌 ❄️';
        advice = `当前跌幅较大（${change24h.toFixed(2)}%），市场恐慌情绪蔓延。切勿恐慌抛售，长期投资者可视为"黄金坑"，分批抄底。`;
    }

    adviceEl.innerHTML = `<strong>${sentiment}</strong><br>${advice}`;
}

function setupEventListeners() {
    elements.convertAmount.addEventListener('input', updateConverter);
    elements.convertFrom.addEventListener('change', updateConverter);

    elements.chartButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const coin = e.target.dataset.coin;
            if (coin === activeChartCoin) return;

            elements.chartButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeChartCoin = coin;

            updateCharts();
            updateAdvice();
        });
    });
}

function updateConverter() {
    const amount = parseFloat(elements.convertAmount.value) || 0;
    const coin = elements.convertFrom.value;
    const priceUsd = currentPrices[coin].usd;

    if (priceUsd === 0) return;

    const totalUsd = amount * priceUsd;
    const totalCny = totalUsd * usdToCnyRate;

    elements.convertResultUsd.textContent = '$' + totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    elements.convertResultCny.textContent = '¥' + totalCny.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

init();
