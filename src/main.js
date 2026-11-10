// === CONSTANTES Y CONFIGURACIÓN ===
const API_BASE = '...';
const STORAGE_KEY = 'glystv_pro';

// === VARIABLES GLOBALES ===
let currentUser = null;
let channels = [];
let favorites = [];

// === FUNCIONES DE LOGIN ===
function login(server, user, pass) { ... }
function loadM3U(url) { ... }

// === FUNCIONES DE REPRODUCTOR ===
function play(channel) { ... }
function toggleFullscreen() { ... }

// === FUNCIONES DE UI ===
function renderChannels() { ... }
function renderHome() { ... }

// === EVENTOS ===
document.addEventListener('DOMContentLoaded', init);
