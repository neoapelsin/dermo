import puppeteer, { Browser, Page } from "puppeteer";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

// ─── ENV ───────────────────────────────────────────────────────────────────────
// Переменные среды (можно задать в .env или export перед запуском)
//
//   TG_BOT_TOKEN=786709623:AAEjFaXrncCI9_CdRKrCyyY1OWUDz0JZ91A
//   TG_CHAT_ID=-5224193413
//   EMAIL_TOKEN=EYwehAt4hem2MYcAT3C8q0cyqogICol8
//   EMAIL_DOMAIN=hotmail
//   SMS_API_KEY=Joel-4667:zR08lv8u
//   SMS_GATEWAY=sandy
//
// Если переменные не заданы — используются дефолтные значения ниже.

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "786709623:AAEjFaXrncCI9_CdRKrCyyY1OWUDz0JZ91A";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "-5224193413";

const CONFIG = {
  targetUrl: "https://www.subito.it",
  registerUrl: "https://areariservata.subito.it/form",
  cookiesDir: process.env.COOKIES_DIR || "./cookies",
  accountsFile: process.env.ACCOUNTS_FILE || "./accounts.json",
  proxyFile: process.env.PROXY_FILE || "./proxy.txt",
  usedProxiesFile: process.env.USED_PROXIES_FILE || "./used_proxies.json",
  headless: false,
  loopDelay: 5_000,
  navigationTimeout: 60_000,
};

const EMAIL_API = {
  token: process.env.EMAIL_TOKEN || "EYwehAt4hem2MYcAT3C8q0cyqogICol8",
  site: "subito.it",
  domain: process.env.EMAIL_DOMAIN || "hotmail",
  baseUrl: "https://api.anymessage.shop",
  pollInterval: 5_000,
  pollMaxAttempts: 60,
};

// ─── SMS PROVIDER: "simsms" или "spanch" ───────────────────────────────────────

// Выбор провайдера SMS: SMS_PROVIDER=simsms или SMS_PROVIDER=spanch
let smsProvider: "simsms" | "spanch" = (process.env.SMS_PROVIDER as any) || "simsms";

// SimSms.org
const SIMSMS_API = {
  apiKey: process.env.SMS_API_KEY || "9Ncl1ZP4bpb5lIJQoZDEMPu42m0jw5",
  service: "opt146",       // subito.it = opt146
  country: "IT",
  baseUrl: "https://simsms.org/priemnik.php",
  pollInterval: 10_000,
  pollMaxAttempts: 60,
  minBalance: 1.0,
};

// Spanch SMS — настраиваемый через Telegram
const SPANCH_API = {
  apiKey: process.env.SPANCH_API_KEY || "Joel-4667:zR08lv8u",
  service: process.env.SPANCH_SERVICE || "subito",
  country: process.env.SPANCH_COUNTRY || "it",
  gateway: process.env.SPANCH_GATEWAY || "sandy",
  route: process.env.SPANCH_ROUTE || "",
  operator: process.env.SPANCH_OPERATOR || "",
  baseUrl: "https://spanch-projects.com/api",
  pollInterval: 5_000,
  pollMaxAttempts: 60,
  minBalance: 1.0,
};

// ─── STATE ─────────────────────────────────────────────────────────────────────

let successCount = 0;
let failCount = 0;
let isRunning = false;
let shouldStop = false;
let lastUpdateId = 0;

// ─── TELEGRAM BOT ──────────────────────────────────────────────────────────────

async function tgSendMessage(text: string): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "HTML" }),
    });
    const data = await res.text();
    console.log(`  📨  TG: ${res.status} | ${data.substring(0, 120)}`);
  } catch (err) {
    console.log(`  ⚠️  TG sendMessage error: ${err}`);
  }
}

async function tgSendFile(filePath: string, caption: string): Promise<void> {
  try {
    const fileData = await fs.readFile(filePath);
    const fileName = path.basename(filePath);
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);

    let body = "";
    body += `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;

    const prefix = Buffer.from(body, "utf-8");
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
    const fullBody = Buffer.concat([prefix, fileData, suffix]);

    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: fullBody,
    });
    console.log(`  📨  TG file: ${res.status}`);
  } catch (err) {
    console.log(`  ⚠️  TG sendFile error: ${err}`);
  }
}

async function tgSendCookiesArchive(): Promise<void> {
  try {
    const archiveName = `cookies_archive_${Date.now()}.tar`;
    try {
      execSync(`tar -cf ${archiveName} -C ${CONFIG.cookiesDir} .`, { stdio: "ignore" });
    } catch {
      try {
        const zipName = archiveName.replace(".tar", ".zip");
        execSync(`powershell -Command "Compress-Archive -Path '${CONFIG.cookiesDir}\\*' -DestinationPath '${zipName}' -Force"`, { stdio: "ignore" });
        await tgSendFile(zipName, `📦 Архив куки (${successCount} аккаунтов)`);
        try { await fs.unlink(zipName); } catch {}
        return;
      } catch {
        console.log("  ⚠️  Не удалось создать архив");
        return;
      }
    }
    await tgSendFile(archiveName, `📦 Архив куки (${successCount} аккаунтов)`);
    try { await fs.unlink(archiveName); } catch {}
  } catch (err) {
    console.log(`  ⚠️  TG archive error: ${err}`);
  }
}

// ─── TELEGRAM COMMAND POLLING ──────────────────────────────────────────────────

async function tgDeleteWebhook(): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/deleteWebhook?drop_pending_updates=false`;
    const res = await fetch(url, { method: "GET" });
    const data = (await res.json()) as any;
    console.log(`  🔗  deleteWebhook: ${data.ok ? "OK" : data.description}`);
  } catch (err) {
    console.log(`  ⚠️  deleteWebhook error: ${err}`);
  }
}

function getSmsStatusText(): string {
  if (smsProvider === "spanch") {
    let s = `Spanch (${SPANCH_API.gateway}, ${SPANCH_API.country})`;
    if (SPANCH_API.route) s += ` route=${SPANCH_API.route}`;
    if (SPANCH_API.operator) s += ` op=${SPANCH_API.operator}`;
    return s;
  }
  return `SimSms (${SIMSMS_API.service}, ${SIMSMS_API.country})`;
}

