// Detecta el OS del visitante y arma el botón "Descargar" apuntando al asset
// correcto del release más nuevo. La info la pedimos a la API de GitHub
// para que NUNCA haya que actualizar este código cuando salga una versión.
const REPO = 'jainierrojas-arch/task-manager-app';
const ICONS = {
  mac: '🍎',
  windows: '🪟',
  linux: '🐧'
};

function detectOS() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(ua) || /mac/.test(platform)) {
    // Apple Silicon vs Intel — heurística por ua. Por defecto asumimos arm64
    // porque cualquier Mac vendido desde 2020 lo es. Si es Intel, el usuario
    // puede usar "Otras plataformas".
    return 'mac-arm64';
  }
  if (/win/.test(ua) || /win/.test(platform)) return 'windows';
  if (/linux/.test(ua)) return 'linux';
  return 'unknown';
}

function pickAsset(assets, os) {
  if (!Array.isArray(assets)) return null;
  if (os === 'mac-arm64') {
    return assets.find(a => /arm64.*mac\.zip$/i.test(a.name))
        || assets.find(a => /mac\.zip$/i.test(a.name));
  }
  if (os === 'mac-intel') {
    return assets.find(a => /^Task-Manager-[\d.]+-mac\.zip$/i.test(a.name))
        || assets.find(a => /mac\.zip$/i.test(a.name));
  }
  if (os === 'windows') {
    return assets.find(a => /setup.*\.exe$/i.test(a.name))
        || assets.find(a => /\.exe$/i.test(a.name));
  }
  return null;
}

function osLabel(os) {
  if (os === 'mac-arm64') return 'Descargar para Mac (Apple Silicon)';
  if (os === 'mac-intel') return 'Descargar para Mac (Intel)';
  if (os === 'windows') return 'Descargar para Windows';
  return 'Descargar Task Manager';
}

function osIcon(os) {
  if (os && os.startsWith('mac')) return ICONS.mac;
  if (os === 'windows') return ICONS.windows;
  if (os === 'linux') return ICONS.linux;
  return '⬇';
}

async function loadLatestRelease() {
  const os = detectOS();
  // Setear icon + label antes incluso de que la API responda — UX inmediata.
  const labelText = osLabel(os);
  const iconText = osIcon(os);
  ['downloadLabel', 'downloadLabel2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = labelText;
  });
  ['downloadIcon', 'downloadIcon2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = iconText;
  });

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) throw new Error('No se pudo obtener el release');
    const data = await res.json();
    const tag = data.tag_name || 'v?';
    const asset = pickAsset(data.assets, os);
    const fallbackUrl = data.html_url || `https://github.com/${REPO}/releases/latest`;
    const downloadUrl = asset ? asset.browser_download_url : fallbackUrl;

    ['downloadBtn', 'downloadBtn2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.href = downloadUrl;
        if (asset) {
          el.setAttribute('download', asset.name);
        }
      }
    });

    const versionEl = document.getElementById('versionLabel');
    if (versionEl) versionEl.textContent = `Última versión: ${tag}`;
  } catch (e) {
    // Silent fallback: el botón sigue funcionando con el href "#" del HTML
    // pero lo apuntamos a /releases/latest como mínimo.
    const fallback = `https://github.com/${REPO}/releases/latest`;
    ['downloadBtn', 'downloadBtn2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.href = fallback;
    });
    const versionEl = document.getElementById('versionLabel');
    if (versionEl) versionEl.textContent = 'Descargá la versión más nueva en GitHub';
  }
}

// Form de early access — por ahora guarda en localStorage para no perder leads
// hasta que conectemos un backend (Mailchimp / ConvertKit / Stripe waitlist).
function initEmailForm() {
  const form = document.getElementById('emailForm');
  const input = document.getElementById('emailInput');
  const note = document.getElementById('formNote');
  if (!form || !input || !note) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = (input.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      note.textContent = 'Email no válido';
      note.style.color = '#ff4757';
      return;
    }
    try {
      const list = JSON.parse(localStorage.getItem('tm_waitlist') || '[]');
      if (!list.includes(email)) list.push(email);
      localStorage.setItem('tm_waitlist', JSON.stringify(list));
    } catch (e) {}
    note.textContent = '✓ Anotado. Te avisamos antes que a nadie.';
    note.style.color = '#4ecdc4';
    input.value = '';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadLatestRelease();
  initEmailForm();
  const yr = document.getElementById('footerYear');
  if (yr) yr.textContent = new Date().getFullYear();
});