async function tgPollUpdates(): Promise<void> {
  await tgDeleteWebhook();
  await sleep(1_000);

  while (true) {
    try {
      const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10&allowed_updates=["message"]`;
      const res = await fetch(url, { method: "GET" });
      const data = (await res.json()) as any;

      if (!data.ok) {
        console.log(`  ⚠️  TG poll: ${data.error_code} ${data.description}`);
        if (data.error_code === 409) {
          console.log("  🔄  Конфликт — удаляю webhook и жду…");
          await tgDeleteWebhook();
          await sleep(3_000);
        }
        await sleep(2_000);
        continue;
      }

      if (data.ok && data.result && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;

          const msg = update.message;
          if (!msg || !msg.text) continue;

          const chatId = String(msg.chat.id);
          if (chatId !== TG_CHAT_ID) continue;

          const rawText = msg.text.trim();
          // Убираем @botname, но сохраняем регистр для параметров
          const textLower = rawText.toLowerCase().replace(/@\S+/g, "").trim();
          const textClean = rawText.replace(/@\S+/g, "").trim();
          console.log(`  📩  TG команда: "${rawText}" от ${msg.from?.username || msg.from?.id}`);

          // ─── /start ───
          if (textLower === "/start" || textLower === "start" || textLower === "старт") {
            if (isRunning) {
              await tgSendMessage("⚠️ Процесс уже запущен!\n\n/stop — остановить");
            } else {
              shouldStop = false;
              await tgSendMessage("▶️ <b>Запускаю регистрацию…</b>");
              registrationLoop().catch(async (err) => {
                console.error("💥 Ошибка в цикле:", err);
                isRunning = false;
                await tgSendMessage(`💥 <b>Цикл упал!</b>\n\n<code>${err.message?.substring(0, 500) || err}</code>`);
              });
            }
          }

          // ─── /stop ───
          else if (textLower === "/stop" || textLower === "stop" || textLower === "стоп") {
            if (!isRunning) {
              await tgSendMessage("ℹ️ Процесс не запущен.\n\n/start — запустить");
            } else {
              shouldStop = true;
              await tgSendMessage("⏸ <b>Останавливаю…</b> Дождитесь завершения текущей итерации.");
            }
          }

          // ─── /status ───
          else if (textLower === "/status" || textLower === "status" || textLower === "статус") {
            const allP = await loadProxies();
            const usedP = await loadUsedProxies();
            const remaining = allP.filter((p) => !usedP.includes(p.raw)).length;

            let smsBalStr = "?";
            try { const b = await smsCheckBalance(); smsBalStr = `$${b}`; } catch {}

            let emailBalStr = "?";
            try { emailBalStr = await emailCheckBalance(); } catch {}

            await tgSendMessage(
              `📊 <b>Статус</b>\n\n` +
              `${isRunning ? "▶️ Работает" : "⏹ Остановлен"}\n` +
              `✅ Успешных: ${successCount}\n` +
              `❌ Ошибок: ${failCount}\n` +
              `📋 Прокси: ${remaining}/${allP.length}\n` +
              `💰 SMS: ${smsBalStr}\n` +
              `💰 Email: ${emailBalStr}\n` +
              `📱 SMS: ${getSmsStatusText()}\n` +
              `⏱ ${new Date().toLocaleString()}`
            );
          }

          // ─── /sms — переключение провайдера ───
          else if (textLower === "/sms" || textLower === "sms") {
            await tgSendMessage(
              `📱 <b>SMS провайдер: ${smsProvider}</b>\n\n` +
              `<b>Команды:</b>\n` +
              `/sms_simsms — переключить на SimSms.org\n` +
              `/sms_spanch — переключить на Spanch SMS\n\n` +
              `<b>Настройки Spanch:</b>\n` +
              `/spanch_gateway sandy — шлюз\n` +
              `/spanch_country it — страна\n` +
              `/spanch_route CQY — маршрут\n` +
              `/spanch_operator vodafone — оператор\n\n` +
              `<b>Текущие настройки Spanch:</b>\n` +
              `🔌 Шлюз: <code>${SPANCH_API.gateway}</code>\n` +
              `🌍 Страна: <code>${SPANCH_API.country}</code>\n` +
              `🛤 Route: <code>${SPANCH_API.route || "—"}</code>\n` +
              `📡 Оператор: <code>${SPANCH_API.operator || "—"}</code>\n` +
              `🔑 API Key: <code>${SPANCH_API.apiKey.substring(0, 15)}…</code>`
            );
          }

          // ─── /sms_simsms ───
          else if (textLower === "/sms_simsms" || textLower === "sms_simsms") {
            smsProvider = "simsms";
            await tgSendMessage(`✅ SMS провайдер: <b>SimSms.org</b>\n\nService: ${SIMSMS_API.service}\nCountry: ${SIMSMS_API.country}`);
          }

          // ─── /sms_spanch ───
          else if (textLower === "/sms_spanch" || textLower === "sms_spanch") {
            smsProvider = "spanch";
            await tgSendMessage(
              `✅ SMS провайдер: <b>Spanch SMS</b>\n\n` +
              `🔌 Шлюз: ${SPANCH_API.gateway}\n` +
              `🌍 Страна: ${SPANCH_API.country}\n` +
              `🛤 Route: ${SPANCH_API.route || "—"}\n` +
              `📡 Оператор: ${SPANCH_API.operator || "—"}`
            );
          }

          // ─── /spanch_gateway <value> ───
          else if (textLower.startsWith("/spanch_gateway") || textLower.startsWith("spanch_gateway")) {
            const parts = textClean.split(/\s+/);
            const val = parts[1] || "";
            if (!val) {
              await tgSendMessage(`🔌 Текущий шлюз: <code>${SPANCH_API.gateway}</code>\n\nИспользуй: /spanch_gateway sandy`);
            } else {
              SPANCH_API.gateway = val;
              await tgSendMessage(`✅ Шлюз Spanch: <b>${val}</b>`);
            }
          }

          // ─── /spanch_country <value> ───
          else if (textLower.startsWith("/spanch_country") || textLower.startsWith("spanch_country")) {
            const parts = textClean.split(/\s+/);
            const val = parts[1] || "";
            if (!val) {
              await tgSendMessage(`🌍 Текущая страна: <code>${SPANCH_API.country}</code>\n\nИспользуй: /spanch_country it`);
            } else {
              SPANCH_API.country = val.toLowerCase();
              await tgSendMessage(`✅ Страна Spanch: <b>${SPANCH_API.country}</b>`);
            }
          }

          // ─── /spanch_route <value> ───
          else if (textLower.startsWith("/spanch_route") || textLower.startsWith("spanch_route")) {
            const parts = textClean.split(/\s+/);
            const val = parts[1] || "";
            if (!val) {
              SPANCH_API.route = "";
              await tgSendMessage(`🛤 Route Spanch: <b>убран</b>\n\nИспользуй: /spanch_route CQY`);
            } else {
              SPANCH_API.route = val;
              await tgSendMessage(`✅ Route Spanch: <b>${val}</b>`);
            }
          }

          // ─── /spanch_operator <value> ───
          else if (textLower.startsWith("/spanch_operator") || textLower.startsWith("spanch_operator")) {
            const parts = textClean.split(/\s+/);
            const val = parts[1] || "";
            if (!val) {
              SPANCH_API.operator = "";
              await tgSendMessage(`📡 Оператор Spanch: <b>убран</b>\n\nИспользуй: /spanch_operator vodafone`);
            } else {
              SPANCH_API.operator = val;
              await tgSendMessage(`✅ Оператор Spanch: <b>${val}</b>`);
            }
          }

          // ─── /help ───
          else if (textLower === "/help" || textLower === "help" || textLower === "помощь") {
            await tgSendMessage(
              `🤖 <b>Команды бота</b>\n\n` +
              `<b>Управление:</b>\n` +
              `/start — запустить регистрацию\n` +
              `/stop — остановить регистрацию\n` +
              `/status — статус, балансы, прокси\n\n` +
              `<b>SMS провайдер:</b>\n` +
              `/sms — текущие настройки SMS\n` +
              `/sms_simsms — переключить на SimSms\n` +
              `/sms_spanch — переключить на Spanch\n\n` +
              `<b>Настройки Spanch:</b>\n` +
              `/spanch_gateway sandy\n` +
              `/spanch_country it\n` +
              `/spanch_route CQY\n` +
              `/spanch_operator vodafone\n\n` +
              `/help — эта справка`
            );
          }
        }
      }
    } catch (err) {
      console.log(`  ⚠️  TG poll error: ${err}`);
    }

    await sleep(1_000);
  }
}

// ─── ANTI-DETECT ───────────────────────────────────────────────────────────────

const SCREEN_PROFILES = [
  { width: 1920, height: 1080, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
  { width: 1366, height: 768, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" },
  { width: 1536, height: 864, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
  { width: 1440, height: 900, ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
  { width: 1280, height: 800, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.112 Safari/537.36" },
];

function getRandomProfile() {
  return SCREEN_PROFILES[Math.floor(Math.random() * SCREEN_PROFILES.length)];
}

// ─── PROXY ─────────────────────────────────────────────────────────────────────

interface ProxyInfo {
  host: string;
  port: string;
  username: string;
  password: string;
  raw: string;
}

function parseProxy(line: string): ProxyInfo | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const parts = trimmed.split(":");
  if (parts.length < 4) return null;
  return { host: parts[0], port: parts[1], username: parts[2], password: parts.slice(3).join(":"), raw: trimmed };
}

async function loadProxies(): Promise<ProxyInfo[]> {
  try {
    const content = await fs.readFile(CONFIG.proxyFile, "utf-8");
    return content.split("\n").map(parseProxy).filter(Boolean) as ProxyInfo[];
  } catch {
    console.error(`❌ Файл ${CONFIG.proxyFile} не найден!`);
    return [];
  }
}

async function loadUsedProxies(): Promise<string[]> {
  try { return JSON.parse(await fs.readFile(CONFIG.usedProxiesFile, "utf-8")); } catch { return []; }
}

async function markProxyUsed(proxy: ProxyInfo): Promise<void> {
  const used = await loadUsedProxies();
  if (!used.includes(proxy.raw)) {
    used.push(proxy.raw);
    await fs.writeFile(CONFIG.usedProxiesFile, JSON.stringify(used, null, 2), "utf-8");
  }
}

async function getAvailableProxies(): Promise<ProxyInfo[]> {
  const all = await loadProxies();
  const used = await loadUsedProxies();
  return all.filter((p) => !used.includes(p.raw));
}

async function getNextProxy(): Promise<ProxyInfo> {
  const available = await getAvailableProxies();
  if (available.length === 0) throw new Error("Все прокси использованы!");
  console.log(`  🔄  Прокси: ${available[0].host}:${available[0].port} (осталось: ${available.length - 1})`);
  return available[0];
}

function proxyToUrl(p: ProxyInfo): string { return `http://${p.username}:${p.password}@${p.host}:${p.port}`; }
function proxyToServer(p: ProxyInfo): string { return `${p.host}:${p.port}`; }

// ─── RANDOM DATA ───────────────────────────────────────────────────────────────

const NAMES_M = ["Marco","Luca","Alessandro","Giuseppe","Andrea","Francesco","Matteo","Lorenzo","Davide","Simone","Federico","Stefano","Antonio","Giovanni","Roberto","Fabio","Riccardo","Nicola","Daniele","Filippo"];
const NAMES_F = ["Maria","Giulia","Francesca","Sara","Valentina","Anna","Chiara","Laura","Martina","Alessia","Giorgia","Elena","Silvia","Federica","Elisa","Roberta","Monica","Paola","Claudia","Simona"];
const TOWNS = ["Roma","Milano","Napoli","Torino","Palermo","Genova","Bologna","Firenze","Bari","Catania","Venezia","Verona","Padova","Trieste","Brescia","Parma","Modena","Perugia","Cagliari","Rimini","Salerno","Bergamo","Pisa"];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(a: number, b: number): number { return Math.floor(Math.random() * (b - a + 1)) + a; }
function genSex(): "m" | "f" { return Math.random() > 0.5 ? "m" : "f"; }
function genName(s: "m" | "f"): string { return s === "m" ? rand(NAMES_M) : rand(NAMES_F); }
function genBirthdate(): string {
  const y = randInt(1974, 2004), m = randInt(1, 12), d = randInt(1, new Date(y, m, 0).getDate());
  return `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}/${y}`;
}
function genPassword(): string {
  const l = "abcdefghijklmnopqrstuvwxyz", u = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", d = "0123456789", sp = "!@#$%&*?";
  let p = l[randInt(0,25)] + u[randInt(0,25)] + d[randInt(0,9)] + sp[randInt(0,sp.length-1)];
  const all = l + u + d + sp;
  for (let i = 0; i < randInt(6,8); i++) p += all[randInt(0, all.length-1)];
  return p.split("").sort(() => Math.random() - 0.5).join("");
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const genAccountId = () => `account_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function ensureCookiesDir() {
  try { await fs.mkdir(CONFIG.cookiesDir, { recursive: true }); } catch {}
}

// ─── HUMAN-LIKE ────────────────────────────────────────────────────────────────

async function humanClick(page: Page, selector: string): Promise<void> {
  try {
    const el = await page.$(selector);
    if (!el) return;
    const box = await el.boundingBox();
    if (!box) {
      await page.evaluate(`(() => { const e = document.querySelector('${selector}'); if(e) e.click(); })()`);
      return;
    }
    const x = box.x + randInt(3, Math.max(4, Math.floor(box.width - 3)));
    const y = box.y + randInt(2, Math.max(3, Math.floor(box.height - 2)));
    await page.mouse.click(x, y, { delay: randInt(30, 80) });
  } catch {
    await page.evaluate(`(() => { const e = document.querySelector('${selector}'); if(e) e.click(); })()`);
  }
}

async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await humanClick(page, selector);
  await sleep(randInt(100, 300));
  for (const char of text) {
    await page.keyboard.type(char, { delay: 0 });
    await sleep(randInt(30, 90));
  }
}

async function scrollTo(page: Page, selector: string): Promise<void> {
  await page.evaluate(`(() => { const el = document.querySelector('${selector}'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); })()`);
  await sleep(randInt(200, 500));
}

// ─── PROXY CHECK ───────────────────────────────────────────────────────────────

async function checkProxyIP(proxy: ProxyInfo): Promise<string> {
  const agent = new HttpsProxyAgent(proxyToUrl(proxy));
  const res = await fetch("https://ipinfo.io/json", { method: "GET", agent });
  const data = (await res.json()) as Record<string, unknown>;
  const ip = (data.ip as string) || "unknown";
  console.log(`  🌐  Прокси IP: ${ip} (${data.country || "??"})`);
  return ip;
}

// ─── EMAIL API FUNCTIONS ───────────────────────────────────────────────────────

async function emailCheckBalance(): Promise<string> {
  const res = await fetch(`${EMAIL_API.baseUrl}/user/balance?token=${EMAIL_API.token}`);
  const d = (await res.json()) as any;
  if (d.status === "success") { console.log(`  💰  Email баланс: ${d.balance}`); return d.balance; }
  throw new Error(`Email balance: ${d.value}`);
}

async function emailOrder(): Promise<{ id: string; email: string }> {
  console.log(`  📧  Заказываю почту…`);
  const res = await fetch(`${EMAIL_API.baseUrl}/email/order?token=${EMAIL_API.token}&site=${EMAIL_API.site}&domain=${EMAIL_API.domain}`);
  const d = (await res.json()) as any;
  if (d.status === "success" && d.id && d.email) { console.log(`  ✅  Почта: ${d.email}`); return { id: d.id, email: d.email }; }
  throw new Error(`Email order: ${d.value || "unknown"}`);
}

async function emailWaitMessage(id: string): Promise<{ value: string; message: string }> {
  console.log(`  ⏳  Жду письмо…`);
  for (let i = 1; i <= EMAIL_API.pollMaxAttempts; i++) {
    const res = await fetch(`${EMAIL_API.baseUrl}/email/getmessage?token=${EMAIL_API.token}&id=${id}`);
    const d = (await res.json()) as any;
    if (d.status === "success" && d.value) { console.log(`  📬  Письмо получено!`); return { value: d.value, message: d.message || "" }; }
    if (d.status === "error" && d.value === "wait message") { if (i % 6 === 0) console.log(`  ⏳  Ещё жду… (${i}/${EMAIL_API.pollMaxAttempts})`); await sleep(EMAIL_API.pollInterval); continue; }
    throw new Error(`Email getMessage: ${d.value}`);
  }
  throw new Error("Email: таймаут");
}

async function emailCancel(id: string): Promise<void> {
  await fetch(`${EMAIL_API.baseUrl}/email/cancel?token=${EMAIL_API.token}&id=${id}`);
  console.log(`  ❌  Почта отменена`);
}

// ─── SMS UNIFIED INTERFACE ─────────────────────────────────────────────────────
// Единый интерфейс для обоих провайдеров

async function smsCheckBalance(): Promise<number> {
  if (smsProvider === "spanch") return spanchCheckBalance();
  return simsmsCheckBalance();
}

async function smsGetNumber(): Promise<{ id: number; phone: string }> {
  if (smsProvider === "spanch") return spanchGetNumber();
  return simsmsGetNumber();
}

async function smsWaitCode(id: number): Promise<string> {
  if (smsProvider === "spanch") return spanchWaitCode(id);
  return simsmsWaitCode(id);
}

async function smsCancel(id: number): Promise<void> {
  if (smsProvider === "spanch") return spanchCancel(id);
  return simsmsCancel(id);
}

function smsMinBalance(): number {
  if (smsProvider === "spanch") return SPANCH_API.minBalance;
  return SIMSMS_API.minBalance;
}

// ─── SIMSMS.ORG ────────────────────────────────────────────────────────────────

async function simsmsCheckBalance(): Promise<number> {
  const url = `${SIMSMS_API.baseUrl}?metod=get_balance&service=${SIMSMS_API.service}&apikey=${SIMSMS_API.apiKey}`;
  const res = await fetch(url);
  const d = (await res.json()) as any;
  if (d.response === "1" && d.balance) {
    const b = Number(d.balance);
    console.log(`  💰  SimSms баланс: $${b}`);
    return b;
  }
  throw new Error(`SimSms balance: ${d.error_msg || JSON.stringify(d)}`);
}

async function simsmsGetNumber(): Promise<{ id: number; phone: string }> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`  📱  [SimSms] Заказываю номер… (попытка ${attempt}/${maxAttempts})`);
    try {
      const url = `${SIMSMS_API.baseUrl}?metod=get_number&country=${SIMSMS_API.country}&service=${SIMSMS_API.service}&apikey=${SIMSMS_API.apiKey}`;
      const res = await fetch(url);
      const d = (await res.json()) as any;

      if (d.response === "1" && d.number && d.id) {
        console.log(`  ✅  Номер: ${d.number} (ID: ${d.id})`);
        return { id: Number(d.id), phone: String(d.number) };
      }

      if (d.response === "2") {
        console.log(`  ⚠️  Номера заняты, повтор через 30с…`);
        if (attempt < maxAttempts) await sleep(30_000);
        continue;
      }

      console.log(`  ⚠️  Попытка ${attempt}: ${d.error_msg || JSON.stringify(d)}`);
    } catch (err) {
      console.log(`  ⚠️  Попытка ${attempt}: ${err}`);
    }
    if (attempt < maxAttempts) await sleep(5_000);
  }
  throw new Error("SimSms getNumber: все 5 попыток провалились");
}

async function simsmsWaitCode(id: number): Promise<string> {
  console.log(`  ⏳  [SimSms] Жду SMS… (макс ${Math.floor(SIMSMS_API.pollMaxAttempts * SIMSMS_API.pollInterval / 1000)}с)`);
  for (let i = 1; i <= SIMSMS_API.pollMaxAttempts; i++) {
    const url = `${SIMSMS_API.baseUrl}?metod=get_sms&country=${SIMSMS_API.country}&service=${SIMSMS_API.service}&id=${id}&apikey=${SIMSMS_API.apiKey}`;
    const res = await fetch(url);
    const d = (await res.json()) as any;

    if ((d.response === "1" || d.response === "4") && d.sms) {
      console.log(`  📲  SMS код: ${d.sms}`);
      return String(d.sms);
    }

    if (d.response === "2") {
      if (i % 3 === 0) console.log(`  ⏳  Жду SMS… (${i}/${SIMSMS_API.pollMaxAttempts})`);
      await sleep(SIMSMS_API.pollInterval);
      continue;
    }

    if (d.response === "3") {
      throw new Error("SimSms: нет SMS или истёк срок (response=3)");
    }

    await sleep(SIMSMS_API.pollInterval);
  }
  throw new Error("SimSms: таймаут ожидания кода");
}

async function simsmsCancel(id: number): Promise<void> {
  const url = `${SIMSMS_API.baseUrl}?metod=denial&country=${SIMSMS_API.country}&service=${SIMSMS_API.service}&id=${id}&apikey=${SIMSMS_API.apiKey}`;
  await fetch(url);
  console.log(`  ❌  SimSms номер отменён (ID: ${id})`);
}

async function simsmsBan(id: number): Promise<void> {
  const url = `${SIMSMS_API.baseUrl}?metod=ban&service=${SIMSMS_API.service}&apikey=${SIMSMS_API.apiKey}&id=${id}`;
  await fetch(url);
  console.log(`  🚫  SimSms номер забанен (ID: ${id})`);
}

// ─── SPANCH SMS ────────────────────────────────────────────────────────────────

async function spanchCheckBalance(): Promise<number> {
  const url = `${SPANCH_API.baseUrl}?api_key=${SPANCH_API.apiKey}&action=getBalance`;
  const res = await fetch(url);
  const d = (await res.json()) as any;
  if (d.status === "success" && d.message !== undefined) {
    const b = Number(d.message);
    console.log(`  💰  Spanch баланс: $${b}`);
    return b;
  }
  throw new Error(`Spanch balance: ${d.message || JSON.stringify(d)}`);
}

async function spanchGetNumber(): Promise<{ id: number; phone: string }> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`  📱  [Spanch] Заказываю номер… (попытка ${attempt}/${maxAttempts}) gw=${SPANCH_API.gateway} country=${SPANCH_API.country}`);
    try {
      let url = `${SPANCH_API.baseUrl}?api_key=${SPANCH_API.apiKey}&action=getNumber&service=${SPANCH_API.service}&country=${SPANCH_API.country}&gateway=${SPANCH_API.gateway}`;
      if (SPANCH_API.route) url += `&route=${SPANCH_API.route}`;
      if (SPANCH_API.operator) url += `&operator=${SPANCH_API.operator}`;

      const res = await fetch(url);
      const d = (await res.json()) as any;

      if (d.status === "success" && d.id && d.phone) {
        console.log(`  ✅  Номер: ${d.phone} (ID: ${d.id}, цена: $${d.price || "?"})`);
        return { id: Number(d.id), phone: String(d.phone) };
      }

      console.log(`  ⚠️  Попытка ${attempt}: ${d.message || JSON.stringify(d)}`);
    } catch (err) {
      console.log(`  ⚠️  Попытка ${attempt}: ${err}`);
    }
    if (attempt < maxAttempts) await sleep(5_000);
  }
  throw new Error("Spanch getNumber: все 5 попыток провалились");
}

async function spanchWaitCode(id: number): Promise<string> {
  console.log(`  ⏳  [Spanch] Жду SMS… (макс ${Math.floor(SPANCH_API.pollMaxAttempts * SPANCH_API.pollInterval / 1000)}с)`);
  for (let i = 1; i <= SPANCH_API.pollMaxAttempts; i++) {
    const url = `${SPANCH_API.baseUrl}?api_key=${SPANCH_API.apiKey}&action=getCode&id=${id}`;
    const res = await fetch(url);
    const d = (await res.json()) as any;

    if (d.status === "success" && d.code) {
      console.log(`  📲  SMS код: ${d.code}`);
      return String(d.code);
    }

    // Ждём
    if (d.status === "success" && d.message === "wait") {
      if (i % 3 === 0) console.log(`  ⏳  Жду SMS… (${i}/${SPANCH_API.pollMaxAttempts})`);
      await sleep(SPANCH_API.pollInterval);
      continue;
    }

    // Ошибка
    if (d.status === "error") {
      if (d.message === "This number is no longer active") {
        throw new Error("Spanch: номер больше не активен");
      }
      console.log(`  ⚠️  Spanch getCode: ${d.message}`);
    }

    await sleep(SPANCH_API.pollInterval);
  }
  throw new Error("Spanch: таймаут ожидания кода");
}

async function spanchCancel(id: number): Promise<void> {
  const url = `${SPANCH_API.baseUrl}?api_key=${SPANCH_API.apiKey}&action=getCancel&id=${id}`;
  await fetch(url);
  console.log(`  ❌  Spanch номер отменён (ID: ${id})`);
}

// ─── COOKIES & ACCOUNTS ────────────────────────────────────────────────────────

async function saveCookies(page: Page, email: string): Promise<string> {
  const cookies = await page.cookies();
  const safeName = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
  const filePath = path.join(CONFIG.cookiesDir, `${safeName}.json`);
  await fs.writeFile(filePath, JSON.stringify(cookies, null, 2), "utf-8");
  console.log(`  💾  Куки → ${filePath}`);
  return filePath;
}

async function saveAccountData(data: Record<string, string>): Promise<void> {
  let accounts: any[] = [];
  try { accounts = JSON.parse(await fs.readFile(CONFIG.accountsFile, "utf-8")); } catch {}
  accounts.push(data);
  await fs.writeFile(CONFIG.accountsFile, JSON.stringify(accounts, null, 2), "utf-8");
}

// ─── BROWSER FACTORY ───────────────────────────────────────────────────────────

async function createBrowser(proxy: ProxyInfo): Promise<Browser> {
  const profile = getRandomProfile();
  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    args: [
      `--proxy-server=${proxyToServer(proxy)}`,
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      `--window-size=${profile.width},${profile.height}`,
      "--disable-dev-shm-usage", "--lang=it-IT,it,en-US,en",
    ],
  });
  (browser as any).__profile = profile;
  return browser;
}

async function createPage(browser: Browser, proxy: ProxyInfo): Promise<Page> {
  const profile = (browser as any).__profile || getRandomProfile();
  const page = await browser.newPage();
  await page.authenticate({ username: proxy.username, password: proxy.password });
  await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: 1 });
  await page.setUserAgent(profile.ua);
  await page.setExtraHTTPHeaders({ "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7" });
  page.setDefaultNavigationTimeout(CONFIG.navigationTimeout);

  await page.evaluateOnNewDocument(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'language', { get: () => 'it-IT' });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const a = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        a.refresh = () => {}; a.item = (i) => a[i]; a.namedItem = (n) => a.find(p => p.name === n);
        return a;
      }
    });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${randInt(4, 16)} });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => ${rand([4, 8, 16])} });
    window.chrome = { runtime: {} };
    const gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return gp.call(this, p);
    };
  `);

  return page;
}

async function createStealthPage(browser: Browser, proxy: ProxyInfo): Promise<Page> {
  const profile = (browser as any).__profile || getRandomProfile();
  const p = await browser.newPage();
  await p.authenticate({ username: proxy.username, password: proxy.password });
  await p.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: 1 });
  await p.setUserAgent(profile.ua);
  await p.setExtraHTTPHeaders({ "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7" });
  p.setDefaultNavigationTimeout(CONFIG.navigationTimeout);
  await p.evaluateOnNewDocument(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });
    window.chrome = { runtime: {} };
  `);
  return p;
}

// ─── REGISTRATION STEPS ────────────────────────────────────────────────────────

async function stepNavigate(page: Page): Promise<void> {
  console.log("  ➡️  Шаг 1: Открытие сайта…");
  await page.goto(CONFIG.targetUrl, { waitUntil: "networkidle2" });
  await sleep(randInt(2000, 3000));
}

async function stepAcceptCookies(page: Page): Promise<void> {
  console.log("  🍪  Шаг 2: Cookie-баннер…");
  try {
    await page.waitForSelector("#didomi-notice-agree-button", { timeout: 10_000 });
    await sleep(randInt(500, 1500));
    await humanClick(page, "#didomi-notice-agree-button");
    console.log("  ✅  Куки приняты");
    await sleep(randInt(500, 1000));
  } catch { console.log("  ℹ️  Баннер не найден"); }
}

async function stepGoToRegister(page: Page): Promise<void> {
  console.log("  ➡️  Шаг 3: Переход на регистрацию…");
  try {
    const link = await page.waitForSelector('a[href="https://areariservata.subito.it/form"]', { timeout: 10_000 });
    if (link) { await link.click(); console.log("  ✅  Клик «Registrati»"); }
  } catch {
    console.log("  ⚠️  Ссылка не найдена, переход по URL…");
    await page.goto(CONFIG.registerUrl, { waitUntil: "networkidle2" });
  }
  await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});
  await sleep(randInt(1000, 2000));
  console.log(`  📍  URL: ${page.url()}`);
}

async function stepFillForm(page: Page, email: string): Promise<{ name: string; password: string; birthdate: string; sex: string; town: string }> {
  console.log("  ✏️  Шаг 4: Заполнение формы…");
  await page.waitForSelector("#name", { timeout: 15_000 });
  await sleep(randInt(500, 1000));

  const sex = genSex();
  const name = genName(sex);
  const password = genPassword();
  const birthdate = genBirthdate();
  const town = rand(TOWNS);

  console.log(`     ${name} | ${email} | ${password} | ${birthdate} | ${sex} | ${town}`);

  // Имя
  await scrollTo(page, "#name");
  await humanType(page, "#name", name);
  await sleep(randInt(200, 500));

  // Email
  await scrollTo(page, "#username");
  await humanType(page, "#username", email);
  await sleep(randInt(200, 500));

  // Пароль
  await scrollTo(page, "#password");
  await humanType(page, "#password", password);
  await sleep(randInt(200, 500));

  // Дата рождения
  await scrollTo(page, "#birthdate");
  await humanType(page, "#birthdate", birthdate);
  await sleep(randInt(200, 500));

  // Пол
  const sexLabel = sex === "m" ? "Maschio" : "Femmina";
  await page.evaluate(`(() => {
    const labels = document.querySelectorAll('label');
    for (const l of labels) { if (l.getAttribute('aria-label') === '${sexLabel}') { l.click(); return; } }
    const inp = document.querySelector('input[name="sex"][value="${sex}"]');
    if (inp) inp.click();
  })()`);
  await sleep(randInt(200, 400));

  // Город
  await scrollTo(page, "#town");
  await humanClick(page, "#town");
  await sleep(200);
  await page.click("#town", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await sleep(200);
  for (const c of town) { await page.keyboard.type(c, { delay: 0 }); await sleep(randInt(30, 80)); }
  await sleep(randInt(1500, 2500));
  try {
    const opt = await page.waitForSelector('#autocomplete-town-menu li, #autocomplete-town-menu [role="option"]', { timeout: 4_000 });
    if (opt) { await sleep(randInt(300, 600)); await opt.click(); console.log("  ✅  Город выбран"); }
  } catch { console.log("  ⚠️  Autocomplete не появился"); }
  await sleep(randInt(200, 500));

  // Чекбоксы
  await page.evaluate(`(() => { const b = document.querySelector("#tosSubito"); if (b) b.click(); })()`);
  await sleep(randInt(150, 300));
  await page.evaluate(`(() => { const b = document.querySelector("#tosCommercial"); if (b) b.click(); })()`);
  await sleep(randInt(150, 300));
  await page.evaluate(`(() => { const b = document.querySelector("#tosBehaviour"); if (b) b.click(); })()`);
  await sleep(randInt(300, 700));

  console.log("  ✅  Форма заполнена!");
  return { name, password, birthdate, sex, town };
}

async function stepSubmitForm(page: Page): Promise<void> {
  console.log("  📤  Шаг 5: Отправка формы…");
  await scrollTo(page, 'button[type="submit"]');
  await sleep(randInt(300, 600));
  await page.evaluate(`(() => {
    const btns = document.querySelectorAll('button[type="submit"]');
    for (const b of btns) { if (b.textContent && b.textContent.trim() === 'Registrati') { b.click(); return; } }
    if (btns.length > 0) btns[0].click();
  })()`);
  console.log("  ✅  «Registrati» нажата!");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
  await sleep(randInt(1500, 3000));
  console.log(`  📍  URL: ${page.url()}`);
}

async function stepVerifyEmail(page: Page, browser: Browser, proxy: ProxyInfo, activationId: string): Promise<Page> {
  console.log("  📧  Шаг 6: Верификация email…");

  const { value, message: html } = await emailWaitMessage(activationId);

  let verifyUrl: string | null = null;

  // value — чистый URL?
  if (value.startsWith("http://") || value.startsWith("https://")) {
    verifyUrl = value;
    console.log("  🔗  API вернул URL");
  }

  // Если нет — ищем в HTML
  if (!verifyUrl) {
    const m = html.match(/href=["'](https?:\/\/[^"']*(?:verify|confirm|activate|verifica|token)[^"']*)/i)
      || html.match(/href=["'](https?:\/\/[^"']*subito\.it[^"']*)/i);
    if (m) { verifyUrl = m[1].replace(/&amp;/g, "&"); console.log("  🔗  URL из HTML"); }
  }

  if (!verifyUrl) { console.log("  ⚠️  Ссылка не найдена"); return page; }

  // Новая вкладка
  console.log("  🆕  Открываю в новой вкладке…");
  const newPage = await createStealthPage(browser, proxy);
  await newPage.goto(verifyUrl, { waitUntil: "networkidle2" });
  await sleep(randInt(2000, 3000));
  console.log(`  📍  URL: ${newPage.url()}`);

  // Cookie-баннер
  try {
    await newPage.waitForSelector("#didomi-notice-agree-button", { timeout: 3_000 });
    await humanClick(newPage, "#didomi-notice-agree-button");
    await sleep(1000);
  } catch {}

  await sleep(randInt(1000, 2000));
  console.log("  ✅  Email верифицирован!");

  // Проверяем кнопку телефона
  const hasPhone = await newPage.evaluate(`(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) { if (b.textContent && b.textContent.includes('Verifica il tuo numero')) return true; }
    return false;
  })()`) as boolean;

  if (hasPhone) { console.log("  📱  Кнопка «Verifica il tuo numero» найдена!"); return newPage; }
  await newPage.close();
  return page;
}

async function stepVerifyPhone(page: Page): Promise<{ phone: string; smsActivationId: number; userId: string; token: string }> {
  console.log("  📱  Шаг 7: Верификация телефона (UI flow)…");

  // Извлечение token и user-id из URL
  const currentUrl = page.url();
  let token: string | null = null;
  let userId: string | null = null;

  try {
    const u = new URL(currentUrl);
    token = u.searchParams.get("token");
    userId = u.searchParams.get("user-id");
  } catch {}

  if (!token || !userId) {
    const pd = await page.evaluate(`(() => {
      try { const p = new URLSearchParams(window.location.search); return { token: p.get('token'), userId: p.get('user-id') }; }
      catch(e) { return { token: null, userId: null }; }
    })()`) as any;
    token = pd?.token || token;
    userId = pd?.userId || userId;
  }

  if (!token || !userId) throw new Error("Не удалось извлечь token/user-id");

  console.log(`  👤  User ID: ${userId}`);
  console.log(`  🔑  Token: ${token.substring(0, 40)}…`);

  // Проверяем баланс SMS перед заказом номера
  const smsBalance = await smsCheckBalance();
  if (smsBalance < smsMinBalance()) {
    const msg = `💸 <b>SMS баланс ниже $${smsMinBalance()}!</b>\n\nПровайдер: ${smsProvider}\nТекущий: $${smsBalance}\n\n⏹ Процесс остановлен.\n✅ ${successCount} | ❌ ${failCount}`;
    console.log(`  💸  SMS баланс $${smsBalance} < $${smsMinBalance()} — СТОП!`);
    await tgSendMessage(msg);
    shouldStop = true;
    throw new Error(`SMS баланс $${smsBalance} < $${smsMinBalance()}`);
  }

  // ─── 7.1: Клик «Verifica il tuo numero» ───────────────────────────
  console.log("  📱  7.1: Клик «Verifica il tuo numero»…");
  await sleep(randInt(1000, 2000));

  const clickedVerifica = await page.evaluate(`(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent && b.textContent.trim().includes('Verifica il tuo numero')) {
        b.click();
        return true;
      }
    }
    return false;
  })()`) as boolean;

  if (clickedVerifica) {
    console.log("  ✅  Кнопка «Verifica il tuo numero» нажата!");
  } else {
    console.log("  ⚠️  Кнопка не найдена, пробую продолжить…");
  }

  await sleep(randInt(2000, 3000));

  // ─── 7.2: Заказ номера ─────────────────────────────────────────────
  const smsData = await smsGetNumber();
  const smsActivationId = smsData.id;
  let phoneForInput = smsData.phone;
  // Убираем код страны 39 для ввода в поле
  if (phoneForInput.startsWith("39") && phoneForInput.length > 10) {
    phoneForInput = phoneForInput.substring(2);
  }
  console.log(`  📱  Номер для ввода: ${phoneForInput}`);

  // ─── 7.3: Ввод номера в поле #phone-number ────────────────────────
  console.log("  ✏️  7.3: Ввод номера…");

  try {
    await page.waitForSelector("#phone-number", { timeout: 10_000 });
  } catch {
    console.log("  ⚠️  Поле #phone-number не найдено, жду ещё…");
    await sleep(3_000);
    await page.waitForSelector("#phone-number", { timeout: 10_000 });
  }

  await scrollTo(page, "#phone-number");
  await humanClick(page, "#phone-number");
  await sleep(randInt(200, 400));

  // Очищаем поле
  await page.click("#phone-number", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await sleep(200);

  // Вводим номер посимвольно
  for (const char of phoneForInput) {
    await page.keyboard.type(char, { delay: 0 });
    await sleep(randInt(30, 80));
  }
  console.log(`  ✅  Номер введён: ${phoneForInput}`);
  await sleep(randInt(500, 1000));

  // ─── 7.4: Клик «Conferma» ─────────────────────────────────────────
  console.log("  📤  7.4: Клик «Conferma»…");
  await sleep(randInt(300, 600));

  const clickedConferma = await page.evaluate(`(() => {
    // Сначала ищем кнопку с form="verify-form"
    const submitBtn = document.querySelector('button[type="submit"][form="verify-form"]');
    if (submitBtn) { submitBtn.click(); return 'verify-form'; }
    // Ищем по тексту
    const btns = document.querySelectorAll('button[type="submit"], button');
    for (const b of btns) {
      const txt = (b.textContent || '').trim().toLowerCase();
      if (txt === 'conferma' || txt === 'invia' || txt === 'verifica' || txt === 'continua' || txt === 'invia codice') {
        b.click();
        return txt;
      }
    }
    return null;
  })()`) as string | null;

  if (clickedConferma) {
    console.log(`  ✅  Кнопка «${clickedConferma}» нажата — SMS отправлена!`);
  } else {
    console.log("  ⚠️  Кнопка Conferma не найдена");
  }

  // Ждём пока страница обработает
  await sleep(randInt(2000, 4000));

  // ─── 7.5: Ожидание SMS кода ────────────────────────────────────────
  console.log("  ⏳  7.5: Жду SMS код…");
  const smsCode = await smsWaitCode(smsActivationId);
  console.log(`  📲  SMS код получен: ${smsCode}`);

  // ─── 7.6: Ввод OTP кода ───────────────────────────────────────────
  console.log("  ✏️  7.6: Ввод OTP кода…");
  await sleep(randInt(500, 1000));

  // Проверяем: одно поле OTP или несколько полей по 1 цифре
  const otpInputType = await page.evaluate(`(() => {
    // Одно поле для всего кода
    const single = document.querySelector('input[name="otp"], input[id="otp"], input[name="code"], input[id="code"], input[name="verification-code"], input[autocomplete="one-time-code"]');
    if (single) return 'single';
    // Несколько полей по 1 цифре
    const multi = document.querySelectorAll('input[maxlength="1"]');
    if (multi.length >= 4) return 'multi-' + multi.length;
    // Может быть одно поле с другим селектором
    const anyInput = document.querySelector('input[inputmode="numeric"][maxlength="6"], input[inputmode="numeric"][maxlength="4"]');
    if (anyInput) return 'single-numeric';
    return 'unknown';
  })()`) as string;

  console.log(`  📋  OTP тип: ${otpInputType}`);

  if (otpInputType === 'single' || otpInputType === 'single-numeric') {
    // Одно поле — вводим весь код
    const selector = otpInputType === 'single'
      ? 'input[name="otp"], input[id="otp"], input[name="code"], input[id="code"], input[name="verification-code"], input[autocomplete="one-time-code"]'
      : 'input[inputmode="numeric"][maxlength="6"], input[inputmode="numeric"][maxlength="4"]';
    await humanClick(page, selector);
    await sleep(200);
    for (const char of smsCode) {
      await page.keyboard.type(char, { delay: 0 });
      await sleep(randInt(30, 80));
    }
    console.log("  ✅  OTP введён (одно поле)");
  } else if (otpInputType.startsWith('multi-')) {
    // Несколько полей по 1 цифре
    const count = parseInt(otpInputType.split('-')[1]);
    for (let i = 0; i < Math.min(smsCode.length, count); i++) {
      await page.evaluate(`(() => {
        const inputs = document.querySelectorAll('input[maxlength="1"]');
        if (inputs[${i}]) {
          inputs[${i}].focus();
          inputs[${i}].value = '${smsCode[i]}';
          inputs[${i}].dispatchEvent(new Event('input', { bubbles: true }));
          inputs[${i}].dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`);
      await sleep(randInt(50, 150));
    }
    console.log(`  ✅  OTP введён (${count} полей)`);
  } else {
    // Неизвестный тип — пробуем API verify как fallback
    console.log("  ⚠️  OTP поля не найдены — пробую API verify…");

    const verifyBodyObj: Record<string, string> = {};
    verifyBodyObj.phone_number = phoneForInput;
    verifyBodyObj.idd_prefix = "+39";
    verifyBodyObj.otp = smsCode;
    const verifyBodyJson = JSON.stringify(verifyBodyObj);

    const verifyResult = await page.evaluate(`
      (async () => {
        try {
          const res = await fetch("https://hades.subito.it/v1/users/${userId}/phone-verification/verify", {
            method: "POST",
            headers: { "authorization": "Bearer ${token}", "content-type": "application/json" },
            body: '${verifyBodyJson.replace(/'/g, "\\'")}',
            credentials: "include"
          });
          const text = await res.text();
          return { status: res.status, body: text };
        } catch (err) { return { status: 0, body: err.toString() }; }
      })()
    `) as { status: number; body: string };

    console.log(`  📡  API Verify: ${verifyResult.status} | ${verifyResult.body.substring(0, 200)}`);

    if (verifyResult.status !== 200 && verifyResult.status !== 201 && verifyResult.status !== 204) {
      throw new Error(`Verify failed: ${verifyResult.status} ${verifyResult.body}`);
    }
    console.log("  ✅  Телефон верифицирован через API!");

    // Логин
    console.log("  🔐  Логин…");
    const loginBodyJson = JSON.stringify({ userId: userId, code: token });
    const loginResult = await page.evaluate(`
      (async () => {
        try {
          const res = await fetch("https://areariservata.subito.it/ceres/api/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '${loginBodyJson.replace(/'/g, "\\'")}',
            credentials: "include"
          });
          const text = await res.text();
          return { status: res.status, body: text };
        } catch (err) { return { status: 0, body: err.toString() }; }
      })()
    `) as { status: number; body: string };
    console.log(`  🔐  Login: ${loginResult.status}`);

    return { phone: smsData.phone, smsActivationId, userId: userId!, token: token! };
  }

  await sleep(randInt(500, 1000));

  // ─── 7.7: Клик «Conferma» для OTP ─────────────────────────────────
  console.log("  📤  7.7: Подтверждение OTP…");

  const clickedOtpConfirm = await page.evaluate(`(() => {
    const btns = document.querySelectorAll('button[type="submit"], button');
    for (const b of btns) {
      const txt = (b.textContent || '').trim().toLowerCase();
      if (txt === 'conferma' || txt === 'verifica' || txt === 'continua' || txt === 'confirm') {
        b.click();
        return txt;
      }
    }
    // Если не нашли по тексту — жмём submit
    const sub = document.querySelector('button[type="submit"]');
    if (sub) { sub.click(); return 'submit'; }
    return null;
  })()`) as string | null;

  if (clickedOtpConfirm) {
    console.log(`  ✅  Кнопка «${clickedOtpConfirm}» нажата!`);
  } else {
    console.log("  ⚠️  Кнопка подтверждения OTP не найдена");
  }

  await sleep(randInt(3000, 5000));

  // Проверяем результат
  const pageUrl = page.url();
  const pageText = await page.evaluate(`document.body ? document.body.innerText.substring(0, 500) : ''`) as string;
  console.log(`  📍  URL после OTP: ${pageUrl}`);
  console.log(`  📄  Текст: ${pageText.substring(0, 200)}`);

  // Проверяем ошибки на странице
  const hasError = await page.evaluate(`(() => {
    const errorEls = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]');
    for (const el of errorEls) {
      const t = (el.textContent || '').trim();
      if (t.length > 3) return t;
    }
    return null;
  })()`) as string | null;

  if (hasError) {
    console.log(`  ⚠️  Ошибка на странице: ${hasError}`);
  }

  console.log("  ✅  Верификация телефона через UI завершена!");

  // ─── LOGIN ─────────────────────────────────────────────────────────
  console.log("  🔐  Логин…");
  const loginBodyJson = JSON.stringify({ userId: userId, code: token });

  const loginResult = await page.evaluate(`
    (async () => {
      try {
        const res = await fetch("https://areariservata.subito.it/ceres/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '${loginBodyJson.replace(/'/g, "\\'")}',
          credentials: "include"
        });
        const text = await res.text();
        return { status: res.status, body: text };
      } catch (err) { return { status: 0, body: err.toString() }; }
    })()
  `) as { status: number; body: string };

  console.log(`  🔐  Login: ${loginResult.status} | ${loginResult.body.substring(0, 200)}`);

  if (loginResult.status === 200 || loginResult.status === 201) {
    console.log("  ✅  Логин успешен!");
  } else {
    console.log(`  ⚠️  Логин: ${loginResult.status}`);
  }

  return { phone: smsData.phone, smsActivationId, userId: userId!, token: token! };
}

// ─── SINGLE REGISTRATION FLOW ─────────────────────────────────────────────────

async function performRegistration(): Promise<void> {
  const accountId = genAccountId();
  console.log(`\n🔵 Регистрация: ${accountId}`);

  let browser: Browser | null = null;
  let emailActivationId: string | null = null;
  let smsActivationId: number | null = null;

  // Ищем рабочую прокси
  let proxy: ProxyInfo | null = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    let candidate: ProxyInfo;
    try {
      candidate = await getNextProxy();
    } catch {
      // Все прокси кончились
      break;
    }
    try {
      await checkProxyIP(candidate);
      proxy = candidate;
      await markProxyUsed(candidate);
      break;
    } catch {
      console.log(`  ⚠️  Прокси ${candidate.host}:${candidate.port} не работает, пропускаю…`);
      await markProxyUsed(candidate);
    }
  }

  if (!proxy) {
    console.error("  ❌  Нет рабочих прокси!");
    await tgSendMessage(`❌ <b>Нет рабочих прокси!</b>\n\n✅ Успешных: ${successCount}\n❌ Ошибок: ${failCount}`);
    shouldStop = true;
    return;
  }

  try {
    // Проверка баланса SMS
    const smsBalance = await smsCheckBalance();
    if (smsBalance < smsMinBalance()) {
      const msg = `💸 <b>SMS баланс ниже $${smsMinBalance()}!</b>\n\nПровайдер: ${smsProvider}\nТекущий: $${smsBalance}\n⏹ Процесс остановлен.\n✅ ${successCount} | ❌ ${failCount}`;
      console.log(`  💸  SMS баланс $${smsBalance} < $${smsMinBalance()} — СТОП!`);
      await tgSendMessage(msg);
      shouldStop = true;
      return;
    }

    await emailCheckBalance();

    const emailData = await emailOrder();
    emailActivationId = emailData.id;
    const email = emailData.email;

    browser = await createBrowser(proxy);
    const page = await createPage(browser, proxy);

    await stepNavigate(page);
    await stepAcceptCookies(page);
    await stepGoToRegister(page);
    const formData = await stepFillForm(page, email);
    await stepSubmitForm(page);

    // Email верификация
    const activePage = await stepVerifyEmail(page, browser, proxy, emailActivationId);

    // Телефон + логин (ОБЯЗАТЕЛЬНЫЙ шаг)
    const phoneData = await stepVerifyPhone(activePage);
    smsActivationId = phoneData.smsActivationId;

    // Сохранение куки
    const cookiePath = await saveCookies(activePage, email);
    await saveAccountData({
      accountId, email,
      password: formData.password,
      name: formData.name,
      birthdate: formData.birthdate,
      sex: formData.sex,
      town: formData.town,
      phone: phoneData.phone || "",
      proxy: proxy.raw,
      smsProvider,
      createdAt: new Date().toISOString(),
    });

    successCount++;
    console.log(`🟢 Успех #${successCount}: ${email} | ${formData.password} | ${phoneData.phone}`);

    // TG: успех + куки
    const tgMsg = `✅ <b>Аккаунт #${successCount}</b>\n\n📧 <code>${email}</code>\n🔑 <code>${formData.password}</code>\n👤 ${formData.name} (${formData.sex})\n📅 ${formData.birthdate}\n🏙 ${formData.town}\n📱 ${phoneData.phone}\n🌐 ${proxy.host}:${proxy.port}\n📱 SMS: ${smsProvider}\n⏱ ${new Date().toLocaleString()}`;
    await tgSendMessage(tgMsg);
    await tgSendFile(cookiePath, `🍪 Куки: ${email}`);

    // Каждые 50 — архив
    if (successCount % 50 === 0) {
      console.log("  📦  Отправляю архив куки…");
      await tgSendCookiesArchive();
    }

  } catch (error) {
    failCount++;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`🔴 Ошибка ${accountId}: ${errMsg}`);

    if (emailActivationId) { try { await emailCancel(emailActivationId); } catch {} }
    if (smsActivationId) { try { await smsCancel(smsActivationId); } catch {} }

    // TG: ошибка
    await tgSendMessage(`❌ <b>Ошибка #${failCount}</b>\n\n🆔 ${accountId}\n🌐 ${proxy?.host || "—"}:${proxy?.port || "—"}\n📱 SMS: ${smsProvider}\n💬 <code>${errMsg.substring(0, 500)}</code>\n⏱ ${new Date().toLocaleString()}\n\n📊 Всего: ✅${successCount} ❌${failCount}`);

  } finally {
    if (browser) {
      await browser.close();
      console.log("  🔒  Браузер закрыт");
    }
  }
}

// ─── REGISTRATION LOOP (управляется командами) ─────────────────────────────────

async function registrationLoop(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  shouldStop = false;

  console.log("\n🟢 Цикл регистрации запущен!");

  await ensureCookiesDir();

  const allProxies = await loadProxies();
  const usedProxies = await loadUsedProxies();
  const available = allProxies.filter((p) => !usedProxies.includes(p.raw)).length;
  console.log(`📋 Прокси: ${allProxies.length} всего, ${usedProxies.length} исп., ${available} доступно`);

  if (available === 0) {
    await tgSendMessage(`❌ <b>Нет прокси!</b>\nДобавьте прокси в ${CONFIG.proxyFile} и /start`);
    isRunning = false;
    return;
  }

  await tgSendMessage(`▶️ <b>Регистрация запущена</b>\n\n📋 Прокси: ${available}\n📱 SMS: ${getSmsStatusText()}\n⏱ ${new Date().toLocaleString()}`);

  let iteration = 0;

  while (!shouldStop) {
    iteration++;

    // Проверяем оставшиеся прокси
    const allP = await loadProxies();
    const usedP = await loadUsedProxies();
    const remaining = allP.filter((p) => !usedP.includes(p.raw));

    if (remaining.length === 0) {
      const msg = `🏁 <b>Все прокси использованы!</b>\n\n✅ Успешных: ${successCount}\n❌ Ошибок: ${failCount}`;
      console.log(msg);
      await tgSendMessage(msg);
      if (successCount > 0) await tgSendCookiesArchive();
      break;
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`  #${iteration} | ${new Date().toLocaleString()} | Прокси: ${remaining.length} | ✅${successCount} ❌${failCount} | SMS: ${smsProvider}`);
    console.log(`${"═".repeat(50)}`);

    await performRegistration();

    // Проверяем shouldStop ещё раз (мог измениться во время регистрации)
    if (shouldStop) break;

    const pause = randInt(CONFIG.loopDelay, CONFIG.loopDelay * 2);
    console.log(`\n⏳ Пауза ${(pause / 1000).toFixed(1)}с…`);
    await sleep(pause);
  }

  isRunning = false;
  console.log("\n⏹ Цикл регистрации остановлен.");
  await tgSendMessage(`⏹ <b>Регистрация остановлена</b>\n\n✅ Успешных: ${successCount}\n❌ Ошибок: ${failCount}\n⏱ ${new Date().toLocaleString()}`);

  if (successCount > 0) {
    await tgSendCookiesArchive();
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🤖 Бот Subito.it — управление через Telegram");
  console.log(`   TG Bot Token: ${TG_BOT_TOKEN.substring(0, 10)}…`);
  console.log(`   TG Chat ID: ${TG_CHAT_ID}`);
  console.log(`   Email domain: ${EMAIL_API.domain}`);
  console.log(`   SMS провайдер: ${smsProvider}`);
  if (smsProvider === "simsms") {
    console.log(`   SimSms: service=${SIMSMS_API.service}, country=${SIMSMS_API.country}`);
  } else {
    console.log(`   Spanch: gw=${SPANCH_API.gateway}, country=${SPANCH_API.country}, route=${SPANCH_API.route || "—"}, op=${SPANCH_API.operator || "—"}`);
  }
  console.log(`   Proxy file: ${CONFIG.proxyFile}`);
  console.log(`   Headless: ${CONFIG.headless}\n`);

  await ensureCookiesDir();

  // Отправляем приветственное сообщение
  await tgSendMessage(
    `🤖 <b>Бот запущен и ждёт команду</b>\n\n` +
    `📧 Email: ${EMAIL_API.domain}\n` +
    `📱 SMS: ${getSmsStatusText()}\n` +
    `📋 Прокси: ${CONFIG.proxyFile}\n\n` +
    `/start — запустить регистрацию\n` +
    `/stop — остановить\n` +
    `/status — статус\n` +
    `/sms — настройки SMS\n` +
    `/help — помощь\n\n` +
    `⏱ ${new Date().toLocaleString()}`
  );

  // Запускаем polling — бот будет ждать команды бесконечно
  console.log("📡 Ожидание команд из Telegram…\n   Отправьте /start в чат для начала.\n");
  await tgPollUpdates();
}

// ─── CRASH HANDLER ─────────────────────────────────────────────────────────────

process.on("uncaughtException", async (err) => {
  console.error("💥 CRASH:", err);
  isRunning = false;
  await tgSendMessage(`💥 <b>БОТ УПАЛ!</b>\n\n<code>${err.message.substring(0, 500)}</code>\n\n✅ ${successCount} | ❌ ${failCount}\n⏱ ${new Date().toLocaleString()}`);
  if (successCount > 0) await tgSendCookiesArchive();
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  console.error("💥 UNHANDLED:", reason);
  isRunning = false;
  const msg = reason instanceof Error ? reason.message : String(reason);
  await tgSendMessage(`💥 <b>БОТ УПАЛ (unhandled)!</b>\n\n<code>${msg.substring(0, 500)}</code>\n\n✅ ${successCount} | ❌ ${failCount}\n⏱ ${new Date().toLocaleString()}`);
  if (successCount > 0) await tgSendCookiesArchive();
  process.exit(1);
});

main().catch(async (err) => {
  console.error("💥 Критическая ошибка:", err);
  await tgSendMessage(`💥 <b>Критическая ошибка!</b>\n\n<code>${err.message?.substring(0, 500) || err}</code>\n\n✅ ${successCount} | ❌ ${failCount}`);
  if (successCount > 0) await tgSendCookiesArchive();
  process.exit(1);
});
